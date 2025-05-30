import { getDistance } from '../../math';
import { RadarOptions } from '../../types';
import { Track } from '../data/track';
import { Asteroid } from '../entities/asteroid';
import { Target } from '../entities/target';

export class LightRadar {

    private SCAN_SPEED = 0.5 //!
    private STEP = 0 //!

    constructor(
        private radarOptions: RadarOptions,
        private mode: string = 'rws',
        radiatedPower: number = 0, //!
        gain: number = 0, //!
        apertureSize: number = 0, //!
        sensitivity: number = 0, //!
        noiseFiltering: number = 0, //!

        private tracks: Track[] = [],
        private targets: Target[] = [],
        private asteroids: Asteroid[] = [],
    ) {}

    setPosition({x, y}: {x: number, y: number}) {
        this.radarOptions.position.x = x
        this.radarOptions.position.y = y
    }

    getMode() {
        return this.mode
    }
    setMode(mode: string) {
        this.mode = mode
        switch (mode) {
            case 'rws':
                this.radarOptions.azimuth = 60
                 break
            case 'stt':
                this.radarOptions.azimuth = 2
                break
            case 'tws':
                this.radarOptions.azimuth = 30
                break
            case 'tws-auto':
                this.radarOptions.azimuth = 15
                break
            case 'emcon':
                this.radarOptions.isScanning = false
                break
   
            default:
                this.radarOptions.isScanning = false
                break
        }
    }
    
    getTracks() {
        return this.tracks
    }
    setTracks(tracks: any[]) {
        this.tracks = tracks
    }

    getTargets() {
        return this.targets
    }
    addTarget(t: Target) {
        this.targets = [...this.targets, t]
    }

    addAsteroid(a: Asteroid) {
        this.asteroids = [...this.asteroids, a]
    }

    start() {
        this.radarOptions.isScanning = true
    }

    update(angle: number, graphics?: Phaser.GameObjects.Graphics) {
        if (!this.radarOptions.isScanning) return

        graphics?.clear()

        if (this.mode === 'rws') {

            if (angle !== undefined) {
                const middleAngle: number = angle;
                const azimuthHalfAngle: number = this.radarOptions.azimuth;

                // Calculate the start and end angles of the scan sector
                const startAngle: number = middleAngle - azimuthHalfAngle;
                const endAngle: number = middleAngle + azimuthHalfAngle;

                if (graphics) {
                    graphics.lineStyle(1, 0x00ff00, 0.5);
                    const startX = this.radarOptions.position.x + this.radarOptions.range * Math.cos(Phaser.Math.DegToRad(startAngle - 90));
                    const startY = this.radarOptions.position.y + this.radarOptions.range * Math.sin(Phaser.Math.DegToRad(startAngle - 90));
                    graphics.lineBetween(this.radarOptions.position.x, this.radarOptions.position.y, startX, startY);

                    const endX = this.radarOptions.position.x + this.radarOptions.range * Math.cos(Phaser.Math.DegToRad(endAngle - 90));
                    const endY = this.radarOptions.position.y + this.radarOptions.range * Math.sin(Phaser.Math.DegToRad(endAngle - 90));
                    graphics.lineBetween(this.radarOptions.position.x, this.radarOptions.position.y, endX, endY);
                }

            }
        }

        if (this.mode === 'stt') {}
    }

}