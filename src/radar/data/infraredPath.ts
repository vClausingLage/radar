import Phaser from "phaser";
import type { GasVolume } from "./types";
import { gasTransmission } from "./signalPath";
import {
    IR_GAS_ATTENUATION_PER_PX,
    IR_HULL_INTENSITY,
    IR_PLUME_ASPECT_EXPONENT,
    IR_PLUME_FRONT_VISIBILITY,
    IR_PLUME_INTENSITY,
} from "./radarGameSettings";

// The energy budget every infrared sensor asks — the IRST on the ship and the
// VIM-90's seeker — as signalPath.ts is the radar's. Passive and one-way: the
// target is the transmitter, so the sum is how hot it is toward the sensor,
// how much of that the medium lets through, and how far it has spread. No
// echo, no cross-section, no Doppler, and nothing anyone can hear.

// A hot thing an IR sensor can see. Structural, so ships satisfy it without
// the sensor modules importing the entity classes; the sensor reads where it
// is and how bright it is toward the sensor, never who it is.
export type IrSource = {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly active: boolean;
    irIntensityToward(from: { x: number; y: number }): number;
};

// A ship's radiant intensity toward a viewer, as a ratio to the reference
// source (full throttle, dead astern = 1). Two parts. The hull is warm from
// every side and does not care which way it points. The engines are the
// rest of it: their heat scales with throttle and with how many are lit,
// and how much of it reaches the viewer depends on aspect — the nozzles
// face aft, and from ahead the hull stands between them and the viewer.
//
// `headingDeg` is the ship's nose; `throttle` is 0..1 (stopped to full) and
// already folds in the engines that are running.
export function irSignature(
    shipPos: { x: number; y: number },
    headingDeg: number,
    throttle: number,
    viewer: { x: number; y: number },
): number {
    const towardViewer = Phaser.Math.RadToDeg(Math.atan2(viewer.y - shipPos.y, viewer.x - shipPos.x));
    // 0 with the viewer dead ahead, 1 with the viewer dead astern.
    const offNoseRad = Phaser.Math.DegToRad(Phaser.Math.Angle.WrapDegrees(towardViewer - headingDeg));
    const rearness = (1 - Math.cos(offNoseRad)) / 2;
    const aspect = IR_PLUME_FRONT_VISIBILITY
        + (1 - IR_PLUME_FRONT_VISIBILITY) * Math.pow(rearness, IR_PLUME_ASPECT_EXPONENT);
    const plume = IR_PLUME_INTENSITY * Phaser.Math.Clamp(throttle, 0, 1) * aspect;
    return IR_HULL_INTENSITY + plume;
}

// Fraction of the heat that survives the path through gas — the same
// Beer-Lambert law the radar pays, at infrared's much higher absorption.
export function irTransmission(
    from: { x: number; y: number },
    to: { x: number; y: number },
    gasVolumes: GasVolume[],
): number {
    return gasTransmission(from, to, gasVolumes, IR_GAS_ATTENUATION_PER_PX);
}

// What the sensor receives, as a ratio to its detection threshold: a source
// of intensity 1 at the sensor's rated range, in clear space, is exactly 1.
// Irradiance from a point source falls with range² — one way, so the IR
// sensor's reach goes as the square root of the intensity, not its fourth
// root: halving a target's heat costs 30 % of the range it is seen at, where
// halving a radar target's cross-section costs 16 %.
export function irSignal(
    intensity: number,
    rangePx: number,
    ratedRangePx: number,
    transmission: number,
): number {
    if (rangePx <= 0) return Infinity;
    const r = rangePx / ratedRangePx;
    return (intensity * transmission) / (r * r);
}
