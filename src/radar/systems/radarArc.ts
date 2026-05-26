import { RadarOptions, Loadout, Vector2 } from '../../types'
import { Track } from '../data/track'
import { Asteroid } from '../../entities/asteroid'
import { Ship } from '../../entities/ship'
import { ActiveRadarMissile, Missile } from '../../entities/missiles'
import { LightRadarRenderer } from '../renderer/lightRadarRenderer'
import { GameMath } from '../../math'
import { RWR, RwrContact, RwrEmitter } from './rwr'
import { RadarDetection, RadarTarget } from './radarDetection'
import { TwsTrackManager } from './twsTrackManager'
import { MissileGuidance } from './missileGuidance'

type RadarMode = 'stt' | 'rws' | 'tws' | 'tws-auto' | 'emcon'
type InterfaceWarningRenderer = { showGoSttWarning: () => void }

type RadarSignal = {
    line: Phaser.Geom.Line
    angleDeg: number
    energy: number
}

type RadarEntityKind = 'ship' | 'asteroid'

type RadarEntityShape = {
    id: number
    kind: RadarEntityKind
    circle: Phaser.Geom.Circle
    x: number
    y: number
    radius: number
    rcs: number
    direction: number
    speed: number
}

type ReturnSignal = {
    entity: RadarEntityShape
    point: Vector2
    distance: number
    angleDeg: number
    energy: number
    snr: number
}

type RadarNoiseSource = {
    id: string
    x: number
    y: number
    power: number
    rcs?: number
}

type RadarEnvironment = {
    noisePower: number
    decoys: RadarEntityShape[]
}

const MODE_AZIMUTH: Record<Exclude<RadarMode, 'emcon' | 'tws-auto'>, number> = {
    rws: 60,
    tws: 30,
    stt: 10,
}

const ENTITY_FILTER_RANGE = 1000

const RADAR_EQUATION = {
    peakTransmitPower: 6e13,
    transmitterGain: 20,
    receiverGain: 20,
    wavelength: 0.12,
    systemLoss: 1.4,
    receiverNoisePower: 1.2e-9,
    minimumSnr: 8,
    rwrDetectionPower: 1.5e7,
    jammerPower: 2.5e12,
}

export class Radar {
    private lastScanTime = 0
    private activeMissiles: Missile[] = []
    private lastFiredMissile: Missile | null = null
    private twsTargetIndex = 0
    private owner: Ship | null = null
    private scene: Phaser.Scene
    private tracks: Track[]
    private sttTrack: Track | null
    private radarOptions: RadarOptions
    private mode: RadarMode
    private loadout: Loadout
    private renderer: LightRadarRenderer | null
    private interfaceRenderer: InterfaceWarningRenderer | null
    private rwr: RWR | null
    private radarDetection: RadarDetection
    private twsTrackManager: TwsTrackManager
    private missileGuidance: MissileGuidance
    private emitter: Emitter
    private receiver: Receiver
    private entities: Entities
    private jammingEnabled = false
    private decoys: RadarNoiseSource[] = []
    private nextDecoyId = 1
    private aim220Waypoints: Vector2[] = []
    public events: Phaser.Events.EventEmitter

    constructor(params: {
        scene: Phaser.Scene
        settings: RadarOptions
        renderer: LightRadarRenderer | null
        mode?: RadarMode
        loadout: Loadout
        tracks?: Track[]
        sttTrack?: Track | null
        interfaceRenderer?: InterfaceWarningRenderer | null
    }) {
        this.scene = params.scene
        this.radarOptions = { ...params.settings, position: { ...params.settings.position } }
        this.tracks = params.tracks || []
        this.sttTrack = params.sttTrack || null
        this.mode = params.mode || 'rws'
        this.loadout = params.loadout
        this.renderer = params.renderer
        this.interfaceRenderer = params.interfaceRenderer || null
        this.rwr = new RWR()
        this.radarDetection = new RadarDetection(this.radarOptions)
        this.twsTrackManager = new TwsTrackManager()
        this.missileGuidance = new MissileGuidance()
        this.emitter = new Emitter(this.scene, RADAR_EQUATION.peakTransmitPower)
        this.receiver = new Receiver()
        this.entities = new Entities(ENTITY_FILTER_RANGE)
        this.events = new Phaser.Events.EventEmitter()
        this.setMode(this.mode)
    }

