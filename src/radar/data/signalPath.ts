import Phaser from 'phaser';
import type { GasVolume } from './types';
import {
    RADAR_MAX_CROSS_SECTION,
    RADAR_MEASUREMENT_JITTER_MAX_PX,
    RADAR_MEASUREMENT_JITTER_REF_PX,
    RADAR_ONE_WAY_RANGE_POWER,
    RADAR_PFA,
    RADAR_REFERENCE_CROSS_SECTION_PX,
    RADAR_TWO_WAY_RANGE_POWER,
    RWR_NOISE_FLOOR,
    gasCloudSettings,
} from './radarGameSettings';

/**
 * The signal path: what happens to a pulse between leaving the antenna and
 * being made sense of by whatever receives it.
 *
 * This is the one place that answers "was there enough energy?", and every
 * sensor in the game asks it — the ship radar's own receiver, a missile
 * seeker, and the warning receiver on the ship being swept. It is deliberately
 * free of game objects (a target is a polygon, gas is a capsule) so a seeker
 * can use it without dragging the ship radar in behind it.
 *
 * A radar's rated range (RADAR_DEFAULT_RANGE_PX) is a display setting — how
 * far out the scope draws its cone and its contacts. It is not where the pulse
 * stops. Everything here is a *signal ratio* normalised so that 1 is the least
 * signal a radar receiver can still make a detection out of, and the rated
 * range is defined as the range at which a reference hull in clear space
 * returns exactly that. So the ring on the scope is where an average contact
 * happens to fade — not a boundary the physics knows about.
 */

// One-way horizon: past this the pulse is too thin for even a warning receiver
// to notice, so nothing beyond it can learn anything from this emission.
const RWR_HORIZON_FACTOR = Math.pow(1 / RWR_NOISE_FLOOR, 1 / RADAR_ONE_WAY_RANGE_POWER);

// Two-way horizon for the largest hull the game allows: the furthest anything
// could still echo from.
const ECHO_HORIZON_FACTOR = Math.pow(RADAR_MAX_CROSS_SECTION, 1 / RADAR_TWO_WAY_RANGE_POWER);

// How far a pulse is worth tracing, as a multiple of the radar's rated range.
// Beyond it there is nobody left to warn and nothing left to hear, so the ray
// ends there — but note it is comfortably past the rated range, which is the
// whole point: the beam does not stop where the scope stops drawing.
export const SIGNAL_HORIZON_FACTOR = Math.max(RWR_HORIZON_FACTOR, ECHO_HORIZON_FACTOR);

// Length (px) to trace a pulse from a radar of this rated range.
export function illuminationRangePx(ratedRangePx: number): number {
    return ratedRangePx * SIGNAL_HORIZON_FACTOR;
}

// Signal a returning echo carries, relative to the receiver's noise floor.
// Out and back, so the range falls in twice over; the target's cross-section
// sets how much of what arrives is thrown back; `transmission` is the fraction
// of energy that survives one crossing of whatever medium is in the way, and
// it too counts twice because the echo comes back through it.
export function returnSignal(
    rangePx: number,
    ratedRangePx: number,
    crossSection: number,
    transmission: number,
): number {
    if (rangePx <= 0) return Infinity;
    return crossSection
        * transmission * transmission
        * Math.pow(ratedRangePx / rangePx, RADAR_TWO_WAY_RANGE_POWER);
}

// Signal the emission itself carries at a listener out at `rangePx`, relative
// to a warning receiver's noise floor. One way only — no reflection, no return
// leg — which is why this stays above the floor long after a return from the
// same range has fallen below it. This is the whole asymmetry: being swept is
// detectable further out than being seen.
export function emissionSignal(
    rangePx: number,
    ratedRangePx: number,
    transmission: number,
): number {
    if (rangePx <= 0) return Infinity;
    return transmission
        * Math.pow(ratedRangePx / rangePx, RADAR_ONE_WAY_RANGE_POWER)
        / RWR_NOISE_FLOOR;
}

// Chance a signal of this strength is actually made out against the noise.
// Swerling I's closed form for a Neyman-Pearson threshold built around a
// design false-alarm rate: Pd = Pfa ^ (1 / (1 + signal)). At signal = 0 this
// is exactly Pfa — the same noise-alone false-alarm chance the threshold was
// set for — and it climbs toward certainty as signal grows, fading in over a
// band rather than switching on at a line. That fade is what makes a contact
// at the edge of the picture blink in and out for a few sweeps before it
// settles, and the nonzero floor is what makes a false alarm possible at all:
// see the receiver's false-alarm spawn, which rolls the same curve against a
// cell with nothing in it.
export function detectionProbability(signal: number): number {
    if (!Number.isFinite(signal)) return 1;
    if (signal < 0) return RADAR_PFA;
    return Math.pow(RADAR_PFA, 1 / (1 + signal));
}

// Roll for one detection at this signal strength.
export function isDetected(signal: number): boolean {
    return Math.random() < detectionProbability(signal);
}

