import Phaser from "phaser";
import { Ship, PlayerShip } from "../entities/ship";
import { Terrain } from "../radar/data/types";

type Entity = Ship | PlayerShip | Terrain;

type RayHit = {
  entity: Entity;
  point: Phaser.Math.Vector2;
  distanceSq: number;
};

export class Ray {
  // Build a polygon from an entity's Matter body vertices. For a compound body
  // this is only the convex hull (Matter keeps the true shape in its parts) —
  // right for the presented cross-section, wrong for where a ray actually
  // lands: use nearestPartHit() for that.
  getBodyPolygons(target: Entity): Phaser.Geom.Polygon {
    const body = target.body as MatterJS.BodyType | null;
    const points = body?.vertices?.map((v) => ({ x: v.x, y: v.y })) ?? [];
    return new Phaser.Geom.Polygon(points);
  }

  // Every polygon a ray must be tested against for a body. A compound body's
  // parts[0] is the whole (hull vertices only) and the remaining parts are the
  // pieces; a plain body — a traced outline included, see bodyShape.ts — is
  // its own single part.
  getBodyParts(target: Entity): Phaser.Geom.Polygon[] {
    const body = target.body as MatterJS.BodyType | null;
    if (!body) return [];
    const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
    return parts.map(part => new Phaser.Geom.Polygon((part.vertices ?? []).map(v => ({ x: v.x, y: v.y }))));
  }

  // Where a line first strikes a body, and the part it struck: the true surface
  // rather than the hull, so a dent in a rock or the gap under a dish's
  // reflector shadows and echoes exactly as drawn.
  nearestPartHit(
    line: Phaser.Geom.Line,
    target: Entity,
  ): { point: Phaser.Math.Vector2; part: Phaser.Geom.Polygon } | null {
    let nearest: { point: Phaser.Math.Vector2; part: Phaser.Geom.Polygon } | null = null;
    let nearestDistSq = Infinity;
    for (const part of this.getBodyParts(target)) {
      const hit = Phaser.Geom.Intersects.GetLineToPolygon(line, part);
      if (!hit) continue;
      const dSq = Phaser.Math.Distance.Squared(line.x1, line.y1, hit.x, hit.y);
      if (dSq < nearestDistSq) {
        nearestDistSq = dSq;
        nearest = { point: new Phaser.Math.Vector2(hit.x, hit.y), part };
      }
    }
    return nearest;
  }

  // Whether a point lies inside a body's actual shape (any of its parts).
  contains(target: Entity, point: { x: number; y: number }): boolean {
    return this.getBodyParts(target).some(part => Phaser.Geom.Polygon.Contains(part, point.x, point.y));
  }

  getNearestBodyIntersection(
    owner: Entity,
    line: Phaser.Geom.Line,
    origin: { x: number; y: number },
    entities: Entity[],
  ): RayHit | null {
    let nearest: RayHit | null = null;

    for (const entity of entities) {
      if (entity === owner || !entity.body) continue;

      const hit = this.nearestPartHit(line, entity);
      if (!hit) continue;

      const d2 = Phaser.Math.Distance.Squared(origin.x, origin.y, hit.point.x, hit.point.y);
      if (!nearest || d2 < nearest.distanceSq) {
        nearest = { entity, point: hit.point, distanceSq: d2 };
      }
    }

    return nearest;
  }

  // Unit normal of the polygon edge a hit point lies on. Phaser's intersection
  // reports only the point, so the edge is found again as the one nearest to
  // it. Orientation is not resolved (winding is not guaranteed); callers that
  // care which way is "out" compare it with their own ray direction.
  surfaceNormalAt(polygon: Phaser.Geom.Polygon, point: { x: number; y: number }): { x: number; y: number } {
    const pts = polygon.points;
    let best = { x: 0, y: 0 };
    let bestDistSq = Infinity;
    let prev = pts[pts.length - 1];
    for (const cur of pts) {
      const ex = cur.x - prev.x;
      const ey = cur.y - prev.y;
      const lenSq = ex * ex + ey * ey || 1;
      const t = Phaser.Math.Clamp(((point.x - prev.x) * ex + (point.y - prev.y) * ey) / lenSq, 0, 1);
      const dSq = Phaser.Math.Distance.Squared(point.x, point.y, prev.x + ex * t, prev.y + ey * t);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        const len = Math.sqrt(lenSq);
        best = { x: -ey / len, y: ex / len };
      }
      prev = cur;
    }
    return best;
  }
}
