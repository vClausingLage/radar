import Phaser from "phaser";
import { IffCode, PlayerShip, Target } from "../../entities/ship";

import { Antenna } from "./modules/antenna";
import { Emitter } from "./modules/emitter";
import { Receiver } from "./modules/receiver";
import { TrackingComputer } from "./modules/trackingComputer";
import { RwrReceiver } from "./modules/rwr";
import { Jammer, JammerError, JammerHudStatus, JammingContest } from "./modules/jammer";
import { TerrainMapper } from "./modules/terrainMapper";
import { CfarDetector } from "./modules/cfarDetector";
import { FlightDatalink } from "./modules/flightDatalink";
import { IffInterrogator, Transponder } from "./modules/iffInterrogator";
import { Irst } from "./modules/irst";
import { profileStart, profileStop } from "../../performance/profiler";

import { FireControl } from "./fireControl";

import { BeamHit, RadarReturn } from "../data/radarReturn";
import {
    beamGain,
    chaffCellCrossSection,
    crossSection,
    emissionSignal,
    gasTransmission,
    isDetected,
    jammerSignal,
    radialSpeed,
    scanLossFactor,
    specularFactor,
    beamPattern,
} from "../data/signalPath";
import { Track, clearIff, iffStateOf } from "../data/track";
import { Entity, GasVolume, Loadout, Mode, RadarHost, Terrain } from "../data/types";

import { InterfaceRenderer } from "../renderer/interfaceRenderer";
import { RadarRenderer } from "../renderer/radarRenderer";
import { TerrainRenderer } from "../renderer/terrainRenderer";
import { ReceiverVideoRenderer } from "../renderer/receiverVideoRenderer";

import { Ray } from "../../physics/ray";
import { RadarEventEmitter } from "./game/radarEventEmitter";

import {
    CLUTTER_GAS_DENSITY,
    CLUTTER_CHAFF_DENSITY,
    CLUTTER_TERRAIN_DENSITY,
    JAMMER_HUD_STANDBY_COLOR,
    JAMMER_STT_DEGRADE_PROB,
    MAX_TWS_TRACKS,
    RADAR_BEAM_WIDTH_DEG,
    RADAR_PULSE_LENGTH_PX,
    RADAR_DEFAULT_RANGE_PX,
    IFF_MATE_PPLI_PX,
    IRST_FIELD_OF_REGARD_DEG,
    LINK_TRACK_MIN_AGE_SCANS,
    RWR_BEARING_ACCURACY_DEG,
    STT_ACQUISITION_BEAM_DEG,
    STT_ACQUISITION_FRAMES,
    STT_BEAM_DEG,
    STT_BEAM_RAY_SPACING_DEG,
    STT_LOCK_BREAK_FRAMES,
    STT_RANGE_GATE_PX,
    TRACK_STT_COURSE_WINDOW_FRAMES,
    TRACK_STT_MAX_MISSED_FRAMES,
    TRACK_STT_MIN_COURSE_SPEED_PX,
    decoySettings,
} from "../data/radarGameSettings";

export class Radar {
    private owner: RadarHost | null = null;

    private mode: Mode = 'rws';
    // Rated range: what the interface draws, and the range this radar's energy
    // budget is quoted at. The pulse itself goes further (see Emitter and
    // data/signalPath.ts) - this is not a wall.
    private range: number;
    // Mechanical by default; a caller can inject a PhasedArrayAntenna
    // instead (see systems/modules/antenna.ts) without this class knowing or
    // caring which it got — everything here talks to the shared interface.
    private antenna: Antenna;
    private emitter: Emitter;
    private receiver: Receiver = new Receiver();
    // Bearing (deg) of the most recent pulse, exposed so a mount can align to the
    // beam (e.g. the dish sprite spins to the current dome bearing).
    private lastBeamDirection = 0;

    private trackingComputer: TrackingComputer = new TrackingComputer();
    private sweepBuffer: BeamHit[] = [];
    // Thermal false alarms accumulated for the sweep in progress. Kept apart
    // from sweepBuffer: these are already-decided detections (the false-alarm
    // roll itself is the Pfa event), not hits still waiting on the energy
    // budget, so they skip processHits' signal test rather than going through
    // it a second time on made-up geometry.
    private falseAlarmBuffer: RadarReturn[] = [];

    // STT state. The lock is held on a track id only: everything the radar
    // knows about the target while locked comes back through the beam.
    private sttTrackId: number | null = null;
    private sttMissedFrames: number = 0;
    // The track the pilot has picked to work (the target designation box). A
    // lock and a TWS shot go to it before they go to the radar's own idea of
    // the best or nearest contact; with none picked, or the pick gone from the
    // scope, they fall back to that. Held by track id, which is never reused.
    private designatedTrackId: number | null = null;
    // Frames left of the wide acquisition dwell that opens every lock.
    private sttAcquireFrames: number = 0;

    // Weapons system. The radar (sensor) produces tracks; FireControl consumes
    // them to launch and guide missiles. Constructed in the constructor (needs
    // the scene).
    private fireControl: FireControl;

    public rwrReceiver = new RwrReceiver();
    public jammer = new Jammer();

    // The infrared search-and-track head, on a ship that carries one (the
    // ship factory fits it; the dish has none). Passive: it runs in every
    // mode, EMCON included, and its lock is the VIM-90's other cue.
    private irst: Irst | null = null;
    // The hot hulls, gas and terrain the last update saw, for a VIM-90 shot
    // taken between updates (the player's key press): its seeker looks at
    // the same world the IRST does.
    private irWorld: { sources: (PlayerShip | Target)[]; gasVolumes: GasVolume[]; terrain: Terrain[] } =
        { sources: [], gasVolumes: [], terrain: [] };

    // The flight net this radar's host belongs to, if any. Gives the radar the
    // one thing it cannot measure - whose side a contact is on - for the
    // wingmen only: see setDatalink().
    private datalink: FlightDatalink | null = null;

    // IFF. The interrogator rides on this radar's antenna; the transponder it
    // asks about is on the other ships (Ship.iffCode). `iffAvailable` is the
    // scene's say - a story level may not have it - and `iffAutonomous` is an
    // AI set's habit: it interrogates its picture on a cadence, and its fire
    // control will not release on a track that answered friendly. The
    // player's set is manual (the I key) and its trigger is its own call.
    private iffInterrogator = new IffInterrogator();
    private iffAvailable = true;
    private iffAutonomous = false;
    // The ships and gas the last update saw, kept for an interrogation asked
    // between updates (the player's key press).
    private iffWorld: { transponders: Transponder[]; gasVolumes: GasVolume[] } = { transponders: [], gasVolumes: [] };

    // Ground-mapping half of the radar: terrain returns bypass the tracking
    // pipeline entirely and are painted like a mapping radar's display.
    private terrainMapper = new TerrainMapper();

    // Ground/volume clutter map and the CFAR threshold it drives — logs
    // terrain and gas returns as they are swept, and raises the noise floor a
    // ship return near them is judged against (see updateRws and
    // Receiver.processHits' localNoiseFloor).
    private cfarDetector = new CfarDetector();

    // Jamming captured if an enemy jammer painted us during the current RWS
    // sweep: its rolled offset and its range from us, so the energy contest
    // (does the burst out-shout the echo we actually caught?) can be judged at
    // sweepComplete with the sweep's real signal in hand. Cleared after use.
    private sweepJamming: { error: JammerError; range: number; bearingDeg: number } | null = null;

    public eventEmitter = new RadarEventEmitter();

    private interfaceRenderer: InterfaceRenderer | null = null;
    // Only the player's radar has a renderer; target radars track silently.
    private radarRenderer: RadarRenderer | null = null;
    // Raw receiver output ring — player-only, like the scope.
    private receiverVideoRenderer: ReceiverVideoRenderer | null = null;

    private raycaster = new Ray();

    private scene: Phaser.Scene;

    constructor(params: { scene: Phaser.Scene; range?: number; antenna?: Antenna }) {
        this.scene = params.scene;
        this.range = params.range ?? RADAR_DEFAULT_RANGE_PX;
        this.antenna = params.antenna ?? new Antenna();
        this.emitter = new Emitter(this.range);
        this.fireControl = new FireControl(this.scene);
    }

    // Attach the visual renderer. Called by the player ship factory only.
    setRadarRenderer(renderer: RadarRenderer): void {
        this.radarRenderer = renderer;
        this.fireControl.setRadarRenderer(renderer);
    }

    // Attach the terrain (ground-mapping) renderer. Player-only, like the
    // radar renderer — AI radars discard terrain returns.
    setTerrainRenderer(renderer: TerrainRenderer): void {
        this.terrainMapper.setRenderer(renderer);
    }

    // Attach the receiver video ring (player-only, like the scope).
    setReceiverVideoRenderer(renderer: ReceiverVideoRenderer): void {
        this.receiverVideoRenderer = renderer;
    }

    setInterfaceRenderer(renderer: InterfaceRenderer): void {
        this.interfaceRenderer = renderer;
    }
    getInterfaceRenderer(): InterfaceRenderer | null {
        return this.interfaceRenderer;
    }

    attachTo(owner: RadarHost): void {
        this.owner = owner;
    }

    // ── IRST ──────────────────────────────────────────────────────────────

    fitIrst(irst: Irst): void {
        this.irst = irst;
    }
    getIrst(): Irst | null {
        return this.irst;
    }

