import { RadarReturn } from '../../data/radarReturn';
import { Vector2 } from '../../../types';
import { decoySettings } from '../../../settings';

export class Receiver {
  // A beam from `from` to `to` may be blocked by chaff: for each decoy cloud the
  // beam passes through, there is a chance the return is lost. Multiple clouds in
  // the path stack the odds. This is the randomness that lets a player break a
  // lock by manoeuvring decoys between their ship and a threat radar.
  isBlockedByDecoy(
    from: { x: number; y: number },
    to: { x: number; y: number },
    decoyCircles: Phaser.Geom.Circle[],
  ): boolean {
    if (decoyCircles.length === 0) return false;
    const line = new Phaser.Geom.Line(from.x, from.y, to.x, to.y);
    for (const circle of decoyCircles) {
      if (Phaser.Geom.Intersects.LineToCircle(line, circle) && Math.random() < decoySettings.BLOCK_PROBABILITY) {
        return true;
      }
    }
    return false;
  }

  // Radar equation: detection probability falls off with (range / maxRange)^4.
  // Each return is accepted probabilistically so close targets are almost always
  // detected and distant targets fade out naturally.
  processHits(
    hits: { point: Phaser.Math.Vector2 }[],
    ownerPos: Vector2,
    maxRange: number,
  ): RadarReturn[] {
    const returns: RadarReturn[] = [];

    for (const hit of hits) {
      const dx = hit.point.x - ownerPos.x;
      const dy = hit.point.y - ownerPos.y;
      const range = Math.sqrt(dx * dx + dy * dy);
      const angle = Phaser.Math.RadToDeg(Math.atan2(dy, dx));

      const pd = 1 - Math.pow(range / maxRange, 4);
      if (Math.random() > pd) continue;

      returns.push({ point: hit.point, range, angle });
    }

    return returns;
  }
}
