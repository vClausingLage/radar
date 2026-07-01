import type { Ship } from './ship';
import { missileSettings } from './entitySettings';
import type { Vector2 } from '../types';
import { MissileRadar } from '../radar/systems/modules/missileRadar';
import { Exhaust, EXHAUST_NOZZLES, MISSILE_EXHAUST } from './exhaust';

// Single source of truth for missile flight envelopes. `speed` is per physics
// step (px), `burnTime` is in seconds, `turnSpeed` is the steering rate. The
// missile classes initialise their fields from here, and the radar derives the
// max-range indicator from it — so there is only one place to retune.
export const MISSILE_FLIGHT = {
    'VIM-177': { speed: missileSettings['VIM-177'].SPEED, burnTime: missileSettings['VIM-177'].BURN_TIME, turnSpeed: missileSettings['VIM-177'].TURN_SPEED },
    'VIM-220': { speed: missileSettings['VIM-220'].SPEED, burnTime: missileSettings['VIM-220'].BURN_TIME, turnSpeed: missileSettings['VIM-220'].TURN_SPEED },
} as const;

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
    missileBurnTime = MISSILE_FLIGHT['VIM-177'].burnTime;
    missileSpeed = MISSILE_FLIGHT['VIM-177'].speed;
    missileTurnSpeed = MISSILE_FLIGHT['VIM-177'].turnSpeed;
    missileAge: number = 0;
    missileWarhead: 'high-explosive' | 'fragmentation' = 'high-explosive';
    private readonly exhaust: Exhaust;
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
        this.setFrictionAir(0); // Remove air friction for space physics
        this.updateHeading(params.dirX, params.dirY);
        this.exhaust = new Exhaust(scene, this, EXHAUST_NOZZLES.missile, MISSILE_EXHAUST);
    }

    preUpdate(time: number, delta: number): void {
        super.preUpdate(time, delta);
        this.exhaust.update();
    }

    destroy(fromScene?: boolean): void {
        this.exhaust?.destroy();
        super.destroy(fromScene);
    }
}

export class ActiveRadarMissile extends Phaser.Physics.Matter.Sprite implements BaseMissile {
    direction: { x: number; y: number; };
    targetId?: number;
    owner?: Ship;
    missileType = 'VIM-220' as const;
    missileGuidance = 'active' as const;
    missileBurnTime = MISSILE_FLIGHT['VIM-220'].burnTime;
    missileSpeed = MISSILE_FLIGHT['VIM-220'].speed;
    missileTurnSpeed = MISSILE_FLIGHT['VIM-220'].turnSpeed;
    missileAge: number = 0;
    missileWarhead: 'high-explosive' | 'fragmentation' = 'fragmentation';
    // Distance (px) to the target at which the onboard seeker comes online.
    activeRadarActivationRange = missileSettings['VIM-220'].ACTIVE_RADAR_ACTIVATION_RANGE;
    // The missile's own radar (RWS search → STT track). Off until activated.
    missileRadar = new MissileRadar(
        missileSettings['VIM-220'].ACTIVE_RADAR_RANGE,
        missileSettings['VIM-220'].ACTIVE_RADAR_AZIMUTH,
    );
    waypointRoute: { first: Vector2; directionPoint: Vector2; reachedFirst: boolean } | null = null;
    private readonly exhaust: Exhaust;

    isActiveRadarEnabled(): boolean {
        return this.missileRadar.isActive();
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
        this.setFrictionAir(0); // Remove air friction for space physics
        this.updateHeading(params.dirX, params.dirY);
        this.exhaust = new Exhaust(scene, this, EXHAUST_NOZZLES.missile, MISSILE_EXHAUST);
    }

    preUpdate(time: number, delta: number): void {
        super.preUpdate(time, delta);
        this.exhaust.update();
    }

    destroy(fromScene?: boolean): void {
        this.exhaust?.destroy();
        super.destroy(fromScene);
    }
}
