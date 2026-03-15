import { RadarOptions, Loadout, Vector2 } from '../../types'
import { Track } from '../data/track'
import { Asteroid } from '../../entities/asteroid'
import { Ship } from '../../entities/ship'
import { Missile } from '../../entities/missiles'
import { LightRadarRenderer } from '../renderer/lightRadarRenderer'
import { GameMath } from '../../math'
import { RWR } from './rwr'
import { RwrContact } from './rwr'
import { RadarDetection } from './radarDetection'
import { TwsTrackManager } from './twsTrackManager'
import { MissileGuidance } from './missileGuidance'
 
type RadarMode = 'stt' | 'rws' | 'tws' | 'tws-auto' | 'emcon'
type InterfaceWarningRenderer = { showGoSttWarning: () => void }

export class LightRadar {
    private lastScanTime = 0
    private activeMissiles: Missile[] = []
    private twsTargetIndex = 0
    private owner: Ship | null = null
    private scene: Phaser.Scene;
    private tracks: Track[];
    private sttTrack: Track | null;
    private radarOptions: RadarOptions;
    private mode: RadarMode;
    private loadout: Loadout;
    private renderer: LightRadarRenderer | null;
    private interfaceRenderer: InterfaceWarningRenderer | null;
    private rwr: RWR | null;
    private radarDetection: RadarDetection;
    private twsTrackManager: TwsTrackManager;
    private missileGuidance: MissileGuidance;
    public events: Phaser.Events.EventEmitter;

