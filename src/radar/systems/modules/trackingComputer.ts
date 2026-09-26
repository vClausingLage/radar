import Phaser from 'phaser';
import { RadarReturn } from '../../data/radarReturn';
import { Track } from '../../data/track';
import { Vector2 } from '../../../types';
import { sameResolutionCell } from '../../data/signalPath';
import {
  MTI_ACTIVATION_DENSITY,
  RADAR_TRACK_HISTORY_LENGTH,
  TRACK_COURSE_RANGE_EXPONENT,
  TRACK_COURSE_RANGE_REF_PX,
  TRACK_COURSE_WINDOW_SCANS,
  TRACK_FILTER_ALPHA,
  TRACK_FILTER_BETA,
  TRACK_GATE_RADIUS_PX,
  TRACK_MAX_MISSED_SCANS,
  TRACK_MIN_COURSE_SPEED_PX,
} from '../../data/radarGameSettings';

type TrackState = {
  track: Track;
  // Smoothed velocity vector (px per scan), separate from track.speed/dir
  // so the raw measurement and the filtered estimate stay distinct.
  velX: number;
  velY: number;
  missedScans: number;
  // Positions from the last few updates, oldest first, holding the baseline the
  // reported course is fitted over. Kept apart from track.history, which is the
  // rendered dot trail and is sized for the eye. One sample per update,
  // refreshed or coasted, so the spacing stays uniform in time and the fitted
  // slope stays a velocity.
  courseSamples: Vector2[];
};

// Mode-dependent knobs the owning radar sets per update. Defaults are the
// search-mode values; STT overrides all three.
type TrackingOptions = {
  // Aging timescale: updates without a return before the track is dropped.
  maxMissedScans?: number;
  // Simultaneous tracks maintained (TWS caps this; RWS does not).
  maxTracks?: number;
  // Minimum detectable velocity, in px per update.
  minCourseSpeed?: number;
  // Updates of track history the reported course is fitted across.
  courseWindow?: number;
  // Whether the baseline is built from raw centroids instead of filtered track
  // positions. The two go wrong in opposite directions, and which one wins
  // depends entirely on how long the baseline is. Across four sweeps the
  // alpha-beta filter's velocity state has barely moved, so its output is the
  // measurement with the noise damped — 2.5x less scatter than the centroid,
  // pure gain. Across sixty STT frames that same state has random-walked far
  // enough that the output drifts coherently for a stretch at a time, and the
  // fit reads that drift as motion; there the centroid, scattered but unbiased
  // about the truth, is the only source a longer baseline can average down.
  courseFromMeasurements?: boolean;
  // Mean clutter density around a contact's position, reported by the
  // CfarDetector (search modes only). Given, a contact sitting in
  // significant clutter whose fitted radial rate is below the blind speed
  // is rejected as clutter itself (MTI): the measurement still updates the
  // filter — the set keeps watching — but the echo is not accepted as
  // target evidence, so the track's confidence decays and, if the contact
  // never shows radial motion, it ages out like an unmatched one.
  mtiClutterDensity?: (point: { x: number; y: number }) => number;
};

export class TrackingComputer {
  private states: TrackState[] = [];
  private nextTrackId = 1;

  // Called on every sweep completion (RWS) or every frame (STT). An update is
  // one scan whichever mode called it, but a search sweep and an STT frame are
  // two very different spans of time, so every timescale in TrackingOptions is
  // the caller's to set.
  update(
    returns: RadarReturn[],
    ownerPos: Vector2,
    {
      maxMissedScans = TRACK_MAX_MISSED_SCANS,
      maxTracks = Infinity,
      minCourseSpeed = TRACK_MIN_COURSE_SPEED_PX,
      courseWindow = TRACK_COURSE_WINDOW_SCANS,
      courseFromMeasurements = false,
      mtiClutterDensity,
    }: TrackingOptions = {},
  ): Track[] {
    const centroids = this.cluster(returns);
    const matched = new Set<number>();

    for (const centroid of centroids) {
      let bestIdx = -1;
      let bestDist = TRACK_GATE_RADIUS_PX;

      for (let i = 0; i < this.states.length; i++) {
        const gateCenter = this.predictedPos(this.states[i]);
        const d = Phaser.Math.Distance.BetweenPoints(centroid.point, gateCenter);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0) {
        matched.add(bestIdx);
        this.refresh(this.states[bestIdx], centroid, {
          minCourseSpeed,
          courseWindow,
          courseFromMeasurements,
          // MTI: a near-zero-radial-rate echo inside significant clutter is
          // clutter's own echo and is not accepted as target evidence. The
          // filter still measures (so a contact that starts moving can prove
          // itself within a couple of scans — an MTI filter needs pulses to
          // establish velocity too), but confidence decays and the missed-
          // scan counter runs, aging a stationary contact out.
          accept: !this.isClutterLike(
            this.states[bestIdx], centroid, ownerPos, minCourseSpeed, mtiClutterDensity,
          ),
        });
      } else {
        this.states.push(this.spawn(centroid));
      }
    }

    for (let i = 0; i < this.states.length; i++) {
      if (!matched.has(i)) {
        this.coast(this.states[i], minCourseSpeed, courseWindow);
      }
    }
    this.states = this.states.filter(s => s.missedScans < maxMissedScans);

    // Enforce the track cap (TWS): keep the highest-confidence tracks.
    if (this.states.length > maxTracks) {
      this.states.sort((a, b) => b.track.confidence - a.track.confidence);
      this.states = this.states.slice(0, maxTracks);
    }

    return this.states.map(s => s.track);
  }

