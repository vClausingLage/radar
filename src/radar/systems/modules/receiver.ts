import Phaser from 'phaser';
import { RadarReturn } from '../../data/radarReturn';
import { Vector2 } from '../../../types';
import { decoySettings, gasCloudSettings } from '../../data/radarGameSettings';
import { JammerError } from './jammer';
import { GasVolume } from '../../data/types';
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

  // A beam crossing a gas cloud loses energy to the medium instead of being
  // blocked by it. Beer-Lambert: the surviving fraction is exp(-optical depth),
  // where the optical depth is the path length inside the cloud times its
  // density — and it counts twice, because the echo has to come back out the
  // same way. Unlike chaff (a fixed per-cloud coin flip) or terrain (an outright
  // shadow), the odds here scale with how much gas is actually in the way, so
  // clipping a cloud's edge costs little and looking down its length costs a lot.
  isAbsorbedByGas(
    from: { x: number; y: number },
    to: { x: number; y: number },
    gasVolumes: GasVolume[],
  ): boolean {
    if (gasVolumes.length === 0) return false;

    const line = new Phaser.Geom.Line(from.x, from.y, to.x, to.y);
    let opticalDepth = 0;
    for (const volume of gasVolumes) {
      opticalDepth += this.pathLengthInGas(line, volume) * volume.density;
    }
    if (opticalDepth === 0) return false;

    const transmission = Math.exp(-2 * opticalDepth * gasCloudSettings.ATTENUATION_PER_PX);
    return Math.random() > transmission;
  }

  // How much of `line` runs inside a cloud's capsule (px). Walked in fixed steps
  // rather than solved analytically: the capsule is a swept circle, the beam is
  // short, and the step is finer than any cloud is thick, so the sampling error
  // is far below the randomness sitting on top of the result anyway.
  private pathLengthInGas(line: Phaser.Geom.Line, volume: GasVolume): number {
    // Cheap reject: a sphere enclosing the whole capsule. Phaser's test also
    // reports containment, so a beam starting inside the gas still counts.
    const spine = volume.line;
    const half = Phaser.Math.Distance.Between(spine.x1, spine.y1, spine.x2, spine.y2) / 2;
    const bounds = new Phaser.Geom.Circle(
      (spine.x1 + spine.x2) / 2,
      (spine.y1 + spine.y2) / 2,
      half + volume.radius,
    );
    if (!Phaser.Geom.Intersects.LineToCircle(line, bounds)) return 0;

    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    const length = Math.hypot(dx, dy);
    if (length === 0) return 0;

    const steps = Math.max(1, Math.ceil(length / gasCloudSettings.PATH_SAMPLE_PX));
    const step = length / steps;
    const radiusSq = volume.radius * volume.radius;
    let inside = 0;

    for (let i = 0; i < steps; i++) {
      // Sample at the middle of each step, so a grazing pass is not systematically
      // over- or under-counted.
      const s = (i + 0.5) / steps;
      if (this.distanceToSpineSquared(line.x1 + dx * s, line.y1 + dy * s, spine) <= radiusSq) {
        inside++;
      }
    }

    return inside * step;
  }

  // Squared distance from a point to the cloud's spine segment — the capsule is
  // exactly the set of points where this is within the radius.
  private distanceToSpineSquared(x: number, y: number, spine: Phaser.Geom.Line): number {
    const sx = spine.x2 - spine.x1;
    const sy = spine.y2 - spine.y1;
    const lengthSq = sx * sx + sy * sy;
    // A cloud that has not spread yet is a single point, not a segment.
    const t = lengthSq === 0
      ? 0
      : Phaser.Math.Clamp(((x - spine.x1) * sx + (y - spine.y1) * sy) / lengthSq, 0, 1);
    const nx = spine.x1 + sx * t;
    const ny = spine.y1 + sy * t;
    return (x - nx) * (x - nx) + (y - ny) * (y - ny);
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
