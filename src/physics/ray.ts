import Phaser from "phaser";

// Anything with a Matter body can be raycast against. Structural on purpose:
// the missile seeker (systems/modules/missileRadar.ts) measures hulls and
// tests terrain shadows through this same raycaster, but its targets reach it
// as the lightweight GuidanceTarget rather than as the ship classes — the
// body is the geometry, and the body is all the raycaster asks for. The body
// type is the union Phaser declares on physics-enabled sprites; at runtime
// every Matter sprite here carries a MatterJS body, which the methods cast
// for before reading parts/vertices.
type RayTarget = {
  body?: Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | MatterJS.BodyType | null;
};

export class Ray {
  // Build a polygon from an entity's Matter body vertices. For a compound body
  // this is only the convex hull (Matter keeps the true shape in its parts) —
  // right for the presented cross-section, wrong for where a ray actually
  // lands: use nearestPartHit() for that.
  getBodyPolygons(target: RayTarget): Phaser.Geom.Polygon {
    const body = target.body as MatterJS.BodyType | null;
    const points = body?.vertices?.map((v) => ({ x: v.x, y: v.y })) ?? [];
    return new Phaser.Geom.Polygon(points);
  }

  // Every polygon a ray must be tested against for a body. A compound body's
  // parts[0] is the whole (hull vertices only) and the remaining parts are the
  // pieces; a plain body — a traced outline included, see bodyShape.ts — is
  // its own single part.
  getBodyParts(target: RayTarget): Phaser.Geom.Polygon[] {
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
    target: RayTarget,
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

  // Whether any of `occluders` stands between `from` and `to`: the line of
  // sight every sensor needs, radar seeker and infrared alike. A body the
  // sensor stands inside cannot block it (the player parked on the pad), and
  // only a strike nearer than `to` counts - a rock past the target is behind
  // it, not in front of it.
  isOccluded(
    from: { x: number; y: number },
    to: { x: number; y: number },
    occluders: (RayTarget & { active: boolean })[],
  ): boolean {
    if (occluders.length === 0) return false;
    const line = new Phaser.Geom.Line(from.x, from.y, to.x, to.y);
    const rangeSq = Phaser.Math.Distance.Squared(from.x, from.y, to.x, to.y);
    for (const body of occluders) {
      if (!body.active || !body.body) continue;
      if (this.contains(body, from)) continue;
      const hit = this.nearestPartHit(line, body);
      if (hit && Phaser.Math.Distance.Squared(from.x, from.y, hit.point.x, hit.point.y) < rangeSq) {
        return true;
      }
    }
    return false;
  }

  // Whether a point lies inside a body's actual shape (any of its parts).
  contains(target: RayTarget, point: { x: number; y: number }): boolean {
    return this.getBodyParts(target).some(part => Phaser.Geom.Polygon.Contains(part, point.x, point.y));
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
