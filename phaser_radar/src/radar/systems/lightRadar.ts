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

    private SCAN_SPEED = .02
    private MISSILE_SPEED = 30
    private SARH_MISSILE_RANGE = 300
    private lastScanTime = 0
    private activeMissiles: Missile[] = []

    constructor(
        private radarOptions: RadarOptions,
        private mode: string = 'rws',
        private loadout: Loadout,
        private missile: Phaser.GameObjects.Image,
        private tracks: Track[] = [],
        private sttTrack: Track | null = null,
        private targets: Target[] = [],
        private asteroids: Asteroid[] = [],
        private renderer: LightRadarRenderer = new LightRadarRenderer(missile)
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

    update(delta: number, angle: number, graphics: Phaser.GameObjects.Graphics): void {
        if (!this.radarOptions.isScanning) {
            // Still update missiles even if radar is not scanning
        } else {
            if (this.mode === 'rws') {
                if (angle !== undefined) {
                    // calculations
                    this.lastScanTime += delta
                    const middleAngle: number = angle
                    const startAngle: number = middleAngle - this.radarOptions.azimuth
                    const endAngle: number = middleAngle + this.radarOptions.azimuth
                    const scanDuration = this.radarOptions.range * this.SCAN_SPEED * (endAngle - startAngle)

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
                        
                        // clear tracks
                        this.tracks = []

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
        for (const m of this.activeMissiles) {
            m.position.x += m.direction.x * m.speed * delta / 1000
            m.position.y += m.direction.y * m.speed * delta / 1000
        }
        // Filter out SARH missiles if not in STT mode
        if (this.mode !== 'stt') {
            this.activeMissiles = this.activeMissiles.filter(missile => 
                !(missile as SARHMissile).guidance || (missile as SARHMissile).guidance !== 'semi-active'
            );
        }
        // Filter out missiles that have gone beyond their range
        this.activeMissiles = this.activeMissiles.filter(missile => {
            const dx = missile.position.x - this.radarOptions.position.x;
            const dy = missile.position.y - this.radarOptions.position.y;
            const distanceFromRadar = Math.sqrt(dx * dx + dy * dy);
            return distanceFromRadar <= missile.range;
        });
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
        const missileSpeed = this.MISSILE_SPEED

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
            range: this.SARH_MISSILE_RANGE,
            speed: missileSpeed,
            guidance: 'semi-active',
            warhead: 'high-explosive',
            position: {
                x: missileStartX,
                y: missileStartY
            },
            direction: {
                x: dxTotal / distance,
                y: dyTotal / distance
            },
        }

        this.activeMissiles.push(missile)
    }

}