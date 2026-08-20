import Phaser from 'phaser';
import { TestScene } from '../scenes/testScene';
import { runGameTests, TestReport } from './testHarness';
import { radarTests } from './radarTests';

// DEV-only wiring for the in-game tests: registers the test scene and hangs the
// runner off the window, so a run can be started from the start menu, from the
// console, or by loading the page with ?tests.
//
// Imported dynamically (and only under import.meta.env.DEV) so none of this —
// nor the test scene it pulls in — reaches a production build.

// How often the manual stepper gives the browser a real task turn, so pending
// loads and other event-driven work can complete mid-run.
const MANUAL_STEP_TASK_YIELD_FRAMES = 20;

// Tucked into the top-right corner, clear of the menu's own layout at any
// window size.
const START_MENU_BUTTON_MARGIN_PX = 16;

type TestWindow = Window & {
    runRadarTests?: (seed?: number) => Promise<TestReport>;
    stepGame?: (frames: number, deltaMs?: number) => Promise<void>;
    radarTestReport?: TestReport;
};

export function installTestHooks(game: Phaser.Game): void {
    game.scene.add('Tests', TestScene, false);

    const testWindow = window as TestWindow;

    testWindow.runRadarTests = async (seed?: number) => {
        const report = await runGameTests(game, radarTests, seed);
        testWindow.radarTestReport = report;
        return report;
    };

    // Drive the game loop by hand. A backgrounded tab throttles
    // requestAnimationFrame to a crawl (or stops it entirely), so browser
    // automation has to supply the frames itself.
    //
    // Two kinds of yield are needed between frames: a microtask so the awaiting
    // test resumes in step with the game, and — less often — a real task, since
    // asset loading finishes on events (a scene stuck in LOADING never leaves it
    // if the loop hogs the call stack).
    let manualTime = performance.now();
    testWindow.stepGame = async (frames: number, deltaMs = 1000 / 60) => {
        for (let i = 0; i < frames; i++) {
            manualTime += deltaMs;
            game.step(manualTime, deltaMs);
            await (i % MANUAL_STEP_TASK_YIELD_FRAMES === 0
                ? new Promise<void>(resolve => setTimeout(resolve, 0))
                : Promise.resolve());
        }
    };

    addStartMenuButton(game, () => { void testWindow.runRadarTests?.(); });

    // ?tests runs the suite on load. This module is imported asynchronously, so
    // the game may already be up by the time it lands — waiting for READY alone
    // would wait for an event that has been and gone.
    if (new URLSearchParams(window.location.search).has('tests')) {
        const start = (): void => { void testWindow.runRadarTests?.(); };
        if (game.isRunning) start();
        else game.events.once(Phaser.Core.Events.READY, start);
    }
}

// Put a RUN RADAR TESTS button on the start menu. Added from here rather than by
// the menu itself: the menu has no business knowing about the test suite, and
// this way nothing about it survives into a production build. Re-attached on
// every create, since the menu is rebuilt whenever it is returned to.
function addStartMenuButton(game: Phaser.Game, run: () => void): void {
    const menu = game.scene.getScene('StartMenu');
    if (!menu) return;

    const attach = (scene: Phaser.Scene): void => {
        const button = scene.add.text(
            scene.scale.width - START_MENU_BUTTON_MARGIN_PX,
            START_MENU_BUTTON_MARGIN_PX,
            'RUN RADAR TESTS',
            {
                fontSize: '16px',
                color: '#00ff88',
                backgroundColor: '#001a11',
                padding: { x: 12, y: 6 },
            },
        ).setOrigin(1, 0).setInteractive();

        button.on('pointerdown', run);
        button.on('pointerover', () => button.setStyle({ backgroundColor: '#00ff88', color: '#001a11' }));
        button.on('pointerout', () => button.setStyle({ backgroundColor: '#001a11', color: '#00ff88' }));
    };

    if (game.scene.isActive('StartMenu')) attach(menu);
    menu.events.on(Phaser.Scenes.Events.CREATE, attach);
}
