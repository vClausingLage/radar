import Phaser from "phaser";
import { Ship } from "../entities/ship";
import { landingSettings } from "../settings";

// A hull already resting on the surface: the ship that starts the level
// parked on the pad meets the pad's body on the first physics step.
const REST_SPEED = 1e-4;

export type Touchdown = 'landed' | 'crash';

// How fast the hull is actually moving, read off the body rather than the
// throttle setting — the two differ for a ship being pushed or drifting.
export function touchdownSpeed(ship: Ship): number {
    const body = ship.body as MatterJS.BodyType | null;
    if (!body) return 0;
    return Math.hypot(body.velocity.x, body.velocity.y);
}

// Judge an arrival on ground. A landing is a slow, tail-first arrival: the
// ship backs down onto the surface on its engines the way a rocket lands on
// its base. Anything else — too fast, or nose or side first — is a crash.
export function assessTouchdown(ship: Ship): Touchdown {
    const speed = touchdownSpeed(ship);
    if (speed > landingSettings.MAX_TOUCHDOWN_SPEED) return 'crash';
    if (speed < REST_SPEED) return 'landed';

    const body = ship.body as MatterJS.BodyType;
    const travelDeg = Phaser.Math.RadToDeg(Math.atan2(body.velocity.y, body.velocity.x));
    const tailDeg = ship.angle + 180;
    const offTail = Math.abs(Phaser.Math.Angle.WrapDegrees(travelDeg - tailDeg));
    return offTail <= landingSettings.TAIL_CONE_DEG ? 'landed' : 'crash';
}
