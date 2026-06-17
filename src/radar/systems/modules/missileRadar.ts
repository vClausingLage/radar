import type { Vector2 } from '../../../types';
import { decoySettings } from '../../data/radarGameSettings';
import { MISSILE_RADAR_MAX_MISSED_LOCK_FRAMES } from '../../data/radarGameSettings';

// Minimal target interface an onboard seeker needs to acquire and track.
// Lives here (rather than in missileGuidance) so the missile entity can hold a
// MissileRadar without a circular import through the guidance module.
export type GuidanceTarget = {
  id: number;
  x: number;
  y: number;
  active: boolean;
  getDirection(): number;
  getSpeed(): number;
};

type MissileRadarMode = 'off' | 'rws' | 'stt';

// Onboard seeker for active-radar missiles (VIM-220). Far less capable than a
// ship radar — no sweep buffer, clustering or filtering — but the same logic
// flow: it searches a forward cone (RWS); once it finds a target it locks and
// tracks it (STT), dropping back to search if the lock is lost. Mirrors the
// RWS→STT behaviour the AI ships use.
export class MissileRadar {
  private mode: MissileRadarMode = 'off';
  private lockedTargetId: number | null = null;
  private missedLockFrames = 0;

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

  // Run the seeker for one frame; returns the tracked target, or null.
  // Chaff (decoyCircles) in the line to a target can mask its return.
  update(
    pos: Vector2,
    headingDeg: number,
    targets: GuidanceTarget[],
    decoyCircles: Phaser.Geom.Circle[] = [],
  ): GuidanceTarget | null {
    if (this.mode === 'off') return null;

    // STT: stay locked while the target is alive, in range and not masked.
    if (this.mode === 'stt' && this.lockedTargetId !== null) {
      const locked = targets.find(t => t.id === this.lockedTargetId && t.active);
      if (locked && this.inRange(pos, locked)) {
        if (!this.isOccluded(pos, locked, decoyCircles)) {
          this.missedLockFrames = 0;
          return locked;
        }
        // Masked by chaff — hold the lock briefly, then let it break.
        if (++this.missedLockFrames <= MISSILE_RADAR_MAX_MISSED_LOCK_FRAMES) return null;
      }
      // Lock lost (gone, out of range, or chaff-broken) — fall back to search.
      this.mode = 'rws';
      this.lockedTargetId = null;
      this.missedLockFrames = 0;
    }

    // RWS: search the forward cone and lock the nearest unmasked target found.
    const found = this.search(pos, headingDeg, targets, decoyCircles);
    if (found) {
      this.mode = 'stt';
      this.lockedTargetId = found.id;
      this.missedLockFrames = 0;
      return found;
    }
    return null;
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
        this.inCone(pos, headingDeg, t) &&
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

  private inCone(pos: Vector2, headingDeg: number, t: GuidanceTarget): boolean {
    const bearing = Phaser.Math.RadToDeg(Math.atan2(t.y - pos.y, t.x - pos.x));
    return Math.abs(Phaser.Math.Angle.WrapDegrees(bearing - headingDeg)) <= this.searchAzimuthDeg;
  }
}