    // IRST mode: the transmitter goes silent exactly as in EMCON (the radar's
    // picture is no longer refreshed, so it goes dark) and the IRST head takes
    // over the scope, looking for heat in its narrow window off the nose. No-op
    // on a ship without an IRST.
    enterIrst(): void {
        if (!this.irst) return;
        if (this.mode === 'stt') this.clearSttState();
        this.mode = 'irst';
        this.trackingComputer.setTracks([]);
        this.sweepBuffer = [];
        this.falseAlarmBuffer = [];
    }

    // Lock the IRST onto the heat source nearest the nose (the lock key, in
    // IRST mode). Returns whether it holds a lock afterwards.
    lockIrst(): boolean {
        if (this.mode !== 'irst' || !this.irst || !this.owner) return false;
        return this.irst.isLocked() || this.irst.lock(this.owner.getDirection());
    }

    // Let go of the IRST lock and go back to searching with the head.
    unlockIrst(): void {
        this.irst?.unlock();
    }

    // Leaving IRST mode switches the head off: its contacts and lock are a
    // picture of the window it was looking through, and nothing refreshes them
    // once the scope belongs to the radar again.
    private leaveIrst(): void {
        if (this.mode === 'irst') this.irst?.reset();
    }

    // Is the transmitter radiating? Not in EMCON, and not in IRST mode, which
    // is EMCON with the heat sensor working.
    isTransmitting(): boolean {
        return this.mode !== 'emcon' && this.mode !== 'irst';
    }

    // Half-width (deg) of the cone a contact has to stay inside, off the nose,
    // for this radar to keep it: the search azimuth in RWS and TWS, and the
    // RWS cone in STT, which is where the dish's gimbal runs out and the lock
    // breaks. Null with no cone to keep - transmitter silent, or the dome's
    // full circle. A pilot cranking or splitting off a contact asks this so
    // as not to turn it off the scope.
    holdingHalfAzimuthDeg(): number | null {
        if (this.mode === 'stt') return this.antenna.getAzimuth('rws') / 2;
        if (this.mode === 'rws' || this.mode === 'tws') return this.antenna.getAzimuth(this.mode) / 2;
        return null;
    }

    // Join a flight's datalink. From here on the host broadcasts its PPLI every
    // frame, and both sensors can tell a wingman from a stranger: tracks that
    // sit on a member's PPLI are tagged friendly (updateFriendTags), and an RWR
    // emitter on a member's bearing is filtered out of the warning picture. A
    // radar without a datalink - the player's - behaves exactly as before.
    setDatalink(datalink: FlightDatalink | null): void {
        this.datalink = datalink;
        this.rwrReceiver.setFriendFilter(datalink
            ? bearingDeg => this.owner !== null && datalink.matchesMemberBearing(
                this.owner.getPosition(), this.owner.id, bearingDeg,
                RWR_BEARING_ACCURACY_DEG, this.scene.time.now,
            )
            : null);
    }

    setMode(mode: Mode): void {
        if (mode !== 'irst') this.leaveIrst();
        this.mode = mode;
    }
    getMode(): Mode {
        return this.mode;
    }

    // Bearing (deg) of the last pulse — the live beam direction. Used by fixed
    // mounts to spin their dish to the current dome bearing.
    getBeamDirection(): number {
        return this.lastBeamDirection;
    }

    // ── Mode switching ─────────────────────────────────────────────────────

    // RWS and TWS share the same search-and-track pipeline; they differ only in
    // azimuth (60° vs 45°) and TWS's 3-track cap + VIM-220 firing capability.
    // Switching between them preserves existing tracks. Leaving STT re-acquires
    // from scratch since STT discarded all but the locked track.
    enterRws(): void {
        this.leaveIrst();
        if (this.mode === 'stt') {
            this.clearSttState();
            this.trackingComputer.setTracks([]);
        }
        this.mode = 'rws';
        this.sweepBuffer = [];
        this.falseAlarmBuffer = [];
    }

    enterTws(): void {
        this.leaveIrst();
        if (this.mode === 'stt') {
            this.clearSttState();
            this.trackingComputer.setTracks([]);
        }
        this.mode = 'tws';
        this.sweepBuffer = [];
        this.falseAlarmBuffer = [];
    }

    private clearSttState(): void {
        this.sttTrackId = null;
        this.sttMissedFrames = 0;
        this.sttAcquireFrames = 0;
        this.antenna.resetTracking();
    }

    // Emission Control: shut the transmitter down. No pulse goes out, so no
    // other ship's RWR sees us and no returns come back — the tactical picture
    // we built while emitting is no longer being refreshed, so it goes dark
    // too, same as leaving STT. RWR reception and datalink traffic are
    // untouched, since both are driven by other emitters, not our own mode.
    enterEmcon(): void {
        this.leaveIrst();
        if (this.mode === 'stt') {
            this.clearSttState();
        }
        this.mode = 'emcon';
        this.trackingComputer.setTracks([]);
        this.sweepBuffer = [];
        this.falseAlarmBuffer = [];
    }

    // ── STT lock management ────────────────────────────────────────────────

    // The designated track, if it is still one the scope shows.
    designatedTrack(): Track | null {
        if (this.designatedTrackId === null) return null;
        return this.displayedTracks().find(t => t.id === this.designatedTrackId) ?? null;
    }

    // Step the designation to the next track outward from the ship, wrapping
    // round to the nearest. Nearest first because that is the order a pilot
    // wants them in: the one that can hurt first, then the ones behind it.
    cycleDesignation(): void {
        if (!this.owner) return;
        const ownerPos = this.owner.getPosition();
        const byRange = this.displayedTracks().sort((a, b) =>
            Phaser.Math.Distance.Squared(ownerPos.x, ownerPos.y, a.pos.x, a.pos.y)
            - Phaser.Math.Distance.Squared(ownerPos.x, ownerPos.y, b.pos.x, b.pos.y));
        if (byRange.length === 0) { this.designatedTrackId = null; return; }
        const at = byRange.findIndex(t => t.id === this.designatedTrackId);
        this.designatedTrackId = byRange[(at + 1) % byRange.length].id;
    }

    // Lock the designated track, else the highest-confidence RWS track, and
    // enter STT.
    enterStt(): void {
        const tracks = this.displayedTracks();
        if (tracks.length === 0) return;

        const best = this.designatedTrack() ?? tracks.reduce((a, b) =>
            b.confidence > a.confidence ? b : a
        );

        this.sttTrackId = best.id;
        this.sttMissedFrames = 0;
        // Designate the dish onto the track: it snaps to the track's bearing on
        // the first STT frame, then has to keep up on its own from there. The
        // designation is only as good as the last sweep, so the beam stays wide
        // for the acquisition dwell while the track is re-measured properly.
        this.sttAcquireFrames = STT_ACQUISITION_FRAMES;
        this.antenna.resetTracking();

        this.leaveIrst();
        this.mode = 'stt';

        // Discard all other tracks — STT focuses entirely on one target.
        this.trackingComputer.setTracks([best]);
        this.sweepBuffer = [];
        this.falseAlarmBuffer = [];
    }

    exitStt(): void {
        this.clearSttState();
        this.mode = 'rws';
        // Clear the STT track; RWS will rebuild contacts from scratch.
        this.trackingComputer.setTracks([]);
        this.sweepBuffer = [];
        this.falseAlarmBuffer = [];
    }

    getSttTrack(): Track | null {
        if (this.sttTrackId === null) return null;
        return this.trackingComputer.getTracks().find(t => t.id === this.sttTrackId) ?? null;
    }

    // The locked track as fire control is allowed to see it. A lock that has
    // drifted outside the rated range keeps its beam — the antenna is still
    // staring at it, and it comes back the moment the range does — but it
    // stops being a firing solution, the same as any other contact the scope
    // is not drawing.
    private displayedSttTrack(): Track | null {
        const track = this.getSttTrack();
        if (!track || !this.owner || this.isFriendlyTrack(track)) return null;
        return this.withinDisplayRange(this.owner.getPosition(), track.pos) ? track : null;
    }

    // The track picture as the interface draws it, and so as fire control is
    // allowed to use it. The radar's own picture (getTracks) runs further —
    // the energy budget, not the range ring, decides what it can hold — but a
    // contact the player cannot see is not one they get to shoot at, and the
    // same rule binds the AI, which drives the identical radar.
    //
    // A wingman's track is on the scope's list (it is a real echo, and shadows
    // what is behind it) but never in this one: weapons are handed only
    // hostile tracks, so a flight cannot lock, fire on or guide onto its own.
    private displayedTracks(): Track[] {
        if (!this.owner) return [];
        const ownerPos = this.owner.getPosition();
        return this.trackingComputer.getTracks()
            .filter(track => !this.isFriendlyTrack(track) && this.withinDisplayRange(ownerPos, track.pos));
    }

    // A track nothing may be fired at, locked or hunted on: a wingman (PPLI),
    // or - for an autonomous AI set only - one that answered an interrogation
    // as friendly. The player's trigger is deliberately not gated by IFF: a
    // friendly reply is information, the call to shoot is the pilot's.
    private isFriendlyTrack(track: Track): boolean {
        return Boolean(track.friendly) || (this.iffAutonomous && iffStateOf(track) === 'friendly');
    }

    // Every track not identified as a wingman, display range or not - what an
    // AI pilot chooses a contact to investigate from.
    getHostileTracks(): Track[] {
        return this.trackingComputer.getTracks().filter(track => !this.isFriendlyTrack(track));
    }

