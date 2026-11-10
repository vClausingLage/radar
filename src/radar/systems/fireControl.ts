import Phaser from "phaser";
import { PlayerShip, Target } from "../../entities/ship";

import { LoadoutManager } from "./modules/loadoutManager";
import { MissileGuidance, GuidanceContext } from "./modules/missileGuidance";

import { Track } from "../data/track";
import { Loadout, Mode } from "../data/types";

import { RadarRenderer } from "../renderer/radarRenderer";

import { Vector2 } from "../../types";
import { Missile, ActiveRadarMissile, SARHMissile, MISSILE_FLIGHT } from "../../entities/missiles";
import { IrSeeker } from "./modules/irSeeker";
import type { IrSource } from "../data/infraredPath";
import type { GasVolume, Terrain } from "../data/types";
import {
    IR_SEEKER_GIMBAL_DEG,
    PHYSICS_FPS,
    VIM220_WAYPOINT_FADE_MS,
} from "../data/radarGameSettings";

// Context the radar (sensor) hands the fire-control system each time the player
// pulls the trigger: the owning ship plus the current track picture. STT lock →
// VIM-177 (SARH), TWS track → VIM-220 (ARH); VIM-90 (IR) on either cue below.
export type ShootContext = {
    ship: (PlayerShip | Target) | null;
    sttTrack: Track | null;
    tracks: Track[];
    // The track the pilot picked, if any: a TWS shot goes to it first.
    designatedId?: number | null;
    // The IRST's lock, as a line of sight (deg, absolute), or null. The other
    // cue a VIM-90's seeker can be uncaged on, with the radar silent.
    irstLockBearing?: number | null;
    // What the VIM-90's seeker would look into at the rail: the hot hulls, the
    // gas between, the terrain. Only the IR shot reads it.
    irWorld?: { sources: IrSource[]; gasVolumes: GasVolume[]; terrain: Terrain[] };
};

// The weapons system. The radar produces tracks; FireControl consumes them to
// launch and guide missiles. It owns the weapon inventory, the in-flight
// missiles and their guidance, and the VIM-220 mid-course datalink (waypoints).
// It deliberately holds no radar/signal-path state — the radar feeds it a
// per-frame GuidanceContext and a per-shot ShootContext.
export class FireControl {
    private loadoutManager = new LoadoutManager();

    // Missile management
    private activeMissiles: Missile[] = [];
    private missileGuidance = new MissileGuidance();
    // Most recently fired VIM-220, for the time-to-active-radar HUD readout.
    private lastVim220: ActiveRadarMissile | null = null;

    // VIM-220 mid-course waypoints (player-placed, up to two: a steer-to point
    // and a direction point). Assigned to each VIM-220 fired while present.
    private vim220Waypoints: Vector2[] = [];
    // The most recently fired VIM-220 carrying the displayed route. Once it
    // passes its first waypoint or is destroyed, the displayed route fades out.
    private vim220RouteMissile: ActiveRadarMissile | null = null;
    // Timestamp (scene.time.now) the waypoint fade-out began, or null.
    private vim220WaypointsFadeStart: number | null = null;

    // Only the player's radar has a renderer; target radars track silently.
    private radarRenderer: RadarRenderer | null = null;

    private scene: Phaser.Scene;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    setRadarRenderer(renderer: RadarRenderer): void {
        this.radarRenderer = renderer;
    }

    getLoadout(): Loadout {
        return this.loadoutManager.getLoadout();
    }
    setLoadout(loadout: Loadout): void {
        this.loadoutManager.setLoadout(loadout);
    }

    // ── Loadout ────────────────────────────────────────────────────────────

    cycleLoadout(): void {
        this.loadoutManager.cycleActive();
    }

    // Directly select a weapon type (used by AI fire-control logic).
    selectWeapon(type: string): void {
        this.loadoutManager.setActiveType(type);
    }

    getWeaponLoad(type: string): number {
        return this.loadoutManager.getLoad(type);
    }

    // ── VIM-220 mid-course waypoints ───────────────────────────────────────

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

