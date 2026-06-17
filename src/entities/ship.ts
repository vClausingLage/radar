import { Radar } from "../radar/systems/radar";
import { AiUnitController } from "../controller/aiUnitController";
import { Vector2 } from "../types";
import { PlayerController } from "../controller/playerController";
import { createEntityId } from './entityId';
import { Decoy } from "./decoy";
import { decoySettings } from "../radar/data/radarGameSettings";

export abstract class Ship extends Phaser.Physics.Matter.Sprite {
    public readonly id: number;
    private direction: number;
    private readonly speed: number;
    private currentSpeed: number;
    private missileNoCollideGroup?: number;
    public readonly radar: Radar;

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
        // Remove air friction for space physics
        this.setFrictionAir(0);
        // Set velocity using Matter physics
        const velocityX = Math.cos(Phaser.Math.DegToRad(this.direction)) * this.speed;
        const velocityY = Math.sin(Phaser.Math.DegToRad(this.direction)) * this.speed;
        this.setVelocity(velocityX, velocityY);
        this.radar.setMode('rws');
        this.angle = this.direction;
        this.currentSpeed = this.speed;
    }

    getCircle(): Phaser.Geom.Circle {
        const radius = Math.max(this.width, this.height) / 2;
        return new Phaser.Geom.Circle(this.x, this.y, radius);
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
}

export class PlayerShip extends Ship {
    public controller?: PlayerController;

    private decoys: Decoy[] = [];
    private remainingDecoys = decoySettings.COUNT;

    constructor(params: {
        scene: Phaser.Scene;
        x: number;
        y: number;
        direction: number;
        speed: number;
        radar: Radar;
    }) {
        super({ ...params, id: 0 });
        this.setScale(.7);
    }

    // Deploy a chaff cloud at the ship's current position (slightly behind the ship).
    deployDecoy(): void {
        if (this.remainingDecoys <= 0) return;
        const spawnDistance = this.getCircle().radius;
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

export class Target extends Ship {
    public readonly shipType: 'cruiser' | 'cargo';
    public controller?: AiUnitController;

    constructor(params: {
        scene: Phaser.Scene;
        x: number;
        y: number;
        direction: number;
        speed: number;
        radar: Radar;
        shipType: 'cruiser' | 'cargo';
    }) {
        // Pass correct texture to parent constructor
        super({
            ...params,
            texture: params.shipType === 'cargo' ? 'cargo' : 'ship'
        });
        this.shipType = params.shipType;
        
        this.setVisible(import.meta.env.DEV);
        this.setScale(.4);
    }

    setController(controller: AiUnitController) {
        this.controller = controller;
    }
}
