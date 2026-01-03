import { Vector2 } from "../types"

export class Asteroid extends Phaser.Physics.Arcade.Sprite {
    constructor(scene: Phaser.Scene, position: Vector2, direction: number, speed: number) {
        super(scene, position.x, position.y, 'asteroid');
        this.position = position;
        this.direction = direction;
        this.speed = speed;
        this.setPosition(this.position.x, this.position.y);
        this.setAngle(this.direction);
        this.scene.add.existing(this);
        this.scene.physics.add.existing(this);
        this.setVelocity(
            this.speed * Math.cos(Phaser.Math.DegToRad(this.direction)),
            this.speed * Math.sin(Phaser.Math.DegToRad(this.direction))
        );
    }
    position: Vector2;
    direction: number;
    speed: number;

    getCircle(): Phaser.Geom.Circle {
        return new Phaser.Geom.Circle(this.x, this.y, ((this.body?.width || 0) / 2) - 10);
    }
}