    // The flight's shared picture as this radar may act on it: the tracks the
    // *other* members report on the link, inside this ship's own display range.
    // The ring binds the shooter - a lead's track out past the wingman's ring
    // is a cue, not a firing solution - so the same range gate as
    // displayedTracks() applies, measured from here.
    //
    // This is deliberately a separate list from displayedTracks(): it is never
    // fed to the normal TWS/STT paths, only to the named launch-on-remote path
    // (shootOnRemote) and to guidance for the missiles launched that way.
    private remoteTracksInRing(): Track[] {
        if (!this.datalink || !this.owner) return [];
        const ownerPos = this.owner.getPosition();
        return this.datalink.remoteTracks(this.owner.id, this.scene.time.now)
            .map(report => report.track)
            .filter(track => this.withinDisplayRange(ownerPos, track.pos))
            .map(track => ({ ...track, dist: Phaser.Math.Distance.Between(ownerPos.x, ownerPos.y, track.pos.x, track.pos.y) }));
    }

    // Could a VIM-220 be launched on this datalinked track right now? It must be
    // a fresh report from another member, inside this ship's ring, and a round
    // must be on the rail. Matched by track number: the source numbers its own
    // tracks, and a two-ship flight has exactly one other source.
    canShootOnRemote(track: Track): boolean {
        return this.getWeaponLoad('VIM-220') > 0 && this.remoteTracksInRing().some(t => t.id === track.id);
    }

    // Tag each track that correlates with a wingman's PPLI. Run every frame
    // after the sweep so a track born this frame is already identified by the
    // time the pilot or fire control looks at it, and a hostile that drifts
    // away from the wingman's position loses the tag again.
    private updateFriendTags(): void {
        if (!this.datalink || !this.owner) return;
        const now = this.scene.time.now;
        for (const track of this.trackingComputer.getTracks()) {
            track.friendly = this.datalink.correlatesWithMember(track.pos, this.owner.id, now);
        }
    }

    // Put this radar's matured hostile tracks on the flight's link. Run after
    // the friend tags, so a wingman is never reported as a target; with the
    // transmitter off the radar holds no tracks and so sends none - the net
    // carries only what some member is actually looking at.
    private publishSharedTracks(): void {
        if (!this.datalink || !this.owner) return;
        this.datalink.publishTracks(
            this.owner.id,
            this.getHostileTracks().filter(track => track.age >= LINK_TRACK_MIN_AGE_SCANS),
            this.scene.time.now,
        );
    }

    // ── IFF ────────────────────────────────────────────────────────────────

    // The scene decides whether IFF exists at all (Game.iffAvailable); the
    // game loop restates it every frame.
    setIffAvailable(available: boolean): void {
        this.iffAvailable = available;
    }

    // An AI set: interrogates on a cadence and holds fire on a friendly reply.
    setIffAutonomous(autonomous: boolean): void {
        this.iffAutonomous = autonomous;
    }

    // Could an interrogation be sent right now? IFF needs a track to point at,
    // a transmitting radar to ride on and an interrogator that has finished its
    // last cycle - the scope indicator follows hasIffTracks.
    canInterrogate(): boolean {
        return this.hasIffTracks() && this.iffInterrogator.isReady(this.scene.time.now);
    }

    // Is IFF something this radar has to offer right now: available, radiating
    // (an interrogation is an emission, so EMCON has none) and holding at
    // least one track to ask about. What the HUD indicator is shown on.
    hasIffTracks(): boolean {
        return this.iffAvailable && this.isTransmitting() && this.ownerCode() !== null
            && this.trackingComputer.getTracks().length > 0;
    }

    // Ask every track in the picture who it is (the player's I key). Returns
    // whether a question went out. The answer arrives as track.iff.
    interrogate(): boolean {
        if (!this.canInterrogate()) return false;
        this.sendInterrogation(this.trackingComputer.getTracks());
        return true;
    }

    // Is the IFF indicator on the scope's range readout (for the tests)?
    iffIndicatorShown(): boolean {
        return this.radarRenderer?.isIffHintShown() ?? false;
    }

    private ownerCode(): IffCode | null {
        const ship = this.ownerShip();
        return ship ? ship.iffCode : null;
    }

    private sendInterrogation(tracks: Track[]): void {
        const code = this.ownerCode();
        if (!this.owner || code === null) return;
        this.iffInterrogator.interrogate({
            ownerPos: this.owner.getPosition(),
            ownerCode: code,
            ratedRangePx: this.range,
            tracks,
            transponders: this.iffWorld.transponders,
            gasVolumes: this.iffWorld.gasVolumes,
            now: this.scene.time.now,
        });
    }

    // Per-frame IFF upkeep, run after the sweep has updated the tracks: take
    // stock of the transponders in the world, let old answers age out, and -
    // for an autonomous set - interrogate on the cadence. A lock that turns
    // out friendly is dropped, so an AI never goes on holding a wingman.
    private updateIff(entities: Entity[], gasVolumes: GasVolume[]): void {
        if (!this.owner) return;
        const now = this.scene.time.now;
        const tracks = this.trackingComputer.getTracks();
        this.iffInterrogator.ageOut(tracks, now);
        if (!this.iffAvailable) {
            for (const track of tracks) clearIff(track);
            return;
        }

        // A flight mate's reply is no evidence about a track: the datalink
        // already says where the mate is (PPLI), and letting its answer vouch
        // for whatever track lies in its gate would have a wingman closing on
        // a target make the target read friendly to its own lead. The mate's
        // transponder is recognised by where it is, as everything here is.
        const mates = this.datalink?.wingmen(this.owner.id, now) ?? [];
        this.iffWorld = {
            transponders: entities
                .filter((e): e is PlayerShip | Target =>
                    e.id !== this.owner?.id && (e instanceof PlayerShip || e instanceof Target) && e.active && Boolean(e.body))
                .map(e => ({ pos: e.getPosition(), code: e.iffCode }))
                .filter(t => !mates.some(m => Phaser.Math.Distance.Between(m.pos.x, m.pos.y, t.pos.x, t.pos.y) <= IFF_MATE_PPLI_PX)),
            gasVolumes,
        };

        // An autonomous set asks on its cadence, and at once about any matured
        // track nobody has asked yet.
        if (this.iffAutonomous && this.isTransmitting()) {
            const candidates = IffInterrogator.autoCandidates(tracks);
            const unasked = candidates.some(track => iffStateOf(track) === 'not interrogated');
            if (candidates.length > 0 && (unasked || this.iffInterrogator.autoDue(now))) {
                this.iffInterrogator.noteAutoInterrogation(now);
                this.sendInterrogation(candidates);
            }
        }

        if (this.mode === 'stt') {
            const locked = this.getSttTrack();
            if (locked && this.isFriendlyTrack(locked)) this.exitStt();
        }
    }

    // ── Jammer ─────────────────────────────────────────────────────────────

    // Trigger a jamming burst (player input). No-op while active, cooling down,
    // or with the transmitter shut down (EMCON) — jamming is itself an emission.
    activateJammer(): void {
        if (!this.isTransmitting()) return;
        this.jammer.activate(this.scene.time.now);
    }

    // True when a jamming burst could be started right now: off cooldown and
    // not blocked by EMCON. Lets an AI check before committing to the burst.
    isJammerReady(): boolean {
        if (!this.isTransmitting()) return false;
        return this.jammer.isReady(this.scene.time.now);
    }

    // True when `point` lies inside the cone our jammer would project — i.e.
    // the nose is pointed close enough at it for a burst to spoof its radar.
    isJammerAimedAt(point: { x: number; y: number }): boolean {
        if (!this.owner) return false;
        return this.jammer.covers(
            this.owner.getPosition(), this.owner.getDirection(), point, this.range,
        );
    }

    // Cone-readout status for the jammer (active/cooldown/ready countdown).
    // EMCON overrides the readout to standby regardless of the underlying
    // timer, since the transmitter is off and the jammer cannot be triggered.
    getJammerHudStatus(): JammerHudStatus {
        if (!this.isTransmitting()) {
            return { label: 'JAMMER STDBY', color: JAMMER_HUD_STANDBY_COLOR };
        }
        return this.jammer.getHudStatus(this.scene.time.now);
    }

    // ── Fire control (delegated to FireControl) ────────────────────────────

    cycleLoadout(): void {
        this.fireControl.cycleLoadout();
    }

    setLoadout(loadout: Loadout): void {
        this.fireControl.setLoadout(loadout);
    }

    selectWeapon(type: string): void {
        this.fireControl.selectWeapon(type);
    }

    getWeaponLoad(type: string): number {
        return this.fireControl.getWeaponLoad(type);
    }

    // Place a VIM-220 mid-course waypoint (Shift+click). See FireControl.
    addVim220Waypoint(point: { x: number; y: number }): void {
        this.fireControl.addVim220Waypoint(point);
    }

    clearVim220Waypoints(): void {
        this.fireControl.clearVim220Waypoints();
    }

    hasFullVim220Route(): boolean {
        return this.fireControl.hasFullVim220Route();
    }

