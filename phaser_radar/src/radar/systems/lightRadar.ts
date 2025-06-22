import { RadarOptions } from '../../types'
import { Track } from '../data/track'
import { Asteroid } from '../entities/asteroid'
import { Target } from '../entities/target'
import { Missile, SARHMissile, Missiles } from '../entities/missiles'
import { LightRadarRenderer } from '../renderer/lightRadarRenderer'

type Loadout = {
    [key in Missiles]: number
}

export class LightRadar {

    private lastScanTime = 0
    private missileUpdateDelta = 0
    private activeMissiles: Missile[] = []

    constructor(
        private radarOptions: RadarOptions,
        private renderer: LightRadarRenderer,
        private mode: string = 'rws',
        private loadout: Loadout,
        private tracks: Track[] = [],
        private sttTrack: Track | null = null,
        private targets: Target[] = [],
        private asteroids: Asteroid[] = [],
    ) {}

    getPosition() {
        return this.radarOptions.position
    }
    setPosition({x, y}: {x: number, y: number}) {
        this.radarOptions.position.x = x
        this.radarOptions.position.y = y
    }

    getRange() {
        return this.radarOptions.range
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
    stop() {
        this.radarOptions.isScanning = false
    }

    update(delta: number, angle: number, graphics: Phaser.GameObjects.Graphics): void {
        if (!this.radarOptions.isScanning) {
            // do nothing
        } else {
            if (this.mode === 'rws') {
                if (angle !== undefined) {
                    // calculations
                    this.lastScanTime += delta
                    const middleAngle: number = angle
                    const startAngle: number = middleAngle - this.radarOptions.azimuth
                    const endAngle: number = middleAngle + this.radarOptions.azimuth
                    const scanDuration = this.radarOptions.range * this.radarOptions.scanSpeed * (endAngle - startAngle)

                    this.renderer.renderScanAzimuth(graphics, this.radarOptions.position, this.radarOptions.range, startAngle, endAngle)

                    //! generalize these filter functions
                    if (this.lastScanTime >= scanDuration) {
                        const targetsInRange = this.targets.filter(target => {
                            const dx = target.position.x - this.radarOptions.position.x
                            const dy = target.position.y - this.radarOptions.position.y
                            const distance = Math.sqrt(dx * dx + dy * dy)
                            const angleToTarget = Phaser.Math.RadToDeg(Math.atan2(dy, dx)) + 90

                            return distance <= this.radarOptions.range &&
                                angleToTarget >= startAngle && angleToTarget <= endAngle
                        })
                        const asteroidsInRange = this.asteroids.filter(asteroid => {
                            const dx = asteroid.position.x - this.radarOptions.position.x
                            const dy = asteroid.position.y - this.radarOptions.position.y
                            const distance = Math.sqrt(dx * dx + dy * dy)
                            const angleToAsteroid = Phaser.Math.RadToDeg(Math.atan2(dy, dx)) + 90

                            return distance <= this.radarOptions.range &&
                                angleToAsteroid >= startAngle && angleToAsteroid <= endAngle
                        })


                        const circles = [...targetsInRange, ...asteroidsInRange].map(t => {
                            const r = t.size / 2
                            return new Phaser.Geom.Circle(t.position.x, t.position.y, r)
                        })

                        this.renderer.renderAsteroids(asteroidsInRange, graphics)
                        
                        // clear tracks
                        this.tracks = []
                        this.sttTrack = null

                        for (const [index, t] of targetsInRange.entries()) {
                            // Create a line from radar position to target
                            const line = new Phaser.Geom.Line(
                                this.radarOptions.position.x,
                                this.radarOptions.position.y,
                                t.position.x,
                                t.position.y
                            )

                            // Check for collisions with all other circles except the current target
                            const otherCircles = circles.filter(circle => 
                                circle.x !== t.position.x || circle.y !== t.position.y
                            )

                            // Check if line intersects with any other circle
                            const hasCollision = otherCircles.some(circle => 
                                Phaser.Geom.Intersects.LineToCircle(line, circle)
                            )

                            // Calculate distance
                            const dx = t.position.x - this.radarOptions.position.x
                            const dy = t.position.y - this.radarOptions.position.y
                            const distance = Math.sqrt(dx * dx + dy * dy)

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

                                this.renderer.renderRwsContacts(graphics, t, distance)
                            }
                        }

                        // sort tracks by distance
                        this.tracks.sort((a, b) => a.dist - b.dist)

                        console.log('Targets in range:', this.tracks)

                        this.lastScanTime = 0
                    }
                    // Handle active missiles movement in RWS mode
                    for (const missile of this.activeMissiles) {
                        // Move missile according to its direction and speed
                        missile.position.x += missile.direction.x * missile.speed * delta / 1000;
                        missile.position.y += missile.direction.y * missile.speed * delta / 1000;
                        
                        // Render missiles during RWS scan
                        this.renderer.renderMissiles([missile], graphics);
                    }
                }
            }

            if (this.mode === 'stt') {
                const middleAngle: number = angle
                const startAngle: number = middleAngle - this.radarOptions.azimuth
                const endAngle: number = middleAngle + this.radarOptions.azimuth
                this.renderer.renderScanAzimuth(graphics, this.radarOptions.position, this.radarOptions.range, startAngle, endAngle)
                if (this.tracks.length <= 0) {
                    console.error('No tracks found')
                    this.sttTrack = null
                    this.mode = 'rws'
                    return
                }

                if (!this.sttTrack) {
                    this.sttTrack = this.tracks[0]
                    //! change the direction opposite to radar direction
                    //! change it over time
                }

                const dx = this.sttTrack.pos.x - this.radarOptions.position.x
                const dy = this.sttTrack.pos.y - this.radarOptions.position.y
                const distanceToTrack = Math.sqrt(dx * dx + dy * dy)
                const angleToTrack = Phaser.Math.RadToDeg(Math.atan2(dy, dx)) + 90

                if (distanceToTrack > this.radarOptions.range || angleToTrack < startAngle || angleToTrack > endAngle) {
                    this.sttTrack = null
                    this.setMode('rws')
                    return
                }

                this.lastScanTime += delta
                if (this.lastScanTime >= 1000) {
                    this.renderer.renderStt(this.sttTrack, graphics)
                    this.lastScanTime = 0
                }
            }
        }
        // update missiles
        this.updateMissiles(delta)

        this.renderer.renderMissiles(this.activeMissiles, graphics)
    }

