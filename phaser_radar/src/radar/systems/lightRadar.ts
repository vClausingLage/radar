import { RadarOptions, Loadout } from '../../types'
import { Track } from '../data/track'
import { Asteroid } from '../entities/asteroid'
import { Target } from '../entities/ship'
import { ActiveRadarMissile, Missile, SARHMissile } from '../entities/missiles'
import { LightRadarRenderer } from '../renderer/lightRadarRenderer'
import { normalizeAngle } from '../../math'
import { IMAGE_SCALE } from '../../settings'

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
                this.radarOptions.azimuth = 45
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

    update(delta: number, angle: number, targets: Target[], asteroids: Asteroid[], graphics: Phaser.GameObjects.Graphics): void {
        const activeLoadout = Object.keys(this.loadout).find(key => this.loadout[key as keyof Loadout]?.active);
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

                    if (this.lastScanTime >= scanDuration) {
                        this.radarScan(startAngle, endAngle, targets, asteroids, graphics)
                    }
                }
            }

            if (this.mode === 'stt') {
                const middleAngle: number = angle
                const startAngle: number = middleAngle - this.radarOptions.azimuth
                const endAngle: number = middleAngle + this.radarOptions.azimuth

                if (this.tracks.length <= 0) {
                    console.error('No tracks found')
                    this.sttTrack = null
                    this.mode = 'rws'
                    return
                }

                if (!this.sttTrack) {
                    this.sttTrack = this.tracks[0]
                }

                // Update sttTrack with current target information
                const trackedTarget = targets.find(t => t.id === this.sttTrack!.id);
                if (trackedTarget) {
                    // Update position
                    this.sttTrack.pos = { x: trackedTarget.x, y: trackedTarget.y };
                    // Update direction
                    this.sttTrack.dir = trackedTarget.getDirection();
                    // Update speed
                    this.sttTrack.speed = trackedTarget.getSpeed();
                    // Recalculate distance
                    const dx = this.sttTrack.pos.x - this.radarOptions.position.x;
                    const dy = this.sttTrack.pos.y - this.radarOptions.position.y;
                    this.sttTrack.dist = Math.sqrt(dx * dx + dy * dy);
                } else {
                    // Target not found, switch back to RWS
                    console.error('Tracked target not found');
                    this.sttTrack = null;
                    this.mode = 'rws';
                    return;
                }

                const dx = this.sttTrack.pos.x - this.radarOptions.position.x
                const dy = this.sttTrack.pos.y - this.radarOptions.position.y
                const distanceToTrack = Math.sqrt(dx * dx + dy * dy)

                let angleToTrack = normalizeAngle(Phaser.Math.RadToDeg(Math.atan2(dy, dx)))
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
                    console.log('STT Track:', this.sttTrack.pos)
                    this.renderer.renderStt(this.sttTrack, graphics)
                    this.lastScanTime = 0
                }
            }
        }
        // update missiles
        this.updateMissiles(delta, targets, asteroids)

        this.renderer.renderMissiles(this.activeMissiles, graphics)
        this.renderer.renderRadarScanInterface(graphics, this.radarOptions.position, this.radarOptions.range, angle - this.radarOptions.azimuth, angle + this.radarOptions.azimuth, this.radarOptions.range, this.activeMissiles, activeLoadout)
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

        switch (activeWeaponType) {
            case 'AIM-177':
                const sarhMissile = new SARHMissile(
                    this.renderer.scene!,
                    missileStartX,
                    missileStartY,
                    Math.cos(Phaser.Math.DegToRad(angle)),
                    Math.sin(Phaser.Math.DegToRad(angle))
                )
                this.activeMissiles.push(sarhMissile);
                break;
            case 'AIM-220':
                const activeRadarMissile = new ActiveRadarMissile(
                    this.renderer.scene!,
                    missileStartX,
                    missileStartY,
                    Math.cos(Phaser.Math.DegToRad(angle)),
                    Math.sin(Phaser.Math.DegToRad(angle))
                );
                this.activeMissiles.push(activeRadarMissile);
                break;
            default:
                console.error(`Unknown missile type: ${activeWeaponType}`);
                return;
        }
    }

    updateMissiles(delta: number, targets: Target[], asteroids: Asteroid[]): void {
        // Filter out missiles that have gone beyond their burn time
        this.missileUpdateDelta += delta
        if (this.missileUpdateDelta >= 1000) {
            for (const m of this.activeMissiles) {
                console.info(`Missile ${m.type} at position (${m.position.x}, ${m.position.y}) with burn time ${m.burnTime} and age ${m.age}`);
            }

            this.activeMissiles = this.activeMissiles.filter(missile => {
                if (missile.age <= missile.burnTime) {
                    missile.age += 1;
                    return true;
                }
                missile.destroy();
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
                const trackResult = this.trackInDirectionOfTarget(m);
                if (trackResult) {
                    ({ targetDirX, targetDirY } = trackResult);
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
            this.checkCollisionWithAsteroid(m, asteroids);

            // Check for missile collisions with targets
            this.checkCollisionWithTarget(m, targets);
        }
    }

    checkCollisionWithAsteroid(m: Missile, asteroids: Asteroid[]) {
        for (const asteroid of asteroids) {
            const dxAsteroid = m.position.x - asteroid.position.x;
            const dyAsteroid = m.position.y - asteroid.position.y;
            const distanceToAsteroid = Math.sqrt(dxAsteroid * dxAsteroid + dyAsteroid * dyAsteroid);
            
            // Define proximity threshold based on asteroid size
            const asteroidProximityThreshold = 3 + (asteroid?.body?.width! / 2);
            
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
            const dxTarget = m.position.x - target.x;
            const dyTarget = m.position.y - target.y;
            const distanceToTarget = Math.sqrt(dxTarget * dxTarget + dyTarget * dyTarget);
            
            // Define proximity detection radius (missile + target size for more realistic collision)
            const proximityThreshold = 3 + (target.body?.width! / 2);
            
            if (distanceToTarget <= proximityThreshold) {
                console.info(`Missile hit target at position: ${target.x}, ${target.y}`);

                // Create an explosion sprite at the target's position
                if (this.renderer.scene) {
                    const explosion = this.renderer.scene.add.sprite(
                        target.x,
                        target.y,
                        'explosion'
                    );

                    explosion.setScale(IMAGE_SCALE);
                    
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
                
                // destroy missile
                m.destroy();
                
                // Remove the missile and target
                this.activeMissiles = this.activeMissiles.filter(missile => missile !== m);
                // targets = targets.filter(t => t !== target);
                this.destroyedTarget = target;

                // Also remove corresponding track if it exists
                if (this.sttTrack && this.sttTrack.pos.x === target.x && this.sttTrack.pos.y === target.y) {
                    this.sttTrack = null;
                    if (this.mode === 'stt') {
                        this.setMode('rws');
                    }
                }
                
                this.tracks = this.tracks.filter(track => 
                    !(track.pos.x === target.x && track.pos.y === target.y)
                );
                
                // Stop checking other targets since this missile is already destroyed
                break;
            }
        }
    }

    filterTargetsAndAsteroidsInScanArea(startAngle: number, endAngle: number, targets: Target[], asteroids: Asteroid[]): { targetsInRange: Target[], asteroidsInRange: Asteroid[] } {
        const targetsInRange = targets.filter(target => {
            const dx = target.x - this.radarOptions.position.x
            const dy = target.y - this.radarOptions.position.y
            const distance = Math.sqrt(dx * dx + dy * dy)
            let angleToTarget = Phaser.Math.RadToDeg(Math.atan2(dy, dx))

            // Normalize angles to be within -180 to 180 range
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
        const asteroidsInRange = asteroids.filter(a => {
            const dx = a.position.x - this.radarOptions.position.x
            const dy = a.position.y - this.radarOptions.position.y
            const distance = Math.sqrt(dx * dx + dy * dy)
            let angleToAsteroid = Phaser.Math.RadToDeg(Math.atan2(dy, dx))

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

    radarScan(startAngle: number, endAngle: number, targets: Target[], asteroids: Asteroid[], graphics: Phaser.GameObjects.Graphics): void {
        // clear tracks
        this.tracks = []
        this.sttTrack = null

        const { targetsInRange, asteroidsInRange } = this.filterTargetsAndAsteroidsInScanArea(startAngle, endAngle, targets, asteroids)

        const targetCircles = targetsInRange.map(t => {
            return t.getCircle();
        });
        const asteroidCircles = asteroidsInRange.map(a => {
            return a.getCircle();
        });
        const allCircles = [...targetCircles, ...asteroidCircles];

        const radarPosition = {
            x: this.radarOptions.position.x,
            y: this.radarOptions.position.y
        }
        
        for (const t of targetsInRange) {
            let hasCollision = false;
            // Create lines to r, l, t, b points of target circle
            const c = t.getCircle();

            const cardinalPoints = [
                { x: c.right, y: c.y },
                { x: c.left, y: c.y },
                { x: c.x, y: c.top },
                { x: c.x, y: c.bottom }
            ];

            let unobstructedLines = 0;

            for (const point of cardinalPoints) {
                const line = new Phaser.Geom.Line(
                    radarPosition.x,
                    radarPosition.y,
                    point.x,
                    point.y
                );
                
                let lineHasObstruction = false;
                
                // Check against all other circles (except the current target's circle)
                for (const otherCircle of allCircles) {
                    if (otherCircle.x === c.x && otherCircle.y === c.y && otherCircle.radius === c.radius) continue;
                    
                    if (Phaser.Geom.Intersects.LineToCircle(line, otherCircle)) {
                        lineHasObstruction = true;
                        break;
                    }
                }
                
                if (!lineHasObstruction) {
                    unobstructedLines++;
                }
            }

            // If all four lines are obstructed, set hasCollision to true
            hasCollision = unobstructedLines === 0;

            // Calculate distance
            const dx = t.x - this.radarOptions.position.x;
            const dy = t.y - this.radarOptions.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Only draw and process target if there's no collision
            if (!hasCollision) {
                this.tracks = [...this.tracks, {
                    id: t.id,
                    pos: { x: t.x, y: t.y },
                    dist: distance,
                    dir: t.getDirection(),
                    speed: t.getSpeed(),
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
        
        // THIS RENDERER SHOULD USE 
        // TERRAIN RADAR LIKE RENDERING FOR ASTEROIDS
        // NOT IMPLEMENTED
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

    trackInDirectionOfTarget(m: Missile): { targetDirX: number, targetDirY: number } | null {
        if (this.mode === 'stt' && this.sttTrack) {
            // console.info("Calculating lead for missile towards STT target")
            const angleRad = Phaser.Math.DegToRad(this.sttTrack.dir);
            // 1. Calculate relative position and velocity
            const targetVelocity = {
                x: Math.cos(angleRad) * this.sttTrack.speed,
                y: Math.sin(angleRad) * this.sttTrack.speed
            };
            const targetPos = this.sttTrack?.pos!;
            // const targetVelocity = this.sttTrack?.dir!
            const relPos = {
                x: targetPos.x - m.position.x,
                y: targetPos.y - m.position.y,
            };

            // 2. Calculate quadratic coefficients (a, b, c)
            const a =
                targetVelocity.x * targetVelocity.x +
                targetVelocity.y * targetVelocity.y -
                m.speed * m.speed;

            const b = 2 * (relPos.x * targetVelocity.x + relPos.y * targetVelocity.y);
            
            const c = relPos.x * relPos.x + relPos.y * relPos.y;

            // 3. Solve for time 't'
            
            let t = 0; // Time to intercept

            // Check if we have a linear equation (a is close to zero)
            if (Math.abs(a) < 0.001) {
                if (Math.abs(b) < 0.001) {
                // No solution (or infinite solutions)
                return null;
                }
                t = -c / b;
            } else {
                // Solve the quadratic equation
                const discriminant = b * b - 4 * a * c;

                if (discriminant < 0) {
                // No real solution, missile can't catch target
                return null;
                }

                const t1 = (-b + Math.sqrt(discriminant)) / (2 * a);
                const t2 = (-b - Math.sqrt(discriminant)) / (2 * a);

                // We need the smallest positive time
                if (t1 > 0 && t2 > 0) {
                t = Math.min(t1, t2);
                } else if (t1 > 0) {
                t = t1;
                } else if (t2 > 0) {
                t = t2;
                } else {
                // Both solutions are negative, intercept is in the past
                return null;
                }
            }

            // 4. Calculate the intercept position
            const interceptPos = {
                x: targetPos.x + targetVelocity.x * t,
                y: targetPos.y + targetVelocity.y * t,
            };

            // 5. Find the vector from missile to intercept
            const direction = {
                x: interceptPos.x - m.position.x,
                y: interceptPos.y - m.position.y,
            };

            // 6. Normalize the direction vector
            const mag = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
            if (mag === 0) {
                return null; // Should not happen if t > 0
            }

            return {
                targetDirX: direction.x / mag,
                targetDirY: direction.y / mag,
            };
        }
        return null;    
    }
}