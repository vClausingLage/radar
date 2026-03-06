import { LightRadar } from '../radar/systems/lightRadar';
import { Target } from '../entities/ship';

enum AIState {
    PATROL,      // No contacts, wandering
    INVESTIGATE, // Has radar track, moving toward it
    ENGAGE,      // Has STT lock, actively fighting
    EVADE        // Being tracked by enemy radar/STT
}

export class AiUnitController {
    private state: AIState = AIState.PATROL;
    private patrolTarget: { x: number; y: number } | null = null;
    private debugText?: Phaser.GameObjects.Text;
    private readonly fireCooldownMs = 2500;
    private readonly sttLockDelayMs = 2500; // 2.5 seconds from lock to first shot
    private nextShotAt = 0;
    private sttLockAcquiredAt: number | null = null;
    private currentSttTargetId: number | null = null;

    constructor(
        // @ts-ignore
        private scene: Phaser.Scene,
        private ship: Target,
        private turnRate: number = 0,
        // @ts-ignore
        private sttTracked: boolean = false,
        // @ts-ignore
        private radarTracked: boolean = false,
        private radar: LightRadar | null = null,
        private id: number | null = null,

    ) {
        this.setupRadarListeners();
        this.createDebugText();
    }

    public getTurnRate(): number {
        return this.turnRate;
    }
    public setTurnRate(turnRate: number): void {
        this.turnRate = turnRate;
    }

