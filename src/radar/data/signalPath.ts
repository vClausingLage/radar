import Phaser from 'phaser';
import type { GasVolume } from './types';
import {
    ANTENNA_REFERENCE_BEAM_WIDTH_DEG,
    ANTENNA_SIDELOBE_LEVEL,
    JAMMER_POWER,
    RADAR_BEAM_WIDTH_DEG,
    RADAR_MAX_CROSS_SECTION,
    RADAR_MEASUREMENT_JITTER_MAX_PX,
    RADAR_MEASUREMENT_JITTER_REF_PX,
    RADAR_ONE_WAY_RANGE_POWER,
    RADAR_PFA,
    RADAR_PULSE_LENGTH_PX,
    RADAR_REFERENCE_CROSS_SECTION_PX,
    RADAR_SPECULAR_EXPONENT,
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

// Two-way horizon for a radar of this rated range: past it even the largest
// hull the game allows throws back less than the receiver's noise floor, so
// there is no return left to find anywhere further out. Where the one-way
// SIGNAL_HORIZON_FACTOR above bounds how far a pulse is worth tracing for
// anyone still listening, this bounds where an *echo* can still exist — the
// pre-gate a returning sensor applies before spending an energy test on a
// candidate.
export function echoHorizonPx(ratedRangePx: number): number {
    return ratedRangePx * ECHO_HORIZON_FACTOR;
}

// Antenna gain relative to the reference beam (RWS's, ANTENNA_REFERENCE_
// BEAM_WIDTH_DEG), for a beam of this width. The same energy spread over a
// narrower beam packs more of it onto anything inside — a 2-D far-field
// approximation, gain inversely proportional to beamwidth — normalised to 1
// at the reference width so the rest of the tuned budget keeps meaning what
// it was built to mean. STT's 6-degree beam comes out to a gain of 10: it
// locks targets a search sweep could never hold, which is the point of
// staring instead of scanning. Applied once for a one-way emission (only the
// transmit side matters to a listener) and squared for a two-way return (both
// legs cross the same aperture).
//
// Clamped at 1 for anything wider than the reference (the 360-degree dome):
// the illuminating pencil beam is the same hardware in every search mode, so a
// wider search sector does not weaken each pulse — it just revisits any given
// bearing less often. A per-look gain below the reference would model that
// slower revisit as a fainter echo, which it is not; the dome sees each
// contact exactly as brightly as RWS does per look, only less frequently. Only
// a genuinely narrower dwell (STT, TWS) concentrates more energy per look.
export function beamGain(beamWidthDeg: number): number {
    if (beamWidthDeg <= 0) return 1;
    return Math.max(1, ANTENNA_REFERENCE_BEAM_WIDTH_DEG / beamWidthDeg);
}

// The classic AESA cosine scan loss: a fixed phased array's effective
// aperture foreshortens as the beam steers away from the face's own
// boresight, so both the gain and the beamwidth it buys fall off with the
// cosine of the scan angle. Applied on top of beamGain — same treatment,
// squared for a two-way return, once for a one-way emission — which is why a
// phased-array lock held at the edge of its gimbal is measurably weaker than
// one held dead ahead, where a mechanical dish (Antenna.scanAngleDeg always
// 0) pays nothing here at any pointing angle within its mechanical limits.
export function scanLossFactor(scanAngleDeg: number): number {
    return Math.max(0, Math.cos(Phaser.Math.DegToRad(scanAngleDeg)));
}

// The antenna's amplitude pattern: the fraction of full beam gain a target
// at `offAxisDeg` from the beam centre receives. A Gaussian main lobe — the
// smooth stand-in for a real aperture's sinc-shaped pattern, chosen because
// it never goes negative and falls off honestly — normalised to 1 on
// boresight and −3 dB (0.5) at half the beamwidth, so `beamWidthDeg` means
// the same thing here it means everywhere else (the resolution cell). This
// replaces the flat in-beam/sidelobe split: a hit at the edge of a beam
// returns measurably less than one at the centre, which is what makes an
// amplitude-weighted centroid a bearing measurement (poor man's monopulse —
// the weighted mean angle of the cluster *is* the estimate a monopulse
// comparator forms) instead of a geometric average that then has to be
// trimmed of its edge hits.
//
// A pure Gaussian has no sidelobes at all, and real antennas do leak in
// every direction, so the pattern is floored at ANTENNA_SIDELOBE_LEVEL —
// one flat leak standing in for the whole lobe structure outside the main
// lobe, the same simplification illuminateRwr has always made, now as the
// pattern's floor rather than a separate binary branch.
export function beamPattern(offAxisDeg: number, beamWidthDeg: number): number {
    if (beamWidthDeg <= 0) return 1;
    // σ from the −3 dB full width: the half-power point sits at half the
    // quoted beamwidth, so σ = width / (2·√(2·ln 2)).
    const sigma = beamWidthDeg / (2 * Math.sqrt(2 * Math.LN2));
    const mainLobe = Math.exp(-(offAxisDeg * offAxisDeg) / (2 * sigma * sigma));
    return Math.max(mainLobe, ANTENNA_SIDELOBE_LEVEL);
}

// Signal a returning echo carries, relative to the receiver's noise floor.
// Out and back, so the range falls in twice over; the target's cross-section
// sets how much of what arrives is thrown back; `transmission` is the fraction
// of energy that survives one crossing of whatever medium is in the way, and
// it too counts twice because the echo comes back through it. `gain` is the
// beam's antenna gain relative to the reference beam (see beamGain) and also
// counts twice, once on transmit and once on receive.
export function returnSignal(
    rangePx: number,
    ratedRangePx: number,
    crossSection: number,
    transmission: number,
    gain: number = 1,
): number {
    if (rangePx <= 0) return Infinity;
    return crossSection
        * transmission * transmission
        * gain * gain
        * Math.pow(ratedRangePx / rangePx, RADAR_TWO_WAY_RANGE_POWER);
}

// Signal the emission itself carries at a listener out at `rangePx`, relative
// to a warning receiver's noise floor. One way only — no reflection, no return
// leg — which is why this stays above the floor long after a return from the
// same range has fallen below it. This is the whole asymmetry: being swept is
// detectable further out than being seen. `gain` (see beamGain) counts once,
// not twice — only the transmit side is this radar's; the listener's own
// front end is a separate budget, already folded into RWR_NOISE_FLOOR.
export function emissionSignal(
    rangePx: number,
    ratedRangePx: number,
    transmission: number,
    gain: number = 1,
): number {
    if (rangePx <= 0) return Infinity;
    return transmission
        * gain
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

// Signal a jamming burst delivers at a victim `rangePx` away, quoted on the
// victim's own scale: its rated range is the reference, the victim's noise
// floor is 1, and JAMMER_POWER is the figure of merit — the ratio the burst
// achieves against a *reference hull's echo at that range* (where the echo is
// exactly 1). One-way, so it falls with the square of range. The contest
// against any real echo is then jammerSignal / returnSignal, and the
// fourth-power range law does the rest: a jammer that comfortably out-shouts
// an echo out at the ring loses outright — burn-through — to the same contact
// once it closes in or turns broadside, because the echo grows as the fourth
// power while the noise only strengthens as the square.
export function jammerSignal(rangePx: number, ratedRangePx: number): number {
    if (rangePx <= 0) return Infinity;
    return JAMMER_POWER * Math.pow(ratedRangePx / rangePx, RADAR_ONE_WAY_RANGE_POWER);
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

// Whether two returns fall in the same resolution cell — the radar's own
// answer to "is this one contact or two", distinct from measurementJitterPx's
// question of how well *one* contact's position is known. Anisotropic, like
// a real beam: range resolution (RADAR_PULSE_LENGTH_PX) is a fixed px width,
// the same close in or far out, because it comes from the pulse's length in
// time, not its geometry. Cross-range resolution (RADAR_BEAM_WIDTH_DEG) is a
// fixed *angle*, so the px gap it takes to resolve two contacts grows with
// range — the same beam that separates two ships in formation at 600 px
// merges them into one contact at 1500 px, and splits them again as they
// close. Ship and terrain returns are quoted against the same two constants,
// so this is one answer for both, not a tracking-only approximation next to
// a differently-tuned ground map.
//
// The comparison is inclusive on both axes, which is the plot-extraction
// rule: returns quantised into *adjacent* bins differ by exactly one
// resolution element — and the binning is the receiver's own reporting
// grid, not a property of the targets, so its boundary must not split what
// one hull produced. A real set's plot extractor groups detected cells that
// touch into one plot the same way; two genuinely distinct contacts land
// more than one element apart and stay separate.
export function sameResolutionCell(
    a: { range: number; angle: number },
    b: { range: number; angle: number },
): boolean {
    if (Math.abs(a.range - b.range) > RADAR_PULSE_LENGTH_PX) return false;
    return Math.abs(Phaser.Math.Angle.WrapDegrees(a.angle - b.angle)) <= RADAR_BEAM_WIDTH_DEG;
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

// How directly the specific facet a ray struck faces back at the antenna —
// 1 dead-on, fading toward 0 at a grazing limb — the same incidence measure
// the ground map already shades by (TerrainMapper.resolveCell). `crossSection`
// above is a silhouette measurement: it says how much of the hull is turned
// broadside, but not whether the plating at the exact point struck is flat
// and facing the beam or curved away from it. Real RCS is the second thing as
// much as the first — a flat facet at normal incidence glints far harder than
// its share of the silhouette alone would suggest, which is what actually
// makes beaming and stealth shaping work: not merely "less hull", but "less
// hull turned square-on". Raised to RADAR_SPECULAR_EXPONENT rather than used
// as a plain cosine, so the glint is a highlight (a narrow bright lobe near
// normal incidence) and not a smooth Lambertian shade — closer to how a flat
// plate's RCS actually behaves.
//
// `surfaceNormal`'s orientation is not guaranteed (see Ray.surfaceNormalAt),
// so `beamDir` (unit vector, antenna to hit point) is compared against it
// either way round, exactly as the ground map already does.
export function specularFactor(
    beamDir: { x: number; y: number },
    surfaceNormal: { x: number; y: number },
): number {
    const incidence = Math.abs(beamDir.x * surfaceNormal.x + beamDir.y * surfaceNormal.y);
    return Math.pow(incidence, RADAR_SPECULAR_EXPONENT);
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
