import Phaser from "phaser";
import { PlayerShip, Target } from "../../entities/ship";

import { Antenna } from "./modules/antenna";
import { Emitter } from "./modules/emitter";
import { Receiver } from "./modules/receiver";
import { TrackingComputer } from "./modules/trackingComputer";
import { RwrReceiver } from "./modules/rwr";
import { Jammer, JammerError, JammerHudStatus } from "./modules/jammer";
import { TerrainMapper } from "./modules/terrainMapper";

import { FireControl } from "./fireControl";

import { Track } from "../data/track";
import { Entity, Loadout, Mode, RadarHost } from "../data/types";

import { InterfaceRenderer } from "../renderer/interfaceRenderer";
import { RadarRenderer } from "../renderer/radarRenderer";
import { TerrainRenderer } from "../renderer/terrainRenderer";

import { Ray } from "../../physics/ray";
import { RadarEventEmitter } from "./game/radarEventEmitter";

import {
    JAMMER_STT_DEGRADE_PROB,
    MAX_TWS_TRACKS,
    RADAR_DEFAULT_RANGE_PX,
    STT_BEAM_DEG,
    STT_LOCK_BREAK_FRAMES,
} from "../data/radarGameSettings";

export class Radar {
    private owner: RadarHost | null = null;

    private mode: Mode = 'rws';
    private range: number;
    private antenna = new Antenna();
    private emitter: Emitter;
    private receiver: Receiver = new Receiver();
    // Bearing (deg) of the most recent pulse, exposed so a mount can align to the
    // beam (e.g. the dish sprite spins to the current dome bearing).
    private lastBeamDirection = 0;

    private trackingComputer: TrackingComputer = new TrackingComputer();
    private sweepBuffer: { point: Phaser.Math.Vector2 }[] = [];

    // STT state
    private sttTrackId: number | null = null;
    private sttMissedFrames: number = 0;
    // HACK: direct entity reference so the beam follows the target position exactly.
    // TODO: replace with proper angle-tracking loop once chicken-and-egg is resolved.
    private sttTargetEntity: Entity | null = null;

    // Weapons system. The radar (sensor) produces tracks; FireControl consumes
    // them to launch and guide missiles. Constructed in the constructor (needs
    // the scene).
    private fireControl: FireControl;

    public rwrReceiver = new RwrReceiver();
    public jammer = new Jammer();

    // Ground-mapping half of the radar: terrain returns bypass the tracking
    // pipeline entirely and are painted like a mapping radar's display.
    private terrainMapper = new TerrainMapper();

    // Error captured if an enemy jammer spoofed this radar during the current
    // RWS sweep; applied to the buffered hits at sweepComplete, then cleared.
    private sweepJammerError: JammerError | null = null;

    public eventEmitter = new RadarEventEmitter();

    private interfaceRenderer: InterfaceRenderer | null = null;
    // Only the player's radar has a renderer; target radars track silently.
    private radarRenderer: RadarRenderer | null = null;

    private raycaster = new Ray();

    private scene: Phaser.Scene;

    constructor(params: { scene: Phaser.Scene; range?: number }) {
        this.scene = params.scene;
        this.range = params.range ?? RADAR_DEFAULT_RANGE_PX;
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
    }

    enterTws(): void {
        if (this.mode === 'stt') {
            this.clearSttState();
            this.trackingComputer.setTracks([]);
        }
        this.mode = 'tws';
        this.sweepBuffer = [];
    }

    private clearSttState(): void {
        this.sttTrackId = null;
        this.sttMissedFrames = 0;
        this.sttTargetEntity = null;
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
    }

    // ── STT lock management ────────────────────────────────────────────────

    // Lock the highest-confidence RWS track and enter STT.
    enterStt(): void {
        const tracks = this.trackingComputer.getTracks();
        if (tracks.length === 0) return;

        const best = tracks.reduce((a, b) =>
            b.confidence > a.confidence ? b : a
        );

        this.sttTrackId = best.id;
        this.sttMissedFrames = 0;
        this.sttTargetEntity = null; // resolved in updateStt on the first frame

        this.mode = 'stt';

        // Discard all other tracks — STT focuses entirely on one target.
        this.trackingComputer.setTracks([best]);
        this.sweepBuffer = [];

        this.eventEmitter.emitLockEvent();
    }

