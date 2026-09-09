import Phaser from 'phaser';
import { Radar } from '../radar/systems/radar';
import { Target } from '../entities/ship';
import { Track } from '../radar/data/track';
import { world } from '../settings';

// Behaviour states. The engagement flow is a cycle rather than a single state:
//   INVESTIGATE → ENGAGE (shoot) → CRANK (support + open range) → SKATE (bug out)
// EVADE pre-empts everything the moment an enemy fire-control lock is detected.
enum AIState {
    PATROL,      // No contacts — flying a search ladder
    INVESTIGATE, // Radar contact, closing to lock
    ENGAGE,      // STT lock held — shooting
    CRANK,       // Just fired: turn target to the cone edge to open range (F-pole)
    SKATE,       // Missile away/spent: break lock and run
    EVADE,       // Being locked by an enemy — defend the shot
}

type Personality = 'aggressive' | 'defensive';

// Whether the unit is under way. An 'inactive' unit is a stationary emplacement:
// it holds position and heading, but its radar, jammer and weapons work normally.
export type UnitActivity = 'active' | 'inactive';

// ── Tunables ───────────────────────────────────────────────────────────────
const FIRE_COOLDOWN_MS = 2500;
const STT_LOCK_DELAY_MS = 2500;       // lock must be held this long before firing
const INVESTIGATE_STT_MIN_AGE = 2;    // wait ~2 scans of a track before locking it
const CRANK_DURATION_MS = 6000;       // how long to support/crank after a shot
const CRANK_OFFSET_DEG = 25;          // STT: hold target this far off boresight (<30° cone)
const CRANK_OFFSET_TWS_DEG = 18;      // TWS: tighter, its half-azimuth is only 22.5°
const SKATE_MS_AGGRESSIVE = 3000;
const SKATE_MS_DEFENSIVE = 6000;
const DECOY_COOLDOWN_MS = 1200;       // min gap between chaff drops
const PATROL_LEG_PX = 500;            // straight leg of the search ladder
const PATROL_STEP_PX = 150;           // sideways step between legs
const PATROL_MARGIN_PX = 300;         // keep the ladder this far off the world edge
const ROUTE_ARRIVAL_PX = 60;          // a fixed route's destination counts as reached this close

export class AiUnitController {
    private state: AIState = AIState.PATROL;
    private readonly personality: Personality;

    private debugText?: Phaser.GameObjects.Text;

    // Engagement timing.
    private nextShotAt = 0;
    private sttLockAcquiredAt: number | null = null;
    private currentSttTargetId: number | null = null;
    private crankUntil = 0;
    private crankSide = 1;             // +1/−1: which way to crank the nose
    private skateUntil = 0;
    private evadeSide = 1;

    // Last known contact position, so SKATE/EVADE can flee a direction even after
    // the lock (and thus the live track) is gone.
    private lastTargetPos: { x: number; y: number } | null = null;
    private nextDecoyAt = 0;

    // Patrol search ladder.
    private patrolRoute: { x: number; y: number }[] = [];
    private patrolIndex = 0;
    private cargoWaypoints: { x: number; y: number }[] = [];
    private cargoWaypointIndex = 0;
    // A generated cargo route is a loop; a route handed in via setRoute() is a
    // flight with a destination, after which the ship holds where it stopped.
    private routeLoops = true;
    private arrived = false;

    constructor(
        private readonly scene: Phaser.Scene,
        private readonly ship: Target,
        private turnRate = 0,
        private sttTracked = false,
        private readonly radar: Radar | null = null,
        private readonly id: number | null = null,
        private readonly activity: UnitActivity = 'active',
    ) {
        // Cargo is always defensive; cruisers get a coin-flip personality so both
        // aggressive and defensive behaviours show up in a scene.
        this.personality = ship.shipType === 'cargo'
            ? 'defensive'
            : (Phaser.Math.Between(0, 1) === 0 ? 'aggressive' : 'defensive');

        this.createDebugText();
        // A stationary unit has no route to fly.
        if (this.activity === 'active') {
            if (ship.shipType === 'cargo') {
                this.cargoWaypoints = this.generateCargoRoute();
            } else {
                this.patrolRoute = this.generatePatrolRoute();
            }
        }
    }

