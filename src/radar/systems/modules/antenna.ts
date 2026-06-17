import { Mode } from "../../data/types";
import { ANTENNA_AZIMUTH_DEG_BY_MODE, ANTENNA_SWEEP_STEP_DEG } from "../../data/radarGameSettings";

export class Antenna {
    private angleOffset: number = 0;
    private step: number = ANTENNA_SWEEP_STEP_DEG;
    private sweepDirection: 1 | -1 = 1;

    update(mode: Mode, shipDirection: number): { direction: number; sweepComplete: boolean } {
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

    public getAzimuth(mode: Mode): number {
        return ANTENNA_AZIMUTH_DEG_BY_MODE[mode];
    }
}
