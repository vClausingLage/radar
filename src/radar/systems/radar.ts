import { PlayerShip, Target } from "../../entities/ship";

import { Antenna } from "./modules/antenna";
import { Emitter } from "./modules/emitter";
import { Receiver } from "./modules/receiver";
import { TrackingComputer } from "./modules/trackingComputer";
import { RwrReceiver } from "./modules/rwr";
import { MissileGuidance } from "./modules/missileGuidance";
import { LoadoutManager } from "./modules/loadoutManager";
import { Jammer, JammerError, JammerHudStatus } from "./modules/jammer";

import { Track } from "../data/track";
import { Entity, Mode } from "../data/types";

import { InterfaceRenderer } from "../renderer/interfaceRenderer";
import { RadarRenderer } from "../renderer/radarRenderer";

import { Vector2 } from "../../types";
import { Ray } from "../../physics/ray";
import { RadarEventEmitter } from "./game/radarEventEmitter";

import { Missile, ActiveRadarMissile, MISSILE_FLIGHT } from "../../entities/missiles";
import {
    JAMMER_STT_DEGRADE_PROB,
    MAX_TWS_TRACKS,
    PHYSICS_FPS,
    RADAR_DEFAULT_RANGE_PX,
    STT_BEAM_DEG,
    STT_LOCK_BREAK_FRAMES,
    VIM220_WAYPOINT_FADE_MS,
} from "../data/radarGameSettings";

export class Radar {
    private owner: Entity | null = null;

    private mode: Mode = 'rws';
    private range: number = RADAR_DEFAULT_RANGE_PX;
    private antenna = new Antenna();
    private emitter: Emitter = new Emitter(this.range);
    private receiver: Receiver = new Receiver();

    private trackingComputer: TrackingComputer = new TrackingComputer();
    private sweepBuffer: { point: Phaser.Math.Vector2 }[] = [];

    // STT state
    private sttTrackId: number | null = null;
    private sttMissedFrames: number = 0;
    // HACK: direct entity reference so the beam follows the target position exactly.
    // TODO: replace with proper angle-tracking loop once chicken-and-egg is resolved.
    private sttTargetEntity: Entity | null = null;

    // Missile management
    private activeMissiles: Missile[] = [];
    private missileGuidance: MissileGuidance = new MissileGuidance();
    // Most recently fired VIM-220, for the time-to-active-radar HUD readout.
    private lastVim220: ActiveRadarMissile | null = null;

    public rwrReceiver = new RwrReceiver();
    public loadoutManager = new LoadoutManager();
    public jammer = new Jammer();

    // Error captured if an enemy jammer spoofed this radar during the current
    // RWS sweep; applied to the buffered hits at sweepComplete, then cleared.
    private sweepJammerError: JammerError | null = null;

    public eventEmitter = new RadarEventEmitter();

    private interfaceRenderer: InterfaceRenderer | null = null;
    // Only the player's radar has a renderer; target radars track silently.
    private radarRenderer: RadarRenderer | null = null;

    // VIM-220 mid-course waypoints (player-placed, up to two: a steer-to point
    // and a direction point). Assigned to each VIM-220 fired while present.
    private vim220Waypoints: Vector2[] = [];
    // The most recently fired VIM-220 carrying the displayed route. Once it
    // passes its first waypoint or is destroyed, the displayed route fades out.
    private vim220RouteMissile: ActiveRadarMissile | null = null;
    // Timestamp (scene.time.now) the waypoint fade-out began, or null.
    private vim220WaypointsFadeStart: number | null = null;

    private raycaster = new Ray();

    private scene: Phaser.Scene;

    constructor(_params: { scene: Phaser.Scene }) {
        this.scene = _params.scene;
    }

    // Attach the visual renderer. Called by the player ship factory only.
    setRadarRenderer(renderer: RadarRenderer): void {
        this.radarRenderer = renderer;
    }

    setInterfaceRenderer(renderer: InterfaceRenderer): void {
        this.interfaceRenderer = renderer;
    }
    getInterfaceRenderer(): InterfaceRenderer | null {
        return this.interfaceRenderer;
    }

    attachTo(owner: Entity): void {
        this.owner = owner;
    }

