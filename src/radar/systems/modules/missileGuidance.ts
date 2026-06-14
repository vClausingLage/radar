import { Missile, SARHMissile, ActiveRadarMissile } from '../../../entities/missiles';
import { Track } from '../../data/track';

// Minimal target interface the guidance needs for active-radar acquisition.
export type GuidanceTarget = {
  id: number;
  x: number;
  y: number;
  active: boolean;
  getDirection(): number;
  getSpeed(): number;
};

// Context supplied each frame so the guidance can resolve every missile's
// current source of truth: the STT lock (SARH), the maintained tracks (VIM-220
// mid-course), and the live entities (VIM-220 terminal active-radar homing).
export type GuidanceContext = {
  sttTrack: Track | null;
  sttTargetEntity?: GuidanceTarget | null;
  tracks: Track[];
  targets: GuidanceTarget[];
};

// Missile guidance module — mirrors the real-world seeker/autopilot unit.
//
// VIM-177 (SARH): the missile homes on reflected energy from the launching
// ship's radar continuously illuminating the STT track. If the ship breaks
// lock the missile loses guidance and flies ballistic.
//
// VIM-220 (ARH): ship uplinks an intercept heading derived from its TWS track
// until the missile's own seeker activates (missileAge >= activation age),
// then the missile guides itself against any target inside its radar basket.
//
// Guidance phases (mirroring real missile behaviour):
//   age < 2  → flyInDirectionOfShip: hold launch heading off the rail
//   age >= 2 → trackInDirectionOfTarget: steer toward intercept point

export class MissileGuidance {
  private ageTimer = 0;

  update(missiles: Missile[], delta: number, ctx: GuidanceContext): Missile[] {
    // Age missiles once per real second regardless of frame rate.
    this.ageTimer += delta;
    let live = missiles.filter(m => m.active);

    if (this.ageTimer >= 1000) {
      live = live.filter(m => {
        m.missileAge++;
        if (m.missileAge > m.missileBurnTime) {
          m.destroy();
          return false;
        }
        return true;
      });
      this.ageTimer = 0;
    }

    for (const missile of live) {
      const currentDirX = missile.direction.x;
      const currentDirY = missile.direction.y;

      // Phase 1 — fly straight off the rail (boost phase).
      if (missile.missileAge < 2) {
        missile.updateHeading(currentDirX, currentDirY);
        continue;
      }

      // Phase 2 — steer toward intercept.
      const dir = missile instanceof ActiveRadarMissile
        ? this.guideActiveRadar(missile, ctx)
        : this.guideSarh(missile as SARHMissile, ctx);

      // No guidance source → missile flies ballistic (holds last heading).
      if (!dir) continue;

      const turn = Math.min((missile.missileTurnSpeed * delta) / 1000, 1);
      const nx = currentDirX + (dir.x - currentDirX) * turn;
      const ny = currentDirY + (dir.y - currentDirY) * turn;
      const mag = Math.sqrt(nx * nx + ny * ny) || 1;
      missile.updateHeading(nx / mag, ny / mag);
    }

    return live;
  }

  // SARH (VIM-177): homes on the ship's STT illumination. Prefers the direct
  // entity position (no tracking lag) and falls back to the STT track.
  private guideSarh(missile: SARHMissile, ctx: GuidanceContext): { x: number; y: number } | null {
    const from = { x: missile.x, y: missile.y };
    if (ctx.sttTargetEntity) {
      const e = ctx.sttTargetEntity;
      return this.interceptVector(
        from,
        { x: e.x, y: e.y },
        e.getDirection(),
        e.getSpeed(),
        missile.missileSpeed,
      ) ?? this.pursue(from, e);
    }
    if (ctx.sttTrack) {
      // Track velocity is px-per-scan (not physics units) → pursue, don't lead.
      return this.pursue(from, ctx.sttTrack.pos);
    }
    return null;
  }

  // ARH (VIM-220): mid-course on the assigned TWS track, then terminal homing
  // on its own radar once the seeker activates.
  private guideActiveRadar(missile: ActiveRadarMissile, ctx: GuidanceContext): { x: number; y: number } | null {
    const from = { x: missile.x, y: missile.y };

    // Terminal phase: seeker is live — acquire a target inside the radar basket.
    // The entity's speed is in physics units, so a lead intercept is valid here.
    if (missile.isActiveRadarEnabled()) {
      const target = this.acquireActiveRadarTarget(missile, ctx.targets);
      if (target) {
        return this.interceptVector(
          from,
          { x: target.x, y: target.y },
          target.getDirection(),
          target.getSpeed(),
          missile.missileSpeed,
        ) ?? this.pursue(from, target);
      }
    }

    // Mid-course phase: fly toward the assigned track. Track velocity is in
    // px-per-scan (not physics units), so a lead intercept is unreliable — use
    // pure pursuit toward the track position. The terminal seeker refines it.
    const track = missile.targetId !== undefined
      ? ctx.tracks.find(t => t.id === missile.targetId) ?? null
      : null;
    if (track) {
      return this.pursue(from, track.pos);
    }
    return null;
  }

