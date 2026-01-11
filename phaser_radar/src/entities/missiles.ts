export interface BaseMissile {
    direction: {
        x: number;
        y: number;
    };
    targetId?: number;
    missileType: string;
    missileGuidance: string;
    missileBurnTime: number;
    missileSpeed: number;
    missileAge: number;
    missileTurnSpeed: number;
    missileWarhead: 'high-explosive' | 'fragmentation';
}

export type Missile = SARHMissile | ActiveRadarMissile;

export class SARHMissile extends Phaser.Physics.Arcade.Sprite implements BaseMissile {
    direction: { x: number; y: number; };
    targetId?: number;
    missileType: 'AIM-177' = 'AIM-177';
    missileGuidance: 'semi-active' = 'semi-active';
    missileBurnTime = 14;
    missileSpeed = 33.0;
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
        super(scene, params.x, params.y, 'missile');
        this.direction = { x: params.dirX, y: params.dirY };
        scene.add.existing(this);
        scene.physics.add.existing(this);
        // Reduce collision body size (width, height)
        this.setSize(8, 8);
        this.updateHeading(params.dirX, params.dirY);
    }
}

export class ActiveRadarMissile extends Phaser.Physics.Arcade.Sprite implements BaseMissile {
    direction: { x: number; y: number; };
    targetId?: number;
    missileType: 'AIM-220' = 'AIM-220';
    missileGuidance: 'active' = 'active';
    missileBurnTime = 14;
    missileSpeed = 38.0;
    missileTurnSpeed = 0.8;
    missileAge: number = 0;
    missileWarhead: 'high-explosive' | 'fragmentation' = 'fragmentation';
    updateHeading(dirX: number, dirY: number): void {
        const mag = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
        this.direction = { x: dirX / mag, y: dirY / mag };
        this.setAngle(Phaser.Math.RadToDeg(Math.atan2(this.direction.y, this.direction.x)));
        this.setVelocity(this.direction.x * this.missileSpeed, this.direction.y * this.missileSpeed);
    }
    
    constructor(scene: Phaser.Scene, params: { x: number; y: number; dirX: number; dirY: number }) {
        super(scene, params.x, params.y, 'missile');
        this.direction = { x: params.dirX, y: params.dirY };
        scene.add.existing(this);
        scene.physics.add.existing(this);
        // Reduce collision body size (width, height)
        this.setSize(8, 8);
        this.updateHeading(params.dirX, params.dirY);
    }
}