    setMode(mode: Mode): void {
        this.mode = mode;
    }
    getMode(): Mode {
        return this.mode;
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

    // Trigger a jamming burst (player input). No-op while active or cooling down.
    activateJammer(): void {
        this.jammer.activate(this.scene.time.now);
    }

    // Cone-readout status for the jammer (active/cooldown/ready countdown).
    getJammerHudStatus(): JammerHudStatus {
        return this.jammer.getHudStatus(this.scene.time.now);
    }

    // ── Loadout ────────────────────────────────────────────────────────────

    cycleLoadout(): void {
        this.loadoutManager.cycleActive();
    }

    // Place a VIM-220 mid-course waypoint (Shift+click). The first click sets
    // the steer-to point, the second sets the direction point. A third click
    // starts a fresh route. Only meaningful while VIM-220 is the active weapon.
    addVim220Waypoint(point: { x: number; y: number }): void {
        if (this.loadoutManager.getActiveType() !== 'VIM-220') return;
        if (this.vim220Waypoints.length >= 2) this.vim220Waypoints = [];
        // A freshly-placed route shows solid and is owned by no missile yet.
        this.cancelVim220WaypointFade();
        this.vim220Waypoints.push({ x: point.x, y: point.y });
    }

    clearVim220Waypoints(): void {
        this.vim220Waypoints = [];
        this.cancelVim220WaypointFade();
    }

    private cancelVim220WaypointFade(): void {
        this.vim220WaypointsFadeStart = null;
        this.vim220RouteMissile = null;
    }

    // Build a per-missile route copy from the current waypoints, or null if none
    // are placed. `reachedFirst` is missile-local so each missile flies its own.
    private buildVim220Route(): ActiveRadarMissile['waypointRoute'] {
        if (this.vim220Waypoints.length === 0) return null;
        const first = { ...this.vim220Waypoints[0] };
        const directionPoint = this.vim220Waypoints.length >= 2
            ? { ...this.vim220Waypoints[1] }
            : { ...this.vim220Waypoints[0] };
        return { first, directionPoint, reachedFirst: false };
    }

    // Fade and eventually clear the displayed waypoints once the missile that
    // owns them has passed its first waypoint (route consumed) or been destroyed.
    private updateVim220WaypointFade(): void {
        if (this.vim220Waypoints.length === 0) return;

        // Begin the fade on the triggering event.
        if (this.vim220WaypointsFadeStart === null && this.vim220RouteMissile) {
            const missile = this.vim220RouteMissile;
            const passed = missile.waypointRoute?.reachedFirst ?? false;
            const destroyed = !missile.active;
            if (passed || destroyed) {
                this.vim220WaypointsFadeStart = this.scene.time.now;
            }
        }

        // Advance the fade; clear the route once it completes.
        if (this.vim220WaypointsFadeStart !== null) {
            const elapsed = this.scene.time.now - this.vim220WaypointsFadeStart;
            if (elapsed >= VIM220_WAYPOINT_FADE_MS) {
                this.vim220Waypoints = [];
                this.cancelVim220WaypointFade();
            }
        }
    }

    // Current opacity (0–1) for the displayed waypoints, driving the fade-out.
    private getVim220WaypointAlpha(): number {
        if (this.vim220WaypointsFadeStart === null) return 1;
        const elapsed = this.scene.time.now - this.vim220WaypointsFadeStart;
        return Phaser.Math.Clamp(1 - elapsed / VIM220_WAYPOINT_FADE_MS, 0, 1);
    }

    // ── Firing ────────────────────────────────────────────────────────────

    shoot(_angle: number): void {
        if (this.mode === 'stt') {
            this.fireVim177();
        } else if (this.mode === 'tws') {
            this.fireVim220();
        }
    }

    // VIM-177 (SARH): requires an STT lock; rides the ship's illumination.
    private fireVim177(): void {
        const ship = this.ownerShip();
        if (!ship) return;

        const sttTrack = this.getSttTrack();
        if (!sttTrack) return;

        if (this.loadoutManager.getActiveType() !== 'VIM-177') return;
        const loadout = this.loadoutManager.getLoadout();
        if (!loadout['VIM-177'] || loadout['VIM-177'].load <= 0) return;

        // Launch along the ship's heading — the missile flies straight off the
        // rail during its boost phase (age < 2) before the seeker steers it
        // toward the intercept point. MissileGuidance handles the turn.
        const ownerPos = ship.getPosition();
        const rad = Phaser.Math.DegToRad(ship.getDirection());

        // Built via the factory so the shared missile collision category is
        // applied — missiles never collide with one another.
        const missile = this.scene.add.sarhMissile({
            x: ownerPos.x,
            y: ownerPos.y,
            dirX: Math.cos(rad),
            dirY: Math.sin(rad),
        });
        this.armMissile(missile, ship);

        this.activeMissiles.push(missile);
        this.loadoutManager.decrementLoad('VIM-177');
    }

    // VIM-220 (ARH): TWS fire — assigns the missile to the next un-engaged
    // track. Ship guides it mid-course; its own radar takes over at terminal.
    private fireVim220(): void {
        const ship = this.ownerShip();
        if (!ship) return;

        if (this.loadoutManager.getActiveType() !== 'VIM-220') return;
        const loadout = this.loadoutManager.getLoadout();
        if (!loadout['VIM-220'] || loadout['VIM-220'].load <= 0) return;

        const ownerPos = ship.getPosition();

        // Engage the nearest track not already assigned to a live missile, so
        // successive shots walk outward from the closest contact.
        const engaged = new Set(
            this.activeMissiles
                .map(m => m.targetId)
                .filter((id): id is number => id !== undefined),
        );
        const target = this.trackingComputer.getTracks()
            .filter(t => !engaged.has(t.id))
            .sort((a, b) =>
                Phaser.Math.Distance.Between(ownerPos.x, ownerPos.y, a.pos.x, a.pos.y) -
                Phaser.Math.Distance.Between(ownerPos.x, ownerPos.y, b.pos.x, b.pos.y))[0];
        if (!target) return;

        const rad = Phaser.Math.DegToRad(ship.getDirection());

        // Built via the factory so the shared missile collision category is
        // applied — missiles never collide with one another.
        const missile = this.scene.add.activeRadarMissile({
            x: ownerPos.x,
            y: ownerPos.y,
            dirX: Math.cos(rad),
            dirY: Math.sin(rad),
        });
        missile.targetId = target.id;
        missile.waypointRoute = this.buildVim220Route();
        this.armMissile(missile, ship);

        this.activeMissiles.push(missile);
        this.lastVim220 = missile;
        // If this shot carries a route, it now owns the displayed waypoints —
        // they fade once it passes them or dies (see updateVim220WaypointFade).
        if (missile.waypointRoute) {
            this.vim220RouteMissile = missile;
            this.vim220WaypointsFadeStart = null;
        }
        this.loadoutManager.decrementLoad('VIM-220');
    }

    // Tag a freshly-spawned missile with its owner and the owner's no-collide
    // group so it cannot detonate against the launching ship.
    private armMissile(missile: Missile, ship: PlayerShip | Target): void {
        missile.owner = ship;
        const noCollideGroup = ship.getMissileNoCollideGroup();
        if (noCollideGroup !== undefined) missile.setCollisionGroup(noCollideGroup);
    }

    // Max range (px) of the currently selected weapon, for the range indicator.
    getActiveMissileRange(): number | null {
        const type = this.loadoutManager.getActiveType();
        const flight = (MISSILE_FLIGHT as Record<string, { speed: number; burnTime: number }>)[type];
        return flight ? flight.speed * PHYSICS_FPS * flight.burnTime : null;
    }

    // HUD readout for the last-fired VIM-220's seeker: 0 ("RADAR ACTIVE") once
    // its onboard radar is online, otherwise null (the seeker arms by closing
    // range, so there is no meaningful countdown to show). Null when none in
    // flight.
    getLastVim220TimeToActive(): number | null {
        if (!this.lastVim220 || !this.lastVim220.active) {
            this.lastVim220 = null;
            return null;
        }
        return this.lastVim220.isActiveRadarEnabled() ? 0 : null;
    }

    // ── Main update ───────────────────────────────────────────────────────

    update(
        delta: number,
        _direction: number,
        entities: Entity[],
        graphics: Phaser.GameObjects.Graphics,
        decoyCircles: Phaser.Geom.Circle[] = [],
    ): void {
        if (!this.owner || !('getDirection' in this.owner)) return;

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

        // Update missile guidance every frame regardless of radar mode.
        const sttTrack = this.getSttTrack();
        const sttEntity = this.sttTargetEntity && 'getPosition' in this.sttTargetEntity
            ? this.sttTargetEntity as PlayerShip | Target
            : null;
        // Live ship entities (excluding owner) for VIM-220 active-radar homing.
        // Exclude destroyed ships (body becomes undefined when removed).
        const targetShips = entities.filter(
            (e): e is PlayerShip | Target =>
                e.id !== this.owner?.id && 'getDirection' in e && e.active && Boolean(e.body),
        );
        this.activeMissiles = this.missileGuidance.update(this.activeMissiles, delta, {
            sttTrack,
            sttTargetEntity: sttEntity,
            tracks: this.trackingComputer.getTracks(),
            targets: targetShips,
            decoyCircles,
        });

        this.updateVim220WaypointFade();

        if (this.mode === 'stt') {
            this.updateStt(ownerPos, shipDirection, entities, graphics, decoyCircles);
        } else {
            this.updateRws(ownerPos, shipDirection, entities, graphics, decoyCircles);
        }

        this.renderMissileSeekerCones(graphics);
    }

    // Draw the seeker cone for every in-flight VIM-220 whose onboard radar has
    // gone active, so the player can see what each missile can currently "see".
    private renderMissileSeekerCones(graphics: Phaser.GameObjects.Graphics): void {
        if (!this.radarRenderer) return;
        for (const missile of this.activeMissiles) {
            if (!(missile instanceof ActiveRadarMissile) || !missile.isActiveRadarEnabled()) continue;
            const headingDeg = Phaser.Math.RadToDeg(Math.atan2(missile.direction.y, missile.direction.x));
            this.radarRenderer.renderMissileSeekerCone(
                graphics,
                { x: missile.x, y: missile.y },
                headingDeg,
                missile.missileRadar.getRange(),
                missile.missileRadar.getSearchAzimuth(),
            );
        }
    }

    // ── RWS sweep ─────────────────────────────────────────────────────────

    private updateRws(
        ownerPos: { x: number; y: number },
        shipDirection: number,
        entities: Entity[],
        graphics: Phaser.GameObjects.Graphics,
        decoyCircles: Phaser.Geom.Circle[],
    ): void {
        const scanWidth = this.antenna.getAzimuth(this.mode);
        const scanStartAngle = shipDirection - scanWidth / 2;
        const scanEndAngle = shipDirection + scanWidth / 2;

        const { direction: pulseDirection, sweepComplete } = this.antenna.update(this.mode, shipDirection);
        const pulse = this.emitter.sendPulse(ownerPos, pulseDirection, scanWidth);

        this.radarRenderer?.update(
            graphics, ownerPos, this.range,
            scanStartAngle, scanEndAngle,
            [], this.loadoutManager.getLoadout(), this.vim220Waypoints, pulse, false,
            this.getLastVim220TimeToActive(), this.getActiveMissileRange(),
            this.getJammerHudStatus(), this.getVim220WaypointAlpha(),
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

        const nearestPoint = this.nearestHit(pulse.line, ownerPos, targets);
        // Chaff between the antenna and the target can swallow the return.
        if (nearestPoint && !this.receiver.isBlockedByDecoy(ownerPos, nearestPoint, decoyCircles)) {
            this.sweepBuffer.push({ point: nearestPoint });
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

        const pulse = this.emitter.sendPulse(ownerPos, lockDir, STT_BEAM_DEG);

        // Render full RWS cone with red beam fixed at lock direction.
        this.radarRenderer?.update(
            graphics, ownerPos, this.range,
            shipDirection - rwsHalfAz, shipDirection + rwsHalfAz,
            [], this.loadoutManager.getLoadout(), this.vim220Waypoints, pulse, true,
            this.getLastVim220TimeToActive(), this.getActiveMissileRange(),
            this.getJammerHudStatus(), this.getVim220WaypointAlpha(),
        );

        // Render our own jamming cone while the jammer is running.
        if (this.jammer.isActive()) {
            this.radarRenderer?.renderJammerCone(graphics, ownerPos, shipDirection, this.range);
        }

        // Single ray pointed at locked target; processed immediately (no buffer).
        // Chaff in the beam can swallow the return, starving the lock until it
        // breaks (the missed-frame counter below handles that).
        const rawHit = this.nearestHit(pulse.line, ownerPos, targets);
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

    private ownerShip(): (PlayerShip | Target) | null {
        if (!this.owner || !('getDirection' in this.owner)) return null;
        return this.owner as PlayerShip | Target;
    }

    setTracks(tracks: Track[]): void {
        this.trackingComputer.setTracks(tracks);
    }
    getTracks(): Track[] {
        return this.trackingComputer.getTracks();
    }
}