    getScanArea(angle: number): { startAngle: number, endAngle: number } | null {
        if (!angle) return null

        const middleAngle: number = angle

        const startAngle: number = middleAngle - this.radarOptions.azimuth
        const endAngle: number = middleAngle + this.radarOptions.azimuth

        return {
            startAngle: startAngle,
            endAngle: endAngle
        }
    }

    shootSARH(): void {
        if (this.mode !== 'stt' || !this.sttTrack) {
            console.error('Cannot shoot SARH, not in STT mode or no track selected')
            return
        }
        this.loadout['AIM-177'] = (this.loadout['AIM-177'] || 0) - 1
        if (this.loadout['AIM-177'] < 0) {
            console.error('No AIM-177 missiles left in loadout')
            return
        }

        // Simulate shooting a SARH missile at the selected track
        console.log(`Shooting SARH missile at target at position: ${this.sttTrack.pos.x}, ${this.sttTrack.pos.y}`)
        
        const missileStartX = this.radarOptions.position.x
        const missileStartY = this.radarOptions.position.y
        const missileTargetX = this.sttTrack.pos.x
        const missileTargetY = this.sttTrack.pos.y

        // Calculate direction vector and distance to target
        const dxTotal = missileTargetX - missileStartX
        const dyTotal = missileTargetY - missileStartY
        const distance = Math.sqrt(dxTotal * dxTotal + dyTotal * dyTotal)

        if (distance === 0) {
            console.log('Target is at current location, missile not fired.')
            return 
        }

        const missile: SARHMissile = {
            type: 'AIM-177',
            burnTime: 14,
            speed: 17.0,
            turnSpeed: .7,
            guidance: 'semi-active',
            warhead: 'high-explosive',
            position: {
                x: missileStartX,
                y: missileStartY
            },
            direction: {
                x: dxTotal / distance,
                y: dyTotal / distance
            }
        }

        this.activeMissiles.push(missile)
    }