    // Fire the weapon matching the current mode (STT → VIM-177, TWS → VIM-220).
    // The radar supplies the track picture; FireControl owns the launch. A
    // confirmed launch fires a 'missile-fired' event on this radar's own
    // emitter — only the player's radar has a listener (see Game.create()),
    // so AI ships firing the same weapons stay silent. Returns whether a round
    // actually left the rail, so a shooter (the AI) can tell a refused shot
    // from a fired one without watching the loadout count.
    //
    // `only` confines a TWS shot to that track: a flight member shooting its
    // sorted group does not spend a round on the other member's.
    shoot(only?: Track): boolean {
        const tracks = this.displayedTracks();
        const ctx = {
            ship: this.ownerShip(),
            sttTrack: this.displayedSttTrack(),
            tracks: only ? tracks.filter(t => t.id === only.id) : tracks,
            designatedId: this.designatedTrack()?.id ?? null,
            irstLockBearing: this.irst?.getLock()?.bearingDeg ?? null,
            irWorld: this.irWorld,
        };
        const fired = this.fireControl.shoot(this.mode, ctx);
        if (fired) {
            this.eventEmitter.emitMissileFired(fired);
        } else {
            // Only the player's radar has a HUD to tell: an AI shot that is
            // refused is simply not taken.
            const why = this.fireControl.refusalReason(this.mode, ctx);
            this.interfaceRenderer?.showShotRefused(why.reason, why.hint);
        }
        return fired !== null;
    }

    // Launch on remote: fire a VIM-220 at a track a flight mate holds and sent
    // over the link, with this ship's own transmitter in whatever mode it is -
    // EMCON included. The missile needs no illumination from the shooter: it
    // flies the link's track to its activation range and finds the target with
    // its own seeker. The track is re-resolved against the link, so a stale or
    // invented one launches nothing; and it must be inside this ship's ring.
    // Mid-course updates keep coming from the link while the lead holds the
    // track (remoteTracksInRing in the guidance context below). Returns whether
    // a round left the rail, as shoot() does.
    shootOnRemote(track: Track): boolean {
        const remote = this.remoteTracksInRing().find(t => t.id === track.id);
        if (!remote) return false;
        const fired = this.fireControl.shootOnRemote(this.ownerShip(), remote);
        if (fired) {
            this.eventEmitter.emitMissileFired(fired);
        }
        return fired !== null;
    }

    // Max range (px) of a given weapon type, selected or not — lets an AI judge
    // a shot without switching the loadout to find out.
    getMissileRange(type: string): number | null {
        return this.fireControl.getMissileRange(type);
    }

    // ── Main update ───────────────────────────────────────────────────────

    update(
        delta: number,
        _direction: number,
        entities: Entity[],
        graphics: Phaser.GameObjects.Graphics,
        decoyCircles: Phaser.Geom.Circle[] = [],
        terrain: Terrain[] = [],
        gasVolumes: GasVolume[] = [],
    ): void {
        profileStart('Radar_update');
        if (!this.owner) return;

        const ownerPos = this.owner.getPosition();
        const shipDirection = this.owner.getDirection();

        // Broadcast our PPLI first, so a wingman updating later this frame
        // correlates against where we are now rather than where we were.
        this.datalink?.publish(this.owner.id, ownerPos, this.scene.time.now);

        // Age out stale RWR contacts (incoming-emission warnings).
        this.rwrReceiver.tick(this.scene.time.now);
        // Advance jammer active/cooldown state before any isActive() check.
        this.jammer.tick(this.scene.time.now);
        // Drop clutter whose source has moved on.
        this.cfarDetector.tick(this.scene.time.now);

        // Update the weapons system every frame regardless of radar mode. The
        // radar supplies the track picture and live entities; FireControl runs
        // missile guidance, the waypoint fade and the seeker-cone rendering.
        // Live ship entities (excluding owner) for VIM-220 active-radar homing.
        // Exclude destroyed ships (body becomes undefined when removed). A flight
        // mate is NOT excluded: its hull is in the seeker's world like any
        // other. Keeping missiles off it is the seeker's job, done from the
        // PPLI the guidance hands it over the datalink (MissileRadar.
        // setFriendPicture), and the shooters' job before they fire.
        const targetShips = entities.filter(
            (e): e is PlayerShip | Target =>
                e.id !== this.owner?.id
                && 'getDirection' in e && e.active && Boolean(e.body),
        );
        // Guidance is fed the same gated picture as the trigger: a missile in
        // flight rides the track the scope is showing, so a contact that runs
        // out past the ring takes its mid-course updates (and a SARH missile's
        // illumination) with it until it is back inside.
        // Heat comes off the ships alone: chaff has none, and terrain is cold.
        this.irWorld = { sources: targetShips, gasVolumes, terrain };
        // The IRST head only works while it has the scope (IRST mode).
        if (this.mode === 'irst') this.irst?.update(ownerPos, shipDirection, targetShips, gasVolumes, terrain);

        this.fireControl.update(delta, {
            sttTrack: this.displayedSttTrack(),
            tracks: this.displayedTracks(),
            remoteTracks: this.remoteTracksInRing(),
            targets: targetShips,
            irSources: targetShips,
            decoyCircles,
            gasVolumes,
            terrain,
            datalink: this.datalink,
            now: this.scene.time.now,
        }, graphics);

        // A silent transmitter puts no echoes on the receiver — noise only.
        if (!this.isTransmitting()) this.receiverVideoRenderer?.update([]);

        if (this.mode === 'stt') {
            this.updateStt(delta, ownerPos, shipDirection, entities, graphics, decoyCircles, terrain, gasVolumes);
        } else if (this.mode === 'emcon') {
            this.updateSilent(ownerPos, shipDirection, graphics, this.antenna.getAzimuth('rws'), 'RDR STDBY');
        } else if (this.mode === 'irst') {
            this.updateSilent(ownerPos, shipDirection, graphics, IRST_FIELD_OF_REGARD_DEG, 'IRST');
        } else {
            this.updateRws(ownerPos, shipDirection, entities, graphics, decoyCircles, terrain, gasVolumes);
        }
        this.updateFriendTags();
        this.updateIff(entities, gasVolumes);
        this.publishSharedTracks();

        // Paint the ground-mapping picture (persisted, decaying terrain returns).
        this.terrainMapper.render(graphics, ownerPos, this.range, this.scene.time.now);
        // The receiver only listens where the antenna can point: the search
        // sector (STT stares inside the RWS cone it can gimbal across). With
        // the transmitter off there is no sector — noise only, all round.
        const listening = !this.isTransmitting()
            ? null
            : { centreDeg: shipDirection, widthDeg: this.antenna.getAzimuth(this.mode === 'stt' ? 'rws' : this.mode) };
        this.receiverVideoRenderer?.render(graphics, ownerPos, listening);
        if (this.irst && this.mode === 'irst') {
            this.radarRenderer?.renderIrst(graphics, ownerPos, this.irst.getContacts(), this.irst.getLock(), this.range);
        }
        profileStop('Radar_update');
    }

    // ── RWS sweep ─────────────────────────────────────────────────────────