    // Release what the controller owns in the scene (the DEV state label). The
    // ship itself belongs to the scene, so it is left alone — this only detaches
    // the brain, e.g. when a scenario wants an inert prop instead of an opponent.
    destroy(): void {
        this.debugText?.destroy();
        this.debugText = undefined;
    }

    public getTurnRate(): number {
        return this.turnRate;
    }
    public setTurnRate(turnRate: number): void {
        this.turnRate = turnRate;
    }

    // Replace the generated loop with a fixed itinerary whose last point is the
    // destination (a landing pad, a station). Only cargo flies routes — a
    // cruiser's movement is its search ladder and the engagement it leads to.
    public setRoute(waypoints: { x: number; y: number }[]): void {
        this.cargoWaypoints = waypoints.map(p => ({ x: p.x, y: p.y }));
        this.cargoWaypointIndex = 0;
        this.routeLoops = false;
        this.arrived = false;
    }

    // True once a routed ship has reached its destination and stopped.
    public hasArrived(): boolean {
        return this.arrived;
    }

    private createDebugText(): void {
        if (!import.meta.env.DEV) return;
        this.debugText = this.scene.add.text(this.ship.x, this.ship.y - 24, '', {
            fontSize: '11px',
            color: '#00ff88',
            backgroundColor: '#001a11',
        }).setOrigin(0.5, 1);
    }

    private updateDebugText(): void {
        if (!this.debugText) return;
        const stateNames = ['PATROL', 'INVESTIGATE', 'ENGAGE', 'CRANK', 'SKATE', 'EVADE'];
        const lock = this.sttLockAcquiredAt !== null
            ? `L:${Math.floor((this.scene.time.now - this.sttLockAcquiredAt) / 1000)}s`
            : 'L:--';
        const w220 = this.radar?.getWeaponLoad('VIM-220') ?? 0;
        const w177 = this.radar?.getWeaponLoad('VIM-177') ?? 0;
        const activity = this.activity === 'inactive' ? ' STATIC' : '';
        this.debugText.setText(
            `AI ${this.id} ${this.personality[0].toUpperCase()}${activity} [${stateNames[this.state]}] ${lock} D:${this.ship.getRemainingDecoys()} M:${w220}/${w177}`,
        );
        this.debugText.setPosition(this.ship.x, this.ship.y - 24);
    }

    // Called every frame.
    updateContinuous(): void {
        if (!this.ship.active || !this.ship.body) {
            this.debugText?.destroy();
            this.debugText = undefined;
            return;
        }

        const radar = this.radar;
        const tracks = radar?.getTracks() ?? [];
        // Tracks are geometry-only (no entity id): engage the highest-confidence one.
        const preferredTrack = tracks.reduce<Track | undefined>(
            (best, t) => (!best || t.confidence > best.confidence ? t : best),
            undefined,
        );
        const sttTrack = radar?.getSttTrack() ?? null;

        // Weapon doctrine: spend the fire-and-forget VIM-220s first (TWS shots,
        // no lock needed), then fall back to the SARH VIM-177 (needs STT).
        const weapon = this.engagementWeapon();
        // The track the current weapon engages with: the STT lock for the 177,
        // any maintained TWS track for the 220.
        const engagementTrack = weapon === 'VIM-220' ? (preferredTrack ?? null) : sttTrack;

        // Are we being locked by an enemy fire-control radar? (from our RWR)
        this.sttTracked = radar?.rwrReceiver.getPrimaryRwrContact()?.isLocked ?? false;

        this.updateSttLockTracking(sttTrack?.id ?? null);
        this.updateState(preferredTrack, weapon, engagementTrack);

        switch (this.state) {
            case AIState.EVADE: this.executeEvade(); break;
            case AIState.SKATE: this.executeSkate(); break;
            case AIState.CRANK: this.executeCrank(weapon, engagementTrack); break;
            case AIState.ENGAGE: this.executeEngage(weapon, engagementTrack); break;
            case AIState.INVESTIGATE: this.executeInvestigate(preferredTrack, weapon); break;
            case AIState.PATROL: this.executePatrol(); break;
        }

        // Border avoidance overrides state steering at the world edge. A
        // stationary unit can never reach an edge, so it skips both — and so
        // does a ship that has reached its destination and is holding there.
        if (this.activity === 'active' && !this.arrived) {
            this.avoidBorder();
            this.applyMovement();
        } else {
            this.ship.setVelocity(0, 0);
        }
        this.updateDebugText();
    }

