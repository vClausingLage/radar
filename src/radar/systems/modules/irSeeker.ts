import Phaser from 'phaser';
import type { Vector2 } from '../../../types';
import type { GasVolume, Terrain } from '../../data/types';
import { Ray } from '../../../physics/ray';
import { irSignal, irTransmission, type IrSource } from '../../data/infraredPath';
import { profileStart, profileStop } from '../../../performance/profiler';
import {
  IR_SEEKER_FOV_DEG,
  IR_SEEKER_GIMBAL_DEG,
  IR_SEEKER_LOST_FRAMES,
  IR_SEEKER_MIN_SIGNAL,
  IR_SEEKER_RATED_RANGE_PX,
  IR_SEEKER_SLEW_RATE_DEG_PER_SEC,
} from '../../data/radarGameSettings';

// The VIM-90's infrared seeker: a small gimballed optic with a narrow field of
// view, looking for heat. It has no range and no velocity to offer — only the
// direction of the hottest thing in its window — which is exactly what
// proportional navigation needs (MissileGuidance.guideInfrared), and all it
// gives up to anyone: it emits nothing, so its target is never warned.
//
// Before launch the seeker is caged to the launching ship's cue (the radar's
// STT line of sight or the IRST's lock) and must find heat there — tone —
// before fire control lets the round go (lock-on before launch). After launch
// it is on its own: it follows the strongest source in its window by geometry,
// not by identity, so a hotter hull crossing the window takes it. Lose the
// source for IR_SEEKER_LOST_FRAMES and it is done: the missile flies on
// ballistic.
export class IrSeeker {
  // Absolute line of sight the head is pointing along, or null when it has
  // nothing (never acquired, or gave up).
  private lookDeg: number | null = null;
  private lostFrames = 0;
  private readonly raycaster = new Ray();

  hasTrack(): boolean {
    return this.lookDeg !== null;
  }

  getLookDeg(): number | null {
    return this.lookDeg;
  }

  // Uncage on a cue bearing and listen for tone. Returns whether a source
  // inside the field of view clears the seeker's threshold; if so the head
  // is left pointing at it.
  acquire(pos: Vector2, cueDeg: number, sources: IrSource[], gasVolumes: GasVolume[], terrain: Terrain[]): boolean {
    profileStart('irSeeker_acquire');
    const seen = this.strongestInWindow(pos, cueDeg, sources, gasVolumes, terrain);
    this.lookDeg = seen;
    this.lostFrames = 0;
    profileStop('irSeeker_acquire');
    return seen !== null;
  }

  // One tick in flight. Returns the measured line of sight to the source
  // (deg, absolute) or null if there is none this tick.
  update(
    pos: Vector2,
    missileHeadingDeg: number,
    deltaMs: number,
    sources: IrSource[],
    gasVolumes: GasVolume[],
    terrain: Terrain[],
  ): number | null {
    if (this.lookDeg === null) return null;

    profileStart('irSeeker_update');
    const seen = this.strongestInWindow(pos, this.lookDeg, sources, gasVolumes, terrain);
    if (seen === null) {
      if (++this.lostFrames > IR_SEEKER_LOST_FRAMES) this.lookDeg = null;
      profileStop('irSeeker_update');
      return null;
    }
    // The source is in the window: its bearing is measured, and the head slews
    // to re-centre it at the gimbal's rate.
    const maxStep = IR_SEEKER_SLEW_RATE_DEG_PER_SEC * (deltaMs / 1000);
    const error = Phaser.Math.Angle.WrapDegrees(seen - this.lookDeg);
    this.lookDeg = Phaser.Math.Angle.WrapDegrees(this.lookDeg + Phaser.Math.Clamp(error, -maxStep, maxStep));
    // A source the head cannot look at any more — the missile has overflown it
    // or been out-turned — is lost: the head is against its stops.
    if (Math.abs(Phaser.Math.Angle.WrapDegrees(this.lookDeg - missileHeadingDeg)) > IR_SEEKER_GIMBAL_DEG) {
      this.lookDeg = null;
      profileStop('irSeeker_update');
      return null;
    }
    this.lostFrames = 0;
    profileStop('irSeeker_update');
    return seen;
  }

  // Bearing of the strongest source inside the field of view around
  // `centreDeg`, in clear line of sight and above threshold — or null.
  private strongestInWindow(
    pos: Vector2,
    centreDeg: number,
    sources: IrSource[],
    gasVolumes: GasVolume[],
    terrain: Terrain[],
  ): number | null {
    let best: number | null = null;
    let bestSignal = IR_SEEKER_MIN_SIGNAL;
    for (const s of sources) {
      if (!s.active) continue;
      const bearing = Phaser.Math.RadToDeg(Math.atan2(s.y - pos.y, s.x - pos.x));
      if (Math.abs(Phaser.Math.Angle.WrapDegrees(bearing - centreDeg)) > IR_SEEKER_FOV_DEG / 2) continue;
      const range = Phaser.Math.Distance.Between(pos.x, pos.y, s.x, s.y);
      const signal = irSignal(
        s.irIntensityToward(pos), range, IR_SEEKER_RATED_RANGE_PX, irTransmission(pos, s, gasVolumes),
      );
      if (signal < bestSignal) continue;
      if (this.raycaster.isOccluded(pos, s, terrain)) continue;
      best = bearing;
      bestSignal = signal;
    }
    return best;
  }
}
