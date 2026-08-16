import Phaser from "phaser";

export type RadarReturn = {
  point: Phaser.Math.Vector2;
  range: number;
  angle: number;
}