  // Pure pursuit: a normalised vector pointing straight at the target's current
  // position (no lead). Always returns a heading as long as there is separation.
  private pursue(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } | null {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const mag = Math.sqrt(dx * dx + dy * dy);
    return mag > 0 ? { x: dx / mag, y: dy / mag } : null;
  }

  // Pick a target for the missile's onboard radar: prefer the one it is already
  // tracking, then the originally-assigned target, then the nearest in-basket.
  private acquireActiveRadarTarget(
    missile: ActiveRadarMissile,
    targets: GuidanceTarget[],
  ): GuidanceTarget | null {
    const tracked = missile.activeRadarTargetId !== null
      ? targets.find(t => t.id === missile.activeRadarTargetId && t.active) ?? null
      : null;
    if (tracked && this.isInsideBasket(missile, tracked, true)) return tracked;

    const preferred = missile.targetId !== undefined
      ? targets.find(t => t.id === missile.targetId && t.active) ?? null
      : null;
    if (preferred && this.isInsideBasket(missile, preferred, false)) {
      missile.activeRadarTargetId = preferred.id;
      return preferred;
    }

    const fallback = targets
      .filter(t => t.active && this.isInsideBasket(missile, t, false))
      .sort((a, b) =>
        Phaser.Math.Distance.Between(missile.x, missile.y, a.x, a.y) -
        Phaser.Math.Distance.Between(missile.x, missile.y, b.x, b.y))[0] ?? null;

    missile.activeRadarTargetId = fallback?.id ?? null;
    return fallback;
  }

  // Is the target within the missile radar's range and (unless already locked)
  // its forward azimuth basket?
  private isInsideBasket(missile: ActiveRadarMissile, target: GuidanceTarget, alreadyTracking: boolean): boolean {
    const distance = Phaser.Math.Distance.Between(missile.x, missile.y, target.x, target.y);
    if (distance > missile.activeRadarRange) return false;
    if (alreadyTracking) return true;

    const angleToTarget = Phaser.Math.RadToDeg(Math.atan2(target.y - missile.y, target.x - missile.x));
    const heading = Phaser.Math.RadToDeg(Math.atan2(missile.direction.y, missile.direction.x));
    const delta = Math.abs(Phaser.Math.Angle.WrapDegrees(angleToTarget - heading));
    return delta <= missile.activeRadarAzimuth;
  }

  // Proportional Navigation intercept using quadratic time-of-flight solution.
  // Returns a normalised direction vector from `from` to the predicted intercept
  // point, or null if no real solution exists (e.g. target faster than missile).
  interceptVector(
    from: { x: number; y: number },
    targetPos: { x: number; y: number },
    targetDirDeg: number,
    targetSpeed: number,
    missileSpeed: number,
  ): { x: number; y: number } | null {
    const rad = Phaser.Math.DegToRad(targetDirDeg);
    const tv = { x: Math.cos(rad) * targetSpeed, y: Math.sin(rad) * targetSpeed };
    const rel = { x: targetPos.x - from.x, y: targetPos.y - from.y };

    // |rel + tv*t|² = (missileSpeed * t)²
    const a = tv.x * tv.x + tv.y * tv.y - missileSpeed * missileSpeed;
    const b = 2 * (rel.x * tv.x + rel.y * tv.y);
    const c = rel.x * rel.x + rel.y * rel.y;

    let t = 0;
    if (Math.abs(a) < 1e-6) {
      if (Math.abs(b) < 1e-6) return null;
      t = -c / b;
    } else {
      const disc = b * b - 4 * a * c;
      if (disc < 0) return null;
      const t1 = (-b + Math.sqrt(disc)) / (2 * a);
      const t2 = (-b - Math.sqrt(disc)) / (2 * a);
      const pos = [t1, t2].filter(x => x > 0);
      if (pos.length === 0) return null;
      t = Math.min(...pos);
    }

    const ix = targetPos.x + tv.x * t - from.x;
    const iy = targetPos.y + tv.y * t - from.y;
    const mag = Math.sqrt(ix * ix + iy * iy);
    return mag > 0 ? { x: ix / mag, y: iy / mag } : null;
  }
}
