import { Mode } from "../../data/types";

export class Antenna {
    private angleOffset: number = 0;
    private step: number = 1;
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
        switch (mode) {
            case 'rws': return 60;
            case 'tws': return 45;
            case 'stt': return 60; // same cone as rws; STT locks beam direction, not cone width
        }
    }
}