    private updateRws(
        ownerPos: { x: number; y: number },
        shipDirection: number,
        entities: Entity[],
        graphics: Phaser.GameObjects.Graphics,
        decoyCircles: Phaser.Geom.Circle[],
        terrain: Terrain[],
        gasVolumes: GasVolume[],
    ): void {
        profileStart('Radar_updateRws');
        const scanWidth = this.antenna.getAzimuth(this.mode);
        const scanStartAngle = shipDirection - scanWidth / 2;
        const scanEndAngle = shipDirection + scanWidth / 2;

        const { direction: pulseDirection, sweepComplete } = this.antenna.update(this.mode, shipDirection);
        this.lastBeamDirection = pulseDirection;
        const pulse = this.emitter.sendPulse(ownerPos, pulseDirection, scanWidth);
        // A phased array's gain falls off the further the beam scans from its
        // own boresight; a mechanical dish's scanAngleDeg is always 0, so this
        // is a no-op (factor 1) for the antenna every current scenario uses.
        const scanGain = beamGain(scanWidth) * scanLossFactor(this.antenna.scanAngleDeg(shipDirection));

        this.radarRenderer?.update({
            graphics, radarPosition: ownerPos, radarRange: this.range,
            scanStartAngle, scanEndAngle,
            loadout: this.fireControl.getLoadout(),
            vim220Waypoints: this.fireControl.getWaypoints(), pulse,
            vim220TimeToActive: this.fireControl.getLastVim220TimeToActive(),
            missileRange: this.fireControl.getActiveMissileRange(),
            jammerStatus: this.getJammerHudStatus(),
            vim220WaypointAlpha: this.fireControl.getWaypointAlpha(),
            iffHint: this.hasIffTracks(),
        });

        // Render our own jamming cone while the jammer is running.
        if (this.jammer.isActive()) {
            this.radarRenderer?.renderJammerCone(graphics, ownerPos, shipDirection, this.range);
        }

        const targets = entities.filter(e => e.id !== this.owner?.id);

        // Search illumination: any ship the beam touches detects the emission as
        // a (non-locked) RWR contact — shown as a green diamond on its RWR.
        // The off-beam sidelobe test only runs on sweepComplete (see
        // illuminateRwr) — once per leg, not once per frame.
        this.illuminateRwr(targets, [pulse.line], ownerPos, false, gasVolumes, scanGain, sweepComplete, pulseDirection, RADAR_BEAM_WIDTH_DEG);
        this.registerJammingStrobes(targets, ownerPos);

        // If an enemy jammer paints us this frame, remember its spoof error
        // and its range for the rest of the sweep — at sweepComplete the
        // buffered hits are judged against the burst's energy before anything
        // is rewritten.
        const jamming = this.detectJamming(targets, [pulse.line], ownerPos);
        if (jamming) this.sweepJamming = jamming;

        // What the ray lights up (reflectorsAlong). The pencil ray is its own
        // beam boresight, so hits are pattern-weighted at the pencil's width.
        const lit = this.reflectorsAlong(
            pulse.line, ownerPos, targets, terrain, decoyCircles, pulseDirection, RADAR_BEAM_WIDTH_DEG, gasVolumes,
        );

        if (lit.terrain) {
            // Ground mapping is a picture, not a track, and the picture stops at
            // the rated range - the beam reaching past it paints nothing. Gas
            // dims what is inside exactly as it dims a contact.
            if (this.withinDisplayRange(ownerPos, lit.terrain.point)
                && !this.receiver.isAbsorbedByGas(ownerPos, lit.terrain.point, gasVolumes)) {
                this.terrainMapper.addSample(lit.terrain.point, lit.terrain.normal, ownerPos, this.scene.time.now);
                // Ground clutter: whatever the ground map is painting here is
                // also raising the floor a ship return here must clear.
                this.cfarDetector.addClutter(lit.terrain.point, CLUTTER_TERRAIN_DENSITY, this.scene.time.now);
            }
        }
        if (lit.chaff) {
            // The cloud's echo goes into the sweep like any reflection — and
            // the cloud is logged as the zero-Doppler clutter it is, across
            // the whole run of the ray through it, so the clutter filter
            // switches in around it (and its own echo, sitting still, is the
            // first thing that filter takes out).
            this.sweepBuffer.push(...lit.chaff.hits);
            this.logChaffClutter(lit.chaff);
        }
        // Gas and chaff only weaken a hull's echo, so they go into the hit's
        // signal budget, to be weighed against range and hull size when the
        // sweep is processed.
        if (lit.ship) this.sweepBuffer.push(lit.ship);

        // Volume clutter: gas returns a diffuse floor across the cells it
        // occupies, logged along its spine rather than gated by this frame's
        // beam direction — a simplification (a real set only logs clutter
        // where it has actually looked), reasonable for a medium diffuse
        // enough that a single ray's worth of sampling would not represent it
        // fairly either way.
        for (const gas of gasVolumes) {
            const density = CLUTTER_GAS_DENSITY * gas.density;
            this.cfarDetector.addClutter({ x: gas.line.x1, y: gas.line.y1 }, density, this.scene.time.now);
            this.cfarDetector.addClutter({ x: gas.line.x2, y: gas.line.y2 }, density, this.scene.time.now);
            this.cfarDetector.addClutter(
                { x: (gas.line.x1 + gas.line.x2) / 2, y: (gas.line.y1 + gas.line.y2) / 2 },
                density,
                this.scene.time.now,
            );
        }

        // Thermal false alarm, rolled by the detector whose threshold the
        // noise would have to cross (CfarDetector.rollFalseAlarm). The phantom
        // it returns is already a decided detection — the roll *is* the Pfa
        // event — so it goes straight into falseAlarmBuffer rather than
        // through the signal budget a second time.
        const phantom = this.cfarDetector.rollFalseAlarm(
            ownerPos, pulseDirection, this.emitter.getReach(), this.scene.time.now,
        );
        if (phantom) this.falseAlarmBuffer.push(phantom);

        if (sweepComplete) {
            const now = this.scene.time.now;
            // The jammer must first win the energy contest: its burst is
            // judged against the signal the sweep's real echoes actually
            // carry (nominal — scintillation and CFAR ride on top). Only a
            // burst that out-shouts them rewrites the sweep into one coherent
            // false track; a weaker one loses and the real returns process
            // normally — burn-through is the fourth-power range law doing its
            // work. False alarms are neither an echo nor a spoof: they are
            // noise, appended untouched either way.
            let processed: RadarReturn[];
            let contest: JammingContest | null = null;
            if (this.sweepJamming) {
                const jam = jammerSignal(this.sweepJamming.range, this.range);
                const signal = this.receiver.dwellSignal(this.sweepBuffer, ownerPos, this.range, scanGain);
                const jammed = signal > 0 && jam >= signal;
                contest = {
                    bearingDeg: this.sweepJamming.bearingDeg,
                    jammerSignal: jam,
                    echoSignal: signal,
                    jammed,
                    spoofBearingDeg: jammed ? this.sweepJamming.bearingDeg + this.sweepJamming.error.angle : null,
                };
                processed = jammed
                    ? this.receiver.createFakeHits(this.sweepBuffer, ownerPos, this.range, this.sweepJamming.error, scanGain, jam)
                    : this.receiver.processHits(
                        this.sweepBuffer, ownerPos, this.range, scanGain,
                        point => this.cfarDetector.noiseFloorMultiplier(point, now),
                        (point, speed) => this.cfarDetector.notchGain(point, speed, now),
                    );
            } else {
                processed = this.receiver.processHits(
                    this.sweepBuffer, ownerPos, this.range, scanGain,
                    point => this.cfarDetector.noiseFloorMultiplier(point, now),
                    (point, speed) => this.cfarDetector.notchGain(point, speed, now),
                );
            }
            // Every echo the sweep caught, measured before the detector
            // decided on any of them, and the jamming contest if one was run
            // — what the receiver video ring draws and prints.
            if (this.receiverVideoRenderer) {
                const received = this.receiver.measure(this.sweepBuffer, ownerPos, this.range, scanGain);
                this.receiverVideoRenderer.update(received, contest);
                this.receiverVideoRenderer.printSweep(received, contest);
            }
            const returns = processed.concat(this.falseAlarmBuffer);
            // TWS caps simultaneous tracks; RWS searches without a cap. The
            // MTI gate rides the same picture (search modes only — STT stares
            // rather than builds a picture): the clutter map decides whether a
            // contact's motion is even worth judging.
            const maxTracks = this.mode === 'tws' ? MAX_TWS_TRACKS : Infinity;
            this.trackingComputer.update(returns, ownerPos, {
                maxTracks,
                mtiClutterDensity: point => this.cfarDetector.clutterDensity(point, now),
            });
            this.sweepBuffer = [];
            this.falseAlarmBuffer = [];
            this.sweepJamming = null;
        }

        const designated = this.designatedTrack()?.id;
        for (const track of this.displayedTracks()) {
            this.radarRenderer?.renderRwsContacts(graphics, track, track.id === designated);
        }
        profileStop('Radar_updateRws');
    }

    // ── STT concentrated illumination ─────────────────────────────────────

