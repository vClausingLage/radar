import { Vector2 } from "../../types"

export class Asteroid extends Phaser.Physics.Arcade.Sprite {
    constructor(scene: Phaser.Scene, position: Vector2, direction: number, speed: number, size: number) {
        super(scene, position.x, position.y, 'asteroid');
        this.position = position;
        this.direction = direction;
        this.speed = speed;
        this.size = size;
    }
    position: Vector2;
    direction: number;
    speed: number;
    size: number;

    init() {
        this.setScale(0.05); // Visual scale (small)
        this.setPosition(this.position.x, this.position.y);
        this.setAngle(this.direction);
        this.scene.add.existing(this);
        this.scene.physics.add.existing(this);
        this.setVelocity(
            this.speed * Math.cos(Phaser.Math.DegToRad(this.direction - 90)),
            this.speed * Math.sin(Phaser.Math.DegToRad(this.direction - 90))
        );
    }
}