import Phaser from 'phaser';
import type { Vector2 } from '../../../types';
import type { GasVolume, Terrain } from '../../data/types';
import { Ray } from '../../../physics/ray';
import {
  decoySettings,
  MISSILE_RADAR_MAX_MISSED_LOCK_FRAMES,
  MISSILE_SEEKER_BEAM_DEG,
  MISSILE_SEEKER_MIN_SIGNAL,
  MISSILE_SEEKER_SLEW_RATE_DEG_PER_SEC,
  TRACK_FILTER_ALPHA,
  TRACK_FILTER_BETA,
} from '../../data/radarGameSettings';
import { crossSection, echoHorizonPx, emissionSignal, gasTransmission, isDetected, returnSignal, specularFactor } from '../../data/signalPath';

// Minimal target interface an onboard seeker needs to acquire and track.
// Lives here (rather than in missileGuidance) so the missile entity can hold a
// MissileRadar without a circular import through the guidance module.
// `radar` is declared structurally (ships match it) so the seeker's emission
// can feed the victim's RWR without importing the ship radar modules; `body`
// likewise, so the seeker can measure the hull it is looking at off the same
// Matter geometry the ship radar's raycaster reads.
export type GuidanceTarget = {
  id: number;
  x: number;
  y: number;
  active: boolean;
  body?: Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | MatterJS.BodyType | null;
  getDirection(): number;
  getSpeed(): number;
  radar?: {
    rwrReceiver: { receive(key: string, bearingDeg: number, isLocked: boolean, now: number): void };
    eventEmitter: { onRwrLock(): void };
  };
};

type MissileRadarMode = 'off' | 'rws' | 'stt';

// Onboard seeker for active-radar missiles (VIM-220). Far less capable than a
// ship radar — no sweep buffer or clustering, no false alarms, and a hard SNR
// gate instead of a probabilistic detection roll (it re-tests every frame, and
// a per-frame roll of a never-zero Pd would eventually lock anything; see
// MISSILE_SEEKER_MIN_SIGNAL) — but the same logic flow and now the same energy
// budget: what the seeker can see is settled by data/signalPath.ts, so a
// broadside or close hull is a much easier seeker find than a beamed or small
// one, gas taxes the seeker exactly as it taxes the ship radar, and terrain
// between the seeker and a hull shadows it the same way it shadows the ship
// radar's beam. Search (RWS) finds the nearest unmasked contact in its forward
// cone; once it finds a target it locks and tracks it (STT), dropping back to
// search if the lock is lost. Mirrors the RWS→STT behaviour the AI ships use.
//
// Track is held by geometry, not by identity: the seeker points its gimbal at
// where it estimates the target to be, and re-detects whatever is inside the
// narrow beam that frame. A target that out-turns the gimbal falls out of the
// beam; a different ship that wanders into it gets locked instead.
export class MissileRadar {
  // Unique RWR emitter key per seeker, so each inbound missile shows up as its
  // own contact on a victim's warning receiver.
  private static nextEmitterId = 1;
  private readonly emitterKey = `missile-${MissileRadar.nextEmitterId++}`;

  private mode: MissileRadarMode = 'off';
  // What the seeker is currently seeing in its beam — a report, not the thing
  // that keeps the lock alive.
  private lockedTargetId: number | null = null;
  private missedLockFrames = 0;

  // Gimbal bearing (deg, absolute) while tracking, and the seeker's own
  // estimate of the target's position and per-frame velocity. These are what
  // the beam is aimed from, so they are all the seeker knows.
  private beamDirDeg: number | null = null;
  private estPos: Vector2 | null = null;
  private estVel: Vector2 = { x: 0, y: 0 };

  constructor(
    private readonly range: number,            // detection range (px)
    private readonly searchAzimuthDeg: number, // forward search half-cone (deg)
  ) {}

  // Hull geometry and terrain shadowing run through the one raycaster the ship
  // radar uses — the Matter body is the source of truth for both.
  private readonly raycaster = new Ray();

  isActive(): boolean { return this.mode !== 'off'; }
  getMode(): MissileRadarMode { return this.mode; }
  getLockedTargetId(): number | null { return this.lockedTargetId; }
  // Seeker envelope, exposed so the HUD can draw the "what the missile sees"
  // cone once the radar is live.
  getRange(): number { return this.range; }
  getSearchAzimuth(): number { return this.searchAzimuthDeg; }

  // The launching ship's radar tells the missile to bring its seeker online
  // (enters RWS search). No-op once already active.
  activate(): void {
    if (this.mode === 'off') this.mode = 'rws';
  }

