import { LightRadar } from '../radar/systems/lightRadar';
import { Target } from '../entities/ship';

export class AiUnitController {
    constructor(
        private scene: Phaser.Scene,
        private ship: Target,
        private turnRate: number = 0,
        private sttTracked: boolean = false,
        private radarTracked: boolean = false,
        private radar: LightRadar | null = null,
        private id: number | null = null,

    ) {
        this.setupRadarListeners();
    }

    public getTurnRate(): number {
        return this.turnRate;
    }
    public setTurnRate(turnRate: number): void {
        this.turnRate = turnRate;
    }

    private setupRadarListeners(): void {
        if (!this.radar || !this.id) return;

        // Listen for STT tracking
        this.radar?.events.on('stt-track', (trackedId: number | null) => {
            if (trackedId === this.id) {
                this.sttTracked = true;
                console.log(`Target ${this.id}: STT LOCK DETECTED!`);
            } else {
                this.sttTracked = false;
            }
        });

        // Listen for general radar tracking
        this.radar?.events.on('radar-track', (trackedIds: number[]) => {
            if (trackedIds.includes(this.id!)) {
                this.radarTracked = true;
            } else {
                this.radarTracked = false;
            }
        });
    }

    // Called every frame for continuous updates
    updateContinuous(): void {
        // Don't update if ship is destroyed or inactive
        if (!this.ship.active || !this.ship.body) return;
        
        const angleRad = Phaser.Math.DegToRad(this.ship.angle);
        this.ship.setVelocity(
            Math.cos(angleRad) * this.ship.getSpeed(),
            Math.sin(angleRad) * this.ship.getSpeed()
        );
        // this.ship.setAngularVelocity(speed);
        // const angleRad = Phaser.Math.DegToRad(this.ship.angle);
        // this.ship.setVelocity(
        // Math.cos(angleRad) * speed,
        // Math.sin(angleRad) * speed
        // );
        // if (!this.isTurning || !this.targetAngle || !this.turnRate) {
        //     return this.direction!;
        // }

        // // Calculate turn amount based on delta time
        // const turnAmount = this.turnRate * (delta / 1000);
        // const angleDiff = MathUtils.getRelativeAngle(this.targetAngle, this.direction!).angle;

        // if (Math.abs(angleDiff) <= turnAmount) {
        //     // Reached target angle
        //     this.direction = this.targetAngle;
        //     this.isTurning = false;
        // } else {
        //     // Turn towards target angle
        //     this.direction! += Math.sign(angleDiff) * turnAmount;
        //     this.direction = MathUtils.normalizeAngle(this.direction!);
        // }

        // return this.direction!;
    }

    // Called once per second for strategic decisions
    updateStrategic(): void {
        // if (!this.aiRadar || !this.playerRadar || !this.position || !this.direction) return;

        // const playerPosition = this.playerRadar.getPosition();

        // // Calculate aspect angle (player's perspective looking at AI)
        // const playerToAiAngle = Math.atan2(
        //     this.position.y - playerPosition.y,
        //     this.position.x - playerPosition.x
        // ) * (180 / Math.PI);
        
        // const aspect = MathUtils.getRelativeAngle(playerToAiAngle, this.direction);

        // // If being STT tracked, perform defensive maneuvers
        // if (this.sttTracked) {
        //     console.log(`Target ${this.targetId} STT tracked - Aspect: ${aspect.angle.toFixed(1)}° (${aspect.aspect}) - DEFENSIVE MANEUVER`);
        //     this.performDefensiveManeuver();
        // }

        // // If AI detects player on radar, try to lock and shoot
        // if (this.radarTracked) {
        //     this.engageTarget();
        // }
    }

    // private performDefensiveManeuver(): void {
    //     // Target flanking positions: ±90° from current heading
    //     const leftFlank = MathUtils.normalizeAngle(this.direction! + 90);
    //     const rightFlank = MathUtils.normalizeAngle(this.direction! - 90);

    //     // Calculate which flank is faster to reach
    //     const leftDiff = Math.abs(MathUtils.getRelativeAngle(leftFlank, this.direction!).angle);
    //     const rightDiff = Math.abs(MathUtils.getRelativeAngle(rightFlank, this.direction!).angle);

    //     // Choose the closer flank
    //     this.targetAngle = leftDiff < rightDiff ? leftFlank : rightFlank;
    //     this.isTurning = true;

    //     console.log(`Target ${this.targetId} turning to flank position: ${this.targetAngle.toFixed(1)}°`);
    // }

    // private engageTarget(): void {
    //     if (!this.aiRadar || !this.playerRadar) return;

    //     const playerPosition = this.playerRadar.getPosition();
        
    //     // Check if AI radar can see the player
    //     const scanArea = this.aiRadar.getScanArea(this.direction!);
    //     if (!scanArea) return;

    //     // Calculate if player is in AI's radar cone
    //     const dx = playerPosition.x - this.position!.x;
    //     const dy = playerPosition.y - this.position!.y;
    //     const angleToPlayer = MathUtils.normalizeAngle(Math.atan2(dy, dx) * (180 / Math.PI));
        
    //     const { startAngle, endAngle } = scanArea;
    //     const normalizedStart = MathUtils.normalizeAngle(startAngle);
    //     const normalizedEnd = MathUtils.normalizeAngle(endAngle);

    //     let isInCone = false;
    //     if (normalizedStart > normalizedEnd) {
    //         isInCone = angleToPlayer >= normalizedStart || angleToPlayer <= normalizedEnd;
    //     } else {
    //         isInCone = angleToPlayer >= normalizedStart && angleToPlayer <= normalizedEnd;
    //     }

    //     if (isInCone) {
    //         // Try to get STT lock
    //         const tracks = this.aiRadar.getTracks();
    //         if (tracks.length > 0 && this.aiRadar.getMode() !== 'stt') {
    //             console.log(`Target ${this.targetId} acquiring STT lock on player`);
    //             this.aiRadar.setMode('stt');
    //         }

    //         // If we have STT lock, shoot
    //         if (this.aiRadar.getMode() === 'stt') {
    //             const loadout = this.aiRadar.getLoadout();
    //             const activeWeapon = Object.keys(loadout).find(key => 
    //                 loadout[key as keyof typeof loadout]?.active
    //             );
                
    //             if (activeWeapon && loadout[activeWeapon as keyof typeof loadout]?.load > 0) {
    //                 console.log(`Target ${this.targetId} firing at player!`);
    //                 this.aiRadar.shoot(this.direction!);
    //             }
    //         }
    //     }
    // }
    
    // destroy(): void {
    //     // Clean up event listeners
    //     if (this.playerRadar) {
    //         this.playerRadar.events.off('stt-track');
    //         this.playerRadar.events.off('radar-track');
    //     }
    //     console.log('AI Unit Controller destroyed');
    // }
}