  // Chain single-linkage clustering with amplitude-weighted centroid. Two
  // returns join the same group when they fall in the same resolution cell
  // (sameResolutionCell in data/signalPath.ts) rather than within a flat px
  // radius: range resolution stays a fixed width at any range, cross-range
  // resolution is a fixed angle and so grows in px with range, exactly like
  // the ground map's own resolution cell — two ships close together at short
  // range read as two contacts and merge into one as the range that
  // separates them opens up, the same way a real beam would blur them.
  private cluster(returns: RadarReturn[]): RadarReturn[] {
    if (returns.length === 0) return [];

    const used = new Array(returns.length).fill(false);
    const centroids: RadarReturn[] = [];

    for (let i = 0; i < returns.length; i++) {
      if (used[i]) continue;

      const group: RadarReturn[] = [returns[i]];
      used[i] = true;

      let frontier = 0;
      while (frontier < group.length) {
        const pivot = group[frontier++];
        for (let j = 0; j < returns.length; j++) {
          if (used[j]) continue;
          if (sameResolutionCell(pivot, returns[j])) {
            group.push(returns[j]);
            used[j] = true;
          }
        }
      }

      centroids.push(this.weightedCentroid(group));
    }

    return centroids;
  }

  // Amplitude-weighted centroid — the bearing measurement a monopulse
  // comparator forms. Each return carries the effective signal its detection
  // was made on (RadarReturn.signal): looks nearer the beam boresight came
  // back with more of the beam pattern, grazing hull edges came back weak,
  // and a noise spike carries exactly the floor it cleared. Weighting the
  // mean by those amplitudes is what the old α-trimmed centroid did
  // discretely — cutting the outer fraction of each cluster by angle to
  // remove unstable edge hits — except the trim is no longer a flat geometric
  // rule: a real set forms the target bearing from how loudly each look came
  // back, and so does this.
  private weightedCentroid(group: RadarReturn[]): RadarReturn {
    let weightSum = 0;
    let cx = 0;
    let cy = 0;
    let cr = 0;
    let ca = 0;
    for (const r of group) {
      const w = Math.max(r.signal, 0);
      weightSum += w;
      cx += r.point.x * w;
      cy += r.point.y * w;
      cr += r.range * w;
      ca += r.angle * w;
    }

    // A cluster of only floor-level spikes has no amplitude structure to
    // read; fall back to the plain mean rather than divide into nothing.
    if (weightSum <= 0) {
      const cx0 = group.reduce((s, r) => s + r.point.x, 0) / group.length;
      const cy0 = group.reduce((s, r) => s + r.point.y, 0) / group.length;
      const cr0 = group.reduce((s, r) => s + r.range, 0) / group.length;
      const ca0 = group.reduce((s, r) => s + r.angle, 0) / group.length;
      return { point: new Phaser.Math.Vector2(cx0, cy0), range: cr0, angle: ca0, signal: 0 };
    }

    return {
      point: new Phaser.Math.Vector2(cx / weightSum, cy / weightSum),
      range: cr / weightSum,
      angle: ca / weightSum,
      signal: weightSum / group.length,
    };
  }

