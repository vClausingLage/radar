import Phaser from "phaser";
import { Radar } from "../radar/systems/radar";
import { AiUnitController } from "../controller/aiUnitController";
import { Vector2 } from "../types";
import { PlayerController } from "../controller/playerController";
import { createEntityId } from './entityId';
import { Decoy } from "./decoy";
import { decoySettings } from "../radar/data/radarGameSettings";
import { Exhaust, EXHAUST_NOZZLES, SHIP_EXHAUST } from "./exhaust";
import { fitBodyToOutline } from "../physics/bodyShape";
import { SHIP_OUTLINES } from "./spriteOutlines";

export abstract class Ship extends Phaser.Physics.Matter.Sprite {
    public readonly id: number;
    private direction: number;
    private readonly speed: number;
    private currentSpeed: number;
    private missileNoCollideGroup?: number;
    public readonly radar: Radar;
    private readonly exhaust: Exhaust;

    constructor(params: {
        scene: Phaser.Scene;
        x: number;
        y: number;
        direction: number;
        speed: number;
        radar: Radar;
        texture?: string;
        id?: number;
    }) {
        super(params.scene.matter.world, params.x, params.y, params.texture || 'ship');
        this.scene = params.scene;
        this.x = params.x;
        this.y = params.y;
        this.id = params.id ?? createEntityId();
        this.direction = params.direction;
        this.speed = params.speed;
        this.radar = params.radar;
        this.scene.add.existing(this);
        if (!this.body) {
            throw new Error('Body of Ship is undefined');
        }
        // The body is what the radar echoes off and what a missile or the
        // ground actually meets, so give it the hull's silhouette rather
        // than the texture's box. Must run before the friction and velocity
        // below and before the factory's setScale: setBody resets the former
        // and Phaser scales body and picture together from here on.
        fitBodyToOutline(this, SHIP_OUTLINES[this.texture.key] ?? SHIP_OUTLINES.ship);
        // Remove air friction for space physics
        this.setFrictionAir(0);
        // Set velocity using Matter physics
        const velocityX = Math.cos(Phaser.Math.DegToRad(this.direction)) * this.speed;
        const velocityY = Math.sin(Phaser.Math.DegToRad(this.direction)) * this.speed;
        this.setVelocity(velocityX, velocityY);
        this.angle = this.direction;
        this.currentSpeed = this.speed;

        // Orange/yellow engine exhaust from the hull's nozzles (texture-specific).
        const nozzles = EXHAUST_NOZZLES[this.texture.key] ?? EXHAUST_NOZZLES.ship;
        this.exhaust = new Exhaust(this.scene, this, nozzles, SHIP_EXHAUST);
    }

    preUpdate(time: number, delta: number): void {
        super.preUpdate(time, delta);
        this.exhaust.update();
    }

    destroy(fromScene?: boolean): void {
        this.exhaust?.destroy();
        super.destroy(fromScene);
    }

    // ── Engines ────────────────────────────────────────────────────────────
    // One engine per exhaust nozzle. Ships fly with all engines running; the
    // campaign's cold start shuts them down and lights them again one by one.
    getEngineCount(): number {
        return this.exhaust.nozzleCount;
    }

    setEngineRunning(index: number, running: boolean): void {
        this.exhaust.setNozzleRunning(index, running);
    }

    shutDownEngines(): void {
        for (let i = 0; i < this.getEngineCount(); i++) this.setEngineRunning(i, false);
    }

    getCircle(): Phaser.Geom.Circle {
        const radius = Math.max(this.width, this.height) / 2;
        return new Phaser.Geom.Circle(this.x, this.y, radius);
    }
    
    // The transponder: every hull carries one, answering to its side's code.
    // The player's side is 0; Target overrides this from its Side.
    get iffCode(): IffCode {
        return IFF_CODE_PLAYER_SIDE;
    }

    getSpeed(): number {
        return this.speed;
    }

    getCurrentSpeed(): number {
        return this.currentSpeed;
    }

    setCurrentSpeed(newSpeed: number): void {
        this.currentSpeed = newSpeed;
        if (!this.body) return;
        const angleRad = Phaser.Math.DegToRad(this.angle);
        this.setVelocity(
            Math.cos(angleRad) * this.currentSpeed,
            Math.sin(angleRad) * this.currentSpeed
        );
    }
    
