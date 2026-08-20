import Phaser from 'phaser';
import Game from './game';
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
    }): Target {
        const player = this.player;
        if (!player) throw new Error('TestScene: no player to place a drone against');

        const rad = Phaser.Math.DegToRad(opts.bearingDeg);
        const drone = this.add.target({
            x: player.x + Math.cos(rad) * opts.rangePx,
            y: player.y + Math.sin(rad) * opts.rangePx,
            // Nose back at the player by default — that is the aspect the
            // jamming and RWR geometry care about.
            direction: opts.facingDeg ?? opts.bearingDeg + 180,
            speed: 0,
            type: 'cruiser',
            activity: 'inactive',
        });

        drone.controller?.destroy();
        drone.controller = undefined;
        if (!opts.emitting) drone.radar.setMode('emcon');

        this.targets.push(drone);
        return drone;
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