  // No return this scan: the track coasts on its last smoothed velocity rather
  // than freezing in place, and its confidence decays. Without this a single
  // dropped scan would strand the estimate behind a moving target, and in STT
  // the antenna — which is driven from this estimate — could never catch back
  // up once it lost a frame.
  private coast(state: TrackState, minCourseSpeed: number, courseWindow: number): void {
    state.missedScans++;
    state.track.confidence = Math.max(state.track.confidence - 0.1, 0);

    if (state.track.age <= 1) return;

    state.track.history.push(state.track.pos);
    if (state.track.history.length > RADAR_TRACK_HISTORY_LENGTH) {
      state.track.history.shift();
    }
    state.track.pos = {
      x: state.track.pos.x + state.velX,
      y: state.track.pos.y + state.velY,
    };

    // The coasted position still goes into the course baseline. Skipping it
    // would leave a hole in an otherwise evenly spaced series, and the fit
    // reads sample spacing as elapsed time — a dropout would come out as a
    // slowdown the target never made.
    // No measurement this update, so the coasted estimate stands in for one.
    this.pushCourseSample(state, state.track.pos, courseWindow);
    this.reportCourse(state, minCourseSpeed, courseWindow);
  }

  // Predict position one scan ahead from the current smoothed velocity.
  private predictedPos(state: TrackState): Vector2 {
    if (state.track.age > 1) {
      return {
        x: state.track.pos.x + state.velX,
        y: state.track.pos.y + state.velY,
      };
    }
    return state.track.pos;
  }

  // Whether this echo, matched to `state`, reads as clutter rather than a
  // target: it sits in significant clutter (per the CfarDetector's density
  // map) and its fitted radial rate along the line of sight is below the
  // blind speed. The blind speed is the reported course's minimum detectable
  // velocity — the same number, scaled by range the same way reportCourse
  // scales it — because one threshold serves both questions in a real set:
  // how much motion the display will claim, and how much Doppler the MTI
  // filter will believe. The radial projection uses the *reported* course and
  // speed (the least-squares fit), not the α-β velocity state: the fit is
  // the estimate the set is prepared to stand behind, it is range-aware
  // already, and a fresh track reports zero — so it is gated until it has
  // measured motion, exactly as an MTI filter is blind for its first pulses.
  private isClutterLike(
    state: TrackState,
    centroid: RadarReturn,
    ownerPos: Vector2,
    minCourseSpeed: number,
    mtiClutterDensity?: (point: { x: number; y: number }) => number,
  ): boolean {
    if (!mtiClutterDensity) return false;
    if (mtiClutterDensity(centroid.point) < MTI_ACTIVATION_DENSITY) return false;

    const dx = centroid.point.x - ownerPos.x;
    const dy = centroid.point.y - ownerPos.y;
    const bearing = Math.atan2(dy, dx);
    const courseRad = Phaser.Math.DegToRad(state.track.dir);
    const radial = state.track.speed * Math.cos(courseRad - bearing);

    // Same range scaling reportCourse applies: wander is angular at heart
    // and spreads into more pixels the further out the contact sits.
    const blind = minCourseSpeed
      * (state.track.dist / TRACK_COURSE_RANGE_REF_PX) ** TRACK_COURSE_RANGE_EXPONENT;
    return Math.abs(radial) < blind;
  }

  // α-β filter update. The innovation (measurement minus prediction) corrects
  // both position and velocity estimates, damping noise across scans.
  private refresh(
    state: TrackState,
    centroid: RadarReturn,
    { minCourseSpeed, courseWindow, courseFromMeasurements, accept }: Required<
      Pick<TrackingOptions, 'minCourseSpeed' | 'courseWindow' | 'courseFromMeasurements'>
    > & { accept: boolean },
  ): void {
    const predicted = this.predictedPos(state);

    // Innovation: how far off was the prediction?
    const innX = centroid.point.x - predicted.x;
    const innY = centroid.point.y - predicted.y;

    // Corrected position and velocity
    const newX = predicted.x + TRACK_FILTER_ALPHA * innX;
    const newY = predicted.y + TRACK_FILTER_ALPHA * innY;
    state.velX += TRACK_FILTER_BETA * innX;
    state.velY += TRACK_FILTER_BETA * innY;

    // Record the position we're leaving as trail history (oldest first, capped).
    state.track.history.push(state.track.pos);
    if (state.track.history.length > RADAR_TRACK_HISTORY_LENGTH) {
      state.track.history.shift();
    }

    state.track.pos = { x: newX, y: newY };
    state.track.dist = centroid.range;
    this.pushCourseSample(
      state,
      courseFromMeasurements ? { x: centroid.point.x, y: centroid.point.y } : state.track.pos,
      courseWindow,
    );
    this.reportCourse(state, minCourseSpeed, courseWindow);
    state.track.age++;
    state.track.lastUpdate = 0;
    if (accept) {
      state.track.confidence = Math.min(state.track.confidence + 0.15, 1.0);
      state.missedScans = 0;
    } else {
      // MTI-rejected: measured but not believed. The decay mirrors a coast
      // (coast uses 0.1) so a contact the set refuses to believe ages out on
      // the same clock an unmatched one would.
      state.track.confidence = Math.max(state.track.confidence - 0.1, 0);
      state.missedScans++;
    }
  }

