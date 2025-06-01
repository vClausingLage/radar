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
        private clock: Phaser.Time.Clock,
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

    getAsteroids() {
        return this.asteroids
    }
    addAsteroid(a: Asteroid) {
        this.asteroids = [...this.asteroids, a]
    }

    start() {
        this.radarOptions.isScanning = true
    }

    update(delta: number, angle: number, graphics?: Phaser.GameObjects.Graphics) {
        if (!this.radarOptions.isScanning) return

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


                    const circles = [...targetsInRange, ...asteroidsInRange].map(t => {
                        const r = t.size / 2;
                        return new Phaser.Geom.Circle(t.position.x, t.position.y, r);
                    });
                    
                    // clear tracks
                    this.tracks = []

                    for (const [index, t] of targetsInRange.entries()) {
                        // Create a line from radar position to target
                        const line = new Phaser.Geom.Line(
                            this.radarOptions.position.x,
                            this.radarOptions.position.y,
                            t.position.x,
                            t.position.y
                        );

                        // Check for collisions with all other circles except the current target
                        const otherCircles = circles.filter(circle => 
                            circle.x !== t.position.x || circle.y !== t.position.y
                        );

                        // Check if line intersects with any other circle
                        const hasCollision = otherCircles.some(circle => 
                            Phaser.Geom.Intersects.LineToCircle(line, circle)
                        );

                        // Calculate distance
                        const dx = t.position.x - this.radarOptions.position.x;
                        const dy = t.position.y - this.radarOptions.position.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);

                        // Only draw and process target if there's no collision
                        if (!hasCollision) {

                            this.tracks = [...this.tracks, {
                                id: index,
                                pos: t.position,
                                dist: distance,
                                dir: t.direction,
                                speed: t.speed,
                                age: 0,
                                lastUpdate: 0,
                                confidence: 0,
                            }]

                            if (graphics) {
                                // Draw green rectangle at target position on separate graphics object
                                const rectGraphics = graphics.scene?.add.graphics();
                                if (rectGraphics) {
                                    rectGraphics.fillStyle(0x00ff00, 0.7);
                                    rectGraphics.fillRect(t.position.x - 5, t.position.y - 5, 10, 10);
                                    graphics.scene?.tweens.add({
                                        targets: rectGraphics,
                                        alpha: 0,
                                        duration: 3000,
                                        onComplete: () => rectGraphics.destroy()
                                    });
                                }
                                
                                // Display distance as text with fade out
                                // distance is shown as 'nautical miles' => calculated dist divided by 10
                                const distanceText = graphics.scene?.add.text(t.position.x + 10, t.position.y - 10, 
                                    (distance / 10).toFixed(0), 
                                    { fontSize: '12px', color: '#00ff00' }
                                );
                                if (distanceText) {
                                    graphics.scene?.tweens.add({
                                        targets: distanceText,
                                        alpha: 0,
                                        duration: 3000,
                                        onComplete: () => distanceText.destroy()
                                    });
                                }
                                
                                // Draw short line in direction of target with fade out
                                const lineLength = 20;
                                const angle = Math.atan2(t.direction.y, t.direction.x);
                                const endX = t.position.x + lineLength * Math.cos(angle);
                                const endY = t.position.y + lineLength * Math.sin(angle);
                                
                                graphics.lineStyle(2, 0x00ff00, 1);
                                graphics.lineBetween(t.position.x, t.position.y, endX, endY);
                                
                                // Create a separate graphics object for the line to fade it
                                const lineGraphics = graphics.scene?.add.graphics();
                                if (lineGraphics) {
                                    lineGraphics.lineStyle(2, 0x00ff00, 1);
                                    lineGraphics.lineBetween(t.position.x, t.position.y, endX, endY);
                                    graphics.scene?.tweens.add({
                                        targets: lineGraphics,
                                        alpha: 0,
                                        duration: 3000,
                                        onComplete: () => lineGraphics.destroy()
                                    });
                                }
                            }
                        }
                    }

                    // sort tracks by distance
                    this.tracks.sort((a, b) => a.dist - b.dist);

                    console.log('Targets in range:', this.tracks);

                    this.lastScanTime = 0;
                }

            }
        }

        if (this.mode === 'stt') {
            if (this.tracks.length <= 0) {
                console.error('No tracks found')
                this.mode = 'rws'
                return
            }

            // Get the nearest track
            const nearestTrack = this.tracks[0];
            this.tracks = [nearestTrack];

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
            }

            // Draw red line to track every 500ms
            if (graphics && this.clock.now - nearestTrack.lastUpdate >= 500) {

                // Draw new red line to track
                graphics.lineStyle(2, 0xff0000, 1);
                graphics.lineBetween(
                    this.radarOptions.position.x,
                    this.radarOptions.position.y,
                    nearestTrack.pos.x,
                    nearestTrack.pos.y
                );

                // Update last update time
                nearestTrack.lastUpdate = this.clock.now;
            }
        }
    }

}