  // Run the seeker for one frame; returns the target it is tracking, or null.
  // Chaff (decoyCircles) in the line to a target can mask its return, gas
  // taxes it, and terrain between the seeker and a hull shadows it.
  // The seeker's emission also feeds victims' RWRs: every ship in the search
  // cone gets a search contact, everything in the tracking beam a lock warning
  // ("pitbull") — chaff masks the return, not the illumination. Being warned is
  // one-way, so it reaches past the seeker's own envelope (see isHeardBy).
  update(
    pos: Vector2,
    headingDeg: number,
    delta: number,
    targets: GuidanceTarget[],
    decoyCircles: Phaser.Geom.Circle[] = [],
    gasVolumes: GasVolume[] = [],
    terrain: Terrain[] = [],
    now = 0,
  ): GuidanceTarget | null {
    if (this.mode === 'off') return null;

    // STT: keep the beam on the estimated position and see what comes back.
    if (this.mode === 'stt' && this.estPos !== null) {
      // Coast the estimate one frame ahead, then point the gimbal there. The
      // slew limit means a hard cross-turn at short range can walk the target
      // straight off the beam.
      const predicted = { x: this.estPos.x + this.estVel.x, y: this.estPos.y + this.estVel.y };
      const commanded = Phaser.Math.RadToDeg(Math.atan2(predicted.y - pos.y, predicted.x - pos.x));
      this.beamDirDeg = this.slewTo(commanded, delta);

      // Everything the beam covers is being illuminated, detected or not.
      this.illuminateBeam(pos, this.beamDirDeg, MISSILE_SEEKER_BEAM_DEG / 2, targets, gasVolumes, now, true);

      const seen = this.detectInBeam(pos, this.beamDirDeg, targets, decoyCircles, gasVolumes, terrain);
      if (seen) {
        // Measurement corrects position and velocity; nothing else does.
        const innX = seen.x - predicted.x;
        const innY = seen.y - predicted.y;
        this.estPos = {
          x: predicted.x + TRACK_FILTER_ALPHA * innX,
          y: predicted.y + TRACK_FILTER_ALPHA * innY,
        };
        this.estVel = {
          x: this.estVel.x + TRACK_FILTER_BETA * innX,
          y: this.estVel.y + TRACK_FILTER_BETA * innY,
        };
        this.lockedTargetId = seen.id;
        this.missedLockFrames = 0;
        return seen;
      }

      // Nothing in the beam this frame: fly the coast and start the clock.
      this.estPos = predicted;
      if (++this.missedLockFrames <= MISSILE_RADAR_MAX_MISSED_LOCK_FRAMES) return null;

      // Lock starved out — fall back to search.
      this.dropLock();
    }

    // RWS: search the forward cone and lock the nearest unmasked target found.
    const found = this.search(pos, headingDeg, targets, decoyCircles, gasVolumes, terrain);
    if (found) {
      this.mode = 'stt';
      this.lockedTargetId = found.id;
      this.missedLockFrames = 0;
      // Acquisition: the gimbal snaps onto the contact and the track starts
      // from a standing estimate, with no velocity known yet.
      this.beamDirDeg = Phaser.Math.RadToDeg(Math.atan2(found.y - pos.y, found.x - pos.x));
      this.estPos = { x: found.x, y: found.y };
      this.estVel = { x: 0, y: 0 };
      this.illuminateLock(pos, found, now);
      return found;
    }

    // Still searching: everything inside the cone detects the emission as an
    // (unlocked) RWR contact — chaff masks the return, not the illumination.
    for (const t of targets) {
      if (t.active
        && this.inCone(pos, headingDeg, t, this.searchAzimuthDeg)
        && this.isHeardBy(pos, t, gasVolumes)) {
        this.illuminateSearch(pos, t, now);
      }
    }
    return null;
  }

  // Give up the track and go back to searching.
  private dropLock(): void {
    this.mode = 'rws';
    this.lockedTargetId = null;
    this.missedLockFrames = 0;
    this.beamDirDeg = null;
    this.estPos = null;
    this.estVel = { x: 0, y: 0 };
  }

  // Slew the gimbal toward a commanded bearing at its maximum rate, returning
  // where it actually ends up — which lags the command on a fast crosser.
  private slewTo(commandedDeg: number, delta: number): number {
    if (this.beamDirDeg === null) return commandedDeg;
    const maxStep = MISSILE_SEEKER_SLEW_RATE_DEG_PER_SEC * (delta / 1000);
    const error = Phaser.Math.Angle.WrapDegrees(commandedDeg - this.beamDirDeg);
    return Phaser.Math.Angle.WrapDegrees(this.beamDirDeg + Phaser.Math.Clamp(error, -maxStep, maxStep));
  }