    attachTo(owner: Ship): void {
        this.owner = owner
    }

    getPosition(): Vector2 {
        return this.radarOptions.position
    }

    setPosition({ x, y }: Vector2 | Phaser.Math.Vector2): void {
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
                this.radarOptions.azimuth = MODE_AZIMUTH.rws
                break
            case 'tws':
                this.radarOptions.azimuth = MODE_AZIMUTH.tws
                break
            case 'stt':
                this.radarOptions.azimuth = MODE_AZIMUTH.stt
                break
            case 'tws-auto':
                this.radarOptions.azimuth = 15
                break
            case 'emcon':
                this.radarOptions.azimuth = 0
                break
        }
        this.emitter.resetSweep()
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
        this.cycleLoadout()
    }

    cycleLoadout(): void {
        const loadoutKeys = Object.keys(this.loadout) as (keyof Loadout)[]
        if (loadoutKeys.length === 0) return

        const currentActiveIndex = loadoutKeys.findIndex((key) => this.loadout[key]?.active === true)
        if (currentActiveIndex !== -1) {
            this.loadout[loadoutKeys[currentActiveIndex]].active = false
        }

        const nextIndex = currentActiveIndex === -1 || currentActiveIndex === loadoutKeys.length - 1
            ? 0
            : currentActiveIndex + 1

        this.loadout[loadoutKeys[nextIndex]].active = true
        if (loadoutKeys[nextIndex] !== 'AIM-220') {
            this.clearAim220Waypoints()
        }
    }

    getActiveWeaponType(): keyof Loadout | null {
        return (Object.keys(this.loadout).find((key) =>
            this.loadout[key as keyof Loadout]?.active
        ) as keyof Loadout | undefined) ?? null
    }

    addAim220Waypoint(point: Vector2): boolean {
        const aim220Loadout = this.loadout['AIM-220']
        if (this.getActiveWeaponType() !== 'AIM-220' || !aim220Loadout || aim220Loadout.load <= 0) {
            return false
        }

        if (this.aim220Waypoints.length >= 2) {
            this.aim220Waypoints = []
        }

        this.aim220Waypoints.push({ x: point.x, y: point.y })
        return true
    }

    getAim220Waypoints(): Vector2[] {
        return this.aim220Waypoints.map((point) => ({ x: point.x, y: point.y }))
    }

    private clearAim220Waypoints(): void {
        this.aim220Waypoints = []
    }

    start(): void {
        this.radarOptions.isScanning = true
    }

    stop(): void {
        this.radarOptions.isScanning = false
        this.emitter.hide()
    }

    setInterfaceRenderer(renderer: InterfaceWarningRenderer): void {
        this.interfaceRenderer = renderer
    }

    setJammingEnabled(enabled: boolean): void {
        this.jammingEnabled = enabled
    }

    deployDecoy(position: Vector2, power = RADAR_EQUATION.jammerPower * 0.2, rcs = 250): string {
        const id = `decoy-${this.nextDecoyId++}`
        this.decoys.push({
            id,
            x: position.x,
            y: position.y,
            power,
            rcs,
        })
        return id
    }

    clearDecoys(): void {
        this.decoys = []
    }

    getRadarNoiseSources(): RadarNoiseSource[] {
        const sources = [...this.decoys]
        if (this.jammingEnabled && this.owner) {
            sources.push({
                id: `jammer-${(this.owner as { id?: number }).id ?? 'unknown'}`,
                x: this.owner.x,
                y: this.owner.y,
                power: RADAR_EQUATION.jammerPower,
            })
        }

        return sources
    }

    getEmitterPowerAtRange(distance: number): number {
        return RadarEquation.oneWayPower(RADAR_EQUATION.peakTransmitPower, RADAR_EQUATION.transmitterGain, distance)
    }

    update(delta: number, angle: number, ships: Ship[], asteroids: Asteroid[], graphics: Phaser.GameObjects.Graphics): void {
        if (this.owner) {
            this.setPosition(this.owner.getPosition())
        }

        const targets = (ships || [])
            .filter((ship) => (this.owner ? ship !== this.owner : true))
            .filter((ship): ship is Ship & { id: number } => typeof (ship as { id?: number }).id === 'number')

        const hostileMissileEmitters = targets.flatMap((target) => target.radar.getActiveRadarRwrEmitters())
        this.rwr?.receive(targets, asteroids, this.radarOptions.range, this.owner, hostileMissileEmitters)

        if (this.radarOptions.isScanning && this.mode !== 'emcon') {
            const signal = this.emitter.emit(delta, this.radarOptions.position, this.radarOptions.range, angle, this.radarOptions.azimuth)
            const environment = this.getRadarEnvironment(targets)
            const shapes = this.entities.getShapes(this.radarOptions.position, ships, asteroids, this.owner, environment.decoys)
            const returnSignal = this.entities.raycast(signal, shapes, environment.noisePower)
            this.receiver.receive(signal, returnSignal)
            this.processReturnSignals(this.receiver.update(delta), graphics)

            if (this.mode === 'stt') {
                this.handleSttMode(delta, angle, targets, graphics)
            }
        } else {
            this.emitter.hide()
        }

        this.updateMissiles(delta)
        this.emitTrackingEvents()

        this.renderer?.renderMissiles(this.activeMissiles)
        const scanArea = this.getScanArea(angle)
        if (scanArea) {
            this.renderer?.renderRadarScanInterface(
                graphics,
                this.radarOptions.position,
                this.radarOptions.range,
                scanArea.startAngle,
                scanArea.endAngle,
                this.radarOptions.range,
                this.activeMissiles,
                this.loadout,
                this.getRenderedAim220Waypoints()
            )
        }
    }

    private processReturnSignals(returnSignals: ReturnSignal[], graphics: Phaser.GameObjects.Graphics): void {
        if (returnSignals.length === 0) return

        const now = this.scene.time.now
        const updatedTracks = [...this.tracks]

        for (const returnSignal of returnSignals) {
            const source = returnSignal.entity
            const existingIndex = updatedTracks.findIndex((track) => track.id === source.id)
            const measuredPoint = this.getTrackPointFromReturn(returnSignal)
            const track: Track = {
                id: source.id,
                pos: measuredPoint,
                dist: returnSignal.distance,
                dir: source.direction,
                speed: source.speed,
                age: 0,
                lastUpdate: now,
                confidence: Phaser.Math.Clamp(returnSignal.snr / RADAR_EQUATION.minimumSnr, 0, 100),
            }

            if (existingIndex >= 0) {
                updatedTracks[existingIndex] = this.mergeTrack(updatedTracks[existingIndex], track, source.radius)
            } else {
                updatedTracks.push(track)
            }

            this.renderReturnSignal(graphics, returnSignal)
        }

        this.tracks = updatedTracks
            .filter((track) => now - track.lastUpdate < 3000)
            .sort((a, b) => a.dist - b.dist)
    }

    private getTrackPointFromReturn(returnSignal: ReturnSignal): Vector2 {
        const entity = returnSignal.entity
        const distanceToCenter = GameMath.getDistance(returnSignal.point.x, returnSignal.point.y, entity.x, entity.y)
        const nearestSurfaceBias = Phaser.Math.Clamp(distanceToCenter / Math.max(entity.radius, 1), 0, 1)

        return {
            x: Phaser.Math.Linear(returnSignal.point.x, entity.x, 1 - nearestSurfaceBias),
            y: Phaser.Math.Linear(returnSignal.point.y, entity.y, 1 - nearestSurfaceBias),
        }
    }

    private mergeTrack(existing: Track, incoming: Track, entityRadius: number): Track {
        const rangeDelta = Math.abs(existing.dist - incoming.dist)
        const positionDelta = GameMath.getDistance(existing.pos.x, existing.pos.y, incoming.pos.x, incoming.pos.y)
        const sameObjectGate = Math.max(entityRadius * 0.75, 12)

        if (rangeDelta > sameObjectGate && positionDelta > sameObjectGate) {
            return incoming
        }

        return {
            ...existing,
            pos: {
                x: Phaser.Math.Linear(existing.pos.x, incoming.pos.x, 0.35),
                y: Phaser.Math.Linear(existing.pos.y, incoming.pos.y, 0.35),
            },
            dist: Phaser.Math.Linear(existing.dist, incoming.dist, 0.35),
            dir: incoming.dir,
            speed: incoming.speed,
            age: existing.age + 1,
            lastUpdate: incoming.lastUpdate,
            confidence: Math.min(100, existing.confidence * 0.85 + incoming.confidence * 0.15),
        }
    }

    private renderReturnSignal(graphics: Phaser.GameObjects.Graphics, returnSignal: ReturnSignal): void {
        const color = returnSignal.entity.kind === 'ship' ? 0x00ff00 : 0x66ffaa
        const markerSize = returnSignal.entity.kind === 'ship' ? 5 : 3
        const marker = graphics.scene?.add.graphics()
        if (!marker) return

        marker.fillStyle(color, 0.75)
        marker.fillCircle(returnSignal.point.x, returnSignal.point.y, markerSize)
        graphics.scene?.tweens.add({
            targets: marker,
            alpha: 0,
            duration: 1600,
            onComplete: () => marker.destroy(),
        })
    }

    private getRadarEnvironment(targets: Array<Ship & { id: number }>): RadarEnvironment {
        const decoys: RadarEntityShape[] = []
        let noisePower = RADAR_EQUATION.receiverNoisePower

        for (const target of targets) {
            for (const source of target.radar.getRadarNoiseSources()) {
                const distance = GameMath.getDistance(this.radarOptions.position.x, this.radarOptions.position.y, source.x, source.y)
                noisePower += RadarEquation.oneWayPower(source.power, RADAR_EQUATION.transmitterGain, distance)

                if (source.rcs !== undefined) {
                    decoys.push(Entities.createDecoyShape(source))
                }
            }
        }

        return { noisePower, decoys }
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
            this.clearSttTrackingAndReturnToRws()
            return
        }

        if (!this.sttTrack) {
            this.sttTrack = this.tracks[0]
        }

        if (!this.refreshSttTrackFromTargets(targets) || !this.isCurrentSttTrackInScan(scanArea.startAngle, scanArea.endAngle)) {
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

    getScanArea(angle: number): { startAngle: number; endAngle: number } | null {
        if (!Number.isFinite(angle)) return null

        const halfAzimuth = this.radarOptions.azimuth / 2
        return {
            startAngle: angle - halfAzimuth,
            endAngle: angle + halfAzimuth,
        }
    }

    shoot(angle: number): void {
        const activeWeaponType = this.getActiveWeaponType()
        if (!activeWeaponType || !this.loadout[activeWeaponType]) return

        const activeWeapon = this.loadout[activeWeaponType]
        if (activeWeapon.load <= 0) return

        const hasAim220WaypointRoute = activeWeaponType === 'AIM-220' && this.aim220Waypoints.length === 2
        let target: Track | undefined

        if (this.mode === 'stt' && this.sttTrack) {
            target = this.sttTrack
        } else if (this.mode === 'tws' && this.tracks.length > 0) {
            target = this.tracks[this.twsTargetIndex]
            this.twsTargetIndex = (this.twsTargetIndex + 1) % this.tracks.length
        }

        if (!target && !hasAim220WaypointRoute) return

        const spawnOffset = 20
        const angleRad = Phaser.Math.DegToRad(angle || 0)
        const missileStartX = this.radarOptions.position.x + Math.cos(angleRad) * spawnOffset
        const missileStartY = this.radarOptions.position.y + Math.sin(angleRad) * spawnOffset

        switch (activeWeaponType) {
            case 'AIM-177': {
                if (this.mode === 'tws') {
                    this.interfaceRenderer?.showGoSttWarning()
                    return
                }

                activeWeapon.load--
                const sarhMissile = this.scene.add.sarhMissile({
                    x: missileStartX,
                    y: missileStartY,
                    dirX: Math.cos(angleRad),
                    dirY: Math.sin(angleRad),
                    owner: this.owner || undefined,
                })
                const ownerNoCollideGroup = this.owner?.getMissileNoCollideGroup()
                if (ownerNoCollideGroup !== undefined) {
                    sarhMissile.setCollisionGroup(ownerNoCollideGroup)
                }
                this.activeMissiles.push(sarhMissile)
                this.lastFiredMissile = sarhMissile
                break
            }
            case 'AIM-220': {
                activeWeapon.load--
                const activeRadarMissile = this.scene.add.activeRadarMissile({
                    x: missileStartX,
                    y: missileStartY,
                    dirX: Math.cos(angleRad),
                    dirY: Math.sin(angleRad),
                    owner: this.owner || undefined,
                })
                const ownerNoCollideGroup = this.owner?.getMissileNoCollideGroup()
                if (ownerNoCollideGroup !== undefined) {
                    activeRadarMissile.setCollisionGroup(ownerNoCollideGroup)
                }
                if (target) {
                    activeRadarMissile.targetId = target.id
                }
                if (this.aim220Waypoints.length === 2) {
                    const [first, directionPoint] = this.aim220Waypoints
                    activeRadarMissile.waypointRoute = {
                        first: { x: first.x, y: first.y },
                        directionPoint: { x: directionPoint.x, y: directionPoint.y },
                        reachedFirst: false,
                    }
                    this.clearAim220Waypoints()
                }
                this.activeMissiles.push(activeRadarMissile)
                this.lastFiredMissile = activeRadarMissile
                break
            }
        }
    }

    updateMissiles(delta: number): void {
        this.activeMissiles = this.missileGuidance.updateMissiles(
            this.activeMissiles,
            delta,
            this.mode,
            this.sttTrack,
            this.tracks,
            this.getTrackableTargets()
        )

        if (this.lastFiredMissile && !this.lastFiredMissile.active) {
            this.lastFiredMissile = null
        }
    }

    filterTargetsAndAsteroidsInScanArea(startAngle: number, endAngle: number, targets: RadarTarget[], asteroids: Asteroid[]): { targetsInRange: RadarTarget[]; asteroidsInRange: Asteroid[] } {
        return this.radarDetection.filterTargetsAndAsteroidsInScanArea(startAngle, endAngle, targets, asteroids)
    }

    radarScan(startAngle: number, endAngle: number, targets: RadarTarget[], asteroids: Asteroid[], graphics: Phaser.GameObjects.Graphics): void {
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
                confidence: this.receiver.getLastSignalEnergy(),
            }]

            this.renderer?.renderRwsContacts(graphics, target, distance)
        }

        this.tracks.sort((a, b) => a.dist - b.dist)
        this.renderer?.renderAsteroids(asteroidsInRange)
        this.lastScanTime = 0
    }

    radarTwsScan(startAngle: number, endAngle: number, targets: RadarTarget[], asteroids: Asteroid[], graphics: Phaser.GameObjects.Graphics): void {
        this.sttTrack = null

        const { targetsInRange, asteroidsInRange } = this.filterTargetsAndAsteroidsInScanArea(startAngle, endAngle, targets, asteroids)
        const visibleTargets = this.radarDetection.getVisibleTargets(targetsInRange, asteroidsInRange)
        this.tracks = this.twsTrackManager.updateTracks(this.tracks, visibleTargets)

        if (this.twsTargetIndex >= this.tracks.length && this.tracks.length > 0) {
            this.twsTargetIndex = 0
        }

        for (const track of this.tracks) {
            const targetObj = targetsInRange.find((target) => target.id === track.id)
            if (targetObj) {
                this.renderer?.renderRwsContacts(graphics, targetObj, track.dist)
            }
        }

        this.renderer?.renderAsteroids(asteroidsInRange)
        this.lastScanTime = 0
    }

    alertTargetBeingTracked(): number | null {
        return this.sttTrack?.id ?? null
    }

    alertRwr(): number[] | null {
        return this.tracks.length > 0 ? this.tracks.map((track) => track.id) : null
    }

    getRwrContacts(): RwrContact[] {
        return this.rwr?.getContacts() ?? []
    }

    getPrimaryRwrContact(): RwrContact | null {
        return this.rwr?.getPrimaryContact() ?? null
    }

    getActiveRadarRwrEmitters(): RwrEmitter[] {
        return this.activeMissiles
            .filter((missile): missile is ActiveRadarMissile => missile instanceof ActiveRadarMissile)
            .filter((missile) => missile.active && missile.isActiveRadarEnabled() && missile.activeRadarTargetId !== null)
            .map((missile) => ({
                emitterId: `missile-${missile.owner ? (missile.owner as { id?: number }).id ?? 'unknown' : 'unknown'}-${missile.targetId ?? 'free'}-${Math.round(missile.x)}-${Math.round(missile.y)}`,
                x: missile.x,
                y: missile.y,
                headingDeg: Phaser.Math.RadToDeg(Math.atan2(missile.direction.y, missile.direction.x)),
                azimuth: missile.activeRadarAzimuth,
                range: missile.activeRadarRange,
                lockedTargetId: missile.activeRadarTargetId,
            }))
    }

    getLastFiredMissileHudText(): string | null {
        if (!this.lastFiredMissile || !this.lastFiredMissile.active || !(this.lastFiredMissile instanceof ActiveRadarMissile)) {
            return null
        }

        if (this.lastFiredMissile.isActiveRadarEnabled()) {
            return 'AIM-220 ACTIVE'
        }

        return `AIM-220 TTA ${this.lastFiredMissile.getTimeToActive().toFixed(1)}`
    }

    flyInDirectionOfShip(missile: Missile): { targetDirX: number; targetDirY: number } {
        return this.missileGuidance.flyInDirectionOfShip(missile)
    }

    trackInDirectionOfTarget(missile: Missile): { targetDirX: number; targetDirY: number } | null {
        return this.missileGuidance.trackInDirectionOfTarget(missile, this.mode, this.sttTrack, this.tracks, this.getTrackableTargets())
    }

    private getTrackableTargets(): Array<Ship & { id: number }> {
        return this.scene.children.list
            .filter((entry): entry is Ship & { id: number } => entry instanceof Ship && entry !== this.owner && typeof (entry as { id?: number }).id === 'number')
    }

    private getRenderedAim220Waypoints(): Vector2[] {
        const routeWaypoints = this.activeMissiles
            .filter((missile): missile is ActiveRadarMissile => missile instanceof ActiveRadarMissile)
            .filter((missile) => missile.active && missile.waypointRoute !== null && !missile.isActiveRadarEnabled())
            .flatMap((missile) => missile.waypointRoute ? [missile.waypointRoute.first, missile.waypointRoute.directionPoint] : [])

        return [...this.aim220Waypoints, ...routeWaypoints]
    }

    private emitTrackingEvents(): void {
        this.events.emit('stt-track', this.sttTrack ? this.sttTrack.id : null)
        this.events.emit('radar-track', this.tracks.map((track) => track.id))
    }
}

