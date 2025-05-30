import { RadarOptions } from '../../types';
import { Track } from '../data/track';
import { Asteroid } from '../entities/asteroid';
import { Target } from '../entities/target';

export class LightRadar {

    private SCAN_SPEED = .02 //!
    private lastScanTime = 0

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

    update(delta: number, angle: number, graphics?: Phaser.GameObjects.Graphics) {
        if (!this.radarOptions.isScanning) return

        graphics?.clear()

        if (this.mode === 'rws') {

            if (angle !== undefined) {
                const middleAngle: number = angle;

                // Calculate the start and end angles of the scan sector
                const startAngle: number = middleAngle - this.radarOptions.azimuth;
                const endAngle: number = middleAngle + this.radarOptions.azimuth;

                if (graphics) {
                    graphics.lineStyle(1, 0x00ff00, 0.5);
                    const startX = this.radarOptions.position.x + this.radarOptions.range * Math.cos(Phaser.Math.DegToRad(startAngle - 90));
                    const startY = this.radarOptions.position.y + this.radarOptions.range * Math.sin(Phaser.Math.DegToRad(startAngle - 90));
                    graphics.lineBetween(this.radarOptions.position.x, this.radarOptions.position.y, startX, startY);

                    const endX = this.radarOptions.position.x + this.radarOptions.range * Math.cos(Phaser.Math.DegToRad(endAngle - 90));
                    const endY = this.radarOptions.position.y + this.radarOptions.range * Math.sin(Phaser.Math.DegToRad(endAngle - 90));
                    graphics.lineBetween(this.radarOptions.position.x, this.radarOptions.position.y, endX, endY);
                }

                const scanDuration = this.radarOptions.range * this.SCAN_SPEED * (endAngle - startAngle);
                

                this.lastScanTime += delta;
                if (this.lastScanTime >= scanDuration) {
                    
                    const targetsInRange = this.targets.filter(target => {
                        const dx = target.position.x - this.radarOptions.position.x;
                        const dy = target.position.y - this.radarOptions.position.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const angleToTarget = Phaser.Math.RadToDeg(Math.atan2(dy, dx)) + 90; // Adjust for radar orientation

                        return distance <= this.radarOptions.range &&
                            angleToTarget >= startAngle && angleToTarget <= endAngle;
                    })

                    const asteroidsInRange = this.asteroids.filter(asteroid => {
                        const dx = asteroid.position.x - this.radarOptions.position.x;
                        const dy = asteroid.position.y - this.radarOptions.position.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const angleToAsteroid = Phaser.Math.RadToDeg(Math.atan2(dy, dx)) + 90; // Adjust for radar orientation

                        return distance <= this.radarOptions.range &&
                            angleToAsteroid >= startAngle && angleToAsteroid <= endAngle;
                    })

                    // create 4 points for every t and a
                    // ray cast from them to ship
                    // check collision
                    // if all four arrive its a track

                    for (const t of targetsInRange) {
                        const r = t.size / 2
                        const points = [
                            { x: t.position.x + r, y: t.position.y },
                            { x: t.position.x - r, y: t.position.y },
                            { x: t.position.x, y: t.position.y + r },
                            { x: t.position.x, y: t.position.y - r }
                        ];

                        for (const p of points) {
                            const ray = new Phaser.Geom.Line(this.radarOptions.position.x, this.radarOptions.position.y, p.x, p.y);
                            
                            let rayBlocked = false;
                            for (const obstacle of [...this.targets, ...this.asteroids]) {
                                if (obstacle === t) continue; // Skip the target we're checking
                                
                                const obstacleRadius = obstacle.size / 2;
                                const obstacleCircle = new Phaser.Geom.Circle(obstacle.position.x, obstacle.position.y, obstacleRadius);
                                
                                if (Phaser.Geom.Intersects.LineToCircle(ray, obstacleCircle)) {
                                    rayBlocked = true;
                                    break;
                                }
                            }

                            if (!rayBlocked) {
                                // Ray reaches this point of the target without obstruction
                                // Add logic here for successful detection
                            }
                        }
                    }


                    console.log('Targets in range:', targetsInRange);

                    this.lastScanTime = 0;
                }

            }
        }

        if (this.mode === 'stt') {}
    }

}