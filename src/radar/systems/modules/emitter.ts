import { RADAR_DEFAULT_SWEEP_WIDTH_DEG } from '../../data/radarGameSettings';

export type Pulse = {
  energy: number;
  direction: number;
  startAngle: number;
  endAngle: number;
  line: Phaser.Geom.Line;
}

export class Emitter {
  private pulse: Pulse | null = null;
  private range: number = 0;

  constructor(range: number) {
    this.range = range;
  }

  sendPulse(origin: { x: number; y: number }, direction: number, sweepWidth: number = RADAR_DEFAULT_SWEEP_WIDTH_DEG): Pulse {
    const directionRad = Phaser.Math.DegToRad(direction);
    const halfSweep = sweepWidth / 2;
    const line = new Phaser.Geom.Line(
      origin.x,
      origin.y,
      origin.x + Math.cos(directionRad) * this.range,
      origin.y + Math.sin(directionRad) * this.range,
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
