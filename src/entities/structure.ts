import Phaser from "phaser";
import { Vector2 } from "../types";
import { createEntityId } from "./entityId";
import { fitBodyToOutline } from "../physics/bodyShape";

// A fixed, solid piece of the world that radar cannot see through: the ground
// strip, the launchpad, a dish tower. It is terrain exactly like an asteroid —
// one Matter body whose vertices the raycaster reads, so it shadows ships
// behind it and paints on the ground map — and it is static. The `obstacle`
// flag says what a hull meeting it means. A tower stands at flight level:
// ships and missiles hit it like they hit an asteroid. Ground and pad are
// what ships set down on: a sensor body, so Matter reports the contact but
// never pushes a ship off it, and the contact is judged as a landing or a
// crash (see CollisionRegistrar and physics/landing.ts). A radar standing
// inside either (the parked player, a landed cargo ship) is not shadowed by
// it — see Radar.nearestHit.
//
// The body is the texture's rectangle by default, or an outline traced from
// the texture (spriteOutlines.ts) when the picture is not a box.
export class Structure extends Phaser.Physics.Matter.Image {
    public readonly id: number;
    // True for something at flight level (a tower); false for ground that
    // ships land on.
    public readonly obstacle: boolean;

    constructor(params: {
        scene: Phaser.Scene;
        // Where `anchor` lands in world px.
        position: Vector2;
        // The point of the texture (as a fraction of it) that `position` pins:
        // the top-left corner by default, so ground scenery is laid out by its
        // corner like the plain images it replaces; a dish is pinned by the
        // foot of its pedestal instead.
        anchor?: Vector2;
        texture: string;
        scale?: number;
        outline?: Vector2[];
        // Whether ships and missiles crash into it. Off for ground they
        // set down on, on for anything at flight level.
        obstacle?: boolean;
    }) {
        super(params.scene.matter.world, 0, 0, params.texture);
        this.id = createEntityId();
        this.obstacle = params.obstacle ?? false;
        if (params.outline) {
            fitBodyToOutline(this, params.outline);
        }
        const scale = params.scale ?? 1;
        this.setScale(scale);
        // The origin is a fraction of the texture (the centre for a box, the
        // outline's centroid otherwise); put it where the anchor point lands
        // on the requested position.
        const anchor = params.anchor ?? { x: 0, y: 0 };
        this.setPosition(
            params.position.x + (this.originX - anchor.x) * this.width * scale,
            params.position.y + (this.originY - anchor.y) * this.height * scale,
        );
        this.setStatic(true);
        // Ground reports contact without ever resolving it: a ship can sit on
        // it, and the landing rules decide what an arrival meant.
        if (!this.obstacle) this.setSensor(true);
        params.scene.add.existing(this);
    }
}
