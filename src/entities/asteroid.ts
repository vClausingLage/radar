import Phaser from "phaser";
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
        // Optional texture (defaults to the drifting-rubble 'asteroid'). The dish
        // radar station rides a larger 'asteroid_2' boulder, for instance.
        texture?: string;
        // World-space radius (px) for the body. Given, the sprite is scaled so
        // display and body match at that size — Phaser's Matter setScale scales
        // both together, so a big source texture still yields a sane footprint.
        bodyRadius?: number;
        // Stationary emplacements (the radar station) disable the drift spin so
        // the mounted dish and the terrain silhouette stay put.
        spin?: boolean;
    }) {
        super(params.scene.matter.world, params.position.x, params.position.y, params.texture ?? 'asteroid');
        this.id = createEntityId();
        this.direction = params.direction;
        this.speed = params.speed;
        this.setPosition(params.position.x, params.position.y);
        // Circular Matter body instead of the default rectangle. The body is the
        // single source of truth for the radar raycast (Ray.getBodyPolygons reads
        // body.vertices; a Matter circle is internally a ~25-gon), so terrain
        // returns trace the round silhouette — and getCircle() matches exactly.
        // Must run before the velocity/spin below: setBody resets them.
        const nativeRadius = Math.max(this.width, this.height) / 2;
        this.setBody({ type: 'circle', radius: nativeRadius });
        // Scale sprite + body together to the requested world radius. setScale
        // runs Matter.Body.scale under the hood, so the circle stays matched to
        // the display and getCircle() still lines up with the raycast body.
        if (params.bodyRadius !== undefined) {
            this.setScale(params.bodyRadius / nativeRadius);
        }
        this.setAngle(Phaser.Math.Between(0, 359));
        this.scene.add.existing(this);
        // Remove air friction for space physics
        this.setFrictionAir(0);
        this.setVelocity(
            this.speed * Math.cos(Phaser.Math.DegToRad(this.direction)),
            this.speed * Math.sin(Phaser.Math.DegToRad(this.direction))
        );
        if (params.spin ?? true) {
            const spinDirection = Phaser.Math.Between(0, 1) === 0 ? -1 : 1;
            const spinSpeed = Phaser.Math.FloatBetween(0.005, 0.02);
            this.setAngularVelocity(spinDirection * spinSpeed);
        }
    }

    getCircle(): Phaser.Geom.Circle {
        const radius = Math.max(this.width, this.height) / 2;
        return new Phaser.Geom.Circle(this.x, this.y, radius);
    }
}