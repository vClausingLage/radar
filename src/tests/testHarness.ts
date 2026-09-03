import Phaser from 'phaser';
import { TestScene } from '../scenes/testScene';
import { PlayerShip } from '../entities/ship';

// Runner for the in-game tests.
//
// A test is an async function that places ships, lets the real game loop run for
// a number of frames, and then asserts on what the radar systems ended up
// believing. It never advances the game itself: it awaits frames, and whatever
// drives the game (the browser's animation frame, or game.step() from the
// console) advances them. So the same test works live and under automation.
//
// Two things are pinned for the duration of a run:
//  - Math.random, reseeded per test. The radar equation is probabilistic by
//    design, so an unseeded run would answer differently every time and a
//    failure would tell you nothing.
//  - the sound mute flag, since a run fires missiles and radio callouts.

export type Check = { label: string; ok: boolean; detail: string };

export type TestResult = {
    name: string;
    description: string;
    checks: Check[];
    passed: boolean;
    error?: string;
};

export type TestReport = {
    results: TestResult[];
    passed: number;
    failed: number;
    seed: number;
};

export type TestContext = {
    scene: TestScene;
    player: PlayerShip;
    // Advance the game by `count` frames, resuming between the frame that
    // completes the wait and the next one.
    frames(count: number): Promise<void>;
    // Advance until `predicate` holds, giving up after `maxFrames`. Returns
    // whether it held — a test asserts on that rather than trusting it.
    waitUntil(predicate: () => boolean, maxFrames: number): Promise<boolean>;
    // Record an assertion. A test passes when it records at least one check and
    // all of them hold.
    check(label: string, ok: boolean, detail?: string): void;
};

export type GameTest = {
    name: string;
    description: string;
    run: (ctx: TestContext) => Promise<void>;
};

// Fixed by default, so a failure means the behaviour changed, not the dice.
export const DEFAULT_TEST_SEED = 20260820;

// Frames allowed for the scene restart between tests to complete.
const SCENE_RESTART_MAX_FRAMES = 600;

// Advances promises in step with the game loop. Hooked to the game's POST_STEP
// rather than to a scene's update, so waits survive the scene restart between
// tests — during which no scene updates at all.
class FramePacer {
    private waiters: { framesLeft: number; resolve: () => void }[] = [];

    private onStep = (): void => {
        if (this.waiters.length === 0) return;
        const due = this.waiters.filter(w => --w.framesLeft <= 0);
        this.waiters = this.waiters.filter(w => w.framesLeft > 0);
        due.forEach(w => w.resolve());
    };

    constructor(private readonly game: Phaser.Game) {
        this.game.events.on(Phaser.Core.Events.POST_STEP, this.onStep);
    }

    frames(count: number): Promise<void> {
        return new Promise<void>(resolve => {
            this.waiters.push({ framesLeft: Math.max(1, Math.floor(count)), resolve });
        });
    }

    async until(predicate: () => boolean, maxFrames: number): Promise<boolean> {
        for (let i = 0; i < maxFrames; i++) {
            if (predicate()) return true;
            await this.frames(1);
        }
        return predicate();
    }

    destroy(): void {
        this.game.events.off(Phaser.Core.Events.POST_STEP, this.onStep);
        this.waiters = [];
    }
}

// Small deterministic PRNG (mulberry32) — enough for a repeatable radar run.
function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Tear the test scene down and build it again, so each test starts from a fresh
// player, radar and world rather than inheriting the last test's track picture.
//
// Stop and start are separate waits on purpose. Scene transitions are queued and
// processed on the next step, so a scene asked to restart still reports itself
// as running with a live player for one more frame — long enough for a test to
// build its geometry inside a scene that is about to be thrown away, and then
// measure a world that no longer exists.
async function restartTestScene(game: Phaser.Game, pacer: FramePacer): Promise<TestScene | null> {
    // A run can be started from anywhere (the menu, mid-game, the console), so
    // clear whatever scene is up first — otherwise it keeps rendering and
    // stepping its own ships underneath the test.
    game.scene.getScenes(true).forEach(scene => game.scene.stop(scene.scene.key));
    const stopped = await pacer.until(
        () => game.scene.getScenes(true).length === 0,
        SCENE_RESTART_MAX_FRAMES,
    );
    if (!stopped) return null;

    game.scene.start('Tests');
    const ready = await pacer.until(() => {
        const scene = game.scene.getScene('Tests') as TestScene | null;
        return Boolean(scene && game.scene.isActive('Tests') && scene.getPlayer());
    }, SCENE_RESTART_MAX_FRAMES);
    if (!ready) return null;

    // One full frame of the new scene, so the test starts from a world that has
    // already updated once rather than from create()'s initial state.
    await pacer.frames(1);
    return game.scene.getScene('Tests') as TestScene;
}

