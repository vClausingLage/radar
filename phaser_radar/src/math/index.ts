import { Vector2 } from "../types";

export function distanceBetweenPoints(
  v1: Vector2,
  v2: Vector2
): number {
  return Math.sqrt(Math.pow(v2.x - v1.x, 2) + Math.pow(v2.y - v1.y, 2));
}