    private setupRadarListeners(): void {
        if (!this.radar || this.id === null) return;

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
            this.radarTracked = trackedIds.length > 0;
        });
    }

    private createDebugText(): void {
        const isDev = process.env.NODE_ENV === 'development';
        if (!isDev) return;

        this.debugText = this.scene.add.text(this.ship.x, this.ship.y - 24, '', {
            fontSize: '11px',
            color: '#00ff88',
            backgroundColor: '#001a11'
        }).setOrigin(0.5, 1);
    }

    private updateDebugText(): void {
        if (!this.debugText) return;

        const stateNames = ['PATROL', 'INVESTIGATE', 'ENGAGE', 'EVADE'];
        const nearestTrackId = this.radar?.getTracks()?.[0]?.id ?? 'none';
        const lockStatus = this.sttLockAcquiredAt !== null 
            ? `L:${Math.floor((this.scene.time.now - this.sttLockAcquiredAt) / 1000)}s`
            : 'L:--';
        this.debugText.setText(
            `AI ${this.id} [${stateNames[this.state]}] T:${nearestTrackId} ${lockStatus}`
        );
        this.debugText.setPosition(this.ship.x, this.ship.y - 24);
    }

    // Called every frame for continuous updates
    updateContinuous(): void {
        // Don't update if ship is destroyed or inactive
        if (!this.ship.active || !this.ship.body) {
            this.debugText?.destroy();
            this.debugText = undefined;
            return;
        }

        const radar = this.radar;
        const tracks = radar?.getTracks() ?? [];
        const preferredTrack = tracks.find((t: any) => t.id === 0) ?? tracks[0];
        const sttTargetId = radar?.alertTargetBeingTracked() ?? null;

        // Track STT lock duration for fire delay
        this.updateSttLockTracking(sttTargetId);

        // State transitions
        this.updateState(preferredTrack, sttTargetId);

        // Execute current state behavior
        switch (this.state) {
            case AIState.EVADE:
                this.executeEvade(preferredTrack);
                break;
            case AIState.ENGAGE:
                this.executeEngage(preferredTrack, sttTargetId);
                break;
            case AIState.INVESTIGATE:
                this.executeInvestigate(preferredTrack);
                break;
            case AIState.PATROL:
                this.executePatrol();
                break;
        }

        this.applyMovement();
        this.updateDebugText();
    }

    private updateSttLockTracking(sttTargetId: number | null): void {
        if (sttTargetId !== null) {
            // Lock is active
            if (this.currentSttTargetId !== sttTargetId) {
                // New lock acquired
                this.sttLockAcquiredAt = this.scene.time.now;
                this.currentSttTargetId = sttTargetId;
                console.log(`AI ${this.id}: STT lock acquired on target ${sttTargetId}`);
            }
        } else {
            // Lock lost
            if (this.currentSttTargetId !== null) {
                console.log(`AI ${this.id}: STT lock lost`);
            }
            this.sttLockAcquiredAt = null;
            this.currentSttTargetId = null;
        }
    }

    private updateState(preferredTrack: any, _sttTargetId: number | null): void {
        // Priority: Evade > Engage > Investigate > Patrol
        if (this.sttTracked) {
            // Enemy has STT lock on us!
            if (this.state !== AIState.EVADE) {
                console.log(`AI ${this.id}: EVADING! Enemy lock detected!`);
                this.state = AIState.EVADE;
            }
        } else if (preferredTrack && this.radar?.getMode() === 'stt' && this.currentSttTargetId !== null) {
            // We have STT lock
            if (this.state !== AIState.ENGAGE) {
                console.log(`AI ${this.id}: ENGAGING target ${this.currentSttTargetId}!`);
                this.state = AIState.ENGAGE;
            }
        } else if (preferredTrack) {
            // We have radar contact but no lock
            if (this.state !== AIState.INVESTIGATE) {
                console.log(`AI ${this.id}: INVESTIGATING contact ${preferredTrack.id}`);
                this.state = AIState.INVESTIGATE;
            }
        } else {
            // No contacts
            if (this.state !== AIState.PATROL) {
                console.log(`AI ${this.id}: Returning to PATROL`);
                this.state = AIState.PATROL;
            }
        }
    }

    private executePatrol(): void {
        // Wander randomly
        if (!this.patrolTarget || this.isNearPosition(this.patrolTarget, 100)) {
            this.patrolTarget = {
                x: Phaser.Math.Between(1500, 2500),
                y: Phaser.Math.Between(1500, 2500)
            };
        }
        this.turnToward(this.patrolTarget);
        
        // Keep radar in RWS mode when patrolling
        if (this.radar?.getMode() !== 'rws') {
            this.radar?.setMode('rws');
        }
    }

    private executeInvestigate(track: any): void {
        if (!track) return;
        
        // Switch radar to STT mode to get lock
        if (this.radar && this.radar.getMode() !== 'stt') {
            const prioritizedTracks = [track, ...this.radar.getTracks().filter((t: any) => t.id !== track.id)];
            this.radar.setTracks(prioritizedTracks);
            this.radar.setMode('stt');
        }
        
        // Move toward contact
        this.turnToward(track.pos);
    }

    private executeEngage(track: any, sttTargetId: number | null): void {
        if (!track) return;
        
        // Point at target
        this.turnToward(track.pos);
        
        // Fire only after lock has been held for sttLockDelayMs
        const now = this.scene.time.now;
        const lockHeldTime = this.sttLockAcquiredAt !== null ? now - this.sttLockAcquiredAt : 0;
        
        if (this.radar && sttTargetId !== null && 
            lockHeldTime >= this.sttLockDelayMs && 
            now >= this.nextShotAt) {
            this.radar.shoot(this.ship.getDirection());
            this.nextShotAt = now + this.fireCooldownMs;
            console.log(`AI ${this.id}: FIRING! (lock held for ${lockHeldTime}ms)`);
        }
    }

    private executeEvade(track: any): void {
        // Evasive maneuvers: turn perpendicular to threat + jink
        if (track) {
            const threatAngle = Phaser.Math.RadToDeg(
                Math.atan2(track.pos.y - this.ship.y, track.pos.x - this.ship.x)
            );
            // Turn 90 degrees away + random jink
            const evadeAngle = threatAngle + 90 + Phaser.Math.Between(-30, 30);
            this.turnToward({ 
                x: this.ship.x + Math.cos(Phaser.Math.DegToRad(evadeAngle)) * 1000,
                y: this.ship.y + Math.sin(Phaser.Math.DegToRad(evadeAngle)) * 1000
            });
        }
        
        // Switch radar to RWS while evading (break our own lock)
        if (this.radar?.getMode() === 'stt') {
            this.radar.setMode('rws');
        }
    }

    private turnToward(position: { x: number; y: number }): void {
        const desiredAngle = Phaser.Math.RadToDeg(
            Math.atan2(position.y - this.ship.y, position.x - this.ship.x)
        );
        const angleDelta = Phaser.Math.Angle.WrapDegrees(desiredAngle - this.ship.angle);
        const turnStep = Phaser.Math.Clamp(angleDelta, -this.turnRate, this.turnRate);
        this.ship.setAngle(this.ship.angle + turnStep);
    }

    private applyMovement(): void {
        const angleRad = Phaser.Math.DegToRad(this.ship.angle);
        this.ship.setVelocity(
            Math.cos(angleRad) * this.ship.getSpeed(),
            Math.sin(angleRad) * this.ship.getSpeed()
        );
    }

    private isNearPosition(pos: { x: number; y: number }, threshold: number): boolean {
        const dx = pos.x - this.ship.x;
        const dy = pos.y - this.ship.y;
        return Math.sqrt(dx * dx + dy * dy) < threshold;
    }

    // Called once per second for strategic decisions
    updateStrategic(): void {
       
    }
}