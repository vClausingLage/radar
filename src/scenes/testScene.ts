import Phaser from 'phaser';
import Game from './game';
import { GasCloud } from '../entities/gasCloud';
import { Asteroid } from '../entities/asteroid';
import { PlayerShip, Target } from '../entities/ship';

// The scene the in-game radar tests run in.
//
// It is the real game — same factories, same player ship, same per-frame radar,
// physics and AI loop — with an empty world, so a test builds exactly the
// geometry it wants to measure and nothing else emits, moves or shoots. Tests
// that ran against a hand-built rig instead would only prove the rig works.
export class TestScene extends Game {
    // Text lines of the results overlay, cleared before each render.
    private resultLines: Phaser.GameObjects.Text[] = [];

    constructor() {
        super('Tests');
    }

    // A test owns the whole world: no scenario ships, no briefing overlay.
    protected buildScenario(): void {}
    protected showBriefing(): void {}

    create(): void {
        super.create();
        // Every test states its geometry as a bearing and range from the player,
        // so the player holds station — under its own power it would drift a
        // tenth of a pixel per frame and slowly invalidate those ranges.
        this.player?.setCurrentSpeed(0);
    }

    getPlayer(): PlayerShip | undefined {
        return this.player;
    }

    // Place an inert reflector at a bearing/range from the player.
    //
    // A drone is a prop, not an opponent: its AI is detached (so it neither
    // manoeuvres nor shoots nor switches its own radar mode behind the test's
    // back) and its transmitter is off unless the test wants it emitting. That
    // way the only emissions in a test are the ones the test asked for, while
    // the hull still reflects the player's beam like any other ship.
    spawnDrone(opts: {
        bearingDeg: number;
        rangePx: number;
        facingDeg?: number;
        emitting?: boolean;
        // Cruise speed in px per step, for tests that need the drone under
        // way (MTI's moving contact). 0 — holding station — by default.
        speed?: number;
        // Which hull to place. It decides how big a reflector the drone is �?"
        // a cargo hauler is more than twice the cross-section of a cruiser
        // broadside, and no bigger than one bow-on �?" so any test about
        // detection range has to say which one it means.
        hull?: 'cruiser' | 'cargo';
    }): Target {
        const player = this.player;
        if (!player) throw new Error('TestScene: no player to place a drone against');

        const rad = Phaser.Math.DegToRad(opts.bearingDeg);
        const drone = this.add.target({
            x: player.x + Math.cos(rad) * opts.rangePx,
            y: player.y + Math.sin(rad) * opts.rangePx,
            // Nose back at the player by default �?" that is the aspect the
            // jamming and RWR geometry care about.
            direction: opts.facingDeg ?? opts.bearingDeg + 180,
            speed: opts.speed ?? 0,
            type: opts.hull ?? 'cruiser',
            activity: 'inactive',
        });

        drone.controller?.destroy();
        drone.controller = undefined;
        if (!opts.emitting) drone.radar.setMode('emcon');

        this.targets.push(drone);
        return drone;
    }

    // Place a solid rock at a bearing/range from the player, sized to the
    // radius a test wants. Registered as terrain, so it shadows every radar
    // in the scene — the ship radar's beam, the ground map and the missile
    // seekers' returns alike.
    spawnAsteroid(opts: {
        bearingDeg: number;
        rangePx: number;
        radiusPx: number;
    }): Asteroid {
        const player = this.player;
        if (!player) throw new Error('TestScene: no player to place a rock from');

        const rad = Phaser.Math.DegToRad(opts.bearingDeg);
        return this.registerTerrain(this.add.asteroid({
            position: {
                x: player.x + Math.cos(rad) * opts.rangePx,
                y: player.y + Math.sin(rad) * opts.rangePx,
            },
            direction: 0,
            speed: 0,
            bodyRadius: opts.radiusPx,
            // A test's rock holds still and holds its shape: no drift, no spin.
            spin: false,
            angle: 0,
        }));
    }

    // Lay a band of absorbing gas across the world, given as a bearing/range
    // from the player (the centre of the band) and the direction the band runs
    // in. Spawned fully formed: a test measures what a cloud does, not how long
    // it took to get there.
    spawnGasCloud(opts: {
        bearingDeg: number;
        rangePx: number;
        alongDeg: number;
        lengthPx: number;
        radius?: number;
        density?: number;
    }): GasCloud {
        const player = this.player;
        if (!player) throw new Error('TestScene: no player to place a cloud against');

        const toCentre = Phaser.Math.DegToRad(opts.bearingDeg);
        const centreX = player.x + Math.cos(toCentre) * opts.rangePx;
        const centreY = player.y + Math.sin(toCentre) * opts.rangePx;

        const along = Phaser.Math.DegToRad(opts.alongDeg);
        const halfX = Math.cos(along) * opts.lengthPx / 2;
        const halfY = Math.sin(along) * opts.lengthPx / 2;

        const cloud = this.add.gasCloud({
            from: { x: centreX - halfX, y: centreY - halfY },
            to: { x: centreX + halfX, y: centreY + halfY },
            radius: opts.radius,
            density: opts.density,
            spreadMs: 0,
        });

        this.gasClouds.push(cloud);
        return cloud;
    }

    // Draw the finished run over the world, so the result is visible in the game
    // rather than only in the console.
    showResults(title: string, lines: { text: string; ok: boolean }[]): void {
        this.resultLines.forEach(line => line.destroy());
        this.resultLines = [];

        const header = this.add.text(16, 12, title, {
            font: '18px Courier',
            color: '#ffffff',
            backgroundColor: '#000000cc',
            padding: { x: 8, y: 4 },
        }).setScrollFactor(0).setDepth(2000);
        this.resultLines.push(header);

        lines.forEach((line, i) => {
            this.resultLines.push(this.add.text(16, 48 + i * 20, line.text, {
                font: '14px Courier',
                color: line.ok ? '#00ff88' : '#ff4040',
                backgroundColor: '#000000cc',
                padding: { x: 8, y: 2 },
            }).setScrollFactor(0).setDepth(2000));
        });
    }
}