async function runOne(game: Phaser.Game, pacer: FramePacer, test: GameTest): Promise<TestResult> {
    const checks: Check[] = [];
    const scene = await restartTestScene(game, pacer);
    const player = scene?.getPlayer();

    if (!scene || !player) {
        return {
            name: test.name,
            description: test.description,
            checks,
            passed: false,
            error: 'test scene did not start',
        };
    }

    const ctx: TestContext = {
        scene,
        player,
        frames: count => pacer.frames(count),
        waitUntil: (predicate, maxFrames) => pacer.until(predicate, maxFrames),
        check: (label, ok, detail = '') => { checks.push({ label, ok, detail }); },
    };

    let error: string | undefined;
    try {
        await test.run(ctx);
    } catch (e) {
        error = e instanceof Error ? e.message : String(e);
    }

    // The rig's own assertion. Several of these tests assert that nothing
    // happened — no track, no warning — which is also exactly what a scene that
    // died under the test would report, so prove the world was still there.
    ctx.check('test rig stayed live', scene.getPlayer() === player && player.active);

    return {
        name: test.name,
        description: test.description,
        checks,
        passed: !error && checks.length > 0 && checks.every(c => c.ok),
        error,
    };
}

export async function runGameTests(
    game: Phaser.Game,
    tests: GameTest[],
    seed: number = DEFAULT_TEST_SEED,
): Promise<TestReport> {
    const pacer = new FramePacer(game);
    const realRandom = Math.random;
    const mutedBefore = game.sound.mute;
    game.sound.mute = true;

    const results: TestResult[] = [];
    try {
        for (const test of tests) {
            // Reseeded per test, so one test's dice rolls cannot shift another's.
            Math.random = seededRandom(seed);
            results.push(await runOne(game, pacer, test));
        }
    } finally {
        Math.random = realRandom;
        game.sound.mute = mutedBefore;
        pacer.destroy();
    }

    const report: TestReport = {
        results,
        passed: results.filter(r => r.passed).length,
        failed: results.filter(r => !r.passed).length,
        seed,
    };
    reportToConsole(report);
    reportToScreen(game, report);
    return report;
}

function reportToConsole(report: TestReport): void {
    const summary = `RADAR TESTS - ${report.passed} passed, ${report.failed} failed (seed ${report.seed})`;
    console.log(summary);

    for (const result of report.results) {
        console.groupCollapsed(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name}`);
        console.log(result.description);
        if (result.error) console.error(result.error);
        for (const check of result.checks) {
            console.log(`${check.ok ? '  ok  ' : '  FAIL'} ${check.label}${check.detail ? ` - ${check.detail}` : ''}`);
        }
        console.groupEnd();
    }
}

// Best-effort: the results overlay is a convenience, and drawing it needs a
// live canvas the run itself does not. A headless or backgrounded renderer can
// refuse to build the text, and losing the whole report to that would be a poor
// trade — the console copy and the returned object are the results that matter.
function reportToScreen(game: Phaser.Game, report: TestReport): void {
    try {
        renderResultsOverlay(game, report);
    } catch (e) {
        console.warn('RADAR TESTS - could not draw the on-screen results', e);
    }
}

function renderResultsOverlay(game: Phaser.Game, report: TestReport): void {
    const scene = game.scene.getScene('Tests') as TestScene | null;
    if (!scene || !game.scene.isActive('Tests')) return;

    const lines = report.results.flatMap(result => [
        { text: `${result.passed ? '[PASS]' : '[FAIL]'} ${result.name}`, ok: result.passed },
        ...result.checks.map(check => ({
            text: `    ${check.ok ? 'ok  ' : 'FAIL'} ${check.label}${check.detail ? ` - ${check.detail}` : ''}`,
            ok: check.ok,
        })),
        ...(result.error ? [{ text: `    !   ${result.error}`, ok: false }] : []),
    ]);

    scene.showResults(
        `RADAR TESTS - ${report.passed} passed, ${report.failed} failed (seed ${report.seed})`,
        lines,
    );
}
