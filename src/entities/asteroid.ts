import { Vector2 } from "../types"
import { createEntityId } from './entityId';

export class Asteroid extends Phaser.Physics.Matter.Sprite {
    public readonly id: number;
    private readonly direction: number;
    private readonly speed: number;

    constructor(params: {
        scene: Phaser.Scene;
        position: Vector2;
        direction: number;
        speed: number;
    }) {
        super(params.scene.matter.world, params.position.x, params.position.y, 'asteroid');
        this.id = createEntityId();
        this.direction = params.direction;
        this.speed = params.speed;
        this.setPosition(params.position.x, params.position.y);
        this.setAngle(Phaser.Math.Between(0, 359));
        this.scene.add.existing(this);
        // Remove air friction for space physics
        this.setFrictionAir(0);
        this.setVelocity(
            this.speed * Math.cos(Phaser.Math.DegToRad(this.direction)),
            this.speed * Math.sin(Phaser.Math.DegToRad(this.direction))
        );
        const spinDirection = Phaser.Math.Between(0, 1) === 0 ? -1 : 1;
        const spinSpeed = Phaser.Math.FloatBetween(0.005, 0.02);
        this.setAngularVelocity(spinDirection * spinSpeed);
    }

    getCircle(): Phaser.Geom.Circle {
        const radius = Math.max(this.width, this.height) / 2;
        return new Phaser.Geom.Circle(this.x, this.y, radius);
    }
}