export { Radar as LightRadar }

class Entities {
    constructor(private readonly filterRange: number) {}

    static createDecoyShape(source: RadarNoiseSource): RadarEntityShape {
        const radius = Math.sqrt((source.rcs ?? 250) / Math.PI)
        const circle = new Phaser.Geom.Circle(source.x, source.y, radius)

        return {
            id: Entities.hashNoiseSourceId(source.id),
            kind: 'ship',
            circle,
            x: source.x,
            y: source.y,
            radius,
            rcs: source.rcs ?? Math.PI * radius * radius,
            direction: 0,
            speed: 0,
        }
    }

    private static hashNoiseSourceId(id: string): number {
        let hash = 0
        for (let index = 0; index < id.length; index++) {
            hash = (hash * 31 + id.charCodeAt(index)) | 0
        }

        return hash >= 0 ? -hash - 1000 : hash
    }

    getShapes(origin: Vector2, ships: Ship[], asteroids: Asteroid[], owner: Ship | null, decoys: RadarEntityShape[] = []): RadarEntityShape[] {
        const shipShapes = ships
            .filter((ship) => ship !== owner)
            .filter((ship): ship is Ship & { id: number } => typeof (ship as { id?: number }).id === 'number')
            .map((ship) => this.getShipShape(ship))

        const asteroidShapes = asteroids.map((asteroid) => this.getAsteroidShape(asteroid))

        return [...shipShapes, ...asteroidShapes, ...decoys].filter((shape) => {
            const distance = GameMath.getDistance(origin.x, origin.y, shape.x, shape.y)
            return distance <= this.filterRange
        })
    }

