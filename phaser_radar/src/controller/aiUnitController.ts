import { Vector2 } from '../types';
import { Math as MathUtils } from '../math';
import { LightRadar } from '../radar/systems/lightRadar';

export class AiUnitController {
    private sttTracked: boolean = false;
    private radarTracked: boolean = false;

    constructor(
        private turnRate: number | null = null,
        private position: Vector2 | null = null,
        private direction: number | null = null,
        private targetId: number | null = null,
        private playerRadar: LightRadar | null = null
    ) {
        this.setupRadarListeners();
    }

    private setupRadarListeners(): void {
        if (!this.playerRadar || !this.targetId) return;

        // Listen for STT tracking
        this.playerRadar.events.on('stt-track', (trackedId: number | null) => {
            if (trackedId === this.targetId) {
                this.sttTracked = true;
                console.log(`Target ${this.targetId}: STT LOCK DETECTED!`);
            } else {
                if (this.sttTracked) {
                    console.log(`Target ${this.targetId}: STT lock lost`);
                }
                this.sttTracked = false;
            }
        });

        // Listen for general radar tracking
        this.playerRadar.events.on('radar-track', (trackedIds: number[]) => {
            if (trackedIds.includes(this.targetId!)) {
                this.radarTracked = true;
                // console.log(`Target ${this.targetId}: Radar tracking detected`);
            } else {
                this.radarTracked = false;
            }
        });
    }

    setPosition(position: Vector2):void {
        this.position = position;
    }

    setDirection(direction: number): void {
        this.direction = direction;
    }

    setTurnRate(turnRate: number): void {
        this.turnRate = turnRate;
    }

    update(): void {

        if (this.sttTracked && this.playerRadar) {
            const playerPosition = this.playerRadar.getPosition();
            const playerAngle = Math.atan2(
                this.position!.y - playerPosition.y,
                this.position!.x - playerPosition.x
            ) * (180 / Math.PI);
            
            const aspect = MathUtils.getRelativeAngle(playerAngle, this.direction!);
            console.log(`Target ${this.targetId} STT tracked - Aspect: ${aspect}`);
        }

    }
    
    destroy(): void {
        // Clean up event listeners
        if (this.playerRadar) {
            this.playerRadar.events.off('stt-track');
            this.playerRadar.events.off('radar-track');
        }
        console.log(this.position, this.direction, this.sttTracked, this.radarTracked);
        console.log('AI Unit Controller destroyed');
    }
}