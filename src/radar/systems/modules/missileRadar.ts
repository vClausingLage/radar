import Phaser from 'phaser';
import type { Vector2 } from '../../../types';
import { decoySettings } from '../../data/radarGameSettings';
import {
  MISSILE_RADAR_MAX_MISSED_LOCK_FRAMES,
  MISSILE_SEEKER_BEAM_DEG,
  MISSILE_SEEKER_SLEW_RATE_DEG_PER_SEC,
  TRACK_FILTER_ALPHA,
  TRACK_FILTER_BETA,
} from '../../data/radarGameSettings';

// Minimal target interface an onboard seeker needs to acquire and track.
// Lives here (rather than in missileGuidance) so the missile entity can hold a
// MissileRadar without a circular import through the guidance module.
// `radar` is declared structurally (ships match it) so the seeker's emission
// can feed the victim's RWR without importing the ship radar modules.
export type GuidanceTarget = {
  id: number;
  x: number;
  y: number;
  active: boolean;
  getDirection(): number;
  getSpeed(): number;
  radar?: {
    rwrReceiver: { receive(key: string, bearingDeg: number, isLocked: boolean, now: number): void };
    eventEmitter: { onRwrLock(): void };
  };
};

type MissileRadarMode = 'off' | 'rws' | 'stt';

// Onboard seeker for active-radar missiles (VIM-220). Far less capable than a
// ship radar — no sweep buffer or clustering, and only the crudest position
// filter — but the same logic flow: it searches a forward cone (RWS); once it
// finds a target it locks and tracks it (STT), dropping back to search if the
// lock is lost. Mirrors the RWS→STT behaviour the AI ships use.
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
  // Chaff (decoyCircles) in the line to a target can mask its return.
  // The seeker's emission also feeds victims' RWRs: every ship in the search
  // cone gets a search contact, everything in the tracking beam a lock warning
  // ("pitbull") — chaff masks the return, not the illumination.
  update(
    pos: Vector2,
    headingDeg: number,
    delta: number,
    targets: GuidanceTarget[],
    decoyCircles: Phaser.Geom.Circle[] = [],
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
      this.illuminateBeam(pos, this.beamDirDeg, MISSILE_SEEKER_BEAM_DEG / 2, targets, now, true);

      const seen = this.detectInBeam(pos, this.beamDirDeg, targets, decoyCircles);
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
    const found = this.search(pos, headingDeg, targets, decoyCircles);
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
      if (t.active && this.inRange(pos, t) && this.inCone(pos, headingDeg, t, this.searchAzimuthDeg)) {
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

  // Nearest live, unmasked reflector inside the tracking beam. Identity plays
  // no part: whatever is in the beam is what the seeker tracks.
  private detectInBeam(
    pos: Vector2,
    beamDirDeg: number,
    targets: GuidanceTarget[],
    decoyCircles: Phaser.Geom.Circle[],
  ): GuidanceTarget | null {
    return targets
      .filter(t =>
        t.active &&
        this.inRange(pos, t) &&
        this.inCone(pos, beamDirDeg, t, MISSILE_SEEKER_BEAM_DEG / 2) &&
        !this.isOccluded(pos, t, decoyCircles))
      .sort((a, b) =>
        Phaser.Math.Distance.Between(pos.x, pos.y, a.x, a.y) -
        Phaser.Math.Distance.Between(pos.x, pos.y, b.x, b.y))[0] ?? null;
  }

  // Light up everything the beam covers, whether or not its return makes it
  // back — chaff hides the target from the seeker, not the seeker from the
  // target's RWR.
  private illuminateBeam(
    pos: Vector2,
    beamDirDeg: number,
    halfWidthDeg: number,
    targets: GuidanceTarget[],
    now: number,
    isLocked: boolean,
  ): void {
    for (const t of targets) {
      if (!t.active || !this.inRange(pos, t) || !this.inCone(pos, beamDirDeg, t, halfWidthDeg)) continue;
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

  private inRange(pos: Vector2, t: GuidanceTarget): boolean {
    return Phaser.Math.Distance.Between(pos.x, pos.y, t.x, t.y) <= this.range;
  }

  private search(
    pos: Vector2,
    headingDeg: number,
    targets: GuidanceTarget[],
    decoyCircles: Phaser.Geom.Circle[],
  ): GuidanceTarget | null {
    return targets
      .filter(t =>
        t.active &&
        this.inRange(pos, t) &&
        this.inCone(pos, headingDeg, t, this.searchAzimuthDeg) &&
        !this.isOccluded(pos, t, decoyCircles))
      .sort((a, b) =>
        Phaser.Math.Distance.Between(pos.x, pos.y, a.x, a.y) -
        Phaser.Math.Distance.Between(pos.x, pos.y, b.x, b.y))[0] ?? null;
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
