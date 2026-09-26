import Phaser from "phaser";
import { PlayerShip, Target } from "../../entities/ship";

import { Antenna } from "./modules/antenna";
import { Emitter } from "./modules/emitter";
import { Receiver } from "./modules/receiver";
import { TrackingComputer } from "./modules/trackingComputer";
import { RwrReceiver } from "./modules/rwr";
import { Jammer, JammerError, JammerHudStatus } from "./modules/jammer";
import { TerrainMapper } from "./modules/terrainMapper";
import { CfarDetector } from "./modules/cfarDetector";

import { FireControl } from "./fireControl";

import { BeamHit, RadarReturn } from "../data/radarReturn";
import {
    beamGain,
    crossSection,
    emissionSignal,
    gasTransmission,
    isDetected,
    jammerSignal,
    scanLossFactor,
    specularFactor,
    beamPattern,
} from "../data/signalPath";
import { Track } from "../data/track";
import { Entity, GasVolume, Loadout, Mode, RadarHost, Terrain } from "../data/types";

import { InterfaceRenderer } from "../renderer/interfaceRenderer";
import { RadarRenderer } from "../renderer/radarRenderer";
import { TerrainRenderer } from "../renderer/terrainRenderer";

import { Ray } from "../../physics/ray";
import { RadarEventEmitter } from "./game/radarEventEmitter";

