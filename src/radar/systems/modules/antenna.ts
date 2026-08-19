import Phaser from "phaser";
import { Mode } from "../../data/types";
import {
    ANTENNA_AZIMUTH_DEG_BY_MODE,
    ANTENNA_SLEW_RATE_DEG_PER_SEC,
    ANTENNA_SWEEP_STEP_DEG,
} from "../../data/radarGameSettings";

export class Antenna {
    private angleOffset: number = 0;
    private step: number = ANTENNA_SWEEP_STEP_DEG;
    private sweepDirection: 1 | -1 = 1;
    // Where the dish is actually pointing while tracking (STT), as an absolute
    // bearing. Null until the antenna is designated onto a track.
    private trackDirection: number | null = null;

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
            return { direction: shipDirection + this.angleOffset, sweepComplete };
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

        return { direction: shipDirection + this.angleOffset, sweepComplete };
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
            return this.trackDirection;
        }

        const maxStep = ANTENNA_SLEW_RATE_DEG_PER_SEC * (deltaMs / 1000);
        const error = Phaser.Math.Angle.WrapDegrees(commandedDirection - this.trackDirection);
        const step = Phaser.Math.Clamp(error, -maxStep, maxStep);

        this.trackDirection = Phaser.Math.Angle.WrapDegrees(this.trackDirection + step);
        return this.trackDirection;
    }

    // Release the dish from track, so the next designation re-acquires.
    resetTracking(): void {
        this.trackDirection = null;
    }

    public getAzimuth(mode: Mode): number {
        return ANTENNA_AZIMUTH_DEG_BY_MODE[mode];
    }
}
