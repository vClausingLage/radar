import { Track } from "../radar/data/track";
import { Missile } from "../entities/missiles";
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

export function getDistance(pos: Vector2, t: Vector2): number {
  return Math.sqrt(Math.pow(t.x - pos.x, 2) + Math.pow(t.y - pos.y, 2));
}

export const normalizeAngle = (angle: number): number => {
    while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;
  return angle;
}

export function calculateInterceptionVector(missile: Missile, track: Track): Vector2 {
  const missilePosition = { x: missile.position.x, y: missile.position.y };
  const missileSpeed = missile.speed;

  const trackPosition = { x: track.pos.x, y: track.pos.y };
  const trackVelocity = {
    x: track.speed * Math.cos(track.pos.x),
    y: track.speed * Math.sin(track.pos.y)
  };
  
  // Calculate relative position
  const relativePosition = {
    x: trackPosition.x - missilePosition.x,
    y: trackPosition.y - missilePosition.y
  };
  
  // Quadratic equation coefficients
  // For solving: |trackPos + trackVel*t - missilePos| = missileSpeed*t
  const a = Math.pow(trackVelocity.x, 2) + Math.pow(trackVelocity.y, 2) - Math.pow(missileSpeed, 2);
  const b = 2 * (relativePosition.x * trackVelocity.x + relativePosition.y * trackVelocity.y);
  const c = Math.pow(relativePosition.x, 2) + Math.pow(relativePosition.y, 2);
  
  // Calculate discriminant
  const discriminant = b * b - 4 * a * c;
  
  // Check if interception is possible
  if (discriminant < 0 || (a === 0 && b === 0)) {
    // No interception possible, just head toward the track's current position
    return {
      x: relativePosition.x,
      y: relativePosition.y
    };
  }
  
  // Calculate interception time (we want the smaller positive solution)
  let t;
  if (a === 0) {
    t = -c / b;
  } else {
    const t1 = (-b + Math.sqrt(discriminant)) / (2 * a);
    const t2 = (-b - Math.sqrt(discriminant)) / (2 * a);
    t = t1 > 0 && (t2 < 0 || t1 < t2) ? t1 : t2;
  }
  
  if (t < 0) {
    // If time is negative, just aim at current position
    return {
      x: relativePosition.x,
      y: relativePosition.y
    };
  }
  
  // Calculate the interception point
  const interceptionPoint = {
    x: trackPosition.x + trackVelocity.x * t,
    y: trackPosition.y + trackVelocity.y * t
  };
  
  // Calculate direction vector from missile to interception point
  return {
    x: interceptionPoint.x - missilePosition.x,
    y: interceptionPoint.y - missilePosition.y
  };
}