    // Single-target track. The distinction from RWS is not that the radar knows
    // where the target is — it is that the antenna stops sweeping and stares at
    // one contact, so that contact is measured every frame instead of once per
    // sweep.
    //
    // The loop is closed entirely through the beam: the tracking computer's
    // predicted position commands the antenna, the antenna slews toward that
    // command at a finite rate, the beam illuminates whatever is actually inside
    // it, and those returns correct the prediction. Nothing here reads a
    // target's true position, so the lock can be defeated by out-turning the
    // antenna as well as by terrain, chaff or jamming.
    private updateStt(
        delta: number,
        ownerPos: { x: number; y: number },
        shipDirection: number,
        entities: Entity[],
        graphics: Phaser.GameObjects.Graphics,
        decoyCircles: Phaser.Geom.Circle[],
        terrain: Terrain[],
        gasVolumes: GasVolume[],
    ): void {
        profileStart('Radar_updateStt');
        const rwsHalfAz = this.antenna.getAzimuth('rws') / 2;
        const targets = entities.filter(e => e.id !== this.owner?.id);

        // Aim point: where the filter expects the target to be next frame. If
        // the track is gone entirely there is nothing left to point at.
        const aimPoint = this.sttTrackId !== null
            ? this.trackingComputer.getPredictedPos(this.sttTrackId)
            : null;
        if (!aimPoint) {
            this.exitStt();
            return;
        }

        // Commanded bearing, and the antenna's gimbal limit. A target that
        // drives the command past the edge of the cone cannot be followed — the
        // dish runs into its stop and the lock is lost.
        const commanded = Phaser.Math.RadToDeg(
            Math.atan2(aimPoint.y - ownerPos.y, aimPoint.x - ownerPos.x)
        );
        if (Math.abs(Phaser.Math.Angle.WrapDegrees(commanded - shipDirection)) > rwsHalfAz) {
            this.exitStt();
            return;
        }

        // Where the dish actually ends up, which lags the command whenever the
        // target's bearing rate beats the servo.
        const lockDir = this.antenna.trackTo(commanded, delta);
        this.lastBeamDirection = lockDir;

        // Wide while acquiring, narrow once the track is its own.
        const beamWidth = this.sttAcquireFrames > 0 ? STT_ACQUISITION_BEAM_DEG : STT_BEAM_DEG;
        if (this.sttAcquireFrames > 0) this.sttAcquireFrames--;
        // See updateRws's scanGain: a no-op (factor 1) for the mechanical
        // dish every current scenario locks with.
        const sttGain = beamGain(beamWidth) * scanLossFactor(this.antenna.scanAngleDeg(shipDirection));

        const pulse = this.emitter.sendPulse(ownerPos, lockDir, beamWidth);
        // The beam has width: sample it with a fan of rays spanning that width
        // rather than a single pencil ray down boresight. A target off the beam
        // centre still returns energy — until it falls outside the beam.
        const beamLines = this.beamRays(ownerPos, lockDir, beamWidth);

        // Render full RWS cone with the narrow tracking beam inside it.
        this.radarRenderer?.update({
            graphics, radarPosition: ownerPos, radarRange: this.range,
            scanStartAngle: shipDirection - rwsHalfAz, scanEndAngle: shipDirection + rwsHalfAz,
            loadout: this.fireControl.getLoadout(),
            vim220Waypoints: this.fireControl.getWaypoints(), pulse, sttMode: true,
            vim220TimeToActive: this.fireControl.getLastVim220TimeToActive(),
            missileRange: this.fireControl.getActiveMissileRange(),
            jammerStatus: this.getJammerHudStatus(),
            vim220WaypointAlpha: this.fireControl.getWaypointAlpha(),
            iffHint: this.hasIffTracks(),
        });

        // Render our own jamming cone while the jammer is running.
        if (this.jammer.isActive()) {
            this.radarRenderer?.renderJammerCone(graphics, ownerPos, shipDirection, this.range);
        }

        // Collect every return in the beam, ray by ray (reflectorsAlong):
        // where terrain is nearer it paints the ground map and shadows
        // whatever is behind it, so a target sliding behind a rock starves the
        // lock. Chaff in the beam echoes and lets the beam through, so the
        // cloud and the hull both answer, and both land in the tracking gate:
        // the gate follows their energy, which far out is the cloud's.
        const rawHits: BeamHit[] = [];
        for (const line of beamLines) {
            const lit = this.reflectorsAlong(
                line, ownerPos, targets, terrain, decoyCircles, lockDir, beamWidth, gasVolumes,
            );

            if (lit.terrain) {
                if (this.withinDisplayRange(ownerPos, lit.terrain.point)
                    && !this.receiver.isAbsorbedByGas(ownerPos, lit.terrain.point, gasVolumes)) {
                    this.terrainMapper.addSample(lit.terrain.point, lit.terrain.normal, ownerPos, this.scene.time.now);
                }
            }
            if (lit.chaff) {
                rawHits.push(...lit.chaff.hits);
                this.logChaffClutter(lit.chaff);
            }
            // Gas and chaff only cost a hull energy, which the concentrated
            // STT beam has more of to spend.
            if (lit.ship) rawHits.push(lit.ship);
        }

        // The range gate: a tracker listens only to the few range cells either
        // side of where it expects the target, so only the echoes in there
        // can steer the lock. That is what makes chaff a contest at the hull
        // rather than across the whole cloud: what competes with the hull is
        // the slice of cloud that shares its gate.
        const gateRange = Phaser.Math.Distance.BetweenPoints(ownerPos, aimPoint);
        const gatedHits = rawHits.filter(hit =>
            Math.abs(Phaser.Math.Distance.BetweenPoints(ownerPos, hit.point) - gateRange) <= STT_RANGE_GATE_PX);

        // STT energy overpowers the jammer, so returns are not spoofed — but a
        // burst that still out-shouts the lock's echo has a chance to swallow
        // them, scaling with how badly the echo loses the same J/S contest the
        // sweep runs. A concentrated beam's echo grows as the fourth power of
        // closing range, so the burst wins only far out or against a small
        // hull: burn-through protects a lock the old flat chance degraded
        // regardless of geometry.
        const jamming = this.detectJamming(targets, beamLines, ownerPos);
        let hits = gatedHits;
        let contest: JammingContest | null = null;
        if (jamming) {
            const jam = jammerSignal(jamming.range, this.range);
            const signal = this.receiver.dwellSignal(gatedHits, ownerPos, this.range, sttGain);
            const swallow = JAMMER_STT_DEGRADE_PROB * (signal > 0 ? Math.min(jam / signal, 1) : 1);
            if (Math.random() < swallow) hits = [];
            contest = {
                bearingDeg: jamming.bearingDeg,
                jammerSignal: jam,
                echoSignal: signal,
                jammed: hits.length === 0 && gatedHits.length > 0,
                spoofBearingDeg: null,
            };
        }

        // Lock illumination: any ship in the beam detects a locked (red) RWR
        // contact. STT stares rather than
        // sweeps, so it has no natural once-per-leg cadence to gate a sidelobe
        // roll on — left off here rather than rolled every frame (see
        // illuminateRwr); a ship not the lock's target still gets the plain
        // main-beam test whenever the beam happens to cross it.
        this.illuminateRwr(targets, beamLines, ownerPos, true, gasVolumes, sttGain, false, lockDir, beamWidth);
        this.registerJammingStrobes(targets, ownerPos);

        // The narrow STT beam concentrates the same energy onto a smaller
        // patch of sky — see beamGain in data/signalPath.ts — which is why a
        // lock holds through conditions a search sweep would have lost the
        // contact in.
        // STT stares, so the receiver video refreshes every frame rather than
        // once a sweep — and is not printed, which would be 60 lines a second.
        this.receiverVideoRenderer?.update(this.receiver.measure(rawHits, ownerPos, this.range, sttGain), contest);
        const returns = this.receiver.processHits(hits, ownerPos, this.range, sttGain);
        // STT updates every frame, so every timescale differs from search. A high
        // maxMissedScans keeps the lock alive through brief dropouts without
        // conflicting with the sweep timescale, and the course is fitted over
        // dozens of frames rather than four sweeps: at 0.1 px of target motion
        // per frame there is nothing to read in a shorter baseline, and this
        // estimate is what a SARH seeker leads on.
        this.trackingComputer.update(returns, ownerPos, {
            maxMissedScans: TRACK_STT_MAX_MISSED_FRAMES,
            minCourseSpeed: TRACK_STT_MIN_COURSE_SPEED_PX,
            courseWindow: TRACK_STT_COURSE_WINDOW_FRAMES,
            courseFromMeasurements: true,
            energyGate: true,
        });

        // Track missed-frame counter for lock-break logic.
        if (returns.length > 0) {
            this.sttMissedFrames = 0;
        } else {
            this.sttMissedFrames++;
            if (this.sttMissedFrames > STT_LOCK_BREAK_FRAMES) {
                this.exitStt();
                return;
            }
        }

        const stt = this.getSttTrack();
        if (stt && this.withinDisplayRange(ownerPos, stt.pos)) {
            this.radarRenderer?.renderStt(stt, graphics);
        }
        profileStop('Radar_updateStt');
    }

    // Rays sampling a beam of `widthDeg` centred on `direction`, at fixed
    // angular spacing from one edge to the other, so a wide acquisition beam is
    // sampled as finely as a narrow tracking one.
    private beamRays(
        origin: { x: number; y: number },
        direction: number,
        widthDeg: number,
    ): Phaser.Geom.Line[] {
        const lines: Phaser.Geom.Line[] = [];
        const count = Math.max(2, Math.round(widthDeg / STT_BEAM_RAY_SPACING_DEG) + 1);
        const spacing = widthDeg / (count - 1);

        // Traced to the same reach as a search pulse: a tracking beam is
        // narrower than a search sweep, not shorter.
        const reach = this.emitter.getReach();
        for (let i = 0; i < count; i++) {
            const rad = Phaser.Math.DegToRad(direction - widthDeg / 2 + spacing * i);
            lines.push(new Phaser.Geom.Line(
                origin.x,
                origin.y,
                origin.x + Math.cos(rad) * reach,
                origin.y + Math.sin(rad) * reach,
            ));
        }

        return lines;
    }

    // ── EMCON / IRST: transmitter silent ──────────────────────────────────