    // ── State machine ──────────────────────────────────────────────────────

    // Which weapon the next engagement uses: fire-and-forget VIM-220s first,
    // then the SARH VIM-177s.
    private engagementWeapon(): 'VIM-220' | 'VIM-177' {
        return (this.radar?.getWeaponLoad('VIM-220') ?? 0) > 0 ? 'VIM-220' : 'VIM-177';
    }

    private updateState(
        track: Track | undefined,
        weapon: 'VIM-220' | 'VIM-177',
        engagementTrack: Track | null,
    ): void {
        const now = this.scene.time.now;
        const isCargo = this.ship.shipType === 'cargo';

        // Highest priority: an enemy has a fire-control lock on us → defend.
        if (this.sttTracked) {
            this.enter(AIState.EVADE);
            return;
        }

        // Cargo never prosecutes an attack; it just flies its route (evade above
        // still applies).
        if (isCargo) {
            this.enter(AIState.PATROL);
            return;
        }

        // Post-shot maneuvers run to completion before re-evaluating.
        if (this.state === AIState.SKATE && now < this.skateUntil) return;
        if (this.state === AIState.CRANK) {
            // Keep cranking while the window is open and the engagement source
            // (STT lock / TWS track) survives; otherwise bug out.
            if (now < this.crankUntil && engagementTrack) return;
            this.enter(AIState.SKATE);
            return;
        }

        // Ready to shoot? The 177 needs its STT lock; the 220 just needs a
        // matured TWS track (radar mode is set up during INVESTIGATE).
        const readyToEngage = weapon === 'VIM-220'
            ? engagementTrack !== null
                && engagementTrack.age >= INVESTIGATE_STT_MIN_AGE
                && this.radar?.getMode() === 'tws'
            : engagementTrack !== null;

        if (readyToEngage) this.enter(AIState.ENGAGE);
        else if (track) this.enter(AIState.INVESTIGATE);
        else this.enter(AIState.PATROL);
    }

    // Transition with logging + entry side effects.
    private enter(state: AIState): void {
        if (this.state === state) return;
        if (state === AIState.SKATE) {
            this.skateUntil = this.scene.time.now + this.skateDurationMs();
        }
        if (state === AIState.EVADE) {
            this.evadeSide = Phaser.Math.Between(0, 1) === 0 ? 1 : -1;
        }
        this.state = state;
    }

    private skateDurationMs(): number {
        return this.personality === 'aggressive' ? SKATE_MS_AGGRESSIVE : SKATE_MS_DEFENSIVE;
    }

    private updateSttLockTracking(sttTargetId: number | null): void {
        if (sttTargetId !== null) {
            if (this.currentSttTargetId !== sttTargetId) {
                this.sttLockAcquiredAt = this.scene.time.now;
                this.currentSttTargetId = sttTargetId;
            }
        } else {
            this.sttLockAcquiredAt = null;
            this.currentSttTargetId = null;
        }
    }

    // ── State behaviours ───────────────────────────────────────────────────

