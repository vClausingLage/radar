import { RadarOptions, Loadout, Vector2 } from '../../types'
import { Track } from '../data/track'
import { Asteroid } from '../../entities/asteroid'
import { Ship, Target } from '../../entities/ship'
import { Missile } from '../../entities/missiles'
import { LightRadarRenderer } from '../renderer/lightRadarRenderer'
import { Math as MathUtils } from '../../math'
 

export class LightRadar {
    private lastScanTime = 0
    private missileUpdateDelta = 0
    private activeMissiles: Missile[] = []
    private twsTargetIndex = 0
    private owner: Ship | null = null
    private scene: Phaser.Scene;
    private tracks: Track[];
    private sttTrack: Track | null;
    private radarOptions: RadarOptions;
    private mode: string;
    private loadout: Loadout;
    private renderer: LightRadarRenderer | null;
    public events: Phaser.Events.EventEmitter;

    constructor(params: {
        scene: Phaser.Scene;
        settings: RadarOptions;
        renderer: LightRadarRenderer | null;
        mode?: string;
        loadout: Loadout;
        tracks?: Track[];
        sttTrack?: Track | null;
    }) {
        this.scene = params.scene;
        this.tracks = params.tracks || [];
        this.sttTrack = params.sttTrack || null;
        this.radarOptions = params.settings;
        this.mode = params.mode || 'rws';
        this.loadout = params.loadout;
        this.renderer = params.renderer;
        this.events = new Phaser.Events.EventEmitter();
    }

    // Attach radar to its owning ship so we can exclude it from scans
    attachTo(owner: Ship): void {
        this.owner = owner
    }

    getPosition(): Vector2 {
        return this.radarOptions.position
    }
    setPosition({x, y}: Vector2 | Phaser.Math.Vector2): void {
        this.radarOptions.position.x = x
        this.radarOptions.position.y = y
    }

    getRange(): number {
        return this.radarOptions.range
    }

