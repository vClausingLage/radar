import { RadarOptions } from '../../types'
import { Track } from '../data/track'
import { Asteroid } from '../entities/asteroid'
import { Target } from '../entities/target'
import { LightRadarRenderer } from '../renderer/lightRadarRenderer'

export class LightRadar {

    private SCAN_SPEED = .02
    private MISSILE_SPEED = 40
    private lastScanTime = 0
    private activeMissiles: Phaser.GameObjects.Graphics[] = [] // Added to manage active missiles

    constructor(
        private radarOptions: RadarOptions,
        private mode: string = 'rws',
        private clock: Phaser.Time.Clock,
        private tracks: Track[] = [],
        private sttTrack: Track | null = null,
        private targets: Target[] = [],
        private asteroids: Asteroid[] = [],
        private renderer: LightRadarRenderer = new LightRadarRenderer()
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
                //! TODO
                //! if track outside of range or anzimuth 
                //! set tracks to null
                //! set mode to rws
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

                this.lastScanTime += delta
                if (this.lastScanTime >= 1000) {
                    this.renderer.renderStt(this.sttTrack, graphics)
                    this.lastScanTime = 0
                }
            }
        }

        // Update active missiles
        // Iterate backwards because we might remove elements from the array
        for (let i = this.activeMissiles.length - 1; i >= 0; i--) {
            const missileGraphics = this.activeMissiles[i]
            const missileData = missileGraphics.getData('missileData') as {
                startX: number
                startY: number
                targetX: number
                targetY: number
                speed: number
                totalDistance: number
                dxTotal: number
                dyTotal: number
                elapsedTime: number
            }

            missileData.elapsedTime += delta // delta is in milliseconds

            const timeToTargetMs = (missileData.totalDistance / missileData.speed) * 1000

            if (missileData.elapsedTime >= timeToTargetMs) {
                // Missile reached target (or exceeded its flight time)
                missileGraphics.x = missileData.targetX
                missileGraphics.y = missileData.targetY
                console.log('Missile impact!')

                // Optional: Add an impact effect (e.g., short fade out)
                if (graphics && graphics.scene) {
                    graphics.scene.tweens.add({
                        targets: missileGraphics,
                        alpha: 0,
                        duration: 200,
                        onComplete: () => {
                            missileGraphics.destroy()
                        }
                    })
                } else {
                    missileGraphics.destroy()
                }
                this.activeMissiles.splice(i, 1) // Remove missile from active list
            } else {
                // Move missile by interpolating its position
                const fractionOfJourney = missileData.elapsedTime / timeToTargetMs
                missileGraphics.x = missileData.startX + missileData.dxTotal * fractionOfJourney
                missileGraphics.y = missileData.startY + missileData.dyTotal * fractionOfJourney
            }
        }
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

    shootSARH(graphics: Phaser.GameObjects.Graphics): void {
        if (this.mode !== 'stt' || !this.sttTrack) {
            console.error('Cannot shoot SARH, not in STT mode or no track selected')
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

        const timeToTargetSeconds = distance / missileSpeed

        console.log('distance to target:', distance)
        console.log(`Missile launched! Estimated time to target: ${timeToTargetSeconds.toFixed(1)}s`)

        // Create missile visual representation
        if (graphics && graphics.scene) {
            const missileGraphics = graphics.scene.add.graphics()
            missileGraphics.fillStyle(0xff0000, 1)
            // Draw the circle at the graphic's local (0,0)
            missileGraphics.fillCircle(0, 0, 3) 
            // Set the graphic's initial position
            missileGraphics.x = missileStartX
            missileGraphics.y = missileStartY

            // Store missile data on the graphics object for retrieval in the update loop
            missileGraphics.setData('missileData', {
                startX: missileStartX,
                startY: missileStartY,
                targetX: missileTargetX,
                targetY: missileTargetY,
                speed: missileSpeed,
                totalDistance: distance,
                dxTotal: dxTotal, // Store total displacement
                dyTotal: dyTotal, // Store total displacement
                elapsedTime: 0 // Time elapsed in ms
            })

            this.activeMissiles.push(missileGraphics)
        }
    }

}