    private executePatrol(): void {
        if (this.radar?.getMode() !== 'rws') this.radar?.enterRws();

        if (this.ship.shipType === 'cargo') {
            this.followCargoRoute();
            return;
        }

        // React to being painted (unlocked RWR contact) before we have a track:
        // aggressive turns toward the emitter to acquire, defensive turns away.
        const rwr = this.radar?.rwrReceiver.getPrimaryRwrContact();
        if (rwr) {
            const heading = this.personality === 'aggressive' ? rwr.bearingDeg : rwr.bearingDeg + 180;
            this.turnTowardAngle(heading);
            return;
        }

        this.followPatrolLadder();
    }

    private executeInvestigate(track: Track | undefined, weapon: 'VIM-220' | 'VIM-177'): void {
        if (!track) return;
        this.lastTargetPos = { x: track.pos.x, y: track.pos.y };
        this.turnToward(track.pos);
        this.tryJam(track.pos);

        // Wait until the track has matured (~2 scans), then set up the radar for
        // the chosen weapon: TWS for the fire-and-forget 220 (no lock needed),
        // STT lock for the SARH 177.
        if (track.age >= INVESTIGATE_STT_MIN_AGE && this.radar) {
            if (weapon === 'VIM-220') {
                if (this.radar.getMode() !== 'tws') this.radar.enterTws();
            } else if (this.radar.getMode() !== 'stt') {
                this.radar.enterStt();
            }
        }
    }

    private executeEngage(weapon: 'VIM-220' | 'VIM-177', track: Track | null): void {
        if (!track) return;
        this.lastTargetPos = { x: track.pos.x, y: track.pos.y };
        this.turnToward(track.pos);

        this.tryJam(track.pos);

        // The 177 shot is gated on holding the lock; the 220 track matured
        // during INVESTIGATE and can be fired as soon as the launcher is ready.
        const now = this.scene.time.now;
        const lockHeld = this.sttLockAcquiredAt !== null ? now - this.sttLockAcquiredAt : 0;
        const gateOpen = weapon === 'VIM-220' || lockHeld >= STT_LOCK_DELAY_MS;

        if (gateOpen && now >= this.nextShotAt && this.tryShoot(weapon)) {
            this.nextShotAt = now + FIRE_COOLDOWN_MS;
            this.tryDeployDecoy();

            // Enter the crank: pick the side that turns the nose toward open space
            // (world centre), so we open range without cornering ourselves.
            this.crankSide = this.sideTowardCenter(track.pos);
            this.crankUntil = now + CRANK_DURATION_MS;
            this.state = AIState.CRANK;
        }
    }

    private executeCrank(weapon: 'VIM-220' | 'VIM-177', track: Track | null): void {
        // Lost the engagement source (cone exit, chaff, …) → let updateState skate.
        if (!track) return;
        this.lastTargetPos = { x: track.pos.x, y: track.pos.y };

        this.tryJam(track.pos);

        // Keep the target near the cone edge: aim the offset off the target
        // bearing so it stays illuminated while we build lateral separation.
        // TWS cranks tighter than STT — its cone is 45° vs the 60° search cone.
        const offset = this.radar?.getMode() === 'tws' ? CRANK_OFFSET_TWS_DEG : CRANK_OFFSET_DEG;
        const bearing = this.bearingTo(track.pos);
        this.turnTowardAngle(bearing + this.crankSide * offset);

        // Follow-up shot while cranking — this is where the 220s get "spammed"
        // (fireVim220 walks outward across un-engaged tracks by itself).
        const now = this.scene.time.now;
        if (now >= this.nextShotAt && this.tryShoot(weapon)) {
            this.nextShotAt = now + FIRE_COOLDOWN_MS;
            this.tryDeployDecoy();
        }
    }

    // Select the weapon and pull the trigger. Returns true only if a missile
    // actually left the rail (detected via the load count), since shoot() can
    // silently refuse — e.g. all tracks already engaged, or wrong radar mode.
    private tryShoot(weapon: 'VIM-220' | 'VIM-177'): boolean {
        if (!this.radar) return false;
        this.radar.selectWeapon(weapon);
        const before = this.radar.getWeaponLoad(weapon);
        if (before <= 0) return false;
        this.radar.shoot();
        return this.radar.getWeaponLoad(weapon) < before;
    }

