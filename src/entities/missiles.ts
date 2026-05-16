import type { Ship } from './ship';
import { missileSettings } from '../settings';
import type { Vector2 } from '../types';

export interface BaseMissile {
    direction: {
        x: number;
        y: number;
    };
    targetId?: number;
    owner?: Ship; // Reference to the ship that fired this missile
    missileType: string;
    missileGuidance: string;
    missileBurnTime: number;
    missileSpeed: number;
    missileAge: number;
    missileTurnSpeed: number;
    missileWarhead: 'high-explosive' | 'fragmentation';
}

export type Missile = SARHMissile | ActiveRadarMissile;

export class SARHMissile extends Phaser.Physics.Matter.Sprite implements BaseMissile {
    direction: { x: number; y: number; };
    targetId?: number;
    owner?: Ship;
    missileType = 'VIM-177' as const;
    missileGuidance = 'semi-active' as const;
    missileBurnTime = 14;
    missileSpeed = .6;
    missileTurnSpeed = 0.7;
    missileAge: number = 0;
    missileWarhead: 'high-explosive' | 'fragmentation' = 'high-explosive';
    updateHeading(dirX: number, dirY: number): void {
        // normalize
        const mag = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
        this.direction = { x: dirX / mag, y: dirY / mag };
        // set rotation
        this.setAngle(Phaser.Math.RadToDeg(Math.atan2(this.direction.y, this.direction.x)));
        // set velocity via Arcade physics
        this.setVelocity(this.direction.x * this.missileSpeed, this.direction.y * this.missileSpeed);
    }
    
    constructor(scene: Phaser.Scene, params: { x: number; y: number; dirX: number; dirY: number }) {
        super(scene.matter.world, params.x, params.y, 'missile');
        this.direction = { x: params.dirX, y: params.dirY };
        scene.add.existing(this);
        // Remove air friction for space physics
        this.setFrictionAir(0);
        // Set collision body size (width, height)
        // this.setSize(50, 50);
        this.updateHeading(params.dirX, params.dirY);
    }
}

export class ActiveRadarMissile extends Phaser.Physics.Matter.Sprite implements BaseMissile {
    direction: { x: number; y: number; };
    targetId?: number;
    owner?: Ship;
    missileType = 'VIM-220' as const;
    missileGuidance = 'active' as const;
    missileBurnTime = 14;
    missileSpeed = .6;
    missileTurnSpeed = 0.8;
    missileAge: number = 0;
    missileWarhead: 'high-explosive' | 'fragmentation' = 'fragmentation';
    activeRadarActivationAge = missileSettings['VIM-220'].ACTIVE_RADAR_ACTIVATION_TIME;
    activeRadarRange = missileSettings['VIM-220'].ACTIVE_RADAR_RANGE;
    activeRadarAzimuth = missileSettings['VIM-220'].ACTIVE_RADAR_AZIMUTH;
    activeRadarTargetId: number | null = null;
    waypointRoute: { first: Vector2; directionPoint: Vector2; reachedFirst: boolean } | null = null;

    isActiveRadarEnabled(): boolean {
        return this.missileAge >= this.activeRadarActivationAge;
    }

    getTimeToActive(): number {
        return Math.max(0, this.activeRadarActivationAge - this.missileAge);
    }

    updateHeading(dirX: number, dirY: number): void {
        const mag = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
        this.direction = { x: dirX / mag, y: dirY / mag };
        this.setAngle(Phaser.Math.RadToDeg(Math.atan2(this.direction.y, this.direction.x)));
        this.setVelocity(this.direction.x * this.missileSpeed, this.direction.y * this.missileSpeed);
    }
    
    constructor(scene: Phaser.Scene, params: { x: number; y: number; dirX: number; dirY: number }) {
        super(scene.matter.world, params.x, params.y, 'missile');
        this.direction = { x: params.dirX, y: params.dirY };
        scene.add.existing(this);
        // Remove air friction for space physics
        this.setFrictionAir(0);
        // Set collision body size (width, height)
        // this.setSize(8, 8);
        this.updateHeading(params.dirX, params.dirY);
    }
}