    exitStt(): void {
        this.clearSttState();
        this.mode = 'rws';
        // Clear the STT track; RWS will rebuild contacts from scratch.
        this.trackingComputer.setTracks([]);
        this.sweepBuffer = [];
    }

    getSttTrack(): Track | null {
        if (this.sttTrackId === null) return null;
        return this.trackingComputer.getTracks().find(t => t.id === this.sttTrackId) ?? null;
    }

    // ── Jammer ─────────────────────────────────────────────────────────────

    // Trigger a jamming burst (player input). No-op while active, cooling down,
    // or with the transmitter shut down (EMCON) — jamming is itself an emission.
    activateJammer(): void {
        if (this.mode === 'emcon') return;
        this.jammer.activate(this.scene.time.now);
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
    shoot(_angle: number): void {
        const fired = this.fireControl.shoot(this.mode, {
            ship: this.ownerShip(),
            sttTrack: this.getSttTrack(),
            tracks: this.trackingComputer.getTracks(),
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
        terrain: Entity[] = [],
    ): void {
        if (!this.owner) return;

        const ownerPos = this.owner.getPosition();
        const shipDirection = this.owner.getDirection();

        // Age out stale RWR contacts (incoming-emission warnings).
        this.rwrReceiver.tick(this.scene.time.now);
        // Advance jammer active/cooldown state before any isActive() check.
        this.jammer.tick(this.scene.time.now);

        // If the locked STT target was destroyed, drop the dangling reference
        // before anything reads its (now-undefined) body position.
        if (this.sttTargetEntity && (!this.sttTargetEntity.active || !this.sttTargetEntity.body)) {
            this.sttTargetEntity = null;
        }

        // Update the weapons system every frame regardless of radar mode. The
        // radar supplies the track picture and live entities; FireControl runs
        // missile guidance, the waypoint fade and the seeker-cone rendering.
        const sttEntity = this.sttTargetEntity && 'getPosition' in this.sttTargetEntity
            ? this.sttTargetEntity as PlayerShip | Target
            : null;
        // Live ship entities (excluding owner) for VIM-220 active-radar homing.
        // Exclude destroyed ships (body becomes undefined when removed).
        const targetShips = entities.filter(
            (e): e is PlayerShip | Target =>
                e.id !== this.owner?.id && 'getDirection' in e && e.active && Boolean(e.body),
        );
        this.fireControl.update(delta, {
            sttTrack: this.getSttTrack(),
            sttTargetEntity: sttEntity,
            tracks: this.trackingComputer.getTracks(),
            targets: targetShips,
            decoyCircles,
            now: this.scene.time.now,
        }, graphics);

        if (this.mode === 'stt') {
            this.updateStt(ownerPos, shipDirection, entities, graphics, decoyCircles, terrain);
        } else if (this.mode === 'emcon') {
            this.updateEmcon(ownerPos, shipDirection, graphics);
        } else {
            this.updateRws(ownerPos, shipDirection, entities, graphics, decoyCircles, terrain);
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
        terrain: Entity[],
    ): void {
        const scanWidth = this.antenna.getAzimuth(this.mode);
        const scanStartAngle = shipDirection - scanWidth / 2;
        const scanEndAngle = shipDirection + scanWidth / 2;

        const { direction: pulseDirection, sweepComplete } = this.antenna.update(this.mode, shipDirection);
        this.lastBeamDirection = pulseDirection;
        const pulse = this.emitter.sendPulse(ownerPos, pulseDirection, scanWidth);

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
        this.illuminateRwr(targets, pulse.line, ownerPos, false);

        // If an enemy jammer paints us this frame, remember its spoof error for
        // the rest of the sweep — the buffered hits are rewritten at sweepComplete.
        const jamError = this.detectJamming(targets, pulse.line, ownerPos);
        if (jamError) this.sweepJammerError = jamError;

        // Ship and terrain returns compete for the beam — the nearer one wins.
        // A terrain hit is painted on the ground map (and shadows any ship
        // behind it); a nearer ship return masks the terrain behind it.
        const shipHit = this.nearestHit(pulse.line, ownerPos, targets);
        const terrainHit = this.nearestHit(pulse.line, ownerPos, terrain);
        const terrainWins = terrainHit && (!shipHit ||
            Phaser.Math.Distance.Squared(ownerPos.x, ownerPos.y, terrainHit.x, terrainHit.y) <
            Phaser.Math.Distance.Squared(ownerPos.x, ownerPos.y, shipHit.x, shipHit.y));

        if (terrainWins) {
            this.terrainMapper.addSample(terrainHit, this.scene.time.now);
        } else if (shipHit && !this.receiver.isBlockedByDecoy(ownerPos, shipHit, decoyCircles)) {
            // Chaff between the antenna and the target can swallow the return.
            this.sweepBuffer.push({ point: shipHit });
        }

        if (sweepComplete) {
            // A jammed sweep rewrites every buffered hit into one coherent false
            // track (replacing the real return); an un-jammed sweep is normal.
            const returns = this.sweepJammerError
                ? this.receiver.createFakeHits(this.sweepBuffer, ownerPos, this.range, this.sweepJammerError)
                : this.receiver.processHits(this.sweepBuffer, ownerPos, this.range);
            // TWS caps simultaneous tracks; RWS searches without a cap.
            const maxTracks = this.mode === 'tws' ? MAX_TWS_TRACKS : Infinity;
            this.trackingComputer.update(returns, ownerPos, undefined, maxTracks);
            this.sweepBuffer = [];
            this.sweepJammerError = null;
        }

        for (const track of this.trackingComputer.getTracks()) {
            this.radarRenderer?.renderRwsContacts(graphics, track);
        }
    }

    // ── STT concentrated illumination ─────────────────────────────────────

    private updateStt(
        ownerPos: { x: number; y: number },
        shipDirection: number,
        entities: Entity[],
        graphics: Phaser.GameObjects.Graphics,
        decoyCircles: Phaser.Geom.Circle[],
        terrain: Entity[],
    ): void {
        const rwsHalfAz = this.antenna.getAzimuth('rws') / 2;
        const currentSttTrack = this.getSttTrack();
        const targets = entities.filter(e => e.id !== this.owner?.id);

        // HACK: resolve entity reference on first STT frame.
        if (!this.sttTargetEntity && currentSttTrack) {
            let nearest: Entity | null = null;
            let nearestDist = Infinity;
            for (const e of targets) {
                if (!('getPosition' in e)) continue;
                const pos = (e as PlayerShip | Target).getPosition();
                const d = Phaser.Math.Distance.Between(pos.x, pos.y, currentSttTrack.pos.x, currentSttTrack.pos.y);
                if (d < nearestDist) { nearestDist = d; nearest = e; }
            }
            this.sttTargetEntity = nearest;
        }

        // Drive beam directly from entity position so tracking is never frozen.
        // Guard against destroyed entities (body becomes undefined when removed from scene).
        const targetEntity = this.sttTargetEntity as PlayerShip | Target | null;
        if (targetEntity && (!targetEntity.active || !targetEntity.body)) {
            this.exitStt();
            return;
        }
        const targetPos = targetEntity && 'getPosition' in targetEntity
            ? targetEntity.getPosition()
            : currentSttTrack?.pos;

        let lockDir = shipDirection;
        if (targetPos) {
            const bearing = Phaser.Math.RadToDeg(
                Math.atan2(targetPos.y - ownerPos.y, targetPos.x - ownerPos.x)
            );
            const offset = Phaser.Math.Angle.WrapDegrees(bearing - shipDirection);
            if (Math.abs(offset) > rwsHalfAz) {
                this.exitStt();
                return;
            }
            lockDir = shipDirection + offset;
        }

        this.lastBeamDirection = lockDir;
        const pulse = this.emitter.sendPulse(ownerPos, lockDir, STT_BEAM_DEG);

        // Render full RWS cone with red beam fixed at lock direction.
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

        // Single ray pointed at locked target; processed immediately (no buffer).
        // Chaff in the beam can swallow the return, starving the lock until it
        // breaks (the missed-frame counter below handles that).
        let rawHit = this.nearestHit(pulse.line, ownerPos, targets);
        // Terrain between us and the target blocks the beam: the return is the
        // terrain (painted on the ground map), not the ship — the lock starves.
        const terrainHit = this.nearestHit(pulse.line, ownerPos, terrain);
        if (terrainHit && (!rawHit ||
            Phaser.Math.Distance.Squared(ownerPos.x, ownerPos.y, terrainHit.x, terrainHit.y) <
            Phaser.Math.Distance.Squared(ownerPos.x, ownerPos.y, rawHit.x, rawHit.y))) {
            this.terrainMapper.addSample(terrainHit, this.scene.time.now);
            rawHit = null;
        }
        // STT energy overpowers the jammer, so the return is not spoofed — but a
        // jammed frame has a chance to swallow it, feeding the lock-break counter.
        const jammed = this.detectJamming(targets, pulse.line, ownerPos) !== null;
        const hit = rawHit
            && !this.receiver.isBlockedByDecoy(ownerPos, rawHit, decoyCircles)
            && !(jammed && Math.random() < JAMMER_STT_DEGRADE_PROB)
            ? rawHit
            : null;
        const rawHits = hit ? [{ point: hit }] : [];

        // Lock illumination: any ship in the beam detects a locked (red) RWR
        // contact and fires its lock-warning event.
        this.illuminateRwr(targets, pulse.line, ownerPos, true);

        const returns = this.receiver.processHits(rawHits, ownerPos, this.range);
        // STT updates every frame; high maxMissedScans keeps the lock alive during
        // brief signal dropouts without conflicting with the RWS sweep timescale.
        this.trackingComputer.update(returns, ownerPos, 90);

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
        if (stt) {
            this.radarRenderer?.renderStt(stt, graphics);
        }
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
    private illuminateRwr(
        targets: Entity[],
        line: Phaser.Geom.Line,
        ownerPos: { x: number; y: number },
        isLocked: boolean,
    ): void {
        const now = this.scene.time.now;
        for (const entity of targets) {
            if (!('radar' in entity)) continue;
            const polygon = this.raycaster.getBodyPolygons(entity);
            const hit = Phaser.Geom.Intersects.GetLineToPolygon(line, polygon);
            if (!hit) continue;

            const tgt = entity as PlayerShip | Target;
            const epos = tgt.getPosition();
            const bearingDeg = Phaser.Math.RadToDeg(
                Math.atan2(ownerPos.y - epos.y, ownerPos.x - epos.x),
            );
            tgt.radar.rwrReceiver.receive(String(this.owner?.id ?? 'unknown'), bearingDeg, isLocked, now);
            if (isLocked) tgt.radar.eventEmitter.onRwrLock();
        }
    }

    // Return the spoof error of the first enemy jammer affecting us this frame,
    // or null. A jammer affects us only when our beam actually paints the
    // jamming ship *and* we (the emitter) sit inside its jamming cone.
    private detectJamming(
        targets: Entity[],
        line: Phaser.Geom.Line,
        ownerPos: { x: number; y: number },
    ): JammerError | null {
        for (const entity of targets) {
            if (!('radar' in entity)) continue;
            const tgt = entity as PlayerShip | Target;
            if (!tgt.radar.jammer.isActive()) continue;

            const polygon = this.raycaster.getBodyPolygons(entity);
            if (!Phaser.Geom.Intersects.GetLineToPolygon(line, polygon)) continue;

            if (tgt.radar.jammer.covers(tgt.getPosition(), tgt.getDirection(), ownerPos, this.range)) {
                return tgt.radar.jammer.getError();
            }
        }
        return null;
    }

    private nearestHit(
        line: Phaser.Geom.Line,
        ownerPos: { x: number; y: number },
        targets: Entity[],
    ): Phaser.Math.Vector2 | null {
        let nearestPoint: Phaser.Math.Vector2 | null = null;
        let nearestDistSq = Infinity;

        for (const target of targets) {
            const polygon = this.raycaster.getBodyPolygons(target);
            const hit = Phaser.Geom.Intersects.GetLineToPolygon(line, polygon);
            if (!hit) continue;

            const dSq = Phaser.Math.Distance.Squared(ownerPos.x, ownerPos.y, hit.x, hit.y);
            if (dSq < nearestDistSq) {
                nearestDistSq = dSq;
                nearestPoint = new Phaser.Math.Vector2(hit.x, hit.y);
            }
        }

        return nearestPoint;
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
