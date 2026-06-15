import { Missile, SARHMissile, ActiveRadarMissile } from '../../../entities/missiles';
import { Track } from '../../data/track';
import type { GuidanceTarget } from './missileRadar';

export type { GuidanceTarget };

// Context supplied each frame so the guidance can resolve every missile's
// current source of truth: the STT lock (SARH), the maintained tracks (VIM-220
// mid-course), and the live entities (VIM-220 terminal active-radar homing).
export type GuidanceContext = {
  sttTrack: Track | null;
  sttTargetEntity?: GuidanceTarget | null;
  tracks: Track[];
  targets: GuidanceTarget[];
  decoyCircles: Phaser.Geom.Circle[];
};

// Missile guidance module — mirrors the real-world seeker/autopilot unit.
//
// VIM-177 (SARH): the missile homes on reflected energy from the launching
// ship's radar continuously illuminating the STT track. If the ship breaks
// lock the missile loses guidance and flies ballistic.
//
// VIM-220 (ARH): ship uplinks an intercept heading derived from its TWS track
// until the missile closes to activation range, when its own radar (MissileRadar)
// comes online — searching (RWS) then locking and tracking (STT) a target it
// finds, after which it guides itself.
//
// Boost phase (age < 2): hold launch heading off the rail before steering.

// A waypoint counts as reached within this distance (px).
const WAYPOINT_REACHED_DISTANCE = 24;

export class MissileGuidance {
  private ageTimer = 0;
  private debugTimer = 0;

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

    // Throttled debug (~500ms): report each active-radar VIM-220's tracking
    // state after guidance has run, so the target id reflects this frame.
    this.debugTimer += delta;
    if (this.debugTimer >= 500) {
      this.debugTimer = 0;
      for (const m of live) {
        if (m instanceof ActiveRadarMissile && m.missileRadar.isActive()) {
          const tracked = m.missileRadar.getLockedTargetId();
          console.log(
            tracked !== null
              ? `VIM-220 active radar [STT]: tracking target ${tracked}`
              : `VIM-220 active radar [RWS]: searching, no target`,
          );
        }
      }
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

  // ARH (VIM-220) guidance, in priority order:
  //   1. If a waypoint route is set and WP1 not yet reached, fly to WP1 with the
  //      seeker still off.
  //   2. Activate the onboard radar once within activation range of the assigned
  //      target (or once past the first waypoint).
  //   3. With the seeker live, let the missile radar search (RWS) and track
  //      (STT); home on whatever it locks. If it is active but searching, keep
  //      flying the commanded heading (WP2 leg, else the assigned track).
  //   4. Otherwise fly the assigned TWS track (mid-course) by pure pursuit.
  private guideActiveRadar(missile: ActiveRadarMissile, ctx: GuidanceContext): { x: number; y: number } | null {
    const from = { x: missile.x, y: missile.y };

    // 1. Fly to the first waypoint (seeker stays off until it is reached).
    const toFirst = this.flyToFirstWaypoint(missile);
    if (toFirst) return toFirst;

    // Assigned mid-course track handed over by the launching ship.
    const track = missile.targetId !== undefined
      ? ctx.tracks.find(t => t.id === missile.targetId) ?? null
      : null;

    // 2. Activate the seeker by proximity to the assigned target, or once the
    //    missile has passed its first waypoint.
    if (!missile.missileRadar.isActive()) {
      const reachedWaypoint = missile.waypointRoute?.reachedFirst ?? false;
      const nearTarget = track !== null &&
        Phaser.Math.Distance.Between(from.x, from.y, track.pos.x, track.pos.y)
          <= missile.activeRadarActivationRange;
      if (reachedWaypoint || nearTarget) missile.missileRadar.activate();
    }

    // 3. Seeker live: run its RWS→STT loop and home on the locked target.
    if (missile.missileRadar.isActive()) {
      const headingDeg = Phaser.Math.RadToDeg(Math.atan2(missile.direction.y, missile.direction.x));
      const target = missile.missileRadar.update(from, headingDeg, ctx.targets, ctx.decoyCircles);
      if (target) {
        return this.interceptVector(
          from,
          { x: target.x, y: target.y },
          target.getDirection(),
          target.getSpeed(),
          missile.missileSpeed,
        ) ?? this.pursue(from, target);
      }
      // Active but still searching: keep flying the commanded heading.
      const route = missile.waypointRoute;
      if (route?.reachedFirst) return this.pursue(route.first, route.directionPoint);
      if (track) return this.pursue(from, track.pos);
      return null;
    }

    // 4. Mid-course on the assigned track. Track velocity is in px-per-scan
    // (not physics units), so pure pursuit, not a lead intercept.
    if (track) {
      return this.pursue(from, track.pos);
    }
    return null;
  }

  // Fly to the route's first waypoint. Flips `reachedFirst` on arrival (which
  // triggers seeker activation) and then returns null so the search logic takes
  // over. Returns null if there is no route or WP1 is already behind us.
  private flyToFirstWaypoint(missile: ActiveRadarMissile): { x: number; y: number } | null {
    const route = missile.waypointRoute;
    if (!route || route.reachedFirst) return null;

    const from = { x: missile.x, y: missile.y };
    const distance = Phaser.Math.Distance.Between(from.x, from.y, route.first.x, route.first.y);
    if (distance > WAYPOINT_REACHED_DISTANCE) return this.pursue(from, route.first);

    route.reachedFirst = true;
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
