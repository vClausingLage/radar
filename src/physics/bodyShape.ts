import Phaser from "phaser";
import { Vector2 } from "../types";
import { GameMath } from "../math";

// Give a Matter game object a body shaped like its picture's silhouette.
// `outline` is the silhouette in texture pixel space (origin at the texture's
// top-left, unscaled), as traced by tools/traceOutline.js. Matter centres a
// fromVertices body on the polygon's area centroid, not on the texture's
// centre, so the object's origin is pinned to that same point (as a fraction of
// the texture) and body and picture coincide. Call it before any setScale:
// Phaser scales body and picture together from there on.
//
// Concave outlines are fine. Phaser hands them to Body.setVertices on the
// object's existing body, so the body keeps the concave polygon as a single
// part — Matter's SAT collision assumes convex shapes, which does not matter
// for what is, to the game, radar geometry — and the raycaster reads it as
// drawn. Should a body ever be a compound of parts, the raycaster walks them
// (Ray.getBodyParts).
export function fitBodyToOutline(
    target: Phaser.Physics.Matter.Sprite | Phaser.Physics.Matter.Image,
    outline: Vector2[],
): void {
    const centroid = GameMath.polygonCentroid(outline);
    // Matter sorts the vertex array in place, so hand it a copy.
    target.setBody({ type: 'fromVertices', verts: outline.map(p => ({ x: p.x, y: p.y })) });
    target.setOrigin(centroid.x / target.width, centroid.y / target.height);
}
