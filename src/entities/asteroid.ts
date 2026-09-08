import Phaser from "phaser";
import { Vector2 } from "../types"
import { createEntityId } from './entityId';
import { fitBodyToOutline } from '../physics/bodyShape';

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
        // The sprite's silhouette as a polygon in texture pixel space (see
        // spriteOutlines.ts). Given, the body is that polygon rather than a
        // circle, so the radar's terrain returns and occlusion follow the rock
        // as drawn. Without it the body is the circle inscribing the texture.
        outline?: Vector2[];
        // World-space radius (px) for the body. Given, the sprite is scaled so
        // display and body match at that size — Phaser's Matter setScale scales
        // both together, so a big source texture still yields a sane footprint.
        // For a polygon body it is half the texture's longer side.
        bodyRadius?: number;
        // Stationary emplacements (the radar station) disable the drift spin so
        // the mounted dish and the terrain silhouette stay put.
        spin?: boolean;
        // Fixed heading in degrees; random by default so a field cut from one
        // texture does not read as copies. Emplacements pass 0 so a feature
        // placed on the drawn rock (the dish's mount) stays where it was put.
        angle?: number;
    }) {
        super(params.scene.matter.world, params.position.x, params.position.y, params.texture ?? 'asteroid');
        this.id = createEntityId();
        this.direction = params.direction;
        this.speed = params.speed;
        this.setPosition(params.position.x, params.position.y);
        // The body is the single source of truth for the radar raycast
        // (Ray.getBodyPolygons reads body.vertices), so its shape is the
        // silhouette the radar echoes off. Must run before the velocity/spin
        // below: setBody resets them.
        const nativeRadius = Math.max(this.width, this.height) / 2;
        if (params.outline) {
            fitBodyToOutline(this, params.outline);
        } else {
            // A Matter circle is internally a ~25-gon, so terrain returns trace
            // the round silhouette — and getCircle() matches exactly.
            this.setBody({ type: 'circle', radius: nativeRadius });
        }
        // Scale sprite + body together to the requested world radius. setScale
        // runs Matter.Body.scale under the hood, so the body stays matched to
        // the display and getCircle() still lines up with the raycast body.
        if (params.bodyRadius !== undefined) {
            this.setScale(params.bodyRadius / nativeRadius);
        }
        this.setAngle(params.angle ?? Phaser.Math.Between(0, 359));
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
        } else if (this.speed === 0) {
            // Neither drifting nor turning: an emplacement. Static, so a ship
            // crashing into it does not nudge it off its station.
            this.setStatic(true);
        }
    }

    // The circle inscribing the texture: exact for a circle body, a bounding
    // circle for a polygon one.
    getCircle(): Phaser.Geom.Circle {
        const radius = Math.max(this.width, this.height) / 2;
        return new Phaser.Geom.Circle(this.x, this.y, radius);
    }
}
