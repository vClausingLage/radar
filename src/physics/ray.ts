import { Asteroid } from "../entities/asteroid";
import { Ship, PlayerShip } from "../entities/ship";

type Entity = Ship | PlayerShip | Asteroid;

type RayHit = {
  entity: Entity;
  point: Phaser.Geom.Point;
  distanceSq: number;
};

export class Ray {
  // Build a polygon from an entity's Matter body vertices.
  getBodyPolygons(target: Entity): Phaser.Geom.Polygon {
    const body = target.body as MatterJS.BodyType | null;
    const points = body?.vertices?.map((v) => ({ x: v.x, y: v.y })) ?? [];
    return new Phaser.Geom.Polygon(points);
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

      const polygon = this.getBodyPolygons(entity);
      // GetLineToPolygon returns the single nearest intersection (a Vector4),
      // or false when the line misses the polygon.
      const hit = Phaser.Geom.Intersects.GetLineToPolygon(line, polygon);
      if (!hit) continue;

      const d2 = Phaser.Math.Distance.Squared(origin.x, origin.y, hit.x, hit.y);
      if (!nearest || d2 < nearest.distanceSq) {
        nearest = { entity, point: new Phaser.Geom.Point(hit.x, hit.y), distanceSq: d2 };
      }
    }

    return nearest;
  }
}
