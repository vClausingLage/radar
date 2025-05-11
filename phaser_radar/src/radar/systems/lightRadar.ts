import { RadarOptions } from '../../types';
import { Track } from '../data/track';
import { Asteroid } from '../entities/asteroid';
import { Target } from '../entities/target';

export class LightRadar {
    constructor(
        private radarOptions: RadarOptions,
        private mode: string = 'stt',
        private tracks: Track[] = [],
        private targets: Target[] = [],
        private asteroids: Asteroid[] = [],
    ) {}

    setPosition({x, y}: {x: number, y: number}) {
        this.radarOptions.pos.x = x
        this.radarOptions.pos.y = y
    }

    getMode() {
        return this.mode
    }
    setMode(mode: string) {
        this.mode = mode
        switch (mode) {
            case 'rws':
                this.radarOptions.azimuth = 120
                 break
            case 'stt':
                this.radarOptions.azimuth = 5
                break
            case 'tws':
                this.radarOptions.azimuth = 60
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

    update() {
        if (!this.radarOptions.isScanning) return

        if (this.mode === 'rws') {
        }
    }

}