    raycast(signal: RadarSignal, shapes: RadarEntityShape[], noisePower: number): ReturnSignal | null {
        let nearest: ReturnSignal | null = null

        for (const shape of shapes) {
            if (!Phaser.Geom.Intersects.LineToCircle(signal.line, shape.circle)) {
                continue
            }

            const intersection = this.getNearestLineCircleIntersection(signal.line, shape.circle)
            if (!intersection) {
                continue
            }

            const distance = GameMath.getDistance(signal.line.x1, signal.line.y1, intersection.x, intersection.y)
            const receivedPower = RadarEquation.monostaticReceivedPower(signal.energy, shape.rcs, distance)
            const snr = RadarEquation.signalToNoise(receivedPower, noisePower)
            if (snr < RADAR_EQUATION.minimumSnr) {
                continue
            }

            if (!nearest || distance < nearest.distance) {
                nearest = {
                    entity: shape,
                    point: intersection,
                    distance,
                    angleDeg: signal.angleDeg,
                    energy: receivedPower,
                    snr,
                }
            }
        }

        return nearest
    }

    private getShipShape(ship: Ship & { id: number }): RadarEntityShape {
        const circle = ship.getCircle()

        return {
            id: ship.id,
            kind: 'ship',
            circle,
            x: ship.x,
            y: ship.y,
            radius: circle.radius,
            rcs: this.getShapeRcs(circle.radius, 1),
            direction: ship.getDirection(),
            speed: ship.getSpeed(),
        }
    }

