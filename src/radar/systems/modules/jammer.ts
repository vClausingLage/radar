import {
  JAMMER_DURATION_MS,
  JAMMER_COOLDOWN_MS,
  JAMMER_CONE_DEG,
  JAMMER_ANGLE_ERROR_MIN_DEG,
  JAMMER_ANGLE_ERROR_MAX_DEG,
  JAMMER_DISTANCE_ERROR_MIN_PX,
  JAMMER_DISTANCE_ERROR_MAX_PX,
} from "../../data/radarGameSettings";

// A single bearing/range offset applied to every spoofed return in a sweep.
export type JammerError = { angle: number; distance: number };

// HUD-ready status line for the radar cone readout.
export type JammerHudStatus = { label: string; color: string };

// Active radar deception. Owned by every ship's radar (like the RwrReceiver),
// though only the player triggers it. While active it projects a cone ahead of
// the ship; an enemy radar whose beam paints this ship *and* that sits inside
// the cone has its returns rewritten into a single false track (see
// Receiver.createFakeHits). One coherent error is rolled per activation.
export class Jammer {
  // Timestamp (scene.time.now) of the last activation, or null when fully ready.
  private activatedAt: number | null = null;
  // Cached active flag, refreshed each frame by tick() so isActive() is cheap.
  private active = false;
  private error: JammerError = { angle: 0, distance: 0 };

  // Begin a jamming burst. Ignored while already active or still on cooldown.
  activate(now: number): void {
    if (this.activatedAt !== null && now - this.activatedAt < JAMMER_COOLDOWN_MS) {
      return;
    }
    this.activatedAt = now;
    this.error = this.rollError();
  }

  // Advance the active/cooldown state. Must be called once per frame before any
  // isActive() check (the radar does this at the top of update()).
  tick(now: number): void {
    if (this.activatedAt === null) {
      this.active = false;
      return;
    }
    const elapsed = now - this.activatedAt;
    this.active = elapsed < JAMMER_DURATION_MS;
    // Once the full cooldown has elapsed the jammer reports ready again.
    if (elapsed >= JAMMER_COOLDOWN_MS) this.activatedAt = null;
  }

  isActive(): boolean {
    return this.active;
  }

  getError(): JammerError {
    return this.error;
  }

  // Cone-readout status: active countdown (red), cooldown countdown (grey), or
  // ready (green). `now` is scene.time.now.
  getHudStatus(now: number): JammerHudStatus {
    if (this.activatedAt !== null) {
      const elapsed = now - this.activatedAt;
      if (elapsed < JAMMER_DURATION_MS) {
        return { label: `JAMMING ${Math.ceil((JAMMER_DURATION_MS - elapsed) / 1000)}s`, color: '#ff3030' };
      }
      if (elapsed < JAMMER_COOLDOWN_MS) {
        return { label: `XMIT ${Math.ceil((JAMMER_COOLDOWN_MS - elapsed) / 1000)}s`, color: '#888888' };
      }
    }
    return { label: 'JAMMER RDY', color: '#00ff00' };
  }

  // True when `point` (an enemy emitter) lies inside the jamming cone projected
  // ahead of the ship at `pos` facing `directionDeg`, and within `range`.
  covers(
    pos: { x: number; y: number },
    directionDeg: number,
    point: { x: number; y: number },
    range: number,
  ): boolean {
    const dx = point.x - pos.x;
    const dy = point.y - pos.y;
    if (Math.hypot(dx, dy) > range) return false;
    const bearing = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
    const offset = Phaser.Math.Angle.WrapDegrees(bearing - directionDeg);
    return Math.abs(offset) <= JAMMER_CONE_DEG / 2;
  }

  // Roll a random offset with a random sign on each axis.
  private rollError(): JammerError {
    const angleSign = Math.random() < 0.5 ? -1 : 1;
    const distSign = Math.random() < 0.5 ? -1 : 1;
    return {
      angle: angleSign * Phaser.Math.FloatBetween(JAMMER_ANGLE_ERROR_MIN_DEG, JAMMER_ANGLE_ERROR_MAX_DEG),
      distance: distSign * Phaser.Math.FloatBetween(JAMMER_DISTANCE_ERROR_MIN_PX, JAMMER_DISTANCE_ERROR_MAX_PX),
    };
  }
}