    private executeSkate(): void {
        // Break our own lock and go back to searching while we run.
        if (this.radar?.getMode() === 'stt') this.radar.enterRws();
        if (this.lastTargetPos) this.turnAwayFrom(this.lastTargetPos);
    }

    private executeEvade(): void {
        // Chaff first — in this sim that is what actually defeats a track.
        this.tryDeployDecoy();

        // Break our own lock and search while defending.
        if (this.radar?.getMode() === 'stt') this.radar.enterRws();

        // Threat bearing from the RWR (points at the emitter). Defensive runs cold;
        // aggressive beams (perpendicular) to keep the fight closer.
        const rwr = this.radar?.rwrReceiver.getPrimaryRwrContact();
        const threatBearing = rwr?.bearingDeg
            ?? (this.lastTargetPos ? this.bearingTo(this.lastTargetPos) : this.ship.angle);
        const heading = this.personality === 'defensive'
            ? threatBearing + 180
            : threatBearing + 90 * this.evadeSide;
        this.turnTowardAngle(heading);
    }

    // ── Routes ─────────────────────────────────────────────────────────────

    // Boustrophedon search ladder around the current position, clamped to world.
    private generatePatrolRoute(): { x: number; y: number }[] {
        const clampX = (x: number) => Phaser.Math.Clamp(x, PATROL_MARGIN_PX, world.WIDTH - PATROL_MARGIN_PX);
        const clampY = (y: number) => Phaser.Math.Clamp(y, PATROL_MARGIN_PX, world.HEIGHT - PATROL_MARGIN_PX);

        const points: { x: number; y: number }[] = [];
        let x = this.ship.x;
        let y = this.ship.y;
        let dir = Phaser.Math.Between(0, 1) === 0 ? 1 : -1;
        for (let rung = 0; rung < 4; rung++) {
            x += dir * PATROL_LEG_PX;
            points.push({ x: clampX(x), y: clampY(y) });
            y += PATROL_STEP_PX;
            points.push({ x: clampX(x), y: clampY(y) });
            dir *= -1;
        }
        return points;
    }

    private followPatrolLadder(): void {
        if (this.patrolRoute.length === 0) this.patrolRoute = this.generatePatrolRoute();
        if (this.isNearPosition(this.patrolRoute[this.patrolIndex], 120)) {
            this.patrolIndex++;
            if (this.patrolIndex >= this.patrolRoute.length) {
                this.patrolRoute = this.generatePatrolRoute();
                this.patrolIndex = 0;
            }
        }
        this.turnToward(this.patrolRoute[this.patrolIndex]);
    }

    private generateCargoRoute(): { x: number; y: number }[] {
        const cx = this.ship.x;
        const cy = this.ship.y;
        const r = 800;
        return [
            { x: cx + r, y: cy },
            { x: cx, y: cy + r },
            { x: cx - r, y: cy },
            { x: cx, y: cy - r },
        ];
    }

    private followCargoRoute(): void {
        if (this.cargoWaypoints.length === 0 || this.arrived) return;
        const last = this.cargoWaypointIndex === this.cargoWaypoints.length - 1;
        // Intermediate turn points are passed wide; the destination of a fixed
        // route has to be reached, so it is flown closer before we call it.
        const threshold = last && !this.routeLoops ? ROUTE_ARRIVAL_PX : 150;
        if (this.isNearPosition(this.cargoWaypoints[this.cargoWaypointIndex], threshold)) {
            if (last && !this.routeLoops) {
                this.arrived = true;
                return;
            }
            this.cargoWaypointIndex = (this.cargoWaypointIndex + 1) % this.cargoWaypoints.length;
        }
        this.turnToward(this.cargoWaypoints[this.cargoWaypointIndex]);
    }