    constructor(params: {
        scene: Phaser.Scene;
        settings: RadarOptions;
        renderer: LightRadarRenderer | null;
        mode?: RadarMode;
        loadout: Loadout;
        tracks?: Track[];
        sttTrack?: Track | null;
        interfaceRenderer?: InterfaceWarningRenderer | null;
    }) {
        this.scene = params.scene;
        this.tracks = params.tracks || [];
        this.sttTrack = params.sttTrack || null;
        this.radarOptions = params.settings;
        this.mode = params.mode || 'rws';
        this.loadout = params.loadout;
        this.renderer = params.renderer;
        this.interfaceRenderer = params.interfaceRenderer || null;
        this.rwr = new RWR();
        this.radarDetection = new RadarDetection(this.radarOptions);
        this.twsTrackManager = new TwsTrackManager();
        this.missileGuidance = new MissileGuidance();
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

    getAzimuth(): number {
        return this.radarOptions.azimuth
    }

    getMode(): RadarMode {
        return this.mode
    }
    setMode(mode: RadarMode): void {
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
        this.cycleLoadout();
    }

    cycleLoadout(): void {
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

    setInterfaceRenderer(renderer: InterfaceWarningRenderer): void {
        this.interfaceRenderer = renderer
    }

    update(delta: number, angle: number, ships: Ship[], asteroids: Asteroid[], graphics: Phaser.GameObjects.Graphics): void {
        // Keep radar anchored to its owner if available
        if (this.owner) {
            const pos = this.owner.getPosition();
            this.setPosition(pos);
        }

        // Derive targets by excluding the owning ship, if set (always available for missiles)
        const targets: Array<Ship & { id: number }> = (ships || [])
            .filter(s => (this.owner ? s !== this.owner : true))
            .filter((s): s is Ship & { id: number } => typeof (s as { id?: number }).id === 'number')

        // Passive RWR reception runs continuously while radar is attached to an owner
        this.rwr?.receive(targets, asteroids, this.radarOptions.range, this.owner)

        if (this.radarOptions.isScanning) {
            if (this.mode === 'rws') {
                this.tryRunVolumeScan('rws', delta, angle, targets, asteroids, graphics)
            } else if (this.mode === 'tws') {
                this.tryRunVolumeScan('tws', delta, angle, targets, asteroids, graphics)
            } else if (this.mode === 'stt') {
                this.handleSttMode(delta, angle, targets, graphics)
            } // emcon keeps passive RWR only (no active scan)
        }
        // update missiles
        this.updateMissiles(delta)

        // Emit tracking events
        this.emitTrackingEvents();

        this.renderer?.renderMissiles(this.activeMissiles)
        this.renderer?.renderRadarScanInterface(graphics, this.radarOptions.position, this.radarOptions.range, angle - this.radarOptions.azimuth, angle + this.radarOptions.azimuth, this.radarOptions.range, this.activeMissiles, this.loadout)
    }

    private tryRunVolumeScan(
        mode: 'rws' | 'tws',
        delta: number,
        angle: number,
        targets: Array<Ship & { id: number }>,
        asteroids: Asteroid[],
        graphics: Phaser.GameObjects.Graphics
    ): void {
        const scanArea = this.getScanArea(angle)
        if (!scanArea) return

        this.lastScanTime += delta
        const scanDuration = this.getScanDuration(scanArea.startAngle, scanArea.endAngle)
        if (this.lastScanTime < scanDuration) return

        if (mode === 'rws') {
            this.radarScan(scanArea.startAngle, scanArea.endAngle, targets, asteroids, graphics)
            return
        }

        this.radarTwsScan(scanArea.startAngle, scanArea.endAngle, targets, asteroids, graphics)
    }

    private getScanDuration(startAngle: number, endAngle: number): number {
        return this.radarOptions.range * this.radarOptions.scanSpeed * (endAngle - startAngle)
    }

    private handleSttMode(
        delta: number,
        angle: number,
        targets: Array<Ship & { id: number }>,
        graphics: Phaser.GameObjects.Graphics
    ): void {
        const scanArea = this.getScanArea(angle)
        if (!scanArea) return

        if (this.tracks.length <= 0) {
            console.error('No tracks found')
            this.clearSttTrackingAndReturnToRws()
            return
        }

        if (!this.sttTrack) {
            this.sttTrack = this.tracks[0]
        }

        if (!this.refreshSttTrackFromTargets(targets)) {
            console.info('Tracked target not found or destroyed')
            this.clearSttTrackingAndReturnToRws()
            return
        }

        if (!this.isCurrentSttTrackInScan(scanArea.startAngle, scanArea.endAngle)) {
            this.clearSttTrackingAndReturnToRws()
            return
        }

        this.lastScanTime += delta
        if (this.lastScanTime >= 1000 && this.sttTrack) {
            this.renderer?.renderStt(this.sttTrack, graphics)
            this.lastScanTime = 0
        }
    }

    private clearSttTrackingAndReturnToRws(): void {
        // Avoid stale contacts causing immediate re-entry into STT on invalid targets.
        this.sttTrack = null
        this.tracks = []
        this.setMode('rws')
    }

    private refreshSttTrackFromTargets(targets: Array<Ship & { id: number }>): boolean {
        if (!this.sttTrack) return false

        const trackedTarget = targets.find((target) => target.id === this.sttTrack?.id)
        if (!trackedTarget || !trackedTarget.body || !trackedTarget.active) {
            return false
        }

        this.sttTrack.pos = { x: trackedTarget.x, y: trackedTarget.y }
        this.sttTrack.dir = trackedTarget.getDirection()
        this.sttTrack.speed = trackedTarget.getSpeed()
        this.sttTrack.dist = this.getDistanceToRadar(this.sttTrack.pos.x, this.sttTrack.pos.y)
        return true
    }

    private isCurrentSttTrackInScan(startAngle: number, endAngle: number): boolean {
        if (!this.sttTrack) return false

        const dx = this.sttTrack.pos.x - this.radarOptions.position.x
        const dy = this.sttTrack.pos.y - this.radarOptions.position.y
        const distanceToTrack = Math.sqrt(dx * dx + dy * dy)

        if (distanceToTrack > this.radarOptions.range) {
            return false
        }

        const angleToTrack = GameMath.normalizeAngle(Phaser.Math.RadToDeg(Math.atan2(dy, dx)))
        return this.isAngleWithinScanWindow(angleToTrack, startAngle, endAngle)
    }

    private isAngleWithinScanWindow(angle: number, startAngle: number, endAngle: number): boolean {
        const normalizedAngle = GameMath.normalizeAngle(angle)
        const normalizedStartAngle = GameMath.normalizeAngle(startAngle)
        const normalizedEndAngle = GameMath.normalizeAngle(endAngle)

        if (normalizedStartAngle > normalizedEndAngle) {
            return normalizedAngle >= normalizedStartAngle || normalizedAngle <= normalizedEndAngle
        }

        return normalizedAngle >= normalizedStartAngle && normalizedAngle <= normalizedEndAngle
    }

    private getDistanceToRadar(x: number, y: number): number {
        const dx = x - this.radarOptions.position.x
        const dy = y - this.radarOptions.position.y
        return Math.sqrt(dx * dx + dy * dy)
    }

    getScanArea(angle: number): { startAngle: number, endAngle: number } | null {
        if (!Number.isFinite(angle)) return null

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
                
        // Spawn just ahead of ship - collision with owner will be filtered
        const spawnOffset = 20
        const angleRad = Phaser.Math.DegToRad(angle || 0)
        const missileStartX = this.radarOptions.position.x + Math.cos(angleRad) * spawnOffset
        const missileStartY = this.radarOptions.position.y + Math.sin(angleRad) * spawnOffset 

        const distance = Math.sqrt(
            (target.pos.x - missileStartX) ** 2 +
            (target.pos.y - missileStartY) ** 2
        )

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

        // Find the active weapon type in the loadout
        const activeWeaponType = Object.keys(this.loadout).find(key => 
            this.loadout[key as keyof Loadout]?.active
        ) as keyof Loadout;

        // Check if we have the active weapon type and it has ammo
        if (!activeWeaponType || !this.loadout[activeWeaponType]) {
            console.error('No active weapon found');
            return;
        }

        const activeWeapon = this.loadout[activeWeaponType];
        if (activeWeapon.load <= 0) {
            console.warn(`No ${activeWeaponType} missiles remaining`);
            return;
        }

        switch (activeWeaponType) {
            case 'AIM-177': {
                // Semi-active radar homing missile requires STT mode
                if (this.mode === 'tws') {
                    console.log('GO STT! PREVENT SHOOTING');
                    if (this.interfaceRenderer) {
                        this.interfaceRenderer.showGoSttWarning();
                    }
                    return;
                }
                // Only decrease ammo if we actually fire
                activeWeapon.load--;
                
                const sarhMissile = this.scene.add.sarhMissile({
                    x: missileStartX,
                    y: missileStartY,
                    dirX: Math.cos(Phaser.Math.DegToRad(angle)),
                    dirY: Math.sin(Phaser.Math.DegToRad(angle)),
                    owner: this.owner || undefined
                });
                const ownerNoCollideGroupSarh = this.owner?.getMissileNoCollideGroup();
                if (ownerNoCollideGroupSarh !== undefined) {
                    sarhMissile.setCollisionGroup(ownerNoCollideGroupSarh);
                }
                this.activeMissiles.push(sarhMissile);
                break;
            }
            case 'AIM-220': {
                // Only decrease ammo if we actually fire
                activeWeapon.load--;
                
                const activeRadarMissile = this.scene.add.activeRadarMissile({
                    x: missileStartX,
                    y: missileStartY,
                    dirX: Math.cos(Phaser.Math.DegToRad(angle)),
                    dirY: Math.sin(Phaser.Math.DegToRad(angle)),
                    owner: this.owner || undefined
                });
                const ownerNoCollideGroupActive = this.owner?.getMissileNoCollideGroup();
                if (ownerNoCollideGroupActive !== undefined) {
                    activeRadarMissile.setCollisionGroup(ownerNoCollideGroupActive);
                }
                if (this.mode === 'tws' && target) {
                    activeRadarMissile.targetId = target.id;
                }
                this.activeMissiles.push(activeRadarMissile);
                break;
            }
            default:
                console.error(`Unknown missile type: ${activeWeaponType}`);
                return;
        }
    }

    updateMissiles(delta: number): void {
        this.activeMissiles = this.missileGuidance.updateMissiles(
            this.activeMissiles,
            delta,
            this.mode,
            this.sttTrack,
            this.tracks
        )
    }

    filterTargetsAndAsteroidsInScanArea(startAngle: number, endAngle: number, targets: Array<Ship & { id: number }>, asteroids: Asteroid[]): { targetsInRange: Array<Ship & { id: number }>, asteroidsInRange: Asteroid[] } {
        return this.radarDetection.filterTargetsAndAsteroidsInScanArea(startAngle, endAngle, targets, asteroids)
    }

    radarScan(startAngle: number, endAngle: number, targets: Array<Ship & { id: number }>, asteroids: Asteroid[], graphics: Phaser.GameObjects.Graphics): void {

        // TODO
        // THIS MUST BE REFACTORED TO DO AN ACTUAL RADAR SCAN
        // TODO

        // clear tracks
        this.tracks = []
        this.sttTrack = null

        const { targetsInRange, asteroidsInRange } = this.filterTargetsAndAsteroidsInScanArea(startAngle, endAngle, targets, asteroids)
        const visibleTargets = this.radarDetection.getVisibleTargets(targetsInRange, asteroidsInRange)

        for (const { target, distance } of visibleTargets) {
            this.tracks = [...this.tracks, {
                id: target.id,
                pos: { x: target.x, y: target.y },
                dist: distance,
                dir: target.getDirection(),
                speed: target.getSpeed(),
                age: 0,
                lastUpdate: 0,
                confidence: 0,
            }]

            this.renderer?.renderRwsContacts(graphics, target, distance)
        }
        
        // sort tracks by distance
        this.tracks.sort((a, b) => a.dist - b.dist)
                
        // THIS RENDERER SHOULD USE 
        // TERRAIN RADAR LIKE RENDERING FOR ASTEROIDS
        // NOT IMPLEMENTED
        this.renderer?.renderAsteroids(asteroidsInRange)
        
        this.lastScanTime = 0
    }

    radarTwsScan(startAngle: number, endAngle: number, targets: Array<Ship & { id: number }>, asteroids: Asteroid[], graphics: Phaser.GameObjects.Graphics): void {
        this.sttTrack = null

        const { targetsInRange, asteroidsInRange } = this.filterTargetsAndAsteroidsInScanArea(startAngle, endAngle, targets, asteroids)
        const visibleTargets = this.radarDetection.getVisibleTargets(targetsInRange, asteroidsInRange)
        this.tracks = this.twsTrackManager.updateTracks(this.tracks, visibleTargets)

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

    getRwrContacts(): RwrContact[] {
        return this.rwr?.getContacts() ?? [];
    }

    getPrimaryRwrContact(): RwrContact | null {
        return this.rwr?.getPrimaryContact() ?? null;
    }

    flyInDirectionOfShip(m: Missile): { targetDirX: number, targetDirY: number } {
        return this.missileGuidance.flyInDirectionOfShip(m)
    }

    trackInDirectionOfTarget(m: Missile): { targetDirX: number, targetDirY: number } | null {
        return this.missileGuidance.trackInDirectionOfTarget(m, this.mode, this.sttTrack, this.tracks)
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