    getWaypoints(): Vector2[] {
        return this.vim220Waypoints;
    }

    // A full two-point route lets a VIM-220 launch without a track: it flies
    // the datalink to WP1 and goes active there. A fading route is already
    // owned by a missile in flight and no longer counts.
    hasFullVim220Route(): boolean {
        return this.vim220Waypoints.length >= 2 && this.vim220WaypointsFadeStart === null;
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
    getWaypointAlpha(): number {
        if (this.vim220WaypointsFadeStart === null) return 1;
        const elapsed = this.scene.time.now - this.vim220WaypointsFadeStart;
        return Phaser.Math.Clamp(1 - elapsed / VIM220_WAYPOINT_FADE_MS, 0, 1);
    }

    // ── Firing ────────────────────────────────────────────────────────────

    // Fire the weapon matching the current mode. Returns the weapon type that
    // actually left the rail ('VIM-177'/'VIM-220'), or null if the shot was
    // rejected (no lock, no ammo, wrong weapon selected, ...) — the radar uses
    // this to decide whether to key the player's Fox call over the radio.
    shoot(mode: Mode, ctx: ShootContext): string | null {
        // The IR missile cares about the cue, not the radar mode: an STT line of
        // sight or the IRST's lock (IRST mode, transmitter silent).
        if (this.loadoutManager.getActiveType() === 'VIM-90') {
            return this.fireVim90(mode, ctx) ? 'VIM-90' : null;
        }
        if (mode === 'stt') {
            return this.fireVim177(ctx) ? 'VIM-177' : null;
        } else if (mode === 'tws') {
            return this.fireVim220(ctx) ? 'VIM-220' : null;
        }
        return null;
    }

    // Why `shoot` came back empty, as a short HUD line and the key that helps.
    // Mirrors the checks in shoot() in the order a pilot would fix them: the
    // mode, then the weapon that mode fires, then the rail, then the picture. A
    // refusal that says nothing reads as a broken trigger; the rules (VIM-177
    // rides an STT lock, VIM-220 fires from TWS) are the lesson, so the line
    // names the way out.
    refusalReason(mode: Mode, ctx: ShootContext): { reason: string; hint: string } {
        const active = this.loadoutManager.getActiveType();
        if (active === 'VIM-90') {
            if (this.getWeaponLoad('VIM-90') <= 0) return { reason: 'NO VIM-90 LEFT', hint: 'Q - cycle the weapon' };
            const cue = this.irCue(mode, ctx);
            if (cue === null) return { reason: 'VIM-90 NEEDS A LOCK', hint: 'X - IRST mode, E - lock' };
            if (!this.withinSeekerGimbal(ctx, cue)) return { reason: 'TARGET OFF BORESIGHT', hint: 'point the nose' };
            return { reason: 'NO TONE', hint: 'close the range, get behind it' };
        }
        if (mode === 'stt') {
            if (active !== 'VIM-177') return { reason: 'STT FIRES VIM-177', hint: 'Q - cycle the weapon' };
            if (this.getWeaponLoad('VIM-177') <= 0) return { reason: 'NO VIM-177 LEFT', hint: 'ESC - back to search' };
            return { reason: 'LOCK OUTSIDE RANGE RING', hint: 'close the range' };
        }
        if (mode === 'tws') {
            if (active !== 'VIM-220') return { reason: 'VIM-177 NEEDS STT - GO STT', hint: 'E - lock a track, or Q for VIM-220' };
            if (this.getWeaponLoad('VIM-220') <= 0) return { reason: 'NO VIM-220 LEFT', hint: 'E - lock a track for the VIM-177' };
            return ctx.tracks.length === 0
                ? { reason: 'NO TRACK TO SHOOT', hint: 'wait for a contact, or set a two-point route' }
                : { reason: 'ALL TRACKS ENGAGED', hint: 'F - pick another, or wait' };
        }
        if (mode === 'emcon') return { reason: 'EMCON - RADAR OFF', hint: 'R - search, X - step the mode' };
        if (mode === 'irst') return { reason: 'IRST - RADAR OFF', hint: 'Q - VIM-90, or R - radar search' };
        return { reason: 'GO STT OR TWS', hint: 'E - lock a track, X - step to TWS' };
    }

    // VIM-177 (SARH): requires an STT lock; rides the ship's illumination.
    // Returns whether the missile actually left the rail.
    private fireVim177(ctx: ShootContext): boolean {
        const ship = ctx.ship;
        if (!ship) return false;

        const sttTrack = ctx.sttTrack;
        if (!sttTrack) return false;

        if (this.loadoutManager.getActiveType() !== 'VIM-177') return false;
        const loadout = this.loadoutManager.getLoadout();
        if (!loadout['VIM-177'] || loadout['VIM-177'].load <= 0) return false;

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
        return true;
    }

    // VIM-90 (IR): lock-on before launch. The seeker is uncaged on the cue -
    // the radar's STT line of sight if there is one, else the IRST's - and
    // must find heat there above its own threshold (tone) before the round is
    // released. The cue only points the seeker; once off the rail the missile
    // needs nothing more from the ship. Returns whether it left the rail.
    private fireVim90(mode: Mode, ctx: ShootContext): boolean {
        const ship = ctx.ship;
        if (!ship || !ctx.irWorld) return false;
        if (this.getWeaponLoad('VIM-90') <= 0) return false;
        const cue = this.irCue(mode, ctx);
        if (cue === null || !this.withinSeekerGimbal(ctx, cue)) return false;

        const ownerPos = ship.getPosition();
        const seeker = new IrSeeker();
        const { sources, gasVolumes, terrain } = ctx.irWorld;
        if (!seeker.acquire(ownerPos, cue, sources, gasVolumes, terrain)) return false;

        const rad = Phaser.Math.DegToRad(ship.getDirection());
        const missile = this.scene.add.infraredMissile({
            x: ownerPos.x,
            y: ownerPos.y,
            dirX: Math.cos(rad),
            dirY: Math.sin(rad),
        });
        missile.seeker = seeker;
        missile.lastLosDeg = seeker.getLookDeg();
        this.armMissile(missile, ship);

        this.activeMissiles.push(missile);
        this.loadoutManager.decrementLoad('VIM-90');
        return true;
    }

    // Where the VIM-90's seeker is pointed at the rail: the radar's STT line of
    // sight while it holds a lock (the more precise cue: it has range too),
    // otherwise the IRST's. Null with neither.
    private irCue(mode: Mode, ctx: ShootContext): number | null {
        const ship = ctx.ship;
        if (!ship) return null;
        if (mode === 'stt' && ctx.sttTrack) {
            const p = ship.getPosition();
            return Phaser.Math.RadToDeg(Math.atan2(ctx.sttTrack.pos.y - p.y, ctx.sttTrack.pos.x - p.x));
        }
        return ctx.irstLockBearing ?? null;
    }

    // The seeker sits in the missile's nose and the missile leaves along the
    // ship's: a cue further off the nose than the gimbal reaches cannot be
    // looked at.
    private withinSeekerGimbal(ctx: ShootContext, cueDeg: number): boolean {
        if (!ctx.ship) return false;
        return Math.abs(Phaser.Math.Angle.WrapDegrees(cueDeg - ctx.ship.getDirection())) <= IR_SEEKER_GIMBAL_DEG;
    }

    // VIM-220 (ARH): TWS fire — assigns the missile to the next un-engaged
    // track. Ship guides it mid-course; its own radar takes over at terminal.
    // Returns whether the missile actually left the rail.
    private fireVim220(ctx: ShootContext): boolean {
        const ship = ctx.ship;
        if (!ship) return false;
        if (!this.vim220Ready()) return false;

        const ownerPos = ship.getPosition();

        // Engage the nearest track not already assigned to a live missile, so
        // successive shots walk outward from the closest contact. (Missiles
        // launched on remote carry the flight mate's track numbers, a different
        // numbering, so they claim nothing here.)
        const engaged = new Set(
            this.activeMissiles
                .filter(m => !(m instanceof ActiveRadarMissile && m.targetViaLink))
                .map(m => m.targetId)
                .filter((id): id is number => id !== undefined),
        );
        // A track the pilot designated goes first, if it is still free.
        const free = ctx.tracks.filter(t => !engaged.has(t.id));
        const target = free.find(t => t.id === ctx.designatedId) ?? free
            .sort((a, b) =>
                Phaser.Math.Distance.Between(ownerPos.x, ownerPos.y, a.pos.x, a.pos.y) -
                Phaser.Math.Distance.Between(ownerPos.x, ownerPos.y, b.pos.x, b.pos.y))[0];
        // No track needed with a full route — the missile goes active at WP1
        // and searches along the WP1→WP2 direction (maddog on the datalink).
        if (!target && !this.hasFullVim220Route()) return false;

        this.launchVim220(ship, target?.id ?? null, false);
        return true;
    }

    // Launch on remote: a VIM-220 at a track a flight mate holds on the
    // datalink, with no track or illumination of our own. The one path by which
    // fire control accepts a target it did not measure: the radar hands it the
    // link track already screened (fresh, inside this ship's ring), and
    // ordinary TWS firing never sees the link's tracks. Returns the weapon
    // type launched, or null if the round did not leave the rail.
    //
    // A track already assigned to a live remote-launched missile is refused, the
    // same as a track already engaged by an ordinary one.
    shootOnRemote(ship: (PlayerShip | Target) | null, track: Track): string | null {
        if (!ship || !this.vim220Ready()) return null;
        const engaged = this.activeMissiles.some(m =>
            m instanceof ActiveRadarMissile && m.targetViaLink && m.targetId === track.id);
        if (engaged) return null;

        this.launchVim220(ship, track.id, true);
        if (this.lastVim220) this.lastVim220.linkAimPos = { x: track.pos.x, y: track.pos.y };
        return 'VIM-220';
    }

    // A VIM-220 is selected and on the rail.
    private vim220Ready(): boolean {
        if (this.loadoutManager.getActiveType() !== 'VIM-220') return false;
        const loadout = this.loadoutManager.getLoadout();
        return Boolean(loadout['VIM-220']) && loadout['VIM-220'].load > 0;
    }

    private launchVim220(ship: PlayerShip | Target, targetId: number | null, viaLink: boolean): void {
        const ownerPos = ship.getPosition();
        const rad = Phaser.Math.DegToRad(ship.getDirection());

        // Built via the factory so the shared missile collision category is
        // applied — missiles never collide with one another.
        const missile = this.scene.add.activeRadarMissile({
            x: ownerPos.x,
            y: ownerPos.y,
            dirX: Math.cos(rad),
            dirY: Math.sin(rad),
        });
        if (targetId !== null) missile.targetId = targetId;
        missile.targetViaLink = viaLink;
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

    // Whether a VIM-177 this ship launched is still flying on its lock — the
    // STT is then guiding, not merely tracking, and its emission says so
    // (rwr.ts 'vim177-illuminator').
    isGuidingSarh(): boolean {
        return this.activeMissiles.some(m => m instanceof SARHMissile && m.active);
    }

    // Max range (px) of the currently selected weapon, for the range indicator.
    getActiveMissileRange(): number | null {
        return this.getMissileRange(this.loadoutManager.getActiveType());
    }

    // Max range (px) of a weapon type: the distance it covers under motor burn.
    getMissileRange(type: string): number | null {
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

    // ── Per-frame update ──────────────────────────────────────────────────

    // Runs every frame regardless of radar mode: advances missile guidance,
    // the waypoint fade, and draws each live seeker cone. The radar builds the
    // GuidanceContext from its track picture and live entities.
    update(delta: number, ctx: GuidanceContext, graphics: Phaser.GameObjects.Graphics): void {
        this.activeMissiles = this.missileGuidance.update(this.activeMissiles, delta, ctx);
        this.updateVim220WaypointFade();
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
}
