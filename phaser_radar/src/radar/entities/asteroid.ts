import { Vector2 } from "../../types"
import { IMAGE_SCALE } from "../../settings";

export class Asteroid extends Phaser.Physics.Arcade.Sprite {
    constructor(scene: Phaser.Scene, position: Vector2, direction: number, speed: number, size: number) {
        super(scene, position.x, position.y, 'asteroid');
        this.position = position;
        this.direction = direction;
        this.speed = speed;
        this.size = size;
        this.setScale(IMAGE_SCALE);
        this.setPosition(this.position.x, this.position.y);
        this.setAngle(this.direction);
        this.scene.add.existing(this);
        this.scene.physics.add.existing(this);
        this.body?.setSize(this.size, this.size);
        this.setVelocity(
            this.speed * Math.cos(Phaser.Math.DegToRad(this.direction - 90)),
            this.speed * Math.sin(Phaser.Math.DegToRad(this.direction - 90))
        );
    }
    position: Vector2;
    direction: number;
    speed: number;
    size: number;
}