    // Transmitter off: no sweep, no pulse, no illumination. Still draws the
    // static cone frame so the HUD isn't blank - the search cone for EMCON as a
    // heading reference, the IRST's own window in IRST mode - with the range
    // and jammer readouts swapped for standby indicators.
    private updateSilent(
        ownerPos: { x: number; y: number },
        shipDirection: number,
        graphics: Phaser.GameObjects.Graphics,
        scanWidth: number,
        standbyLabel: string,
    ): void {
        const scanStartAngle = shipDirection - scanWidth / 2;
        const scanEndAngle = shipDirection + scanWidth / 2;

        this.radarRenderer?.update({
            graphics, radarPosition: ownerPos, radarRange: this.range,
            scanStartAngle, scanEndAngle,
            loadout: this.fireControl.getLoadout(),
            vim220Waypoints: this.fireControl.getWaypoints(),
            vim220TimeToActive: this.fireControl.getLastVim220TimeToActive(),
            missileRange: this.fireControl.getActiveMissileRange(),
            jammerStatus: this.getJammerHudStatus(),
            vim220WaypointAlpha: this.fireControl.getWaypointAlpha(),
            standbyLabel,
        });

        // A jamming burst triggered just before EMCON was engaged still runs
        // its course — keep showing its cone rather than hide it silently.
        if (this.jammer.isActive()) {
            this.radarRenderer?.renderJammerCone(graphics, ownerPos, shipDirection, this.range);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    // Notify every ship the beam touches that it is being illuminated, so its
    // RWR registers a contact: unlocked (green, search) or locked (red, STT).
    // A beam sampled by several rays still illuminates each ship once.
    //
    // Being warned is a one-way problem: the receiver only has to hear the
    // pulse, where a return has to survive the trip out and back again. So a
    // ship is warned from ranges at which this radar has no hope of tracking
    // it - sitting outside the rated range protects nobody from knowing they
    // are being looked at. Gas on the path costs the pulse energy once here,
    // not twice: nothing is coming back through it.
    //
    // The gain a listener hears: a hull the beam is actually resting on
    // (the pulse ray crosses it — the crossing point sits on the boresight
    // ray) hears the beam's full gain; a hull wholly off the beam hears the
    // amplitude pattern at its own bearing off the beam centre — the skirt
    // just off the main lobe, decaying smoothly down to the flat sidelobe
    // floor. This replaces the old binary in-beam/sidelobe split: being just
    // off the instantaneous beam now sounds nearly as loud as being under
    // it, which is what a real antenna's main-lobe skirt does, while far-off
    // listeners still only catch the sidelobe leak.
    //
    // `testSidelobes` gates that off-beam test to once per sweep leg
    // (the caller passes it true only on sweepComplete) rather than every
    // frame. It has to be rate-limited somehow: detectionProbability's floor
    // is RADAR_PFA, never truly zero, so a channel re-rolled every single
    // frame for hundreds of frames running will eventually cross it no matter
    // how weak the real signal is — exactly the false-alarm mechanic working
    // as intended, just aimed at one specific ship every frame instead of at
    // a random cell a few times a sweep. Once per sweep leg keeps the
    // sidelobe roll at the same cadence a real search radar would actually
    // offer a listener, in main beam or not.
    private illuminateRwr(
        targets: Entity[],
        lines: Phaser.Geom.Line[],
        ownerPos: { x: number; y: number },
        isLocked: boolean,
        gasVolumes: GasVolume[],
        mainGain: number,
        testSidelobes: boolean,
        beamCentreDeg: number,
        beamWidthDeg: number,
    ): void {
        const now = this.scene.time.now;
        for (const entity of targets) {
            if (!this.hasRadar(entity)) continue;
            const polygon = this.raycaster.getBodyPolygons(entity);
            const inMainBeam = lines.some(line => Phaser.Geom.Intersects.GetLineToPolygon(line, polygon));
            if (!inMainBeam && !testSidelobes) continue;

            const epos = entity.getPosition();
            const range = Phaser.Math.Distance.Between(ownerPos.x, ownerPos.y, epos.x, epos.y);
            let gain = mainGain;
            if (!inMainBeam) {
                // Off the beam: the listener catches the pattern's skirt at
                // its own bearing off the beam centre — near the lobe nearly
                // full, far out only the sidelobe floor.
                const bearingToDeg = Phaser.Math.RadToDeg(
                    Math.atan2(epos.y - ownerPos.y, epos.x - ownerPos.x),
                );
                gain = mainGain * beamPattern(
                    Math.abs(Phaser.Math.Angle.WrapDegrees(bearingToDeg - beamCentreDeg)),
                    beamWidthDeg,
                );
            }
            // Gas on the path costs the pulse energy once here, not twice:
            // nothing is coming back through it.
            const transmission = gasTransmission(ownerPos, epos, gasVolumes);
            if (!isDetected(emissionSignal(range, this.range, transmission, gain))) {
                continue;
            }

            const bearingDeg = Phaser.Math.RadToDeg(
                Math.atan2(ownerPos.y - epos.y, ownerPos.x - epos.x),
            );
            // A sidelobe leak reads as an ordinary (green) search contact even
            // during STT — it is catching leakage off a beam not aimed at it,
            // not the beam itself, so it does not earn the lock warning. Only a
            // ship the main beam is actually resting on gets that.
            const locked = isLocked && inMainBeam;
            // A lock that is guiding a VIM-177 sounds different from one that
            // is only tracking: the target's RWR reads it as the missile.
            const signature = locked && this.fireControl.isGuidingSarh() ? 'vim177-illuminator' : 'ship-radar';
            entity.radar.rwrReceiver.receive(
                String(this.owner?.id ?? 'unknown'), bearingDeg, locked, now, false, signature,
            );
        }
    }

    // The jammer affecting us this frame and its range from us — the inputs
    // the energy contest runs on — or null. A jammer affects us only when our
    // beam actually paints the jamming ship *and* we (the emitter) sit inside
    // its jamming cone.
    private detectJamming(
        targets: Entity[],
        lines: Phaser.Geom.Line[],
        ownerPos: { x: number; y: number },
    ): { error: JammerError; range: number; bearingDeg: number } | null {
        for (const entity of targets) {
            if (!this.hasRadar(entity)) continue;
            if (!entity.radar.jammer.isActive()) continue;

            const polygon = this.raycaster.getBodyPolygons(entity);
            if (!lines.some(line => Phaser.Geom.Intersects.GetLineToPolygon(line, polygon))) continue;

            if (entity.radar.jammer.covers(entity.getPosition(), entity.getDirection(), ownerPos, this.range)) {
                return {
                    error: entity.radar.jammer.getError(),
                    range: Phaser.Math.Distance.Between(
                        ownerPos.x, ownerPos.y, entity.getPosition().x, entity.getPosition().y,
                    ),
                    bearingDeg: Phaser.Math.RadToDeg(
                        Math.atan2(entity.getPosition().y - ownerPos.y, entity.getPosition().x - ownerPos.x),
                    ),
                };
            }
        }
        return null;
    }

    // A jamming burst is itself an emission, and a loud one: any ship inside
    // the cone hears it regardless of whose beam is where — hearing is
    // one-way, and it does not depend on the energy contest (a jammer that
    // cannot fool the radar is still being heard by it). The victim's RWR
    // therefore marks the jammer as a strobe at its bearing, keyed by the
    // jammer ship's own id — the same emitter its search contact would use,
    // so the strobe replaces that symbol while the burst runs. Registered
    // after illuminateRwr so a same-frame search contact does not overwrite it.
    private registerJammingStrobes(
        targets: Entity[],
        ownerPos: { x: number; y: number },
    ): void {
        const now = this.scene.time.now;
        for (const entity of targets) {
            if (!this.hasRadar(entity)) continue;
            if (!entity.radar.jammer.isActive()) continue;
            if (!entity.radar.jammer.covers(entity.getPosition(), entity.getDirection(), ownerPos, this.range)) continue;

            const bearingDeg = Phaser.Math.RadToDeg(
                Math.atan2(entity.y - ownerPos.y, entity.x - ownerPos.x),
            );
            this.rwrReceiver.receive(String(entity.id), bearingDeg, false, now, true);
        }
    }

    // What one ray of the beam lights up. Terrain is solid: nearer than
    // everything else it wins the ray outright, shadows whatever is behind it
    // and is handed to the ground map. A hull is solid too — the ray stops on
    // it. A chaff cloud is not: it is a volume of dipoles, so a ray crossing
    // it brings back the cloud's own echo (one resolution cell's worth of it,
    // signalPath.chaffCellCrossSection — brighter the further out it is seen)
    // *and* carries on, dimmed, to whatever hull is behind it. Both echoes
    // then compete on equal terms in the receiver and the tracking gate; which
    // one the radar believes is settled by energy, not by an occlusion rule.
    // Shared by the search sweep and the STT stare, which do different things
    // with the answer (the sweep also logs ground clutter off the terrain it
    // paints).
    private reflectorsAlong(
        line: Phaser.Geom.Line,
        ownerPos: { x: number; y: number },
        targets: Entity[],
        terrain: Terrain[],
        decoyCircles: Phaser.Geom.Circle[],
        beamCentreDeg: number,
        beamWidthDeg: number,
        gasVolumes: GasVolume[],
    ): {
        terrain: { point: Phaser.Math.Vector2; normal: { x: number; y: number } } | null;
        // The cloud's echo, and the points where the ray enters and leaves it
        // — where the cloud deposits its clutter.
        chaff: { hits: BeamHit[]; entry: Phaser.Math.Vector2; exit: Phaser.Math.Vector2 } | null;
        ship: BeamHit | null;
    } {
        const shipHit = this.nearestHit(line, ownerPos, targets, beamCentreDeg, beamWidthDeg);
        const terrainHit = this.nearestHit(line, ownerPos, terrain, beamCentreDeg, beamWidthDeg);
        const cloud = this.nearestChaffCrossing(line, ownerPos, decoyCircles);
        const distSqOf = (point: { x: number; y: number } | undefined): number =>
            point
                ? Phaser.Math.Distance.Squared(ownerPos.x, ownerPos.y, point.x, point.y)
                : Infinity;
        const shipDistSq = distSqOf(shipHit?.point);
        const terrainDistSq = distSqOf(terrainHit?.point);
        const cloudDistSq = distSqOf(cloud?.entry);

        if (terrainHit && terrainDistSq <= shipDistSq && terrainDistSq <= cloudDistSq) {
            return { terrain: { point: terrainHit.point, normal: terrainHit.normal }, chaff: null, ship: null };
        }

        const gas = (point: { x: number; y: number }): number =>
            this.receiver.gasRoundTrip(ownerPos, point, gasVolumes);
        // The cloud answers only where the ray reaches it before any hull or
        // rock stops the ray, and only up to where the ray stops.
        const chaffLit = cloud !== null && cloudDistSq < shipDistSq && cloudDistSq < terrainDistSq;
        const stopPx = Math.sqrt(Math.min(shipDistSq, terrainDistSq));
        const chaff = chaffLit && cloud
            ? {
                hits: this.chaffCells(cloud, ownerPos, stopPx, beamCentreDeg, beamWidthDeg, gas),
                entry: cloud.entry,
                exit: cloud.exit,
            }
            : null;

        // A hull the ray reaches through the cloud pays for both crossings.
        const shipVisible = shipHit !== null && shipDistSq < terrainDistSq;
        const throughChaff = chaffLit ? decoySettings.ONE_WAY_TRANSMISSION ** 2 : 1;
        const ship: BeamHit | null = shipVisible && shipHit
            ? {
                point: shipHit.point,
                crossSection: shipHit.crossSection,
                transmission: gas(shipHit.point) * throughChaff,
                radialSpeed: radialSpeed(ownerPos, shipHit.point, shipHit.velocity),
            }
            : null;

        return { terrain: null, chaff, ship };
    }

    // Ships carry a radar — and so an RWR that can hear us and a jammer that
    // can paint us; terrain does neither. Narrowing by the property rather
    // than casting: what an inter-set interaction (illumination, jamming) may
    // read off another ship is exactly what its radar exposes.
    private hasRadar(entity: Entity): entity is PlayerShip | Target {
        return 'radar' in entity;
    }

    // Where this ray first strikes something, and how much of that something is
    // turned towards the beam. The cross-section is measured here, at the hull,
    // because this is the only place the geometry is known — and weighted here
    // by the beam pattern at the hit's own off-axis angle, since the beam is
    // the thing doing the illuminating: an STT fan samples its beam with
    // several rays, and a hull lit by an edge ray returns less than one lit
    // dead-centre (a search sweep's pencil ray is its own boresight, so its
    // hits sit at pattern ≈ 1).
    private nearestHit(
        line: Phaser.Geom.Line,
        ownerPos: { x: number; y: number },
        targets: Entity[],
        beamCentreDeg: number,
        beamWidthDeg: number,
    ): {
        point: Phaser.Math.Vector2;
        crossSection: number;
        normal: { x: number; y: number };
        velocity: { x: number; y: number };
    } | null {
        let nearest: ReturnType<Radar['nearestHit']> = null;
        let nearestDistSq = Infinity;

        for (const target of targets) {
            // A body the antenna stands inside cannot shadow it: the ship
            // parked on the launchpad is above the slab, not walled in by it,
            // and a dish is not blinded by its own reflector. Without this
            // the body's far edges would read as terrain all round.
            if (this.raycaster.contains(target, ownerPos)) continue;
            // Against the true surface (a concave body's convex parts), not
            // the hull: a dent shadows and echoes as drawn.
            const hit = this.raycaster.nearestPartHit(line, target);
            if (!hit) continue;

            const dSq = Phaser.Math.Distance.Squared(ownerPos.x, ownerPos.y, hit.point.x, hit.point.y);
            if (dSq < nearestDistSq) {
                nearestDistSq = dSq;
                // Surface orientation at the hit, for the ground map's
                // incidence-dependent return strength and, below, the ship
                // return's specular glint.
                const normal = this.raycaster.surfaceNormalAt(hit.part, hit.point);
                const beamDirX = (hit.point.x - ownerPos.x) / Math.sqrt(dSq || 1);
                const beamDirY = (hit.point.y - ownerPos.y) / Math.sqrt(dSq || 1);
                // The beam pattern at this hit's own bearing off the beam
                // centre: the amplitude the return carries before range and
                // hull size are even considered.
                const hitBearingDeg = Phaser.Math.RadToDeg(Math.atan2(beamDirY, beamDirX));
                const pattern = beamPattern(
                    Math.abs(Phaser.Math.Angle.WrapDegrees(hitBearingDeg - beamCentreDeg)),
                    beamWidthDeg,
                );
                nearest = {
                    point: hit.point,
                    // The hull's silhouette (how much of it is turned
                    // broadside) weighted by how square-on the specific facet
                    // struck actually faces the beam — the same width can be
                    // a flat glint or a curved graze depending on which part
                    // of the hull the ray happened to land on — and by how
                    // much of the beam's amplitude that look carried.
                    crossSection: crossSection(this.raycaster.getBodyPolygons(target), ownerPos)
                        * specularFactor({ x: beamDirX, y: beamDirY }, normal)
                        * pattern,
                    normal,
                    // What the echo's Doppler is measured off: the body's own
                    // motion (px per physics step). A rock that drifts has one
                    // too; nothing in the clutter map pretends otherwise.
                    velocity: (target.body as MatterJS.BodyType | null)?.velocity ?? { x: 0, y: 0 },
                };
            }
        }

        return nearest;
    }

    // The run of range cells a ray lights inside a cloud, from where it goes
    // in to where it comes out — or to where the ray stops on a hull or a rock
    // inside it. One echo per cell (RADAR_PULSE_LENGTH_PX deep), each at the
    // middle of its cell and priced as one cell's worth of dipoles
    // (signalPath.chaffCellCrossSection), weighted by the beam pattern at its
    // bearing like any other hit.
    private chaffCells(
        cloud: { entry: Phaser.Math.Vector2; exit: Phaser.Math.Vector2 },
        ownerPos: { x: number; y: number },
        stopPx: number,
        beamCentreDeg: number,
        beamWidthDeg: number,
        gas: (point: { x: number; y: number }) => number,
    ): BeamHit[] {
        const entryRange = Phaser.Math.Distance.BetweenPoints(ownerPos, cloud.entry);
        const chord = Math.max(0, Math.min(
            Phaser.Math.Distance.BetweenPoints(cloud.entry, cloud.exit),
            stopPx - entryRange,
        ));
        if (chord === 0) return [];
        const dirX = (cloud.exit.x - cloud.entry.x) / (Phaser.Math.Distance.BetweenPoints(cloud.entry, cloud.exit) || 1);
        const dirY = (cloud.exit.y - cloud.entry.y) / (Phaser.Math.Distance.BetweenPoints(cloud.entry, cloud.exit) || 1);
        const cells: BeamHit[] = [];
        for (let start = 0; start < chord; start += RADAR_PULSE_LENGTH_PX) {
            const depth = Math.min(RADAR_PULSE_LENGTH_PX, chord - start);
            const along = start + depth / 2;
            const point = new Phaser.Math.Vector2(cloud.entry.x + dirX * along, cloud.entry.y + dirY * along);
            const bearingDeg = Phaser.Math.RadToDeg(Math.atan2(point.y - ownerPos.y, point.x - ownerPos.x));
            cells.push({
                point,
                crossSection: chaffCellCrossSection(Phaser.Math.Distance.BetweenPoints(ownerPos, point), depth)
                    * beamPattern(Math.abs(Phaser.Math.Angle.WrapDegrees(bearingDeg - beamCentreDeg)), beamWidthDeg),
                transmission: gas(point),
                radialSpeed: 0,
            });
        }
        return cells;
    }

    // A cloud the beam crossed is clutter all along the run of the ray
    // through it, not just at its rim: logged at the entry, the middle and the
    // exit, so the cells it fills are the cells the clutter filter switches
    // into.
    private logChaffClutter(chaff: { entry: Phaser.Math.Vector2; exit: Phaser.Math.Vector2 }): void {
        const now = this.scene.time.now;
        const middle = { x: (chaff.entry.x + chaff.exit.x) / 2, y: (chaff.entry.y + chaff.exit.y) / 2 };
        for (const point of [chaff.entry, middle, chaff.exit]) {
            this.cfarDetector.addClutter(point, CLUTTER_CHAFF_DENSITY, now);
        }
    }

    // The nearest chaff cloud this ray passes through, or null: where it goes
    // in and where it comes out (or ends, if the ray stops inside).
    private nearestChaffCrossing(
        line: Phaser.Geom.Line,
        ownerPos: { x: number; y: number },
        decoyCircles: Phaser.Geom.Circle[],
    ): { entry: Phaser.Math.Vector2; exit: Phaser.Math.Vector2 } | null {
        let nearest: ReturnType<Radar['nearestChaffCrossing']> = null;
        let nearestDistSq = Infinity;

        for (const circle of decoyCircles) {
            const points = Phaser.Geom.Intersects.GetLineToCircle(line, circle) ?? [];
            // A radar standing inside its own chaff has the cloud all round:
            // the ray starts in it.
            const inside = circle.contains(line.x1, line.y1);
            const crossings = points
                .map(p => new Phaser.Math.Vector2(p.x, p.y))
                .sort((a, b) =>
                    Phaser.Math.Distance.Squared(line.x1, line.y1, a.x, a.y)
                    - Phaser.Math.Distance.Squared(line.x1, line.y1, b.x, b.y));
            if (crossings.length === 0 && !inside) continue;

            const entry = inside ? new Phaser.Math.Vector2(line.x1, line.y1) : crossings[0];
            const exit = inside
                ? (crossings[0] ?? new Phaser.Math.Vector2(line.x2, line.y2))
                : (crossings[1] ?? new Phaser.Math.Vector2(line.x2, line.y2));
            const dSq = Phaser.Math.Distance.Squared(ownerPos.x, ownerPos.y, entry.x, entry.y);
            if (dSq >= nearestDistSq) continue;
            nearestDistSq = dSq;
            nearest = { entry, exit };
        }

        return nearest;
    }

    // Whether a point is inside the range the interface actually draws. The
    // radar routinely knows about things that are not.
    private withinDisplayRange(
        ownerPos: { x: number; y: number },
        point: { x: number; y: number },
    ): boolean {
        return Phaser.Math.Distance.Between(ownerPos.x, ownerPos.y, point.x, point.y) <= this.range;
    }

    // ── External API ──────────────────────────────────────────────────────

    start(): void {}
    // A stopped radar's receiver goes dark: take the video ring's labels with it.
    stop(): void {
        this.receiverVideoRenderer?.destroy();
        this.receiverVideoRenderer = null;
    }

    // The owner as a firing ship, or null when the radar is mounted on something
    // that has no weapons (the fixed dish station). Only ships fire.
    private ownerShip(): (PlayerShip | Target) | null {
        return (this.owner instanceof PlayerShip || this.owner instanceof Target) ? this.owner : null;
    }

    // Test seam: the suite injects a synthetic picture directly (iffTests),
    // bypassing detection. Mode transitions are this class's own work and go
    // straight to the tracking computer — nothing in play should call this.
    setTracks(tracks: Track[]): void {
        this.trackingComputer.setTracks(tracks);
    }
    getTracks(): Track[] {
        return this.trackingComputer.getTracks();
    }
}