    getDirection(): number {
        if (this.angle === undefined) {
            throw new Error('Direction of Target is undefined');
        }
        return this.angle
    }
    getPosition(): Vector2 {
        return { x: this.x, y: this.y };
    }

    setMissileNoCollideGroup(group: number): void {
        this.missileNoCollideGroup = group;
        this.setCollisionGroup(group);
    }

    getMissileNoCollideGroup(): number | undefined {
        return this.missileNoCollideGroup;
    }

    // ── Chaff / decoys ─────────────────────────────────────────────────────
    // Available to every ship (player and AI). A deployed cloud lingers and its
    // circle blocks radar/seeker rays passing through it (see Receiver/MissileRadar).
    private decoys: Decoy[] = [];
    private remainingDecoys = decoySettings.COUNT;

    // Deploy a chaff cloud just clear of the ship's tail, so it never wraps
    // the ship's own antenna. No-op once depleted.
    deployDecoy(): void {
        if (this.remainingDecoys <= 0) return;
        const spawnDistance = this.getCircle().radius + decoySettings.RADIUS + decoySettings.SPAWN_CLEARANCE_PX;
        const rearDirectionRad = Phaser.Math.DegToRad(this.getDirection() + 180);
        const decoyX = this.x + Math.cos(rearDirectionRad) * spawnDistance;
        const decoyY = this.y + Math.sin(rearDirectionRad) * spawnDistance;

        this.decoys.push(new Decoy(this.scene, decoyX, decoyY));
        this.remainingDecoys--;
    }

    getRemainingDecoys(): number {
        return this.remainingDecoys;
    }

    // Prune expired chaff (and fade the live ones), then return the survivors.
    getActiveDecoys(): Decoy[] {
        const now = this.scene.time.now;
        this.decoys = this.decoys.filter(d => {
            if (d.isExpired(now)) {
                d.destroy();
                return false;
            }
            d.update(now);
            return true;
        });
        return this.decoys;
    }
}

export class PlayerShip extends Ship {
    public controller?: PlayerController;

    constructor(params: {
        scene: Phaser.Scene;
        x: number;
        y: number;
        direction: number;
        speed: number;
        radar: Radar;
    }) {
        super({ ...params, id: 0 });
    }
}

// Whose side an AI ship is on. Radar cannot tell: a track is geometry, an RWR
// contact is an emitter, and a friendly cargo ship's navigation radar paints
// the player exactly like a hostile's search radar does. The side only becomes
// known through identification — visually, or from a datalink declaration —
// which is what a mission's rules of engagement are built on.
export type Side = 'hostile' | 'friendly';

// The code a ship's IFF transponder answers to. One per group: 0 is the
// player's side, 1 the enemy's. A transponder replies only to an interrogation
// carrying its own code, so a ship never answers the other side's question -
// and silence is all the other side learns.
export type IffCode = 0 | 1;
export const IFF_CODE_PLAYER_SIDE: IffCode = 0;
export const IFF_CODE_ENEMY_SIDE: IffCode = 1;

export function iffCodeOf(side: Side): IffCode {
    return side === 'friendly' ? IFF_CODE_PLAYER_SIDE : IFF_CODE_ENEMY_SIDE;
}

export class Target extends Ship {
    public readonly shipType: 'cruiser' | 'cargo';
    public readonly side: Side;
    public controller?: AiUnitController;

    constructor(params: {
        scene: Phaser.Scene;
        x: number;
        y: number;
        direction: number;
        speed: number;
        radar: Radar;
        shipType: 'cruiser' | 'cargo';
        side?: Side;
    }) {
        // Pass correct texture to parent constructor
        super({
            ...params,
            texture: params.shipType === 'cargo' ? 'cargo' : 'ship'
        });
        this.shipType = params.shipType;
        this.side = params.side ?? 'hostile';
    }

    get iffCode(): IffCode {
        return iffCodeOf(this.side);
    }

    setController(controller: AiUnitController) {
        this.controller = controller;
    }
}
