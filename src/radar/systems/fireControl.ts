import Phaser from "phaser";
import { PlayerShip, Target } from "../../entities/ship";

import { LoadoutManager } from "./modules/loadoutManager";
import { MissileGuidance, GuidanceContext } from "./modules/missileGuidance";

import { Track } from "../data/track";
import { Loadout, Mode } from "../data/types";

import { RadarRenderer } from "../renderer/radarRenderer";

import { Vector2 } from "../../types";
import { Missile, ActiveRadarMissile, MISSILE_FLIGHT } from "../../entities/missiles";
import {
    PHYSICS_FPS,
    VIM220_WAYPOINT_FADE_MS,
} from "../data/radarGameSettings";

// Context the radar (sensor) hands the fire-control system each time the player
// pulls the trigger: the owning ship plus the current track picture. STT lock →
// VIM-177 (SARH), TWS track → VIM-220 (ARH).
export type ShootContext = {
    ship: (PlayerShip | Target) | null;
    sttTrack: Track | null;
    tracks: Track[];
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
        if (mode === 'stt') {
            return this.fireVim177(ctx) ? 'VIM-177' : null;
        } else if (mode === 'tws') {
            return this.fireVim220(ctx) ? 'VIM-220' : null;
        }
        return null;
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

    // VIM-220 (ARH): TWS fire — assigns the missile to the next un-engaged
    // track. Ship guides it mid-course; its own radar takes over at terminal.
    // Returns whether the missile actually left the rail.
    private fireVim220(ctx: ShootContext): boolean {
        const ship = ctx.ship;
        if (!ship) return false;

        if (this.loadoutManager.getActiveType() !== 'VIM-220') return false;
        const loadout = this.loadoutManager.getLoadout();
        if (!loadout['VIM-220'] || loadout['VIM-220'].load <= 0) return false;

        const ownerPos = ship.getPosition();

        // Engage the nearest track not already assigned to a live missile, so
        // successive shots walk outward from the closest contact.
        const engaged = new Set(
            this.activeMissiles
                .map(m => m.targetId)
                .filter((id): id is number => id !== undefined),
        );
        const target = ctx.tracks
            .filter(t => !engaged.has(t.id))
            .sort((a, b) =>
                Phaser.Math.Distance.Between(ownerPos.x, ownerPos.y, a.pos.x, a.pos.y) -
                Phaser.Math.Distance.Between(ownerPos.x, ownerPos.y, b.pos.x, b.pos.y))[0];
        // No track needed with a full route — the missile goes active at WP1
        // and searches along the WP1→WP2 direction (maddog on the datalink).
        if (!target && !this.hasFullVim220Route()) return false;

        const rad = Phaser.Math.DegToRad(ship.getDirection());

        // Built via the factory so the shared missile collision category is
        // applied — missiles never collide with one another.
        const missile = this.scene.add.activeRadarMissile({
            x: ownerPos.x,
            y: ownerPos.y,
            dirX: Math.cos(rad),
            dirY: Math.sin(rad),
        });
        if (target) missile.targetId = target.id;
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
        return true;
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
