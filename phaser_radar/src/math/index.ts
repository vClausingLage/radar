import { Vector2, ReturnSignal } from "../types";
import { Track } from "../radar/data/track";

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

export function fitTrack(history: ReturnSignal[]): Track | null {
  if (history.length < 2) return null;

  // 1) Mean (µx, µy, µt)
  let sumX = 0, sumY = 0, sumT = 0;
  history.forEach(h => { sumX+=h.point.x; sumY+=h.point.y; sumT+=h.time; });
  const n = history.length;
  const meanX = sumX / n, meanY = sumY / n, meanT = sumT / n;

  // 2) Covariance with time (needed for velocity components)
  let numX = 0, numY = 0, den  = 0;
  history.forEach(h => {
    const dt = h.time - meanT;
    numX += (h.point.x - meanX) * dt;
    numY += (h.point.y - meanY) * dt;
    den  += dt * dt;
  });
  if (den === 0) return null;          // all timestamps identical – shouldn't happen

  const vx = numX / den;               // px per ms
  const vy = numY / den;
  const speed = Math.hypot(vx, vy);
  const dir   = new Phaser.Math.Vector2(vx, vy).normalize();
  const bla = {
    x: dir.x,
    y: dir.y,
  } as Vector2;

  return { pos: { x: meanX, y: meanY }, dir: bla, speed };
}
