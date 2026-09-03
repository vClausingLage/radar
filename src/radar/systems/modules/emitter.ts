import Phaser from 'phaser';
import { RADAR_DEFAULT_SWEEP_WIDTH_DEG } from '../../data/radarGameSettings';
import { illuminationRangePx } from '../../data/signalPath';

export type Pulse = {
  energy: number;
  direction: number;
  startAngle: number;
  endAngle: number;
  // The ray as far as it can matter to anything — well past the rated range the
  // scope is drawn at. What the pulse can *do* out there is the signal path's
  // business (data/signalPath.ts); the emitter only sends it.
  line: Phaser.Geom.Line;
}

export class Emitter {
  private pulse: Pulse | null = null;
  // Rated range: the range the radar's energy budget is quoted at, and the one
  // the interface draws. Not where the pulse stops.
  private range: number = 0;
  // How far the ray is actually traced, beyond which nobody can hear the pulse
  // and nothing can echo back off it.
  private reach: number = 0;

  constructor(range: number) {
    this.range = range;
    this.reach = illuminationRangePx(range);
  }

  getRange(): number {
    return this.range;
  }

  getReach(): number {
    return this.reach;
  }

  sendPulse(origin: { x: number; y: number }, direction: number, sweepWidth: number = RADAR_DEFAULT_SWEEP_WIDTH_DEG): Pulse {
    const directionRad = Phaser.Math.DegToRad(direction);
    const halfSweep = sweepWidth / 2;
    const line = new Phaser.Geom.Line(
      origin.x,
      origin.y,
      origin.x + Math.cos(directionRad) * this.reach,
      origin.y + Math.sin(directionRad) * this.reach,
    );

    this.pulse = {
      energy: 1,
      direction,
      startAngle: direction - halfSweep,
      endAngle: direction + halfSweep,
      line,
    };

    return this.pulse;
  }

}