    updateMissiles(delta: number): void {
        // Filter out missiles that have gone beyond their burn time
        this.missileUpdateDelta += delta

        if (this.missileUpdateDelta >= 1000) {

            for (const m of this.activeMissiles) {
                console.log(`Missile ${m.type} at position (${m.position.x}, ${m.position.y}) with burn time ${m.burnTime}`);
            }

            this.activeMissiles = this.activeMissiles.filter(missile => {
                if (missile.burnTime > 0) {
                    missile.burnTime -= 1;
                    return true;
                }
                return false;
            });
            this.missileUpdateDelta = 0
        }
        // Update missile positions
        for (const m of this.activeMissiles) {
            // Calculate current direction as a vector
            const currentDirX = m.direction.x;
            const currentDirY = m.direction.y;
            
            // Calculate target direction (either to STT target or continuing straight)
            let targetDirX = currentDirX;
            let targetDirY = currentDirY;
            
            // For SARH missiles in STT mode, calculate the target direction
            if (this.mode === 'stt' && this.sttTrack && 
                (m as SARHMissile).guidance === 'semi-active') {
                const dxToTarget = this.sttTrack.pos.x - m.position.x;
                const dyToTarget = this.sttTrack.pos.y - m.position.y;
                const distToTarget = Math.sqrt(dxToTarget * dxToTarget + dyToTarget * dyToTarget);
                
                if (distToTarget > 0) {
                    targetDirX = dxToTarget / distToTarget;
                    targetDirY = dyToTarget / distToTarget;
                }
            }
            
            // Interpolate direction based on turn speed (0 to 1)
            const turnFactor = Math.min(m.turnSpeed * delta / 1000, 1);
            m.direction.x = currentDirX + (targetDirX - currentDirX) * turnFactor;
            m.direction.y = currentDirY + (targetDirY - currentDirY) * turnFactor;
            
            // Normalize the direction vector
            const dirMag = Math.sqrt(m.direction.x * m.direction.x + m.direction.y * m.direction.y);
            if (dirMag > 0) {
                m.direction.x /= dirMag;
                m.direction.y /= dirMag;
            }
            
            // Move missile according to its direction and speed
            m.position.x += m.direction.x * m.speed * delta / 1000;
            m.position.y += m.direction.y * m.speed * delta / 1000;

            // Check for missile collisions with asteroids
            this.checkCollisionWithAsteroid(m);

            // Check for missile collisions with targets
            this.checkCollisionWithTarget(m);
        }
    }

    checkCollisionWithAsteroid(m: Missile) {
        for (const asteroid of this.asteroids) {
            const dxAsteroid = m.position.x - asteroid.position.x;
            const dyAsteroid = m.position.y - asteroid.position.y;
            const distanceToAsteroid = Math.sqrt(dxAsteroid * dxAsteroid + dyAsteroid * dyAsteroid);
            
            // Define proximity threshold based on asteroid size
            const asteroidProximityThreshold = 3 + (asteroid.size / 2);
            
            if (distanceToAsteroid <= asteroidProximityThreshold) {
                console.log(`Missile hit asteroid at position: ${asteroid.position.x}, ${asteroid.position.y}`);
                
                // Remove the missile
                this.activeMissiles = this.activeMissiles.filter(missile => missile !== m);
                
                // Stop checking other objects since this missile is already destroyed
                break;
            }
        }
    }

    checkCollisionWithTarget(m: Missile) {
        for (const target of this.targets) {
            const dxTarget = m.position.x - target.position.x;
            const dyTarget = m.position.y - target.position.y;
            const distanceToTarget = Math.sqrt(dxTarget * dxTarget + dyTarget * dyTarget);
            
            // Define proximity detection radius (missile + target size for more realistic collision)
            const proximityThreshold = 3 + (target.size / 2);
            
            if (distanceToTarget <= proximityThreshold) {
                console.log(`Missile hit target at position: ${target.position.x}, ${target.position.y}`);

                // Create an explosion sprite at the target's position
                if (this.renderer.scene) {
                    const explosion = this.renderer.scene.add.sprite(
                        target.position.x,
                        target.position.y,
                        'explosion'
                    );

                    explosion.setScale(.05);
                    
                    explosion.alpha = 1;
                    this.renderer.scene.tweens.add({
                        targets: explosion,
                        alpha: 0,
                        duration: 1900,
                        ease: 'Power1',
                        onComplete: () => {
                            explosion.destroy();
                        }
                    });
                }
                
                // Remove the missile and target
                this.activeMissiles = this.activeMissiles.filter(missile => missile !== m);
                this.targets = this.targets.filter(t => t !== target);
                
                // Also remove corresponding track if it exists
                if (this.sttTrack && this.sttTrack.pos.x === target.position.x && this.sttTrack.pos.y === target.position.y) {
                    this.sttTrack = null;
                    if (this.mode === 'stt') {
                        this.setMode('rws');
                    }
                }
                
                this.tracks = this.tracks.filter(track => 
                    !(track.pos.x === target.position.x && track.pos.y === target.position.y)
                );
                
                // Stop checking other targets since this missile is already destroyed
                break;
            }
        }
    }

}