    private getAsteroidShape(asteroid: Asteroid): RadarEntityShape {
        const circle = asteroid.getCircle()

        return {
            id: asteroid.id,
            kind: 'asteroid',
            circle,
            x: asteroid.x,
            y: asteroid.y,
            radius: circle.radius,
            rcs: this.getShapeRcs(circle.radius, 0.65),
            direction: asteroid.angle,
            speed: 0,
        }
    }

    private getNearestLineCircleIntersection(line: Phaser.Geom.Line, circle: Phaser.Geom.Circle): Vector2 | null {
        const dx = line.x2 - line.x1
        const dy = line.y2 - line.y1
        const fx = line.x1 - circle.x
        const fy = line.y1 - circle.y

        const a = dx * dx + dy * dy
        const b = 2 * (fx * dx + fy * dy)
        const c = fx * fx + fy * fy - circle.radius * circle.radius
        const discriminant = b * b - 4 * a * c

        if (discriminant < 0 || a === 0) return null

        const sqrtDiscriminant = Math.sqrt(discriminant)
        const t1 = (-b - sqrtDiscriminant) / (2 * a)
        const t2 = (-b + sqrtDiscriminant) / (2 * a)
        const t = [t1, t2]
            .filter((value) => value >= 0 && value <= 1)
            .sort((left, right) => left - right)[0]

        if (t === undefined) return null

        return {
            x: line.x1 + dx * t,
            y: line.y1 + dy * t,
        }
    }

