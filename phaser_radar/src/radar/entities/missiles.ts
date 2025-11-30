export interface BaseMissile {
    burnTime: number;
    speed: number;
    age: number;
    turnSpeed: number;
    warhead: 'high-explosive' | 'fragmentation';
    position: {
        x: number;
        y: number;
    };
    direction: {
        x: number;
        y: number;
    };
}

// export interface SARHMissile extends BaseMissile {
//     type: 'AIM-177';
//     guidance: 'semi-active';
//     burnTime: 14;
//     speed: 33.0;
//     turnSpeed: 0.7
// }

// export interface ActiveRadarMissile extends BaseMissile {
//     type: 'AIM-220';
//     guidance: 'active';
//     burnTime: 14;
//     speed: 38.0;
//     turnSpeed: 0.8;
// }

export type Missile = SARHMissile | ActiveRadarMissile

export type Missiles = 'AIM-177' | 'AIM-220'

export class SARHMissile extends Phaser.GameObjects.Sprite implements BaseMissile {
    type: 'AIM-177' = 'AIM-177';
    guidance: 'semi-active' = 'semi-active';
    burnTime = 14;
    speed = 33.0;
    turnSpeed = 0.7;
    age: number = 0;
    warhead: 'high-explosive' | 'fragmentation' = 'high-explosive';
    position: { x: number; y: number; };
    direction: { x: number; y: number; };
    constructor(scene: Phaser.Scene, x: number, y: number, dirX: number, dirY: number) {
        super(scene, x, y, 'missile');
        this.position = { x, y };
        this.direction = { x: dirX, y: dirY };
    }
}

export class ActiveRadarMissile extends Phaser.GameObjects.Sprite implements BaseMissile {
    type: 'AIM-220' = 'AIM-220';
    guidance: 'active' = 'active';
    burnTime = 14;
    speed = 38.0;
    turnSpeed = 0.8;
    age: number = 0;
    warhead: 'high-explosive' | 'fragmentation' = 'fragmentation';
    position: { x: number; y: number; };
    direction: { x: number; y: number; };
    constructor(scene: Phaser.Scene, x: number, y: number, dirX: number, dirY: number) {
        super(scene, x, y, 'missile');
        this.position = { x, y };
        this.direction = { x: dirX, y: dirY };
    }
}