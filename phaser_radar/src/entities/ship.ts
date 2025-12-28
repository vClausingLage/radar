import { LightRadar } from "../radar/systems/lightRadar";
import { AiUnitController } from "../controller/aiUnitController";

abstract class Ship extends Phaser.Physics.Arcade.Sprite {
    constructor(
        public scene: Phaser.Scene, 
        public x: number, 
        public y: number, 
        private direction: number,
        private speed: number, 
        public radar: LightRadar,
    ) {
        super(scene, x, y, 'ship');
        
        this.radar = radar;
        this.scene.add.existing(this);
        this.scene.physics.add.existing(this);
        this.body?.velocity.set(
            Math.cos(Phaser.Math.DegToRad(direction)) * this.speed, 
            Math.sin(Phaser.Math.DegToRad(direction)) * this.speed
        );
        this.radar.setMode('rws');
        this.angle = this.direction;
    }

    getCircle() {
        return new Phaser.Geom.Circle(this.x, this.y, ((this.body?.width || 0) / 2) - 10);
    }

    getSpeed(): number {
        if (!this.body || !this.body.velocity) {
            throw new Error('Velocity of Target is undefined');
        }
        return this.body.velocity.length()
    }
    getDirection(): number {
        if (this.angle === undefined) {
            throw new Error('Direction of Target is undefined');
        }
        return this.angle
    }
}

export class PlayerShip extends Ship {
    constructor(
        scene: Phaser.Scene, 
        x: number, 
        y: number, 
        direction: number, 
        speed: number, 
        radar: LightRadar, 
    ) {
        super(scene, x, y, direction, speed, radar);
    }
}

export class Target extends Ship {
    constructor(
        scene: Phaser.Scene, 
        x: number, 
        y: number, 
        direction: number,
        speed: number, 
        type: 'cruiser' | 'cargo',
        radar: LightRadar, 
        public id: number, 
        public controller: AiUnitController
    ) {
        super(scene, x, y, direction, speed, radar);
        this.setVisible(false);
    }
}
