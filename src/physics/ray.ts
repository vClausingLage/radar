import { Asteroid } from "../entities/asteroid";
import { Ship, PlayerShip } from "../entities/ship";

type Entity = Ship | PlayerShip | Asteroid;

type RayHit = {
  entity: Entity;
  point: Phaser.Geom.Point;
  distanceSq: number;
};

export class Ray {
  static getBodyPolygons(body: MatterJS.BodyType): Phaser.Geom.Polygon[] {
    const parts = body.parts && body.parts.length > 1 ? body.parts.slice(1) : [body];
    return parts.map((part) =>
      new Phaser.Geom.Polygon(part.vertices.map((v) => ({ x: v.x, y: v.y })))
    );
  }
  
  static getNearestBodyIntersection(
    owner: Entity,
    line: Phaser.Geom.Line,
    origin: Phaser.Types.Math.Vector2Like,
    entities: Entity[],
  ): RayHit | null {
    let nearest: RayHit | null = null;
  
    for (const entity of entities) {
      if (entity === owner || !entity.body) continue;
  
      const body = entity.body as MatterJS.BodyType;
      const polygons = this.getBodyPolygons(body);
  
      for (const polygon of polygons) {
        const hits = Phaser.Geom.Intersects.GetLineToPolygon(line, polygon);
        if (!hits) continue;
  
        for (const hit of hits) {
          const d2 = Phaser.Math.Distance.Squared(origin.x, origin.y, hit.x, hit.y);
          if (!nearest || d2 < nearest.distanceSq) {
            nearest = { entity, point: hit, distanceSq: d2 };
          }
        }
      }
    }
  
    return nearest;
  }

}