    private getShapeRcs(radius: number, reflectivity: number): number {
        return Math.max(1, Math.PI * radius * radius * reflectivity)
    }
}

class RadarEquation {
    static monostaticReceivedPower(transmitPower: number, radarCrossSection: number, range: number): number {
        const clampedRange = Math.max(range, 1)
        const numerator = transmitPower
            * RADAR_EQUATION.transmitterGain
            * RADAR_EQUATION.receiverGain
            * RADAR_EQUATION.wavelength ** 2
            * radarCrossSection
        const denominator = (4 * Math.PI) ** 3 * clampedRange ** 4 * RADAR_EQUATION.systemLoss

        return numerator / denominator
    }

    static oneWayPower(transmitPower: number, gain: number, range: number): number {
        const clampedRange = Math.max(range, 1)
        return transmitPower * gain / (4 * Math.PI * clampedRange ** 2)
    }

    static signalToNoise(signalPower: number, noisePower: number): number {
        return signalPower / Math.max(noisePower, Number.EPSILON)
    }
}

class Emitter {
    private readonly signalLine = new Phaser.Geom.Line()
    private renderLine: Phaser.GameObjects.Line | null = null
    private fadeTween: Phaser.Tweens.Tween | null = null
    private sweepRatio = 0
    private sweepDirection: 1 | -1 = 1