import {
    CLUTTER_GAS_DENSITY,
    CLUTTER_TERRAIN_DENSITY,
    JAMMER_STT_DEGRADE_PROB,
    MAX_TWS_TRACKS,
    RADAR_BEAM_WIDTH_DEG,
    RADAR_DEFAULT_RANGE_PX,
    RADAR_FALSE_ALARM_RATE,
    STT_ACQUISITION_BEAM_DEG,
    STT_ACQUISITION_FRAMES,
    STT_BEAM_DEG,
    STT_BEAM_RAY_SPACING_DEG,
    STT_LOCK_BREAK_FRAMES,
    TRACK_STT_COURSE_WINDOW_FRAMES,
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
    // Frames left of the wide acquisition dwell that opens every lock.
    private sttAcquireFrames: number = 0;

    // Weapons system. The radar (sensor) produces tracks; FireControl consumes
    // them to launch and guide missiles. Constructed in the constructor (needs
    // the scene).
    private fireControl: FireControl;

    public rwrReceiver = new RwrReceiver();
    public jammer = new Jammer();

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
    private sweepJamming: { error: JammerError; range: number } | null = null;

    public eventEmitter = new RadarEventEmitter();

    private interfaceRenderer: InterfaceRenderer | null = null;
    // Only the player's radar has a renderer; target radars track silently.
    private radarRenderer: RadarRenderer | null = null;

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

    setInterfaceRenderer(renderer: InterfaceRenderer): void {
        this.interfaceRenderer = renderer;
    }
    getInterfaceRenderer(): InterfaceRenderer | null {
        return this.interfaceRenderer;
    }

    attachTo(owner: RadarHost): void {
        this.owner = owner;
    }

    setMode(mode: Mode): void {
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
        if (this.mode === 'stt') {
            this.clearSttState();
            this.trackingComputer.setTracks([]);
        }
        this.mode = 'rws';
        this.sweepBuffer = [];
        this.falseAlarmBuffer = [];
    }

    enterTws(): void {
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
        if (this.mode === 'stt') {
            this.clearSttState();
        }
        this.mode = 'emcon';
        this.trackingComputer.setTracks([]);
        this.sweepBuffer = [];
        this.falseAlarmBuffer = [];
    }

    // ── STT lock management ────────────────────────────────────────────────

    // Lock the highest-confidence RWS track and enter STT.
    enterStt(): void {
        const tracks = this.displayedTracks();
        if (tracks.length === 0) return;

        const best = tracks.reduce((a, b) =>
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

        this.mode = 'stt';

        // Discard all other tracks — STT focuses entirely on one target.
        this.trackingComputer.setTracks([best]);
        this.sweepBuffer = [];
        this.falseAlarmBuffer = [];

        this.eventEmitter.emitLockEvent();
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
        if (!track || !this.owner) return null;
        return this.withinDisplayRange(this.owner.getPosition(), track.pos) ? track : null;
    }

    // The track picture as the interface draws it, and so as fire control is
    // allowed to use it. The radar's own picture (getTracks) runs further —
    // the energy budget, not the range ring, decides what it can hold — but a
    // contact the player cannot see is not one they get to shoot at, and the
    // same rule binds the AI, which drives the identical radar.
    private displayedTracks(): Track[] {
        if (!this.owner) return [];
        const ownerPos = this.owner.getPosition();
        return this.trackingComputer.getTracks()
            .filter(track => this.withinDisplayRange(ownerPos, track.pos));
    }

    // ── Jammer ─────────────────────────────────────────────────────────────

    // Trigger a jamming burst (player input). No-op while active, cooling down,
    // or with the transmitter shut down (EMCON) — jamming is itself an emission.
    activateJammer(): void {
        if (this.mode === 'emcon') return;
        this.jammer.activate(this.scene.time.now);
    }

    // True when a jamming burst could be started right now: off cooldown and
    // not blocked by EMCON. Lets an AI check before committing to the burst.
    isJammerReady(): boolean {
        if (this.mode === 'emcon') return false;
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
        if (this.mode === 'emcon') {
            return { label: 'JAMMER STDBY', color: '#ffff00' };
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
    // so AI ships firing the same weapons stay silent.
    shoot(): void {
        const fired = this.fireControl.shoot(this.mode, {
            ship: this.ownerShip(),
            sttTrack: this.displayedSttTrack(),
            tracks: this.displayedTracks(),
        });
        if (fired) {
            this.eventEmitter.emitMissileFired(fired);
        }
    }

    // Max range (px) of the currently selected weapon, for the range indicator.
    getActiveMissileRange(): number | null {
        return this.fireControl.getActiveMissileRange();
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
        if (!this.owner) return;

        const ownerPos = this.owner.getPosition();
        const shipDirection = this.owner.getDirection();

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
        // Exclude destroyed ships (body becomes undefined when removed).
        const targetShips = entities.filter(
            (e): e is PlayerShip | Target =>
                e.id !== this.owner?.id && 'getDirection' in e && e.active && Boolean(e.body),
        );
        // Guidance is fed the same gated picture as the trigger: a missile in
        // flight rides the track the scope is showing, so a contact that runs
        // out past the ring takes its mid-course updates (and a SARH missile's
        // illumination) with it until it is back inside.
        this.fireControl.update(delta, {
            sttTrack: this.displayedSttTrack(),
            tracks: this.displayedTracks(),
            targets: targetShips,
            decoyCircles,
            gasVolumes,
            terrain,
            now: this.scene.time.now,
        }, graphics);

        if (this.mode === 'stt') {
            this.updateStt(delta, ownerPos, shipDirection, entities, graphics, decoyCircles, terrain, gasVolumes);
        } else if (this.mode === 'emcon') {
            this.updateEmcon(ownerPos, shipDirection, graphics);
        } else {
            this.updateRws(ownerPos, shipDirection, entities, graphics, decoyCircles, terrain, gasVolumes);
        }

        // Paint the ground-mapping picture (persisted, decaying terrain returns).
        this.terrainMapper.render(graphics, ownerPos, this.range, this.scene.time.now);
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

        this.radarRenderer?.update(
            graphics, ownerPos, this.range,
            scanStartAngle, scanEndAngle,
            [], this.fireControl.getLoadout(), this.fireControl.getWaypoints(), pulse, false,
            this.fireControl.getLastVim220TimeToActive(), this.fireControl.getActiveMissileRange(),
            this.getJammerHudStatus(), this.fireControl.getWaypointAlpha(),
        );

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

        // Ship, terrain and chaff returns compete for the beam — the nearer
        // reflector wins the ray. Terrain shadows ships and is handed to the
        // TerrainMapper; a chaff cloud is a reflector like any other, so
        // nearer than the target it hides it behind an echo of its own (and
        // paints a contact — that is what chaff is for); a nearer ship return
        // masks both. The pencil ray is its own beam boresight, so hits are
        // pattern-weighted at the pencil's width.
        const shipHit = this.nearestHit(pulse.line, ownerPos, targets, pulseDirection, RADAR_BEAM_WIDTH_DEG);
        const terrainHit = this.nearestHit(pulse.line, ownerPos, terrain, pulseDirection, RADAR_BEAM_WIDTH_DEG);
        const decoyEcho = this.nearestDecoyEcho(pulse.line, ownerPos, decoyCircles);
        const distSqOf = (hit: { point: Phaser.Math.Vector2 } | null): number =>
            hit
                ? Phaser.Math.Distance.Squared(ownerPos.x, ownerPos.y, hit.point.x, hit.point.y)
                : Infinity;
        const shipDistSq = distSqOf(shipHit);
        const terrainDistSq = distSqOf(terrainHit);
        const decoyDistSq = distSqOf(decoyEcho);

        if (terrainHit && terrainDistSq <= shipDistSq && terrainDistSq <= decoyDistSq) {
            // Ground mapping is a picture, not a track, and the picture stops at
            // the rated range - the beam reaching past it paints nothing. Gas
            // dims what is inside exactly as it dims a contact.
            if (this.withinDisplayRange(ownerPos, terrainHit.point)
                && !this.receiver.isAbsorbedByGas(ownerPos, terrainHit.point, gasVolumes)) {
                this.terrainMapper.addSample(terrainHit.point, terrainHit.normal, ownerPos, this.scene.time.now);
                // Ground clutter: whatever the ground map is painting here is
                // also raising the floor a ship return here must clear.
                this.cfarDetector.addClutter(terrainHit.point, CLUTTER_TERRAIN_DENSITY, this.scene.time.now);
            }
        } else if (decoyEcho && decoyDistSq < shipDistSq) {
            // The chaff cloud's echo enters the tracking pipeline like a
            // contact: same energy budget, same clustering, and the tracking
            // computer cannot tell it from a hull — a false track is the
            // whole point of throwing chaff.
            this.sweepBuffer.push({
                point: decoyEcho.point,
                crossSection: decoySettings.CROSS_SECTION,
                transmission: this.receiver.gasRoundTrip(ownerPos, decoyEcho.point, gasVolumes),
            });
        } else if (shipHit) {
            // Gas only weakens it, so it goes into the hit's signal
            // budget instead, to be weighed against range and hull size when the
            // sweep is processed.
            this.sweepBuffer.push({
                point: shipHit.point,
                crossSection: shipHit.crossSection,
                transmission: this.receiver.gasRoundTrip(ownerPos, shipHit.point, gasVolumes),
            });
        }

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

        // Thermal false alarm: the receiver's own noise can cross the
        // detection threshold with nothing in the cell at all (see
        // detectionProbability in data/signalPath.ts — its floor is exactly
        // this chance, RADAR_PFA). This roll *is* the Pfa event, so the
        // fabricated point does not go through the signal budget a second
        // time — it goes straight into falseAlarmBuffer rather than
        // sweepBuffer. Its range is drawn uniformly along the full traced
        // reach rather than weighted toward the near end the way a real echo
        // is: that is the tell that separates a noise spike from a
        // reflection, a genuine return thins out with distance and receiver
        // noise does not.
        //
        // The same CFAR threshold applies to noise as to echoes: the raised
        // floor near clutter suppresses noise spikes there exactly as it
        // suppresses weak target returns, so the roll is divided by the same
        // floor multiplier the real hits are judged against. Without this the
        // threshold would be higher only for echoes — and noise would be
        // *most* believable exactly where a real set declares nothing, which
        // is backwards: clutter residue is the reason a real CFAR detector
        // raises its threshold in the first place.
        const phantomRange = Math.random() * this.emitter.getReach();
        const phantomRad = Phaser.Math.DegToRad(pulseDirection);
        const phantomPoint = new Phaser.Math.Vector2(
            ownerPos.x + Math.cos(phantomRad) * phantomRange,
            ownerPos.y + Math.sin(phantomRad) * phantomRange,
        );
        if (Math.random() < RADAR_FALSE_ALARM_RATE
            / this.cfarDetector.noiseFloorMultiplier(phantomPoint, this.scene.time.now)) {
            this.falseAlarmBuffer.push({
                point: phantomPoint,
                range: phantomRange,
                angle: pulseDirection,
                // A noise spike that cleared the threshold carries exactly the
                // floor it cleared — no amplitude structure for the tracking
                // computer's weighted centroid to read anything into.
                signal: 1,
            });
        }

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
            if (this.sweepJamming) {
                const jam = jammerSignal(this.sweepJamming.range, this.range);
                const signal = this.receiver.dwellSignal(this.sweepBuffer, ownerPos, this.range, scanGain);
                processed = signal > 0 && jam >= signal
                    ? this.receiver.createFakeHits(this.sweepBuffer, ownerPos, this.range, this.sweepJamming.error, scanGain, jam)
                    : this.receiver.processHits(
                        this.sweepBuffer, ownerPos, this.range, scanGain,
                        point => this.cfarDetector.noiseFloorMultiplier(point, now),
                    );
            } else {
                processed = this.receiver.processHits(
                    this.sweepBuffer, ownerPos, this.range, scanGain,
                    point => this.cfarDetector.noiseFloorMultiplier(point, now),
                );
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

        for (const track of this.displayedTracks()) {
            this.radarRenderer?.renderRwsContacts(graphics, track);
        }
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
        this.radarRenderer?.update(
            graphics, ownerPos, this.range,
            shipDirection - rwsHalfAz, shipDirection + rwsHalfAz,
            [], this.fireControl.getLoadout(), this.fireControl.getWaypoints(), pulse, true,
            this.fireControl.getLastVim220TimeToActive(), this.fireControl.getActiveMissileRange(),
            this.getJammerHudStatus(), this.fireControl.getWaypointAlpha(),
        );

        // Render our own jamming cone while the jammer is running.
        if (this.jammer.isActive()) {
            this.radarRenderer?.renderJammerCone(graphics, ownerPos, shipDirection, this.range);
        }

        // Collect every ship return in the beam. Terrain and chaff compete
        // ray by ray under the same nearest-wins rule as the sweep: where
        // terrain is nearer it paints the ground map and shadows whatever
        // is behind it, so a target sliding behind a rock starves the lock;
        // chaff nearer than the target hides it behind an echo of its own.
        const rawHits: BeamHit[] = [];
        for (const line of beamLines) {
            const shipHit = this.nearestHit(line, ownerPos, targets, lockDir, beamWidth);
            const terrainHit = this.nearestHit(line, ownerPos, terrain, lockDir, beamWidth);
            const decoyEcho = this.nearestDecoyEcho(line, ownerPos, decoyCircles);
            const distSqOf = (hit: { point: Phaser.Math.Vector2 } | null): number =>
                hit
                    ? Phaser.Math.Distance.Squared(ownerPos.x, ownerPos.y, hit.point.x, hit.point.y)
                    : Infinity;
            const shipDistSq = distSqOf(shipHit);
            const terrainDistSq = distSqOf(terrainHit);
            const decoyDistSq = distSqOf(decoyEcho);

            if (terrainHit && terrainDistSq <= shipDistSq && terrainDistSq <= decoyDistSq) {
                if (this.withinDisplayRange(ownerPos, terrainHit.point)
                    && !this.receiver.isAbsorbedByGas(ownerPos, terrainHit.point, gasVolumes)) {
                    this.terrainMapper.addSample(terrainHit.point, terrainHit.normal, ownerPos, this.scene.time.now);
                }
            } else if (decoyEcho && decoyDistSq < shipDistSq) {
                // The cloud's echo is a return like any other — it can land
                // inside the gate and drag the lock, or starve it entirely if
                // the target sits behind the cloud.
                rawHits.push({
                    point: decoyEcho.point,
                    crossSection: decoySettings.CROSS_SECTION,
                    transmission: this.receiver.gasRoundTrip(ownerPos, decoyEcho.point, gasVolumes),
                });
            } else if (shipHit) {
                // Chaff between the antenna and the target has already lost
                // the ray above; gas only costs it energy, which the
                // concentrated STT beam has more of to spend. Starved frames
                // feed the lock-break counter below, so a target that drags
                // the lock through a thick enough cloud can still shake it.
                rawHits.push({
                    point: shipHit.point,
                    crossSection: shipHit.crossSection,
                    transmission: this.receiver.gasRoundTrip(ownerPos, shipHit.point, gasVolumes),
                });
            }
        }

        // STT energy overpowers the jammer, so returns are not spoofed — but a
        // burst that still out-shouts the lock's echo has a chance to swallow
        // them, scaling with how badly the echo loses the same J/S contest the
        // sweep runs. A concentrated beam's echo grows as the fourth power of
        // closing range, so the burst wins only far out or against a small
        // hull: burn-through protects a lock the old flat chance degraded
        // regardless of geometry.
        const jamming = this.detectJamming(targets, beamLines, ownerPos);
        let hits = rawHits;
        if (jamming) {
            const jam = jammerSignal(jamming.range, this.range);
            const signal = this.receiver.dwellSignal(rawHits, ownerPos, this.range, sttGain);
            const swallow = JAMMER_STT_DEGRADE_PROB * (signal > 0 ? Math.min(jam / signal, 1) : 1);
            if (Math.random() < swallow) hits = [];
        }

        // Lock illumination: any ship in the beam detects a locked (red) RWR
        // contact and fires its lock-warning event. STT stares rather than
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
        const returns = this.receiver.processHits(hits, ownerPos, this.range, sttGain);
        // STT updates every frame, so every timescale differs from search. A high
        // maxMissedScans keeps the lock alive through brief dropouts without
        // conflicting with the sweep timescale, and the course is fitted over
        // dozens of frames rather than four sweeps: at 0.1 px of target motion
        // per frame there is nothing to read in a shorter baseline, and this
        // estimate is what a SARH seeker leads on.
        this.trackingComputer.update(returns, ownerPos, {
            maxMissedScans: 90,
            minCourseSpeed: TRACK_STT_MIN_COURSE_SPEED_PX,
            courseWindow: TRACK_STT_COURSE_WINDOW_FRAMES,
            courseFromMeasurements: true,
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

    // ── EMCON standby ─────────────────────────────────────────────────────

    // Transmitter off: no sweep, no pulse, no illumination. Still draws the
    // static cone frame (heading reference) so the HUD isn't blank, with the
    // range and jammer readouts swapped for standby indicators.
    private updateEmcon(
        ownerPos: { x: number; y: number },
        shipDirection: number,
        graphics: Phaser.GameObjects.Graphics,
    ): void {
        const scanWidth = this.antenna.getAzimuth('rws');
        const scanStartAngle = shipDirection - scanWidth / 2;
        const scanEndAngle = shipDirection + scanWidth / 2;

        this.radarRenderer?.update(
            graphics, ownerPos, this.range,
            scanStartAngle, scanEndAngle,
            [], this.fireControl.getLoadout(), this.fireControl.getWaypoints(), undefined, false,
            this.fireControl.getLastVim220TimeToActive(), this.fireControl.getActiveMissileRange(),
            this.getJammerHudStatus(), this.fireControl.getWaypointAlpha(),
            true,
        );

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
            if (!('radar' in entity)) continue;
            const polygon = this.raycaster.getBodyPolygons(entity);
            const inMainBeam = lines.some(line => Phaser.Geom.Intersects.GetLineToPolygon(line, polygon));
            if (!inMainBeam && !testSidelobes) continue;

            const tgt = entity as PlayerShip | Target;
            const epos = tgt.getPosition();
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
            // not the beam itself, so it does not earn the lock warning or the
            // event. Only a ship the main beam is actually resting on gets that.
            const locked = isLocked && inMainBeam;
            tgt.radar.rwrReceiver.receive(String(this.owner?.id ?? 'unknown'), bearingDeg, locked, now);
            if (locked) tgt.radar.eventEmitter.onRwrLock();
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
    ): { error: JammerError; range: number } | null {
        for (const entity of targets) {
            if (!('radar' in entity)) continue;
            const tgt = entity as PlayerShip | Target;
            if (!tgt.radar.jammer.isActive()) continue;

            const polygon = this.raycaster.getBodyPolygons(entity);
            if (!lines.some(line => Phaser.Geom.Intersects.GetLineToPolygon(line, polygon))) continue;

            if (tgt.radar.jammer.covers(tgt.getPosition(), tgt.getDirection(), ownerPos, this.range)) {
                return {
                    error: tgt.radar.jammer.getError(),
                    range: Phaser.Math.Distance.Between(
                        ownerPos.x, ownerPos.y, tgt.getPosition().x, tgt.getPosition().y,
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
            if (!('radar' in entity)) continue;
            const tgt = entity as PlayerShip | Target;
            if (!tgt.radar.jammer.isActive()) continue;
            if (!tgt.radar.jammer.covers(tgt.getPosition(), tgt.getDirection(), ownerPos, this.range)) continue;

            const bearingDeg = Phaser.Math.RadToDeg(
                Math.atan2(tgt.y - ownerPos.y, tgt.x - ownerPos.x),
            );
            this.rwrReceiver.receive(String(tgt.id), bearingDeg, false, now, true);
        }
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
    ): { point: Phaser.Math.Vector2; crossSection: number; normal: { x: number; y: number } } | null {
        let nearest: { point: Phaser.Math.Vector2; crossSection: number; normal: { x: number; y: number } } | null = null;
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
                };
            }
        }

        return nearest;
    }

    // Where the beam first enters the nearest chaff cloud, or null. The echo
    // comes off the cloud's near side — the resolution cell cannot see into
    // it — so the contact paints at the entry point and competes by that
    // range, the same as a terrain or hull return would.
    private nearestDecoyEcho(
        line: Phaser.Geom.Line,
        ownerPos: { x: number; y: number },
        decoyCircles: Phaser.Geom.Circle[],
    ): { point: Phaser.Math.Vector2 } | null {
        let nearest: { point: Phaser.Math.Vector2 } | null = null;
        let nearestDistSq = Infinity;

        for (const circle of decoyCircles) {
            const points = Phaser.Geom.Intersects.GetLineToCircle(line, circle);
            // A ray crossing a cloud yields one entry point; take the nearest.
            const point = points?.sort((a, b) =>
                Phaser.Math.Distance.Squared(line.x1, line.y1, a.x, a.y) -
                Phaser.Math.Distance.Squared(line.x1, line.y1, b.x, b.y))[0];
            if (!point) continue;
            const dSq = Phaser.Math.Distance.Squared(ownerPos.x, ownerPos.y, point.x, point.y);
            if (dSq < nearestDistSq) {
                nearestDistSq = dSq;
                nearest = { point: new Phaser.Math.Vector2(point.x, point.y) };
            }
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
    stop(): void {}

    // The owner as a firing ship, or null when the radar is mounted on something
    // that has no weapons (the fixed dish station). Only ships fire.
    private ownerShip(): (PlayerShip | Target) | null {
        return (this.owner instanceof PlayerShip || this.owner instanceof Target) ? this.owner : null;
    }

    setTracks(tracks: Track[]): void {
        this.trackingComputer.setTracks(tracks);
    }
    getTracks(): Track[] {
        return this.trackingComputer.getTracks();
    }
}