  // One sample per update into the course baseline, oldest dropped once the
  // window is full. The window is a length in updates, so shrinking it (a mode
  // change) has to take effect at once rather than bleeding stale samples in.
  private pushCourseSample(state: TrackState, sample: Vector2, courseWindow: number): void {
    state.courseSamples.push(sample);
    if (state.courseSamples.length > courseWindow) {
      state.courseSamples.splice(0, state.courseSamples.length - courseWindow);
    }
  }

  // Course and speed as reported to the scope, the weapons and the voice
  // callouts. They are fitted across the course baseline rather than read off
  // the filter's velocity directly: one update's velocity estimate carries that
  // update's full centroid wander, and on a contact that is barely moving that
  // wander is the entire signal — the heading then swings through every point
  // of the compass while the target sits still. A least-squares slope across
  // the baseline averages the wander out, and it steadies a moving contact's
  // vector for the same reason.
  //
  // Note this is deliberately a second, independent estimate rather than the
  // filter's: the filter is tuned to follow the target for the antenna and the
  // gate, this one is tuned to answer what course the contact is making.
  //
  // Below the minimum detectable velocity the fit is wander whatever the
  // baseline, so the track reports zero speed and holds its last heading. The
  // scope draws no vector on it, the way a set that cannot resolve a contact's
  // motion simply does not claim a course for it, and a SARH seeker fed this
  // track leads on nothing rather than on noise. A target thrown across the
  // gate by decoys drags the whole baseline around with it, which fits a large
  // and fast-changing slope, so that scatter survives untouched.
  private reportCourse(state: TrackState, minCourseSpeed: number, courseWindow: number): void {
    const samples = state.courseSamples;

    // A course fitted from a baseline that is not yet filled is a course fitted
    // from noise — the shorter the baseline, the wilder the slope it supports.
    // The set holds off until it has had a decent look, which for a freshly
    // entered STT lock is about half a second.
    if (samples.length < Math.max(2, courseWindow / 2)) {
      state.track.speed = 0;
      return;
    }

    // Least-squares slope of x and y against sample index, i.e. px per update.
    const meanIdx = (samples.length - 1) / 2;
    let idxVariance = 0;
    let covX = 0;
    let covY = 0;
    for (let i = 0; i < samples.length; i++) {
      const dIdx = i - meanIdx;
      idxVariance += dIdx * dIdx;
      covX += dIdx * samples[i].x;
      covY += dIdx * samples[i].y;
    }

    const velX = covX / idxVariance;
    const velY = covY / idxVariance;
    const speed = Math.sqrt(velX * velX + velY * velY);

    // The threshold is quoted at a reference range and grows with the contact's
    // own: wander is angular at heart, so it spreads into more pixels the
    // further out the return comes from.
    const rangeScale = (state.track.dist / TRACK_COURSE_RANGE_REF_PX) ** TRACK_COURSE_RANGE_EXPONENT;
    if (speed < minCourseSpeed * rangeScale) {
      state.track.speed = 0;
      return;
    }

    state.track.dir = Phaser.Math.RadToDeg(Math.atan2(velY, velX));
    state.track.speed = speed;
  }

  private spawn(centroid: RadarReturn): TrackState {
    return {
      missedScans: 0,
      velX: 0,
      velY: 0,
      courseSamples: [{ x: centroid.point.x, y: centroid.point.y }],
      track: {
        id: this.nextTrackId++,
        pos: { x: centroid.point.x, y: centroid.point.y },
        dist: centroid.range,
        dir: 0,
        speed: 0,
        age: 0,
        lastUpdate: 0,
        confidence: 0.3,
        history: [],
      },
    };
  }

  getTracks(): Track[] {
    return this.states.map(s => s.track);
  }

  // Where the filter expects the target to be on the next update. This is the
  // aim point an STT antenna is driven to: an estimate built from measurements,
  // carrying the filter's lag, not the target's true position.
  getPredictedPos(trackId: number): Vector2 | null {
    const state = this.states.find(s => s.track.id === trackId);
    return state ? this.predictedPos(state) : null;
  }

  // Tracks handed in from outside (a mode change, or the datalink picture) come
  // with no baseline behind them: the course has to be re-fitted from the
  // updates that follow, at whatever rate the new mode runs.
  setTracks(tracks: Track[]): void {
    this.states = tracks.map(t => ({
      track: t,
      missedScans: 0,
      velX: 0,
      velY: 0,
      courseSamples: [t.pos],
    }));
  }
}