    constructor(
        private readonly scene: Phaser.Scene,
        private readonly energy = 100,
        private readonly sweepSpeedDegPerMs = 0.04
    ) {}

    emit(delta: number, origin: Vector2, range: number, headingDeg: number, azimuthDeg: number): RadarSignal {
        const halfAzimuth = azimuthDeg / 2
        const sweepSpan = Math.max(azimuthDeg, 0)
        const sweepStep = sweepSpan > 0 ? (this.sweepSpeedDegPerMs * delta) / sweepSpan : 0
        this.sweepRatio += sweepStep * this.sweepDirection

        if (this.sweepRatio >= 1) {
            this.sweepRatio = 1
            this.sweepDirection = -1
        } else if (this.sweepRatio <= 0) {
            this.sweepRatio = 0
            this.sweepDirection = 1
        }

        const startAngle = headingDeg - halfAzimuth
        const angleDeg = startAngle + sweepSpan * this.sweepRatio
        const angleRad = Phaser.Math.DegToRad(angleDeg)
        const endX = origin.x + Math.cos(angleRad) * range
        const endY = origin.y + Math.sin(angleRad) * range

        this.signalLine.x1 = origin.x
        this.signalLine.y1 = origin.y
        this.signalLine.x2 = endX
        this.signalLine.y2 = endY
        this.render(this.signalLine)

        return {
            line: this.signalLine,
            angleDeg,
            energy: this.energy,
        }
    }