  // Nearest live, unmasked reflector inside a cone that returns enough energy.
  // Identity plays no part: whatever is in the beam is what the seeker tracks.
  // The tracking beam and the search cone differ only in centre and width, so
  // both call sites share this, and the gates apply in the order a real seeker
  // spends them: geometry first (the cone, and a pre-gate at the echo horizon
  // — past it no hull can return even the floor), then chaff, then the energy
  // test, which is where aspect, hull size, gas and terrain shadowing decide.
  // A hard range gate here instead would answer "is it inside the envelope"
  // for every hull alike; the energy test answers "did enough of it come
  // back", which is the question the seeker's receiver actually asks.
  private nearestDetected(
    pos: Vector2,
    coneCentreDeg: number,
    coneHalfDeg: number,
    targets: GuidanceTarget[],
    decoyCircles: Phaser.Geom.Circle[],
    gasVolumes: GasVolume[],
    terrain: Terrain[],
  ): GuidanceTarget | null {
    const reach = echoHorizonPx(this.range);
    let best: GuidanceTarget | null = null;
    let bestDist = Infinity;
    for (const t of targets) {
      if (!t.active) continue;
      const d = Phaser.Math.Distance.Between(pos.x, pos.y, t.x, t.y);
      if (d > reach || d >= bestDist) continue;
      if (!this.inCone(pos, coneCentreDeg, t, coneHalfDeg)) continue;
      if (this.isOccluded(pos, t, decoyCircles)) continue;
      if (this.returnStrength(pos, t, gasVolumes, terrain) < MISSILE_SEEKER_MIN_SIGNAL) continue;
      bestDist = d;
      best = t;
    }
    return best;
  }

  // Whatever the tracking beam sees is what it tracks.
  private detectInBeam(
    pos: Vector2,
    beamDirDeg: number,
    targets: GuidanceTarget[],
    decoyCircles: Phaser.Geom.Circle[],
    gasVolumes: GasVolume[],
    terrain: Terrain[],
  ): GuidanceTarget | null {
    return this.nearestDetected(
      pos, beamDirDeg, MISSILE_SEEKER_BEAM_DEG / 2, targets, decoyCircles, gasVolumes, terrain,
    );
  }

  // Light up everything the beam covers, whether or not its return makes it
  // back — chaff hides the target from the seeker, not the seeker from the
  // target's RWR.
  private illuminateBeam(
    pos: Vector2,
    beamDirDeg: number,
    halfWidthDeg: number,
    targets: GuidanceTarget[],
    gasVolumes: GasVolume[],
    now: number,
    isLocked: boolean,
  ): void {
    for (const t of targets) {
      if (!t.active || !this.inCone(pos, beamDirDeg, t, halfWidthDeg)) continue;
      if (!this.isHeardBy(pos, t, gasVolumes)) continue;
      if (isLocked) this.illuminateLock(pos, t, now);
      else this.illuminateSearch(pos, t, now);
    }
  }

  // Lock (STT) illumination: red RWR contact + lock-warning event on the victim.
  private illuminateLock(pos: Vector2, t: GuidanceTarget, now: number): void {
    if (!t.radar) return;
    t.radar.rwrReceiver.receive(this.emitterKey, this.bearingFrom(pos, t), true, now);
    t.radar.eventEmitter.onRwrLock();
  }

  // Search (RWS) illumination: green, unlocked RWR contact.
  private illuminateSearch(pos: Vector2, t: GuidanceTarget, now: number): void {
    t.radar?.rwrReceiver.receive(this.emitterKey, this.bearingFrom(pos, t), false, now);
  }

  // Bearing from the victim toward the emitting missile (RWR convention).
  private bearingFrom(pos: Vector2, t: GuidanceTarget): number {
    return Phaser.Math.RadToDeg(Math.atan2(pos.y - t.y, pos.x - t.x));
  }

