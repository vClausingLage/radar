import { Vector2 } from '../types';

export class AiUnitController {
    constructor(
        private turnRate: number | null = null,
        private position: Vector2 | null = null,
        private direction: number | null = null,
        private sttTracked: boolean = false,
        private radarTracked: boolean = false
    ) {}

    setPosition(position: Vector2) {
        this.position = position;
    }

    setDirection(direction: number) {
        this.direction = direction;
    }

    setSttTracked(sttTracked: boolean) {
        this.sttTracked = sttTracked;
    }

    setRadarTracked(radarTracked: boolean) {
        this.radarTracked = radarTracked;
    }
    setTurnRate(turnRate: number) {
        this.turnRate = turnRate;
    }

    update() {
        console.log(this.turnRate);
    }
    
    destroy() {
        console.log(this.position, this.direction, this.sttTracked, this.radarTracked);
        // Clean up resources if needed
        console.log('AI Unit Controller destroyed');
    }
}