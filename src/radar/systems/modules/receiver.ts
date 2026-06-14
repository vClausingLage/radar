import { RadarReturn } from '../../data/radarReturn';
import { Vector2 } from '../../../types';

export class Receiver {
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