  // Signal a return off `target` would carry back to the seeker, as a ratio to
  // the noise floor — the same budget the ship radar runs (returnSignal in
  // data/signalPath.ts): out and back at the fourth power of range, the hull's
  // presented width weighted by how square-on the facet struck faces the
  // seeker, taxed by the gas on the path. This is the change from the old hard
  // range gate: a cargo hauler broadside is a much easier seeker find than the
  // same hull bow-on at the same range, and a close target can still be found
  // through conditions a distant one cannot.
  //
  // The ray to the hull is the seeker's measuring instrument, so it is cast
  // against the true surface, and the facet it lands on is the one whose
  // incidence the return is priced by — the same measurement the ship radar
  // takes at its own hits.
  private returnStrength(
    pos: Vector2,
    target: GuidanceTarget,
    gasVolumes: GasVolume[],
    terrain: Terrain[],
  ): number {
    const line = new Phaser.Geom.Line(pos.x, pos.y, target.x, target.y);
    const hit = this.raycaster.nearestPartHit(line, target);
    // No part hit means the line never crossed an edge — the seeker stands
    // inside the hull, so impact, not measurement, is next. Measure to the
    // hull's centre and give the return full specular credit.
    const point = hit ? hit.point : { x: target.x, y: target.y };
    if (this.isShadowed(pos, point, terrain)) return 0;

    const dx = point.x - pos.x;
    const dy = point.y - pos.y;
    const range = Math.hypot(dx, dy);
    if (range === 0) return Infinity;
    const beamDir = { x: dx / range, y: dy / range };
    const normal = hit ? this.raycaster.surfaceNormalAt(hit.part, hit.point) : beamDir;
    const rcs = crossSection(this.raycaster.getBodyPolygons(target), pos)
      * specularFactor(beamDir, normal);
    const transmission = gasTransmission(pos, point, gasVolumes);
    return returnSignal(range, this.range, rcs, transmission);
  }

  // Whether solid terrain stands between the seeker and a return at `point`.
  // The same rule the ship radar's beam competes under: a body the seeker
  // stands inside cannot shadow it, and only a terrain hit *nearer than the
  // return* hides it — a rock past the target is behind the echo, not in
  // front of it.
  private isShadowed(
    pos: Vector2,
    point: { x: number; y: number },
    terrain: Terrain[],
  ): boolean {
    if (terrain.length === 0) return false;
    const line = new Phaser.Geom.Line(pos.x, pos.y, point.x, point.y);
    const rangeSq = Phaser.Math.Distance.Squared(pos.x, pos.y, point.x, point.y);
    for (const body of terrain) {
      if (!body.active || !body.body) continue;
      if (this.raycaster.contains(body, pos)) continue;
      const hit = this.raycaster.nearestPartHit(line, body);
      if (hit && Phaser.Math.Distance.Squared(pos.x, pos.y, hit.point.x, hit.point.y) < rangeSq) {
        return true;
      }
    }
    return false;
  }

  // Whether a ship out there can hear this seeker at all. One way, so the
  // warning carries further than the seeker's own envelope — the same asymmetry
  // that lets a ship's RWR hear a search radar that cannot yet see it — and gas
  // on the path costs the emission energy once, not twice.
  private isHeardBy(pos: Vector2, t: GuidanceTarget, gasVolumes: GasVolume[]): boolean {
    const range = Phaser.Math.Distance.Between(pos.x, pos.y, t.x, t.y);
    const transmission = gasTransmission(pos, { x: t.x, y: t.y }, gasVolumes);
    return isDetected(emissionSignal(range, this.range, transmission));
  }

  // Whatever the forward search cone sees is what the seeker acquires.
  private search(
    pos: Vector2,
    headingDeg: number,
    targets: GuidanceTarget[],
    decoyCircles: Phaser.Geom.Circle[],
    gasVolumes: GasVolume[],
    terrain: Terrain[],
  ): GuidanceTarget | null {
    return this.nearestDetected(
      pos, headingDeg, this.searchAzimuthDeg, targets, decoyCircles, gasVolumes, terrain,
    );
  }

  // True if chaff between the seeker and the target masks the return this frame.
  private isOccluded(pos: Vector2, t: GuidanceTarget, decoyCircles: Phaser.Geom.Circle[]): boolean {
    if (decoyCircles.length === 0) return false;
    const line = new Phaser.Geom.Line(pos.x, pos.y, t.x, t.y);
    for (const circle of decoyCircles) {
      if (Phaser.Geom.Intersects.LineToCircle(line, circle) && Math.random() < decoySettings.BLOCK_PROBABILITY) {
        return true;
      }
    }
    return false;
  }

  private inCone(pos: Vector2, centreDeg: number, t: GuidanceTarget, halfWidthDeg: number): boolean {
    const bearing = Phaser.Math.RadToDeg(Math.atan2(t.y - pos.y, t.x - pos.x));
    return Math.abs(Phaser.Math.Angle.WrapDegrees(bearing - centreDeg)) <= halfWidthDeg;
  }
}
