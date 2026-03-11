import { Ship } from "../../entities/ship";
import { Asteroid } from "../../entities/asteroid";
import { radarModule } from "../../settings";
import { GameMath } from "../../math";

export class RWR {
  private alert = false;

  getAlert(): boolean {
    return this.alert;
  }

  receive(targets: Array<Ship & { id: number }>, asteroids: Asteroid[], range: number, owner: Ship|null): void {
    if (!owner) return;

    this.alert = false;

    for (const target of targets) {
      const distance = GameMath.getDistance(target.x, target.y, owner.x, owner.y);
      if (distance > range * radarModule.RWR_RANGE_MULTIPLICATOR) continue;

      // Check if owner falls within the target's radar cone
      const angleToOwner = Phaser.Math.RadToDeg(Math.atan2(owner.y - target.y, owner.x - target.x));
      const relativeAngle = GameMath.normalizeAngle(angleToOwner - target.getDirection());
      const azimuth = target.radar.getAzimuth();

      if (Math.abs(relativeAngle) > azimuth) continue;

      // Check that the line from target to owner is not obstructed by an asteroid
      const line = new Phaser.Geom.Line(target.x, target.y, owner.x, owner.y);
      let obstructed = false;

      for (const asteroid of asteroids) {
        if (Phaser.Geom.Intersects.LineToCircle(line, asteroid.getCircle())) {
          obstructed = true;
          break;
        }
      }

      if (!obstructed) {
        this.alert = true;
        break;
      }
    }
  }
}