    resetSweep(): void {
        this.sweepRatio = 0
        this.sweepDirection = 1
    }

    hide(): void {
        this.renderLine?.setVisible(false)
    }

    private render(line: Phaser.Geom.Line): void {
        if (!this.renderLine) {
            this.renderLine = this.scene.add.line(0, 0, line.x1, line.y1, line.x2, line.y2, 0x00ff00, 1)
                .setOrigin(0, 0)
                .setDepth(50)
            this.fadeTween = this.scene.tweens.add({
                targets: this.renderLine,
                alpha: 0.25,
                duration: 180,
                yoyo: true,
                repeat: -1,
            })
        }

        this.renderLine.setVisible(true)
        this.renderLine.setTo(line.x1, line.y1, line.x2, line.y2)
        if (!this.fadeTween?.isPlaying()) {
            this.fadeTween?.play()
        }
    }
}

class Receiver {
    private lastSignalEnergy = 0
    private pendingSignals: Array<{ signal: ReturnSignal; remainingMs: number }> = []

    receive(signal: RadarSignal, returnSignal: ReturnSignal | null): void {
        this.lastSignalEnergy = signal.energy
        if (!returnSignal) return

        this.pendingSignals.push({
            signal: returnSignal,
            remainingMs: returnSignal.distance,
        })
    }

    update(delta: number): ReturnSignal[] {
        const dueSignals: ReturnSignal[] = []
        const pendingSignals: Array<{ signal: ReturnSignal; remainingMs: number }> = []

        for (const pendingSignal of this.pendingSignals) {
            const remainingMs = pendingSignal.remainingMs - delta
            if (remainingMs <= 0) {
                dueSignals.push(pendingSignal.signal)
            } else {
                pendingSignals.push({ ...pendingSignal, remainingMs })
            }
        }

        this.pendingSignals = pendingSignals
        return dueSignals
    }

    getLastSignalEnergy(): number {
        return this.lastSignalEnergy
    }
}
