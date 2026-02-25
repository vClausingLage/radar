import { Vector2 } from "../types"

export class Asteroid extends Phaser.Physics.Arcade.Sprite {
    position: Vector2;
    direction: number;
    speed: number;

    constructor(params: {
        scene: Phaser.Scene;
        position: Vector2;
        direction: number;
        speed: number;
    }) {
        super(params.scene, params.position.x, params.position.y, 'asteroid');
        this.position = params.position;
        this.direction = params.direction;
        this.speed = params.speed;
        this.setPosition(this.position.x, this.position.y);
        this.setAngle(this.direction);
        this.scene.add.existing(this);
        this.scene.physics.add.existing(this);
        this.setVelocity(
            this.speed * Math.cos(Phaser.Math.DegToRad(this.direction)),
            this.speed * Math.sin(Phaser.Math.DegToRad(this.direction))
        );
    }

    getCircle(): Phaser.Geom.Circle {
        return new Phaser.Geom.Circle(this.x, this.y, ((this.body?.width || 0) / 2) - 10);
    }
}