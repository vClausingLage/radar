import { Vector2 } from "../types";

export function distanceBetweenPoints(
  v1: Vector2,
  v2: Vector2
): number {
  return Math.sqrt(Math.pow(v2.x - v1.x, 2) + Math.pow(v2.y - v1.y, 2));
}

export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function getMiddleAngle(angle1: number, angle2: number): number {
  const diff = Phaser.Math.Angle.Wrap(angle2 - angle1);
  return Phaser.Math.Angle.Wrap(angle1 + diff / 2);
}