    getMode(): string {
        return this.mode
    }
    setMode(mode: string): void {
        this.mode = mode
        switch (mode) {
            case 'rws':
                this.radarOptions.azimuth = 45
                break
            case 'stt':
                break
            case 'tws':
                this.radarOptions.azimuth = 20
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
    
    getTracks(): Track[] {
        return this.tracks
    }
    setTracks(tracks: Track[]): void {
        this.tracks = tracks
    }

    getLoadout(): Loadout {
        return this.loadout
    }
    setLoadout(): void {
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

    start(): void {
        this.radarOptions.isScanning = true
    }
    stop(): void {
        this.radarOptions.isScanning = false
    }

    update(delta: number, angle: number, ships: Array<Ship | Target>, asteroids: Asteroid[], graphics: Phaser.GameObjects.Graphics): void {
        // Keep radar anchored to its owner if available
        if (this.owner) {
            const pos = this.owner.getPosition();
            this.setPosition(pos);
        }

        // Derive targets by excluding the owning ship, if set (always available for missiles)
        const targets: Target[] = (ships || [])
            .filter(s => (this.owner ? s !== this.owner : true)) as Target[]

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

            if (this.mode === 'tws') {
                if (angle !== undefined) {
                    // calculations
                    this.lastScanTime += delta
                    const middleAngle: number = angle
                    const startAngle: number = middleAngle - this.radarOptions.azimuth
                    const endAngle: number = middleAngle + this.radarOptions.azimuth
                    const scanDuration = this.radarOptions.range * this.radarOptions.scanSpeed * (endAngle - startAngle)

                    if (this.lastScanTime >= scanDuration) {
                        this.radarTwsScan(startAngle, endAngle, targets, asteroids, graphics)
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
                if (trackedTarget && trackedTarget.body && trackedTarget.active) {
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
                    // Target not found or destroyed, switch back to RWS
                    console.info('Tracked target not found or destroyed');
                    this.sttTrack = null;
                    this.mode = 'rws';
                    return;
                }

                const dx = this.sttTrack.pos.x - this.radarOptions.position.x
                const dy = this.sttTrack.pos.y - this.radarOptions.position.y
                const distanceToTrack = Math.sqrt(dx * dx + dy * dy)

                let angleToTrack = MathUtils.normalizeAngle(Phaser.Math.RadToDeg(Math.atan2(dy, dx)))
                const normalizedStartAngle = MathUtils.normalizeAngle(startAngle);
                const normalizedEndAngle = MathUtils.normalizeAngle(endAngle);

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
                    this.renderer?.renderStt(this.sttTrack, graphics)
                    this.lastScanTime = 0
                }
            }
        }
        // update missiles
        this.updateMissiles(delta)

        // Emit tracking events
        this.emitTrackingEvents();

        this.renderer?.renderMissiles(this.activeMissiles)
        this.renderer?.renderRadarScanInterface(graphics, this.radarOptions.position, this.radarOptions.range, angle - this.radarOptions.azimuth, angle + this.radarOptions.azimuth, this.radarOptions.range, this.activeMissiles, this.loadout)
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
            // Cycle through available tracks: 0, 1, 2, 0, 1, 2...
            target = this.tracks[this.twsTargetIndex]
            // Move to next target for next shot
            this.twsTargetIndex = (this.twsTargetIndex + 1) % this.tracks.length
        } else {
            console.error('No target to shoot at')
            return
        }

        if (!target) {
            console.error('No target to shoot at')
            return
        }
                
        // Spawn far enough ahead to avoid collision with launching ship
        const spawnOffset = 100
        const angleRad = Phaser.Math.DegToRad(angle || 0)
        const missileStartX = this.radarOptions.position.x + Math.cos(angleRad) * spawnOffset
        const missileStartY = this.radarOptions.position.y + Math.sin(angleRad) * spawnOffset 

        const distance = Math.sqrt(
            (target.pos.x - missileStartX) ** 2 +
            (target.pos.y - missileStartY) ** 2
        );

        if (distance === 0) {
            // Fallback: nudge start point a bit and continue
            const nudge = 1
            const adjX = missileStartX + Math.cos(angleRad) * nudge
            const adjY = missileStartY + Math.sin(angleRad) * nudge
            const newDistance = Math.sqrt(
                (target.pos.x - adjX) ** 2 +
                (target.pos.y - adjY) ** 2
            )
            if (newDistance === 0) {
                console.error('Target is at current location, missile not fired.')
                return
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

        switch (activeWeaponType) {
            case 'AIM-177':
                if (this.mode === 'tws') console.log('GO STT! PREVENT SHOOTING')
                const sarhMissile = this.scene.add.sarhMissile({
                    x: missileStartX,
                    y: missileStartY,
                    dirX: Math.cos(Phaser.Math.DegToRad(angle)),
                    dirY: Math.sin(Phaser.Math.DegToRad(angle))
                });
                // Assign target in TWS so the missile can track the intended contact
                if (this.mode === 'tws' && target) {
                    sarhMissile.targetId = target.id;
                }
                this.activeMissiles.push(sarhMissile);
                break;
            case 'AIM-220':
                const activeRadarMissile = this.scene.add.activeRadarMissile({
                    x: missileStartX,
                    y: missileStartY,
                    dirX: Math.cos(Phaser.Math.DegToRad(angle)),
                    dirY: Math.sin(Phaser.Math.DegToRad(angle))
                });
                if (this.mode === 'tws' && target) {
                    activeRadarMissile.targetId = target.id;
                }
                this.activeMissiles.push(activeRadarMissile);
                break;
            default:
                console.error(`Unknown missile type: ${activeWeaponType}`);
                return;
        }
    }

    updateMissiles(delta: number): void {
        // Remove destroyed or inactive missiles
        this.activeMissiles = this.activeMissiles.filter(m => m.active);

        // Filter out missiles that have gone beyond their burn time
        this.missileUpdateDelta += delta
        if (this.missileUpdateDelta >= 1000) {
            for (const m of this.activeMissiles) {
                console.info(`Missile ${m.missileType} at position (${m.x}, ${m.y}) with burn time ${m.missileBurnTime} and age ${m.missileAge}`);
            }

            this.activeMissiles = this.activeMissiles.filter(missile => {
                if (missile.missileAge <= missile.missileBurnTime) {
                    missile.missileAge += 1;
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

            if (m.missileAge < 2) {
                ({ targetDirX, targetDirY } = this.flyInDirectionOfShip(m));
            } else {
                const trackResult = this.trackInDirectionOfTarget(m);
                if (trackResult) {
                    ({ targetDirX, targetDirY } = trackResult);
                }
            }
            
            // Interpolate direction based on turn speed (0 to 1)
            const turnFactor = Math.min(m.missileTurnSpeed * delta / 1000, 1);
            m.direction.x = currentDirX + (targetDirX - currentDirX) * turnFactor;
            m.direction.y = currentDirY + (targetDirY - currentDirY) * turnFactor;
            
            // Normalize the direction vector
            const dirMag = Math.sqrt(m.direction.x * m.direction.x + m.direction.y * m.direction.y);
            if (dirMag > 0) {
                m.direction.x /= dirMag;
                m.direction.y /= dirMag;
            }
            
            m.updateHeading(m.direction.x, m.direction.y);
        }
    }

    filterTargetsAndAsteroidsInScanArea(startAngle: number, endAngle: number, targets: Target[], asteroids: Asteroid[]): { targetsInRange: Target[], asteroidsInRange: Asteroid[] } {
        const targetsInRange = targets.filter(target => {
            const dx = target.x - this.radarOptions.position.x
            const dy = target.y - this.radarOptions.position.y
            const distance = Math.sqrt(dx * dx + dy * dy)
            let angleToTarget = Phaser.Math.RadToDeg(Math.atan2(dy, dx))

            // Normalize angles to be within -180 to 180 range
            angleToTarget = MathUtils.normalizeAngle(angleToTarget);
            const normalizedStartAngle = MathUtils.normalizeAngle(startAngle);
            const normalizedEndAngle = MathUtils.normalizeAngle(endAngle);

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

        // TODO
        // THIS MUST BE REFACTORED TO DO AN ACTUAL RADAR SCAN
        // TODO

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
                
                this.renderer?.renderRwsContacts(graphics, t, distance)
            }
        }
        
        // sort tracks by distance
        this.tracks.sort((a, b) => a.dist - b.dist)
        
        console.log('Targets in range:', this.owner, this.tracks)
        
        // THIS RENDERER SHOULD USE 
        // TERRAIN RADAR LIKE RENDERING FOR ASTEROIDS
        // NOT IMPLEMENTED
        this.renderer?.renderAsteroids(asteroidsInRange)
        
        this.lastScanTime = 0
    }

    radarTwsScan(startAngle: number, endAngle: number, targets: Target[], asteroids: Asteroid[], graphics: Phaser.GameObjects.Graphics): void {
        this.sttTrack = null
        const MAX_TWS_TRACKS = 3

        const { targetsInRange, asteroidsInRange } = this.filterTargetsAndAsteroidsInScanArea(startAngle, endAngle, targets, asteroids)

        const targetCircles = targetsInRange.map(t => t.getCircle());
        const asteroidCircles = asteroidsInRange.map(a => a.getCircle());
        const allCircles = [...targetCircles, ...asteroidCircles];

        const radarPosition = {
            x: this.radarOptions.position.x,
            y: this.radarOptions.position.y
        }

        // Build list of valid targets (not obstructed)
        const validTargets: Array<{ target: Target, distance: number, hasCollision: boolean }> = [];

        for (const t of targetsInRange) {
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

            const hasCollision = unobstructedLines === 0;
            const dx = t.x - this.radarOptions.position.x;
            const dy = t.y - this.radarOptions.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (!hasCollision) {
                validTargets.push({ target: t, distance, hasCollision });
            }
        }

        // Update existing tracks or add new ones
        const updatedTracks: Track[] = [];
        const usedTargetIds = new Set<number>();

        // First, try to update existing tracks with targets still in range
        for (const track of this.tracks) {
            const matchingTarget = validTargets.find(vt => vt.target.id === track.id);
            
            if (matchingTarget) {
                // Update existing track
                updatedTracks.push({
                    id: matchingTarget.target.id,
                    pos: { x: matchingTarget.target.x, y: matchingTarget.target.y },
                    dist: matchingTarget.distance,
                    dir: matchingTarget.target.getDirection(),
                    speed: matchingTarget.target.getSpeed(),
                    age: track.age + 1,
                    lastUpdate: 0,
                    confidence: Math.min(track.confidence + 0.1, 1.0),
                });
                usedTargetIds.add(matchingTarget.target.id);
            }
        }

        // Add new targets to empty slots (up to MAX_TWS_TRACKS total)
        if (updatedTracks.length < MAX_TWS_TRACKS) {
            // Sort unused targets by distance
            const unusedTargets = validTargets
                .filter(vt => !usedTargetIds.has(vt.target.id))
                .sort((a, b) => a.distance - b.distance);

            for (const vt of unusedTargets) {
                if (updatedTracks.length >= MAX_TWS_TRACKS) break;

                updatedTracks.push({
                    id: vt.target.id,
                    pos: { x: vt.target.x, y: vt.target.y },
                    dist: vt.distance,
                    dir: vt.target.getDirection(),
                    speed: vt.target.getSpeed(),
                    age: 0,
                    lastUpdate: 0,
                    confidence: 0.5,
                });
            }
        }

        this.tracks = updatedTracks;

        // Reset target index if it exceeds current track count
        if (this.twsTargetIndex >= this.tracks.length && this.tracks.length > 0) {
            this.twsTargetIndex = 0;
        }

        // Render tracks
        for (const track of this.tracks) {
            const targetObj = targetsInRange.find(t => t.id === track.id);
            if (targetObj) {
                this.renderer?.renderRwsContacts(graphics, targetObj, track.dist);
            }
        }

        // Render asteroids
        this.renderer?.renderAsteroids(asteroidsInRange);
        
        console.log('TWS Tracks:', this.tracks.map(t => ({ id: t.id, dist: Math.round(t.dist) })));
        
        this.lastScanTime = 0;
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
        // Find the track this missile is targeting
        let targetTrack: Track | null = null;
        
        if (this.mode === 'stt' && this.sttTrack) {
            targetTrack = this.sttTrack;
        } else if (this.mode === 'tws' && m.targetId !== undefined) {
            // Find the track with matching ID
            targetTrack = this.tracks.find(track => track.id === m.targetId) || null;
        }
        
        if (targetTrack) {
            // console.info("Calculating lead for missile towards target")
            const angleRad = Phaser.Math.DegToRad(targetTrack.dir);
            // 1. Calculate relative position and velocity
            const targetVelocity = {
                x: Math.cos(angleRad) * targetTrack.speed,
                y: Math.sin(angleRad) * targetTrack.speed
            };
            const targetPos = targetTrack?.pos!;
            // const targetVelocity = this.sttTrack?.dir!
            const relPos = {
                x: targetPos.x - m.x,
                y: targetPos.y - m.y,
            };

            // 2. Calculate quadratic coefficients (a, b, c)
            const a =
                targetVelocity.x * targetVelocity.x +
                targetVelocity.y * targetVelocity.y -
                m.missileSpeed * m.missileSpeed;

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
                x: interceptPos.x - m.x,
                y: interceptPos.y - m.y,
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

    private emitTrackingEvents(): void {
        // Emit STT tracking event (always emit, with null when not tracking)
        const sttTargetId = this.sttTrack ? this.sttTrack.id : null;
        this.events.emit('stt-track', sttTargetId);
        
        // Emit radar tracking events (always emit, with empty array when no tracks)
        const trackedIds = this.tracks.map(track => track.id);
        this.events.emit('radar-track', trackedIds);
    }
}