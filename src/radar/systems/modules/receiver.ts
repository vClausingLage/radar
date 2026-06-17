import { RadarReturn } from '../../data/radarReturn';
import { Vector2 } from '../../../types';
import { decoySettings } from '../../data/radarGameSettings';
import { JammerError } from './jammer';
import { RADAR_DETECTION_RANGE_POWER } from '../../data/radarGameSettings';

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

      const pd = 1 - Math.pow(range / maxRange, RADAR_DETECTION_RANGE_POWER);
      if (Math.random() > pd) continue;

      returns.push({ point: hit.point, range, angle });
    }

    return returns;
  }

  // Jamming variant of processHits: every real hit is displaced by the *same*
  // bearing/range offset before the normal detection test runs. Because the
  // offset is shared, the spoofed returns stay clustered and the tracking
  // computer forms a single coherent false track — offset from (and replacing)
  // the real contact, since the genuine returns are discarded here.
  createFakeHits(
    hits: { point: Phaser.Math.Vector2 }[],
    ownerPos: Vector2,
    maxRange: number,
    error: JammerError,
  ): RadarReturn[] {
    const spoofed = hits.map((hit) => {
      const dx = hit.point.x - ownerPos.x;
      const dy = hit.point.y - ownerPos.y;
      const range = Math.max(0, Math.sqrt(dx * dx + dy * dy) + error.distance);
      const angleRad = Math.atan2(dy, dx) + Phaser.Math.DegToRad(error.angle);
      return {
        point: new Phaser.Math.Vector2(
          ownerPos.x + Math.cos(angleRad) * range,
          ownerPos.y + Math.sin(angleRad) * range,
        ),
      };
    });

    return this.processHits(spoofed, ownerPos, maxRange);
  }
}
