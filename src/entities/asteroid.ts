import { Vector2 } from "../types"

export class Asteroid extends Phaser.Physics.Matter.Sprite {
    private readonly direction: number;
    private readonly speed: number;

    constructor(params: {
        scene: Phaser.Scene;
        position: Vector2;
        direction: number;
        speed: number;
    }) {
        super(params.scene.matter.world, params.position.x, params.position.y, 'asteroid');
        this.direction = params.direction;
        this.speed = params.speed;
        this.setPosition(params.position.x, params.position.y);
        this.setAngle(this.direction);
        this.scene.add.existing(this);
        // Remove air friction for space physics
        this.setFrictionAir(0);
        this.setVelocity(
            this.speed * Math.cos(Phaser.Math.DegToRad(this.direction)),
            this.speed * Math.sin(Phaser.Math.DegToRad(this.direction))
        );
    }

    getCircle(): Phaser.Geom.Circle {
        const radius = Math.max(this.width, this.height) / 2;
        return new Phaser.Geom.Circle(this.x, this.y, radius);
    }
}