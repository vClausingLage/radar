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
                this.radarOptions.azimuth = 60
                 break
            case 'stt':
                this.radarOptions.azimuth = 2
                break
            case 'tws':
                this.radarOptions.azimuth = 30
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

            this.STEP += this.SCAN_SPEED
            if (this.STEP === this.radarOptions.azimuth) {
                console.log('Radar scan complete')
                for (const t of this.targets) {
                    const dist = getDistance(this.radarOptions.pos, t.position)
                    if (dist <= this.radarOptions.range) {
                        this.tracks = [...this.tracks, {
                            pos: t.position,
                            dir: t.direction,
                            speed: t.speed,
                            dist: dist,
                            age: 0,
                            lastUpdate: 0
                        }]
                    }
                }
                // calculate target return
                // noise < return energy
                // radar cross section
                // 
                this.STEP = 0
            }
        }

        if (this.mode === 'stt') {}
    }

}