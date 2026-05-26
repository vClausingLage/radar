import { PlayerShip, Target } from "../../entities/ship";
import { Asteroid } from "../../entities/asteroid";
import { Track } from "../data/track";

import { Emitter } from "./modules/emitter";

import { RwrContact } from "./rwr";

import { InterfaceRenderer } from "../renderer/interfaceRenderer";
import { RadarRenderer } from "../renderer/radarRenderer";

import { playerShipSettings } from "../../settings";
import { Loadout } from "../../types";

import { Ray } from "../../physics/ray";

export interface IRadar {

}

type Mode = 'rws' | 'tws' | 'stt';

type Entity = PlayerShip | Target | Asteroid;

export class Radar implements IRadar {
    private owner: Entity | null = null;

    private mode: Mode = 'rws';
    private range: number = 700;
    private antenna = new Antenna();
    private emitter: Emitter = new Emitter(this.range);

    private trackingComputer = new TrackingComputer();
    public rwrReceiver = new RwrReceiver();
    public loadoutManager = new LoadoutManager();

    public eventEmitter = new RadarEventEmitter()

    private interfaceRenderer: InterfaceRenderer | null = null;
    private radarRenderer: RadarRenderer = new RadarRenderer();


    constructor(_params: {
        scene: Phaser.Scene;
    }) {
        this.radarRenderer.setScene(_params.scene);
    }


    setInterfaceRenderer(renderer: InterfaceRenderer): void {
        this.interfaceRenderer = renderer;
    }
    getInterfaceRenderer(): InterfaceRenderer | null {
        return this.interfaceRenderer;
    }

    attachTo(owner: Entity): void {
        this.owner = owner;
    }

    setMode(mode: Mode): void {
        this.mode = mode;
    }
    getMode(): Mode {
        return this.mode;
    }

    start(): void {
        // Start radar scanning logic
    }

    stop(): void {
        // Stop radar scanning logic
    }

    update(_delta: number, _direction: number, entities: Entity[], graphics: Phaser.GameObjects.Graphics): void {
        if (!this.owner || !('getDirection' in this.owner)) return;

        const scanWidth = this.antenna.getAzimuth(this.mode);
        const shipDirection = this.owner.getDirection();
        const scanStartAngle = shipDirection - scanWidth / 2;
        const scanEndAngle = shipDirection + scanWidth / 2;

        // PULSE
        const pulseDirection = this.antenna.update(this.mode, shipDirection);
        const pulse = this.emitter.sendPulse(
            { x: this.owner.x, y: this.owner.y },
            pulseDirection,
            scanWidth,
        );

        this.radarRenderer.update(
            graphics,
            { x: this.owner.x, y: this.owner.y },
            this.range,
            scanStartAngle,
            scanEndAngle,
            [],
            this.loadoutManager.getLoadout(),
            [],
            pulse,
        );

        const targets = entities.filter(e => e.id !== this.owner?.id);
        for (const target of targets) {
            // const targetCircle = target.getCircle();
            // const hits = Phaser.Geom.Intersects.GetLineToCircle(pulse.line, targetCircle);
            // const nearestHit =
            // hits.length === 0
            //     ? null
            //     : hits.reduce((nearest, p) => {
            //         const dNearest = Phaser.Math.Distance.Squared(
            //         pulse.line.x1, pulse.line.y1,
            //         nearest.x, nearest.y
            //         );
            //         const dCurrent = Phaser.Math.Distance.Squared(
            //         pulse.line.x1, pulse.line.y1,
            //         p.x, p.y
            //         );
            //         return dCurrent < dNearest ? p : nearest;
            //     }, hits[0]);

            // if (nearestHit) {
            //     graphics.fillStyle(0x800080, 1);
            //     graphics.fillCircleShape(new Phaser.Geom.Circle(nearestHit.x, nearestHit.y, 3));
            // }
            const origin = { x: this.owner.x, y: this.owner.y };
            const rayEnd = {
            x: origin.x + Math.cos(Phaser.Math.DegToRad(pulseDirection)) * this.range,
            y: origin.y + Math.sin(Phaser.Math.DegToRad(pulseDirection)) * this.range
            };
            const ray = new Phaser.Geom.Line(origin.x, origin.y, rayEnd.x, rayEnd.y);

            const nearest = Ray.getNearestBodyIntersection(this.owner, ray, origin, targets);
            if (nearest && this.owner instanceof PlayerShip) {
            console.log('Nearest body hit:', nearest.entity.id, nearest.point);
            }
        }
    }

    shoot(_angle: number): void {
        // Handle shooting logic, emit events, and manage missile tracks
    }

    setTracks(tracks: Track[]): void {
        // Set list of tracks
        this.trackingComputer.setTracks(tracks);
    }
    getTracks(): Track[] {
        // Return list of current tracks
        return this.trackingComputer.getTracks();
    }
}

class RadarEventEmitter {
    private emitter: Phaser.Events.EventEmitter = new Phaser.Events.EventEmitter();

    emitRadarTrack() {
        this.emitter.emit('radar-track');
    }

    emitLockEvent(): boolean {
        this.emitter.emit('lock');
        return false;
    }

    emitMissileTrackEvent() {
        this.emitter.emit('missile-track');
    }
}

class TrackingComputer {
    private tracks: Track[] = [];
    setTracks(tracks: Track[]): void {
        this.tracks = tracks;
    }
    getTracks(): Track[] {
        return this.tracks;
    }
}

class RwrReceiver {
    getRwrSignals(): RwrContact[] {
        return [];
    }
    getPrimaryRwrContact(): RwrContact | null {
        return null;
    }
    getLastFiredMissileHudText(): string | null {
        return null;
    }
}

class LoadoutManager {
    private loadout: Loadout = playerShipSettings.LOADOUT;

    setLoadout(loadout: Loadout): void {
        this.loadout = loadout;
    }
    getLoadout() {
        return this.loadout;
    }
}

class Antenna {
    private shipDirection: number = 0;
    private angleOffset: number = 0;
    private step: number = 1;
    private sweepDirection: 1 | -1 = 1;

    update(mode: Mode, shipDirection: number): number {
        this.shipDirection = shipDirection;

        const halfAzimuth = this.getAzimuth(mode) / 2;

        if (this.angleOffset < -halfAzimuth || this.angleOffset > halfAzimuth) {
            this.angleOffset = -halfAzimuth;
            this.sweepDirection = 1;
        }

        this.angleOffset += this.step * this.sweepDirection;

        if (this.angleOffset >= halfAzimuth) {
            this.angleOffset = halfAzimuth;
            this.sweepDirection = -1;
        } else if (this.angleOffset <= -halfAzimuth) {
            this.angleOffset = -halfAzimuth;
            this.sweepDirection = 1;
        }

        return this.shipDirection + this.angleOffset;
    }

    public getAzimuth(mode: Mode): number {
        switch (mode) {
            case 'rws':
                return 60;
            case 'tws':
                return 45;
            case 'stt':
                return 10;
        }
    }
}
