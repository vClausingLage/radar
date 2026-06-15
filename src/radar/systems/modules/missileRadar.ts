import type { Vector2 } from '../../../types';

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

  constructor(
    private readonly range: number,            // detection range (px)
    private readonly searchAzimuthDeg: number, // forward search half-cone (deg)
  ) {}

  isActive(): boolean { return this.mode !== 'off'; }
  getMode(): MissileRadarMode { return this.mode; }
  getLockedTargetId(): number | null { return this.lockedTargetId; }

  // The launching ship's radar tells the missile to bring its seeker online
  // (enters RWS search). No-op once already active.
  activate(): void {
    if (this.mode === 'off') this.mode = 'rws';
  }

  // Run the seeker for one frame; returns the tracked target, or null.
  update(pos: Vector2, headingDeg: number, targets: GuidanceTarget[]): GuidanceTarget | null {
    if (this.mode === 'off') return null;

    // STT: stay locked while the target is alive and within range.
    if (this.mode === 'stt' && this.lockedTargetId !== null) {
      const locked = targets.find(t => t.id === this.lockedTargetId && t.active);
      if (locked && this.inRange(pos, locked)) return locked;
      // Lock lost — fall back to search.
      this.mode = 'rws';
      this.lockedTargetId = null;
    }

    // RWS: search the forward cone and lock the nearest target found.
    const found = this.search(pos, headingDeg, targets);
    if (found) {
      this.mode = 'stt';
      this.lockedTargetId = found.id;
      return found;
    }
    return null;
  }

  private inRange(pos: Vector2, t: GuidanceTarget): boolean {
    return Phaser.Math.Distance.Between(pos.x, pos.y, t.x, t.y) <= this.range;
  }

  private search(pos: Vector2, headingDeg: number, targets: GuidanceTarget[]): GuidanceTarget | null {
    return targets
      .filter(t => t.active && this.inRange(pos, t) && this.inCone(pos, headingDeg, t))
      .sort((a, b) =>
        Phaser.Math.Distance.Between(pos.x, pos.y, a.x, a.y) -
        Phaser.Math.Distance.Between(pos.x, pos.y, b.x, b.y))[0] ?? null;
  }

  private inCone(pos: Vector2, headingDeg: number, t: GuidanceTarget): boolean {
    const bearing = Phaser.Math.RadToDeg(Math.atan2(t.y - pos.y, t.x - pos.x));
    return Math.abs(Phaser.Math.Angle.WrapDegrees(bearing - headingDeg)) <= this.searchAzimuthDeg;
  }
}
