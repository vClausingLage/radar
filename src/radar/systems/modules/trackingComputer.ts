import { RadarReturn } from '../../data/radarReturn';
import { Track } from '../../data/track';
import { Vector2 } from '../../../types';

// Returns within this distance (px) of each other belong to the same contact.
const CLUSTER_RADIUS = 80;
// Gate radius (px) around the predicted track position for association.
const GATE_RADIUS = 200;
// Drop a track after this many consecutive scans with no return.
const MAX_MISSED_SCANS = 4;

// α-trimmed mean: discard this fraction of cluster points from each angular
// end before computing the centroid. Removes unstable polygon-edge hits.
const TRIM_FRACTION = 0.15;

// α-β filter gains. α smooths position, β smooths velocity.
// Lower α → smoother track, higher lag. Tune to target speed vs update rate.
const ALPHA = 0.35;
const BETA = 0.08;

type TrackState = {
  track: Track;
  // Smoothed velocity vector (px per scan), separate from track.speed/dir
  // so the raw measurement and the filtered estimate stay distinct.
  velX: number;
  velY: number;
  missedScans: number;
};

export class TrackingComputer {
  private states: TrackState[] = [];
  private nextTrackId = 1;

  // Called on every sweep completion (RWS) or every frame (STT).
  // maxMissedScans lets callers set mode-appropriate aging timescales.
  // maxTracks caps the number of maintained tracks (TWS tracks up to 3); the
  // lowest-confidence tracks beyond the cap are dropped.
  update(
    returns: RadarReturn[],
    _ownerPos: Vector2,
    maxMissedScans = MAX_MISSED_SCANS,
    maxTracks = Infinity,
  ): Track[] {
    const centroids = this.cluster(returns);
    const matched = new Set<number>();

    for (const centroid of centroids) {
      let bestIdx = -1;
      let bestDist = GATE_RADIUS;

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
        this.refresh(this.states[bestIdx], centroid);
      } else {
        this.states.push(this.spawn(centroid));
      }
    }

    for (let i = 0; i < this.states.length; i++) {
      if (!matched.has(i)) {
        this.states[i].missedScans++;
        this.states[i].track.confidence = Math.max(
          this.states[i].track.confidence - 0.1,
          0,
        );
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

  // Chain single-linkage clustering with angular α-trimmed centroid.
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
          if (Phaser.Math.Distance.BetweenPoints(pivot.point, returns[j].point) < CLUSTER_RADIUS) {
            group.push(returns[j]);
            used[j] = true;
          }
        }
      }

      centroids.push(this.trimmedCentroid(group));
    }

    return centroids;
  }

  // Sort cluster members by their sweep angle and discard the outer
  // TRIM_FRACTION on each side before computing the mean. This eliminates
  // the unstable edge hits that cause centroid drift when a target is only
  // partially within the scan cone.
  private trimmedCentroid(group: RadarReturn[]): RadarReturn {
    const sorted = [...group].sort((a, b) => a.angle - b.angle);

    const trim = group.length >= 6
      ? Math.floor(sorted.length * TRIM_FRACTION)
      : 0;
    const core = sorted.slice(trim, sorted.length - trim);

    const cx = core.reduce((s, r) => s + r.point.x, 0) / core.length;
    const cy = core.reduce((s, r) => s + r.point.y, 0) / core.length;
    const cr = core.reduce((s, r) => s + r.range, 0) / core.length;
    const ca = core.reduce((s, r) => s + r.angle, 0) / core.length;

    return { point: new Phaser.Math.Vector2(cx, cy), range: cr, angle: ca };
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

  // α-β filter update. The innovation (measurement minus prediction) corrects
  // both position and velocity estimates, damping noise across scans.
  private refresh(state: TrackState, centroid: RadarReturn): void {
    const predicted = this.predictedPos(state);

    // Innovation: how far off was the prediction?
    const innX = centroid.point.x - predicted.x;
    const innY = centroid.point.y - predicted.y;

    // Corrected position and velocity
    const newX = predicted.x + ALPHA * innX;
    const newY = predicted.y + ALPHA * innY;
    state.velX += BETA * innX;
    state.velY += BETA * innY;

    state.track.pos = { x: newX, y: newY };
    state.track.dist = centroid.range;
    state.track.dir = Phaser.Math.RadToDeg(Math.atan2(state.velY, state.velX));
    state.track.speed = Math.sqrt(state.velX * state.velX + state.velY * state.velY);
    state.track.age++;
    state.track.lastUpdate = 0;
    state.track.confidence = Math.min(state.track.confidence + 0.15, 1.0);
    state.missedScans = 0;
  }

  private spawn(centroid: RadarReturn): TrackState {
    return {
      missedScans: 0,
      velX: 0,
      velY: 0,
      track: {
        id: this.nextTrackId++,
        pos: { x: centroid.point.x, y: centroid.point.y },
        dist: centroid.range,
        dir: 0,
        speed: 0,
        age: 0,
        lastUpdate: 0,
        confidence: 0.3,
      },
    };
  }

  getTracks(): Track[] {
    return this.states.map(s => s.track);
  }

  setTracks(tracks: Track[]): void {
    this.states = tracks.map(t => ({ track: t, missedScans: 0, velX: 0, velY: 0 }));
  }
}
