import Phaser from 'phaser';
import { BeamHit, RadarReturn } from '../../data/radarReturn';
import { Vector2 } from '../../../types';
import { decoySettings } from '../../data/radarGameSettings';
import { JammerError } from './jammer';
import { GasVolume } from '../../data/types';
import { gasTransmission, isDetected, measurementJitterPx, returnSignal } from '../../data/signalPath';

export class Receiver {
  // A beam from `from` to `to` may be blocked by chaff: for each decoy cloud the
  // beam passes through, there is a chance the return is lost. Multiple clouds in
  // the path stack the odds. Unlike gas, this is not an energy loss the pulse can
  // out-shout at short range — a chaff cloud is a swarm of reflectors that hides
  // the target behind returns of its own — so it stays a flat coin flip, and it
  // is the randomness that lets a player break a lock by manoeuvring decoys
  // between their ship and a threat radar.
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

  // Fraction of the pulse's energy that survives the round trip through any gas
  // on this path — out and back, so the one-way transmission counts twice.
  // Handed to processHits as part of the hit, where it goes into the same energy
  // budget as range and cross-section: gas does not block a contact, it costs
  // the return signal strength, and a close enough (or big enough) contact still
  // has the energy to spare.
  gasRoundTrip(
    from: { x: number; y: number },
    to: { x: number; y: number },
    gasVolumes: GasVolume[],
  ): number {
    const oneWay = gasTransmission(from, to, gasVolumes);
    return oneWay * oneWay;
  }

  // Ground-mapping variant: terrain returns never reach the tracking pipeline,
  // so there is no signal budget to fold the loss into — the sample is either
  // painted or it is not, at the odds the surviving energy gives it.
  isAbsorbedByGas(
    from: { x: number; y: number },
    to: { x: number; y: number },
    gasVolumes: GasVolume[],
  ): boolean {
    return Math.random() > this.gasRoundTrip(from, to, gasVolumes);
  }

  // Turn the reflections the beam found into the returns the radar actually
  // received. Each one is accepted on its own signal strength — range, hull
  // cross-section and whatever the medium took out of it — against the
  // receiver's noise floor (see data/signalPath.ts). `ratedRange` is the range
  // that budget is quoted at, not a cutoff: a big contact just past it can
  // still be seen, and a small one inside it can still be missed.
  processHits(
    hits: BeamHit[],
    ownerPos: Vector2,
    ratedRange: number,
  ): RadarReturn[] {
    const returns: RadarReturn[] = [];

    for (const hit of hits) {
      const dx = hit.point.x - ownerPos.x;
      const dy = hit.point.y - ownerPos.y;
      const range = Math.sqrt(dx * dx + dy * dy);
      const angle = Phaser.Math.RadToDeg(Math.atan2(dy, dx));

      const signal = returnSignal(range, ratedRange, hit.crossSection, hit.transmission);
      if (!isDetected(signal)) continue;

      returns.push(this.jitteredReturn(ownerPos, range, angle, signal));
    }

    return returns;
  }

  // A detected return's true geometry, jittered by the measurement noise its
  // own signal strength buys it (measurementJitterPx in data/signalPath.ts).
  // Applied in range and bearing rather than in x/y directly — a real set's
  // accuracy is a range error and an angular error, not an isotropic
  // positional one — then converted back to a point so the tracking computer
  // clusters and filters on it exactly as it does a noiseless hit.
  private jitteredReturn(ownerPos: Vector2, range: number, angle: number, signal: number): RadarReturn {
    const jitterPx = measurementJitterPx(signal);
    const jitteredRange = Math.max(0, range + this.gaussian() * jitterPx);
    // The same px wander subtends fewer degrees the further out it is.
    const angleJitterDeg = Phaser.Math.RadToDeg(Math.atan2(this.gaussian() * jitterPx, Math.max(range, 1)));
    const jitteredAngle = angle + angleJitterDeg;
    const angleRad = Phaser.Math.DegToRad(jitteredAngle);

    return {
      point: new Phaser.Math.Vector2(
        ownerPos.x + Math.cos(angleRad) * jitteredRange,
        ownerPos.y + Math.sin(angleRad) * jitteredRange,
      ),
      range: jitteredRange,
      angle: jitteredAngle,
    };
  }

  // Standard-normal sample (Box-Muller). A receiver's measurement noise is
  // Gaussian, not uniform — a return usually lands close to the truth and
  // only occasionally wanders far — so every jitter axis above draws from it.
  private gaussian(): number {
    const u1 = Math.max(Number.EPSILON, Math.random());
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // Jamming variant of processHits: every real hit is displaced by the *same*
  // bearing/range offset before the normal detection test runs. Because the
  // offset is shared, the spoofed returns stay clustered and the tracking
  // computer forms a single coherent false track — offset from (and replacing)
  // the real contact, since the genuine returns are discarded here. The hull's
  // cross-section and the gas it was seen through carry over unchanged, and the
  // detection test then runs at the range the return *appears* to come from —
  // the radar has no way to judge it by anything else.
  createFakeHits(
    hits: BeamHit[],
    ownerPos: Vector2,
    ratedRange: number,
    error: JammerError,
  ): RadarReturn[] {
    const spoofed = hits.map((hit) => {
      const dx = hit.point.x - ownerPos.x;
      const dy = hit.point.y - ownerPos.y;
      const range = Math.max(0, Math.sqrt(dx * dx + dy * dy) + error.distance);
      const angleRad = Math.atan2(dy, dx) + Phaser.Math.DegToRad(error.angle);
      return {
        ...hit,
        point: new Phaser.Math.Vector2(
          ownerPos.x + Math.cos(angleRad) * range,
          ownerPos.y + Math.sin(angleRad) * range,
        ),
      };
    });

    return this.processHits(spoofed, ownerPos, ratedRange);
  }
}
