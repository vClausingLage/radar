import { LightRadar } from '../radar/systems/lightRadar';
import { Target } from '../entities/ship';

export class AiUnitController {
    private debugText?: Phaser.GameObjects.Text;
    private readonly fireCooldownMs = 2500;
    private nextShotAt = 0;

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

        const nearestTrackId = this.radar?.getTracks()?.[0]?.id ?? 'none';
        const mode = this.radar?.getMode() ?? 'na';
        this.debugText.setText(`AI ${this.id} R:${this.radarTracked ? '1' : '0'} T:${nearestTrackId} M:${mode}`);
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

        // Prefer the player (id 0). If not available, fall back to closest contact.
        const preferredTrack = tracks.find(track => track.id === 0) ?? tracks[0];

        if (radar) {
            if (preferredTrack) {
                // Put preferred target first so STT acquires the intended contact.
                const prioritizedTracks = [preferredTrack, ...tracks.filter(track => track.id !== preferredTrack.id)];
                radar.setTracks(prioritizedTracks);
                if (radar.getMode() !== 'stt') {
                    radar.setMode('stt');
                }
            } else if (radar.getMode() !== 'rws') {
                radar.setMode('rws');
            }
        }

        if (preferredTrack) {
            const desiredAngle = Phaser.Math.RadToDeg(
                Math.atan2(preferredTrack.pos.y - this.ship.y, preferredTrack.pos.x - this.ship.x)
            );
            const angleDelta = Phaser.Math.Angle.WrapDegrees(desiredAngle - this.ship.angle);
            const maxTurnPerFrame = this.turnRate * 100;
            const turnStep = Phaser.Math.Clamp(angleDelta, -maxTurnPerFrame, maxTurnPerFrame);
            this.ship.setAngle(this.ship.angle + turnStep);
        }

        const angleRad = Phaser.Math.DegToRad(this.ship.angle);
        this.ship.setVelocity(
            Math.cos(angleRad) * this.ship.getSpeed(),
            Math.sin(angleRad) * this.ship.getSpeed()
        );

        // Fire only when STT lock is active, with cooldown to avoid missile spam.
        const now = this.scene.time.now;
        const sttTargetId = radar?.alertTargetBeingTracked() ?? null;
        if (radar && sttTargetId !== null && now >= this.nextShotAt) {
            radar.shoot(this.ship.getDirection());
            this.nextShotAt = now + this.fireCooldownMs;
        }

        this.updateDebugText();
    }

    // Called once per second for strategic decisions
    updateStrategic(): void {
       
    }
}