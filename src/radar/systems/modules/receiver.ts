import Phaser from 'phaser';
import { BeamHit, RadarReturn } from '../../data/radarReturn';
import { Vector2 } from '../../../types';
import {
  decoySettings,
  RADAR_BEAM_WIDTH_DEG,
  RADAR_PULSE_LENGTH_PX,
  RECEIVER_INTEGRATION_RADIUS_PX,
} from '../../data/radarGameSettings';
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
  // received. `ratedRange` is the range the energy budget is quoted at, not a
  // cutoff: a big contact just past it can still be seen, and a small one
  // inside it can still be missed. `gain` is the beam's antenna gain relative
  // to the reference (RWS) beam — see beamGain in data/signalPath.ts — so a
  // narrow STT beam pulls in returns a wide search sweep would have missed at
  // the same range.
  //
  // Hits are integrated before the detection test runs, not tested one at a
  // time: a search sweep buffers one ray hit per frame the beam happens to
  // cross a hull, so one pass across one target ordinarily leaves several
  // hits in `hits`, not one. Testing each of those independently would be
  // several separate rolls of the same encounter — and since Pd never
  // actually reaches zero (detectionProbability's floor is RADAR_PFA), enough
  // independent rolls against a target with real but weak signal eventually
  // succeeds no matter how faint it is, which is a Monte Carlo artefact, not
  // a radar seeing further. A real set does not do this either: it integrates
  // a dwell's worth of pulses before its detector declares anything.
  // integrationGroups groups the hits a single dwell produced, their signal
  // is summed (non-coherent integration — a simplification of the true
  // integration-loss curve, but the right *shape*: more looks raise the
  // combined signal, not the number of independent chances at the floor),
  // and the whole group is accepted or rejected once.
  // `localNoiseFloor(point)` is the CFAR half of the budget — a caller (in
  // practice `CfarDetector`, systems/modules/cfarDetector.ts) reporting how
  // cluttered the ground picture is right there: 1 with nothing nearby,
  // growing wherever terrain or gas has been logging returns. Dividing
  // `totalSignal` by it is the same move a CFAR detector makes by *raising
  // its threshold* near clutter instead, done to the signal side of the
  // comparison rather than the floor side. Defaults to a flat 1 (no clutter
  // model) so a caller with nothing to say about the ground picture — a
  // missile seeker, say — is not forced to depend on one.
  processHits(
    hits: BeamHit[],
    ownerPos: Vector2,
    ratedRange: number,
    gain: number = 1,
    localNoiseFloor: (point: Vector2) => number = () => 1,
  ): RadarReturn[] {
    const returns: RadarReturn[] = [];

    for (const group of this.integrationGroups(hits)) {
      let totalSignal = 0;
      let sumX = 0;
      let sumY = 0;
      for (const hit of group) {
        const dx = hit.point.x - ownerPos.x;
        const dy = hit.point.y - ownerPos.y;
        const range = Math.sqrt(dx * dx + dy * dy);
        totalSignal += returnSignal(range, ratedRange, hit.crossSection, hit.transmission, gain);
        sumX += hit.point.x;
        sumY += hit.point.y;
      }
      const cx = sumX / group.length;
      const cy = sumY / group.length;

      // Scintillation: a real hull's presented RCS is not the fixed number
      // crossSection() measures, it fluctuates dwell to dwell (see
      // scintillation() below for the model). Applied once per dwell (this
      // whole group), not once per hit within it — a slow fluctuation shares
      // one state across one encounter. This is what makes a marginal
      // contact fade in bursts across several sweeps rather than flickering
      // independently frame to frame, and gives the tracking computer's
      // confidence decay and α-β filter something real to smooth over.
      totalSignal *= this.scintillation();
      // CFAR: a target sitting against a rock or inside a gas cloud is judged
      // against a locally raised floor, not the flat one everywhere else.
      totalSignal /= localNoiseFloor({ x: cx, y: cy });
      if (!isDetected(totalSignal)) continue;

      const dx = cx - ownerPos.x;
      const dy = cy - ownerPos.y;
      const range = Math.sqrt(dx * dx + dy * dy);
      const angle = Phaser.Math.RadToDeg(Math.atan2(dy, dx));

      returns.push(this.jitteredReturn(ownerPos, range, angle, totalSignal));
    }

    return returns;
  }

  // Chain single-linkage clustering on raw hit points, tighter than the
  // tracking computer's own resolution cell: this is grouping the handful of
  // ray hits one dwell left on one hull (they sit close together — successive
  // one-degree steps across the same target), not deciding whether two nearby
  // *returns* are one contact or two — that is TrackingComputer.cluster()'s
  // job, on the already-integrated returns this produces.
  private integrationGroups(hits: BeamHit[]): BeamHit[][] {
    const used = new Array(hits.length).fill(false);
    const groups: BeamHit[][] = [];

    for (let i = 0; i < hits.length; i++) {
      if (used[i]) continue;

      const group: BeamHit[] = [hits[i]];
      used[i] = true;

      let frontier = 0;
      while (frontier < group.length) {
        const pivot = group[frontier++];
        for (let j = 0; j < hits.length; j++) {
          if (used[j]) continue;
          if (Phaser.Math.Distance.BetweenPoints(pivot.point, hits[j].point) < RECEIVER_INTEGRATION_RADIUS_PX) {
            group.push(hits[j]);
            used[j] = true;
          }
        }
      }

      groups.push(group);
    }

    return groups;
  }

  // A detected return's true geometry, jittered by the measurement noise its
  // own signal strength buys it (measurementJitterPx in data/signalPath.ts),
  // then snapped to the range/bearing bin a real receiver would actually
  // report it in — RADAR_PULSE_LENGTH_PX and RADAR_BEAM_WIDTH_DEG, the same
  // resolution cell TrackingComputer.cluster() groups returns by, so the
  // reported value only ever carries as much precision as this radar could
  // really claim. Both are applied in range and bearing rather than in x/y
  // directly — a real set's accuracy and resolution are a range figure and an
  // angular figure, not isotropic ones — then converted back to a point.
  private jitteredReturn(ownerPos: Vector2, range: number, angle: number, signal: number): RadarReturn {
    const jitterPx = measurementJitterPx(signal);
    const jitteredRange = Math.max(0, range + this.gaussian() * jitterPx);
    // The same px wander subtends fewer degrees the further out it is.
    const angleJitterDeg = Phaser.Math.RadToDeg(Math.atan2(this.gaussian() * jitterPx, Math.max(range, 1)));
    const jitteredAngle = angle + angleJitterDeg;

    const binnedRange = Math.round(jitteredRange / RADAR_PULSE_LENGTH_PX) * RADAR_PULSE_LENGTH_PX;
    const binnedAngle = Math.round(jitteredAngle / RADAR_BEAM_WIDTH_DEG) * RADAR_BEAM_WIDTH_DEG;
    const angleRad = Phaser.Math.DegToRad(binnedAngle);

    return {
      point: new Phaser.Math.Vector2(
        ownerPos.x + Math.cos(angleRad) * binnedRange,
        ownerPos.y + Math.sin(angleRad) * binnedRange,
      ),
      range: binnedRange,
      angle: binnedAngle,
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

  // Target fluctuation, mean 1 so crossSection()'s nominal figure is
  // unchanged on average, but with real dwell-to-dwell spread either side of
  // it — the way many small scatterers adding with random phase actually
  // behave, rather than the fixed number alone would suggest. Swerling I's
  // own model is a single exponential draw (chi-squared, 2 degrees of
  // freedom); this radar's energy margins are already thin enough that its
  // long right tail and real mass near 0 turned "reliably held" contacts
  // noticeably less reliable for no gain in realism worth that cost, so this
  // uses Swerling III/IV's gentler model instead — a dominant scatterer plus
  // several small ones, chi-squared with 4 degrees of freedom (the mean of
  // two independent Exp(1) draws), half the variance of Swerling I while
  // still a standard, named fluctuation model and still real dwell-to-dwell
  // scintillation rather than none.
  private scintillation(): number {
    const draw = (): number => -Math.log(Math.max(Number.EPSILON, Math.random()));
    return (draw() + draw()) / 2;
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
    gain: number = 1,
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

    return this.processHits(spoofed, ownerPos, ratedRange, gain);
  }
}
