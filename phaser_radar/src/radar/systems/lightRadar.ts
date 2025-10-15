import { RadarOptions, Loadout } from '../../types'
import { Track } from '../data/track'
import { Asteroid } from '../entities/asteroid'
import { Target } from '../entities/ship'
import { Missile, SARHMissile } from '../entities/missiles'
import { LightRadarRenderer } from '../renderer/lightRadarRenderer'
import { calculateInterceptionVector } from '../../math'

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
        private destroyedTarget: Target | null = null,
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
                this.radarOptions.azimuth = 0
                break
   
            default:
                break
        }
    }
    
    getTracks() {
        return this.tracks
    }
    setTracks(tracks: Track[]) {
        this.tracks = tracks
    }

    getAsteroids() {
        return this.asteroids
    }
    addAsteroid(a: Asteroid) {
        this.asteroids = [...this.asteroids, a]
    }

    getLoadout() {
        return this.loadout
    }
    setLoadout() {
        // Find current active weapon and set the next one active
        const loadoutKeys = Object.keys(this.loadout) as (keyof Loadout)[];
        if (loadoutKeys.length > 0) {
            const currentActiveIndex = loadoutKeys.findIndex(key => this.loadout[key]?.active === true);
            
            // Deactivate current active weapon
            if (currentActiveIndex !== -1) {
                this.loadout[loadoutKeys[currentActiveIndex]].active = false;
            }
            
            // Activate next weapon (or first if none active or last was active)
            const nextIndex = currentActiveIndex === -1 || currentActiveIndex === loadoutKeys.length - 1 
            ? 0 
            : currentActiveIndex + 1;
            
            this.loadout[loadoutKeys[nextIndex]].active = true;
        }
    }

    start() {
        this.radarOptions.isScanning = true
    }
    stop() {
        this.radarOptions.isScanning = false
    }

    update(delta: number, angle: number, targets: Target[], graphics: Phaser.GameObjects.Graphics): void {
        const activeMissile = Object.keys(this.loadout).find(key => this.loadout[key as keyof Loadout]?.active);
        if (!this.radarOptions.isScanning) {
            // do nothing
        } else {
            if (this.mode === 'emcon') {
            }
            if (this.mode === 'rws') {
                if (angle !== undefined) {
                    // calculations
                    this.lastScanTime += delta
                    const middleAngle: number = angle
                    const startAngle: number = middleAngle - this.radarOptions.azimuth
                    const endAngle: number = middleAngle + this.radarOptions.azimuth
                    const scanDuration = this.radarOptions.range * this.radarOptions.scanSpeed * (endAngle - startAngle)

                    this.renderer.renderScanAzimuth(graphics, this.radarOptions.position, this.radarOptions.range, startAngle, endAngle)

                    if (this.lastScanTime >= scanDuration) {
                        this.radarScan(startAngle, endAngle, targets, graphics)
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
                let angleToTrack = Phaser.Math.RadToDeg(Math.atan2(dy, dx)) + 90

                // Normalize angles to be within -180 to 180 range
                const normalizeAngle = (angle: number) => {
                    while (angle > 180) angle -= 360;
                    while (angle < -180) angle += 360;
                    return angle;
                }

                angleToTrack = normalizeAngle(angleToTrack);
                const normalizedStartAngle = normalizeAngle(startAngle);
                const normalizedEndAngle = normalizeAngle(endAngle);

                let isTrackInAngle = false;
                
                // Handle angle wraparound case
                if (normalizedStartAngle > normalizedEndAngle) {
                    // Wraparound case: track is in range if it's >= startAngle OR <= endAngle
                    isTrackInAngle = angleToTrack >= normalizedStartAngle || angleToTrack <= normalizedEndAngle;
                } else {
                    // Normal case: track is in range if it's between start and end angles
                    isTrackInAngle = angleToTrack >= normalizedStartAngle && angleToTrack <= normalizedEndAngle;
                }

                if (distanceToTrack > this.radarOptions.range || !isTrackInAngle) {
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
        this.updateMissiles(delta, targets)

        this.renderer.renderMissiles(this.activeMissiles, graphics)

        this.renderer.renderHud(activeMissile)
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

    shoot(angle: number): void {
        let target

        if (this.mode === 'stt' && this.sttTrack) {
            target = this.sttTrack
        } else if (this.mode === 'tws' && this.tracks.length > 0) {
            // select target
        } else {
            console.error('No target to shoot at')
            return
        }

        if (!target) {
            console.error('No target to shoot at')
            return
        }
                
        const missileStartX = this.radarOptions.position.x
        const missileStartY = this.radarOptions.position.y 

        const distance = Math.sqrt(
            (target.pos.x - missileStartX) ** 2 +
            (target.pos.y - missileStartY) ** 2
        );

        if (distance === 0) {
            console.error('Target is at current location, missile not fired.')
            return 
        }
        
        console.info('active loadout:', this.loadout)
        const missile: SARHMissile = {
            type: 'AIM-177',
            age: 0,
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
                x: Math.cos(Phaser.Math.DegToRad(angle)),
                y: Math.sin(Phaser.Math.DegToRad(angle))
            }
        }

        // DECREASE MISSILE LOADOUT
        // Find the active weapon type in the loadout
        const activeWeaponType = Object.keys(this.loadout).find(key => 
            this.loadout[key as keyof Loadout]?.active
        ) as keyof Loadout;

        // If we have an active weapon with remaining count, decrease it
        if (activeWeaponType && this.loadout[activeWeaponType]) {
            const activeWeapon = this.loadout[activeWeaponType];
            
            if (activeWeapon.load > 0) {
                activeWeapon.load--;
                console.info(`Fired a ${activeWeaponType}. Remaining: ${activeWeapon.load}`);
            } else {
                console.warn(`No ${activeWeaponType} missiles remaining`);
                return; // Don't fire if no missiles left
            }
        }

        this.activeMissiles.push(missile)
    }

    updateMissiles(delta: number, targets: Target[]): void {
        // Filter out missiles that have gone beyond their burn time
        this.missileUpdateDelta += delta
        if (this.missileUpdateDelta >= 1000) {
            for (const m of this.activeMissiles) {
                console.log(`Missile ${m.type} at position (${m.position.x}, ${m.position.y}) with burn time ${m.burnTime} and age ${m.age}`);
            }

            this.activeMissiles = this.activeMissiles.filter(missile => {
                if (missile.age <= missile.burnTime) {
                    missile.age += 1;
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

            if (m.age < 2) {
                ({ targetDirX, targetDirY } = this.flyInDirectionOfShip(m));
            } else {
                ({ targetDirX, targetDirY } = this.trackInDirectionOfTarget(m));
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
            this.checkCollisionWithTarget(m, targets);
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
                console.info(`Missile hit asteroid at position: ${asteroid.position.x}, ${asteroid.position.y}`);
                
                // Remove the missile
                this.activeMissiles = this.activeMissiles.filter(missile => missile !== m);
                
                // Stop checking other objects since this missile is already destroyed
                break;
            }
        }
    }

    checkCollisionWithTarget(m: Missile, targets: Target[]) {
        for (const target of targets) {
            const dxTarget = m.position.x - target.position.x;
            const dyTarget = m.position.y - target.position.y;
            const distanceToTarget = Math.sqrt(dxTarget * dxTarget + dyTarget * dyTarget);
            
            // Define proximity detection radius (missile + target size for more realistic collision)
            const proximityThreshold = 3 + (target.size / 2);
            
            if (distanceToTarget <= proximityThreshold) {
                console.info(`Missile hit target at position: ${target.position.x}, ${target.position.y}`);

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
                // targets = targets.filter(t => t !== target);
                this.destroyedTarget = target;

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

    filterTargetsAndAsteroidsInScanArea(startAngle: number, endAngle: number, targets: Target[]): { targetsInRange: Target[], asteroidsInRange: Asteroid[] } {
        const targetsInRange = targets.filter(target => {
            const dx = target.position.x - this.radarOptions.position.x
            const dy = target.position.y - this.radarOptions.position.y
            const distance = Math.sqrt(dx * dx + dy * dy)
            let angleToTarget = Phaser.Math.RadToDeg(Math.atan2(dy, dx)) + 90

            // Normalize angles to be within -180 to 180 range
            const normalizeAngle = (angle: number) => {
                while (angle > 180) angle -= 360;
                while (angle < -180) angle += 360;
                return angle;
            }

            angleToTarget = normalizeAngle(angleToTarget);
            const normalizedStartAngle = normalizeAngle(startAngle);
            const normalizedEndAngle = normalizeAngle(endAngle);

            let isInAngle = false;
            
            // Handle angle wraparound case (e.g., start=-156, end=-36)
            if (normalizedStartAngle > normalizedEndAngle) {
                // Wraparound case: target is in range if it's >= startAngle OR <= endAngle
                isInAngle = angleToTarget >= normalizedStartAngle || angleToTarget <= normalizedEndAngle;
            } else {
                // Normal case: target is in range if it's between start and end angles
                isInAngle = angleToTarget >= normalizedStartAngle && angleToTarget <= normalizedEndAngle;
            }

            return distance <= this.radarOptions.range && isInAngle
        })
        const asteroidsInRange = this.asteroids.filter(asteroid => {
            const dx = asteroid.position.x - this.radarOptions.position.x
            const dy = asteroid.position.y - this.radarOptions.position.y
            const distance = Math.sqrt(dx * dx + dy * dy)
            let angleToAsteroid = Phaser.Math.RadToDeg(Math.atan2(dy, dx)) + 90

            // Normalize angles to be within -180 to 180 range
            const normalizeAngle = (angle: number) => {
                while (angle > 180) angle -= 360;
                while (angle < -180) angle += 360;
                return angle;
            }

            angleToAsteroid = normalizeAngle(angleToAsteroid);
            const normalizedStartAngle = normalizeAngle(startAngle);
            const normalizedEndAngle = normalizeAngle(endAngle);

            let isInAngle = false;
            
            // Handle angle wraparound case (e.g., start=-156, end=-36)
            if (normalizedStartAngle > normalizedEndAngle) {
                // Wraparound case: asteroid is in range if it's >= startAngle OR <= endAngle
                isInAngle = angleToAsteroid >= normalizedStartAngle || angleToAsteroid <= normalizedEndAngle;
            } else {
                // Normal case: asteroid is in range if it's between start and end angles
                isInAngle = angleToAsteroid >= normalizedStartAngle && angleToAsteroid <= normalizedEndAngle;
            }

            return distance <= this.radarOptions.range && isInAngle
        })

        return { targetsInRange, asteroidsInRange }
    }

    radarScan(startAngle: number, endAngle: number, target: Target[], graphics: Phaser.GameObjects.Graphics): void {
        // clear tracks
        this.tracks = []
        this.sttTrack = null

        const { targetsInRange, asteroidsInRange } = this.filterTargetsAndAsteroidsInScanArea(startAngle, endAngle, target)

        const circles = [...targetsInRange, ...asteroidsInRange].map(t => {
            const r = t.size / 2
            return new Phaser.Geom.Circle(t.position.x, t.position.y, r)
        })

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
        
        this.renderer.renderAsteroids(asteroidsInRange, graphics)
        
        this.lastScanTime = 0
    }

    updateEnemiesInMain(): number | null {
        if (this.destroyedTarget) {
            const id = this.destroyedTarget.id;
            this.destroyedTarget = null;
            return id;
        }
        return null
    }

    alertTargetBeingTracked(): number | null {
        if (this.sttTrack) {
            const id = this.sttTrack.id;
            return id;
        }
        return null
    }

    alertRwr(): number[] | null {
        if (this.tracks.length > 0) {
            return this.tracks.map(track => track.id);
        }
        return null
    }

    flyInDirectionOfShip(m: Missile): { targetDirX: number, targetDirY: number } {
        return { targetDirX: m.direction.x, targetDirY: m.direction.y };
    }

    trackInDirectionOfTarget(m: Missile): { targetDirX: number, targetDirY: number } {
        // // in STT all missiles track the STT target
        if (this.mode === 'stt' && this.sttTrack) {
            const dxToTarget = this.sttTrack.pos.x - m.position.x;
            const dyToTarget = this.sttTrack.pos.y - m.position.y;
            const distToTarget = Math.sqrt(dxToTarget * dxToTarget + dyToTarget * dyToTarget);
            
            if (distToTarget > 0) {
                m.direction.x = dxToTarget / distToTarget;
                m.direction.y = dyToTarget / distToTarget;
            }
        }
        return { targetDirX: m.direction.x, targetDirY: m.direction.y };

        // if (!this.sttTrack) {
        //     return { targetDirX: m.direction.x, targetDirY: m.direction.y };
        // }

        // const vector = calculateInterceptionVector(m, this.sttTrack);
        // return { targetDirX: vector.x, targetDirY: vector.y };
    }
}