// How far a detected return's reported position wanders from where it truly
// is, as a 1-sigma jitter (px). Measurement accuracy improves with SNR —
// resolution / sqrt(2 * signal) — so a strong, close return is nearly exact
// and a faint one right at the floor wanders by the full reference amount.
// Clamped so a return sitting right at the detection floor cannot roll a
// jitter large enough to place it somewhere the geometry never supported.
export function measurementJitterPx(signal: number): number {
    if (!Number.isFinite(signal) || signal <= 0) return RADAR_MEASUREMENT_JITTER_MAX_PX;
    const jitter = RADAR_MEASUREMENT_JITTER_REF_PX / Math.sqrt(2 * signal);
    return Math.min(jitter, RADAR_MEASUREMENT_JITTER_MAX_PX);
}

// A hull's radar cross-section as seen from `from`, relative to the reference
// hull the rated range is quoted for. Measured as the width the hull presents
// across the line of sight, so it falls straight out of the geometry: a long
// ship broadside is a much bigger reflector than the same ship bow-on, and a
// blocky one barely cares which way it is pointing.
export function crossSection(polygon: Phaser.Geom.Polygon, from: { x: number; y: number }): number {
    const points = polygon.points;
    if (points.length === 0) return 1;

    let cx = 0;
    let cy = 0;
    for (const p of points) {
        cx += p.x;
        cy += p.y;
    }
    cx /= points.length;
    cy /= points.length;

    const losX = cx - from.x;
    const losY = cy - from.y;
    const losLength = Math.hypot(losX, losY);
    if (losLength === 0) return 1;

    // Unit vector across the line of sight: the hull's extent along it is
    // exactly the silhouette the beam sees.
    const acrossX = -losY / losLength;
    const acrossY = losX / losLength;

    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
        const projected = p.x * acrossX + p.y * acrossY;
        if (projected < min) min = projected;
        if (projected > max) max = projected;
    }

    return Phaser.Math.Clamp(
        (max - min) / RADAR_REFERENCE_CROSS_SECTION_PX,
        0,
        RADAR_MAX_CROSS_SECTION,
    );
}

// Fraction of a pulse's energy that survives a single trip from `from` to `to`
// through the gas clouds in the way. Beer-Lambert: the survivor is
// exp(-optical depth), the optical depth being the path length inside each
// cloud times its density. Nothing is blocked outright — the signal is made
// weaker, and it is the energy budget above that decides what that costs.
export function gasTransmission(
    from: { x: number; y: number },
    to: { x: number; y: number },
    gasVolumes: GasVolume[],
): number {
    if (gasVolumes.length === 0) return 1;

    const line = new Phaser.Geom.Line(from.x, from.y, to.x, to.y);
    let opticalDepth = 0;
    for (const volume of gasVolumes) {
        opticalDepth += pathLengthInGas(line, volume) * volume.density;
    }
    if (opticalDepth === 0) return 1;

    return Math.exp(-opticalDepth * gasCloudSettings.ATTENUATION_PER_PX);
}

// How much of `line` runs inside a cloud's capsule (px). Walked in fixed steps
// rather than solved analytically: the capsule is a swept circle, the beam is
// short, and the step is finer than any cloud is thick, so the sampling error
// is far below the randomness sitting on top of the result anyway.
function pathLengthInGas(line: Phaser.Geom.Line, volume: GasVolume): number {
    // Cheap reject: a sphere enclosing the whole capsule. Phaser's test also
    // reports containment, so a beam starting inside the gas still counts.
    const spine = volume.line;
    const half = Phaser.Math.Distance.Between(spine.x1, spine.y1, spine.x2, spine.y2) / 2;
    const bounds = new Phaser.Geom.Circle(
        (spine.x1 + spine.x2) / 2,
        (spine.y1 + spine.y2) / 2,
        half + volume.radius,
    );
    if (!Phaser.Geom.Intersects.LineToCircle(line, bounds)) return 0;

    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    const length = Math.hypot(dx, dy);
    if (length === 0) return 0;

    const steps = Math.max(1, Math.ceil(length / gasCloudSettings.PATH_SAMPLE_PX));
    const step = length / steps;
    const radiusSq = volume.radius * volume.radius;
    let inside = 0;

    for (let i = 0; i < steps; i++) {
        // Sample at the middle of each step, so a grazing pass is not
        // systematically over- or under-counted.
        const s = (i + 0.5) / steps;
        if (distanceToSpineSquared(line.x1 + dx * s, line.y1 + dy * s, spine) <= radiusSq) {
            inside++;
        }
    }

    return inside * step;
}

// Squared distance from a point to the cloud's spine segment — the capsule is
// exactly the set of points where this is within the radius.
function distanceToSpineSquared(x: number, y: number, spine: Phaser.Geom.Line): number {
    const sx = spine.x2 - spine.x1;
    const sy = spine.y2 - spine.y1;
    const lengthSq = sx * sx + sy * sy;
    // A cloud that has not spread yet is a single point, not a segment.
    const t = lengthSq === 0
        ? 0
        : Phaser.Math.Clamp(((x - spine.x1) * sx + (y - spine.y1) * sy) / lengthSq, 0, 1);
    const nx = spine.x1 + sx * t;
    const ny = spine.y1 + sy * t;
    return (x - nx) * (x - nx) + (y - ny) * (y - ny);
}