    // ── Steering / helpers ─────────────────────────────────────────────────

    // If within BORDER_MARGIN of an edge and heading further toward it, steer back.
    private avoidBorder(): boolean {
        const margin = world.BORDER_MARGIN;
        const { x, y } = this.ship;
        const rad = Phaser.Math.DegToRad(this.ship.angle);
        const dirX = Math.cos(rad);
        const dirY = Math.sin(rad);

        let steerX = 0;
        if (x < margin && dirX < 0) steerX = 1;
        else if (x > world.WIDTH - margin && dirX > 0) steerX = -1;

        let steerY = 0;
        if (y < margin && dirY < 0) steerY = 1;
        else if (y > world.HEIGHT - margin && dirY > 0) steerY = -1;

        if (steerX === 0 && steerY === 0) return false;

        this.turnToward({
            x: x + (steerX !== 0 ? steerX : dirX) * 1000,
            y: y + (steerY !== 0 ? steerY : dirY) * 1000,
        });
        return true;
    }

    // Throttled chaff drop; no-op while cooling down or out of decoys.
    private tryDeployDecoy(): void {
        const now = this.scene.time.now;
        if (now < this.nextDecoyAt || this.ship.getRemainingDecoys() <= 0) return;
        this.ship.deployDecoy();
        this.nextDecoyAt = now + DECOY_COOLDOWN_MS;
    }

    // Burst the jammer when the target sits inside the cone the nose projects
    // and the transmitter is off cooldown. Jamming only spoofs radars inside
    // that cone, so a burst fired off-boresight would be wasted.
    private tryJam(pos: { x: number; y: number }): void {
        const radar = this.radar;
        if (!radar || !radar.isJammerReady() || !radar.isJammerAimedAt(pos)) return;
        radar.activateJammer();
    }

    private bearingTo(pos: { x: number; y: number }): number {
        return Phaser.Math.RadToDeg(Math.atan2(pos.y - this.ship.y, pos.x - this.ship.x));
    }

    // +1 or −1: which crank side turns the nose from the target bearing toward the
    // world centre (keeps the ship from cranking itself into a wall).
    private sideTowardCenter(targetPos: { x: number; y: number }): number {
        const toCenter = Phaser.Math.RadToDeg(
            Math.atan2(world.HEIGHT / 2 - this.ship.y, world.WIDTH / 2 - this.ship.x),
        );
        const delta = Phaser.Math.Angle.WrapDegrees(toCenter - this.bearingTo(targetPos));
        return delta >= 0 ? 1 : -1;
    }

    private turnToward(position: { x: number; y: number }): void {
        this.turnTowardAngle(this.bearingTo(position));
    }

    private turnAwayFrom(position: { x: number; y: number }): void {
        this.turnTowardAngle(this.bearingTo(position) + 180);
    }

    private turnTowardAngle(desiredAngleDeg: number): void {
        // A stationary unit holds its heading — every state still computes its
        // desired bearing, it just cannot act on it. Same for a ship that has
        // landed at the end of its route.
        if (this.activity === 'inactive' || this.arrived) return;
        const angleDelta = Phaser.Math.Angle.WrapDegrees(desiredAngleDeg - this.ship.angle);
        const turnStep = Phaser.Math.Clamp(angleDelta, -this.turnRate, this.turnRate);
        this.ship.setAngle(this.ship.angle + turnStep);
    }

    private applyMovement(): void {
        const angleRad = Phaser.Math.DegToRad(this.ship.angle);
        this.ship.setVelocity(
            Math.cos(angleRad) * this.ship.getSpeed(),
            Math.sin(angleRad) * this.ship.getSpeed(),
        );
    }

    private isNearPosition(pos: { x: number; y: number }, threshold: number): boolean {
        return Phaser.Math.Distance.Between(pos.x, pos.y, this.ship.x, this.ship.y) < threshold;
    }
}
