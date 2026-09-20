import Phaser from "phaser";
import { Mode } from "../../data/types";
import {
    ANTENNA_AZIMUTH_DEG_BY_MODE,
    ANTENNA_SLEW_RATE_DEG_PER_SEC,
    ANTENNA_SWEEP_STEP_DEG,
} from "../../data/radarGameSettings";

// Mechanically scanned beam: a single reflector that physically points
// wherever it is looking. Each frame it advances the beam one step across
// the azimuth and reports { direction, sweepComplete }; while tracking (STT)
// it drives toward a commanded bearing at a finite servo slew rate, lagging
// a target whose bearing rate beats it — that lag is what lets a target
// out-turn a lock. A gimbal lets it point anywhere inside its mechanical
// limits at full gain, which is the property PhasedArrayAntenna below does
// not share.
export class Antenna {
    private angleOffset: number = 0;
    private step: number = ANTENNA_SWEEP_STEP_DEG;
    private sweepDirection: 1 | -1 = 1;
    // Where the dish is actually pointing while tracking (STT), as an absolute
    // bearing. Null until the antenna is designated onto a track.
    protected trackDirection: number | null = null;
    // Last direction this antenna actually reported, from either update() or
    // trackTo(). Kept so scanAngleDeg() — meaningless for a mechanical dish,
    // always 0 — has something to measure against for the antenna that
    // actually answers it, without every caller having to track it itself.
    protected lastDirection: number = 0;

    update(mode: Mode, shipDirection: number): { direction: number; sweepComplete: boolean } {
        // Dome: a fixed dish spinning continuously through a full circle, rather
        // than a cone wiping back and forth. The beam advances one step and wraps
        // at 360°, completing a sweep once per revolution.
        if (mode === 'dome') {
            this.angleOffset += this.step;
            let sweepComplete = false;
            if (this.angleOffset >= 360) {
                this.angleOffset -= 360;
                sweepComplete = true;
            }
            this.lastDirection = shipDirection + this.angleOffset;
            return { direction: this.lastDirection, sweepComplete };
        }

        let sweepComplete = false;
        const halfAzimuth = this.getAzimuth(mode) / 2;

        if (this.angleOffset < -halfAzimuth || this.angleOffset > halfAzimuth) {
            this.angleOffset = -halfAzimuth;
            this.sweepDirection = 1;
        }

        this.angleOffset += this.step * this.sweepDirection;

        if (this.angleOffset >= halfAzimuth) {
            this.angleOffset = halfAzimuth;
            this.sweepDirection = -1;
            sweepComplete = true;
        } else if (this.angleOffset <= -halfAzimuth) {
            this.angleOffset = -halfAzimuth;
            this.sweepDirection = 1;
            sweepComplete = true;
        }

        this.lastDirection = shipDirection + this.angleOffset;
        return { direction: this.lastDirection, sweepComplete };
    }

    // STT: drive the dish toward a commanded bearing at the servo's maximum
    // slew rate and return where it actually ended up. The command is where the
    // tracking computer thinks the target is; the return value is where the
    // beam is really pointing. The two diverge whenever the target's bearing
    // rate exceeds ANTENNA_SLEW_RATE_DEG_PER_SEC — that lag is what lets a
    // target out-turn a lock instead of being followed omnisciently.
    //
    // The first call after designation snaps the dish onto the commanded
    // bearing: acquisition slews from the search position before track starts.
    trackTo(commandedDirection: number, deltaMs: number): number {
        if (this.trackDirection === null) {
            this.trackDirection = commandedDirection;
            this.lastDirection = this.trackDirection;
            return this.trackDirection;
        }

        const maxStep = ANTENNA_SLEW_RATE_DEG_PER_SEC * (deltaMs / 1000);
        const error = Phaser.Math.Angle.WrapDegrees(commandedDirection - this.trackDirection);
        const step = Phaser.Math.Clamp(error, -maxStep, maxStep);

        this.trackDirection = Phaser.Math.Angle.WrapDegrees(this.trackDirection + step);
        this.lastDirection = this.trackDirection;
        return this.trackDirection;
    }

    // Release the dish from track, so the next designation re-acquires.
    resetTracking(): void {
        this.trackDirection = null;
    }

    public getAzimuth(mode: Mode): number {
        return ANTENNA_AZIMUTH_DEG_BY_MODE[mode];
    }

    // How far the beam is currently steered off this antenna's own boresight
    // (the ship's nose) — the scan angle a phased array's gain and beamwidth
    // degrade with (scanLossFactor in data/signalPath.ts). A mechanical dish
    // physically points wherever it is tracking and pays nothing for this, so
    // the base class always reports 0; see PhasedArrayAntenna for the antenna
    // that actually answers it.
    scanAngleDeg(_shipDirection: number): number {
        return 0;
    }
}

// A fixed electronically-scanned array: no reflector to move, so no servo lag
// at all — trackTo snaps to the commanded bearing every single frame, which
// is the real reason a lock on this antenna cannot be out-turned the way a
// mechanical dish's can be (Radar's antenna field takes either behind the
// same interface; nothing in the current scenarios constructs this one yet —
// it is infrastructure for a future hull, per the realism roadmap's phased
// array item).
//
// The trade is on the other side: beam energy is steered by phase across a
// flat face, not by physically pointing the face at the target, so gain and
// beamwidth degrade the further the beam scans from the array's own
// boresight. A lock held at the edge of the gimbal is measurably weaker on
// this antenna — beaten by closing range, not by turning — where the same
// lock on a mechanical dish is exactly as strong at the edge as at the
// centre.
export class PhasedArrayAntenna extends Antenna {
    trackTo(commandedDirection: number, _deltaMs: number): number {
        this.trackDirection = Phaser.Math.Angle.WrapDegrees(commandedDirection);
        this.lastDirection = this.trackDirection;
        return this.trackDirection;
    }

    scanAngleDeg(shipDirection: number): number {
        return Math.abs(Phaser.Math.Angle.WrapDegrees(this.lastDirection - shipDirection));
    }
}
