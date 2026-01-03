import { Vector2 } from '../types';

export class AiUnitController {
    constructor(
        private turnRate: number | null = null,
        private position: Vector2 | null = null,
        private direction: number | null = null,
        private sttTracked: boolean = false,
        private radarTracked: boolean = false
    ) {}

    setPosition(position: Vector2):void {
        this.position = position;
    }

    setDirection(direction: number): void {
        this.direction = direction;
    }

    setSttTracked(sttTracked: boolean): void {
        this.sttTracked = sttTracked;
    }

    setRadarTracked(radarTracked: boolean): void {
        this.radarTracked = radarTracked;
    }
    setTurnRate(turnRate: number): void {
        this.turnRate = turnRate;
    }

    update(): void {
        console.log(this.turnRate);
    }
    
    destroy(): void {
        console.log(this.position, this.direction, this.sttTracked, this.radarTracked);
        console.log('AI Unit Controller destroyed');
    }
}