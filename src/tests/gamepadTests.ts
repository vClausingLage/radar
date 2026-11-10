import Phaser from 'phaser';
import { GameTest, TestContext } from './testHarness';
import { Target } from '../entities/ship';
import { RADAR_DEFAULT_RANGE_PX } from '../radar/data/radarGameSettings';
import { gamepadSettings, landingSettings, playerShipSettings } from '../settings';
import { AudioPlayer } from '../audio/audioPlayer';
import { ShipStartup, StartupStepKey } from '../audio/startup';

// In-game tests for the gamepad bindings. A fake pad stands behind
// navigator.getGamepads(), so a press travels the real way: Phaser polls the
// browser, sees the edge, and the player's controller acts on it.

const PAD = Phaser.Input.Gamepad.Configs.XBOX_360;

// Standard-mapping pad: 17 buttons, 4 axes.
const BUTTON_COUNT = 17;
const AXIS_COUNT = 4;

// Frames for a button held longer than one poll, to prove it acts only once.
const HOLD_FRAMES = 5;
// Frames over which the turn rate is measured.
const TURN_FRAMES = 30;
// Inside the ring, where a cargo hull is held steadily.
const CONTACT_RANGE_PX = RADAR_DEFAULT_RANGE_PX * 0.5;
const ACQUIRE_MAX_FRAMES = 400;
// Trigger travel either side of TRIGGER_PRESS_THRESHOLD.
const TRIGGER_LIGHT_TOUCH = 0.2;
const TRIGGER_PART_PULL = 0.7;

class FakePad {
    private buttons = Array.from({ length: BUTTON_COUNT }, () => ({ pressed: false, touched: false, value: 0 }));
    private axes = new Array<number>(AXIS_COUNT).fill(0);
    private timestamp = performance.now();

    constructor() {
        Object.defineProperty(navigator, 'getGamepads', {
            configurable: true,
            value: () => [{
                id: 'Fake standard pad', index: 0, connected: true, mapping: 'standard',
                timestamp: this.timestamp, buttons: this.buttons, axes: this.axes, vibrationActuator: null,
            }],
        });
    }

    async press(ctx: TestContext, index: number, travel = 1): Promise<void> {
        this.buttons[index].pressed = true;
        this.buttons[index].value = travel;
        this.timestamp = performance.now();
        await ctx.frames(HOLD_FRAMES);
        this.buttons[index].pressed = false;
        this.buttons[index].value = 0;
        this.timestamp = performance.now();
        await ctx.frames(1);
    }

    async setStick(ctx: TestContext, deflection: number): Promise<void> {
        this.axes[PAD.LEFT_STICK_H] = deflection;
        this.timestamp = performance.now();
        await ctx.frames(1);
    }

    // Centre the stick for Phaser's copy of the pad, which outlives the test,
    // then give the browser its own getGamepads back.
    async unplug(ctx: TestContext): Promise<void> {
        await this.setStick(ctx, 0);
        delete (navigator as unknown as { getGamepads?: unknown }).getGamepads;
    }
}

async function withPad(ctx: TestContext, run: (pad: FakePad) => Promise<void>): Promise<void> {
    const pad = new FakePad();
    await ctx.frames(1);
    try {
        await run(pad);
    } finally {
        await pad.unplug(ctx);
    }
}

async function acquireContact(ctx: TestContext): Promise<Target> {
    const drone = ctx.scene.spawnDrone({
        bearingDeg: ctx.player.getDirection(), rangePx: CONTACT_RANGE_PX, hull: 'cargo', side: 'hostile',
    });
    ctx.check('the radar holds a track to work with',
        await ctx.waitUntil(() => ctx.player.radar.getTracks().length > 0, ACQUIRE_MAX_FRAMES));
    return drone;
}

function selectedWeapon(ctx: TestContext): string | undefined {
    return Object.entries(ctx.player.radar['fireControl'].getLoadout()).find(([, slot]) => slot.active)?.[0];
}

const r1StepsTheModeLoop: GameTest = {
    name: 'Gamepad: R1 steps RWS, TWS, IRST, EMCON and back, once per press',
    description: 'R1 is held for several polls at each step, so a press that repeated would skip a mode.',
    async run(ctx) {
        await withPad(ctx, async pad => {
            const radar = ctx.player.radar;
            radar.enterRws();
            for (const expected of ['tws', 'irst', 'emcon', 'rws']) {
                await pad.press(ctx, PAD.RB);
                ctx.check(`R1 steps to ${expected}`, radar.getMode() === expected, radar.getMode());
            }
        });
    },
};

const lockAndBreakLock: GameTest = {
    name: 'Gamepad: B locks, A fires on the lock, R1 breaks it back to RWS',
    description: 'A cargo hull sits ahead inside the ring. B enters STT on it, A launches the selected '
        + 'missile, and R1 leaves STT for RWS rather than continuing the loop.',
    async run(ctx) {
        await withPad(ctx, async pad => {
            const radar = ctx.player.radar;
            await acquireContact(ctx);

            await pad.press(ctx, PAD.B);
            ctx.check('B enters STT', radar.getMode() === 'stt', radar.getMode());

            const weapon = selectedWeapon(ctx) ?? '';
            const before = radar.getWeaponLoad(weapon);
            await pad.press(ctx, PAD.A);
            ctx.check('A launches one missile', radar.getWeaponLoad(weapon) === before - 1,
                `${before} -> ${radar.getWeaponLoad(weapon)}`);

            await pad.press(ctx, PAD.RB);
            ctx.check('R1 breaks the lock back to RWS', radar.getMode() === 'rws', radar.getMode());
        });
    },
};

const defensiveAndWeaponButtons: GameTest = {
    name: 'Gamepad: X chaff, Y jammer, D-pad left weapon, D-pad up IFF',
    description: 'One press of each, read off the subsystem it drives.',
    async run(ctx) {
        await withPad(ctx, async pad => {
            const ship = ctx.player;
            const decoys = ship['remainingDecoys'];
            await pad.press(ctx, PAD.X);
            ctx.check('X drops one decoy', ship['remainingDecoys'] === decoys - 1, `${decoys} -> ${ship['remainingDecoys']}`);

            await pad.press(ctx, PAD.Y);
            ctx.check('Y starts the jammer', ship.radar['jammer'].isActive());

            const weapon = selectedWeapon(ctx);
            await pad.press(ctx, PAD.LEFT);
            ctx.check('D-pad left changes the selected weapon', selectedWeapon(ctx) !== weapon, `${weapon} -> ${selectedWeapon(ctx)}`);

            await acquireContact(ctx);
            const track = ship.radar.getTracks()[0];
            await pad.press(ctx, PAD.UP);
            ctx.check('D-pad up interrogates the track', track.iff !== undefined);
        });
    },
};

const stickTurnsInProportion: GameTest = {
    name: 'Gamepad: the left stick turns the ship in proportion, with a deadzone',
    description: 'Heading change over a fixed span: a stick inside the deadzone leaves it alone, half '
        + 'deflection turns at about half the rate of full, and left is the mirror of right.',
    async run(ctx) {
        await withPad(ctx, async pad => {
            const ship = ctx.player;
            ship.setCurrentSpeed(playerShipSettings.SPEED);

            const turnedBy = async (deflection: number): Promise<number> => {
                await pad.setStick(ctx, deflection);
                const start = ship.angle;
                await ctx.frames(TURN_FRAMES);
                return Phaser.Math.Angle.WrapDegrees(ship.angle - start);
            };

            const drift = await turnedBy(gamepadSettings.STICK_DEADZONE / 2);
            const full = await turnedBy(1);
            const half = await turnedBy(0.5);
            const left = await turnedBy(-1);
            await pad.setStick(ctx, 0);

            ctx.check('inside the deadzone the heading holds', Math.abs(drift) < 0.01, `${drift.toFixed(3)} deg`);
            ctx.check('full right turns right', full > 0, `${full.toFixed(2)} deg`);
            ctx.check('half deflection turns at about half the rate', Math.abs(half / full - 0.5) < 0.15, `${half.toFixed(2)} deg vs ${full.toFixed(2)} deg`);
            ctx.check('full left mirrors full right', Math.abs(left + full) < Math.abs(full) * 0.15, `${left.toFixed(2)} deg vs ${full.toFixed(2)} deg`);
        });
    },
};

const throttleSteps: GameTest = {
    name: 'Gamepad: L1 and L2 step the throttle, stopping at each end',
    description: 'From rest L1 climbs 1/3, 2/3, FULL and holds there; L2 comes back down to REV and holds. '
        + 'Each is held over several polls, so a press that repeated would skip a setting. '
        + 'L2 is an analog trigger: a part pull counts, a light touch does not.',
    async run(ctx) {
        await withPad(ctx, async pad => {
            const ship = ctx.player;
            const full = ship.getSpeed();
            const near = (speed: number) => Math.abs(ship.getCurrentSpeed() - speed) < 1e-6;
            await ctx.frames(1);
            ship.setCurrentSpeed(0);

            for (const [label, speed] of [['1/3', full / 3], ['2/3', (full * 2) / 3], ['FULL', full], ['FULL still', full]] as const) {
                await pad.press(ctx, PAD.LB);
                ctx.check(`L1 to ${label}`, near(speed), `${ship.getCurrentSpeed()}`);
            }

            await pad.press(ctx, PAD.LT, TRIGGER_LIGHT_TOUCH);
            ctx.check('a light touch on L2 holds the setting', near(full), `${ship.getCurrentSpeed()}`);
            await pad.press(ctx, PAD.LT, TRIGGER_PART_PULL);
            ctx.check('a part pull on L2 steps down', near((full * 2) / 3), `${ship.getCurrentSpeed()}`);

            const reverse = -landingSettings.REVERSE_SPEED;
            for (const [label, speed] of [['1/3', full / 3], ['REV', reverse], ['REV still', reverse]] as const) {
                await pad.press(ctx, PAD.LT);
                ctx.check(`L2 to ${label}`, near(speed), `${ship.getCurrentSpeed()}`);
            }
        });
    },
};

const coldShipHasNoThrottle: GameTest = {
    name: 'Gamepad: L1 and L2 do nothing while the throttle is locked',
    description: 'The cold start hides the touch throttle and locks the pad with it, so L1 cannot fly a '
        + 'ship off the pad before the procedure has finished.',
    async run(ctx) {
        await withPad(ctx, async pad => {
            const ship = ctx.player;
            const controller = ship.controller;
            await ctx.frames(1);
            ship.setCurrentSpeed(0);

            controller?.setThrottleLocked(true);
            try {
                await pad.press(ctx, PAD.LB);
                await pad.press(ctx, PAD.LT);
                ctx.check('the ship stays at rest', ship.getCurrentSpeed() === 0, `${ship.getCurrentSpeed()}`);
            } finally {
                controller?.setThrottleLocked(false);
            }
            await pad.press(ctx, PAD.LB);
            ctx.check('unlocked, L1 opens the throttle', ship.getCurrentSpeed() > 0, `${ship.getCurrentSpeed()}`);
        });
    },
};

// Long enough for the slowest switch: the ack delay, then an engine spooling up.
const SWITCH_MAX_FRAMES = 400;

const startThrowsColdStartSwitches: GameTest = {
    name: 'Gamepad: Start throws the cold-start switches in order, never over a running one',
    description: 'A real procedure with its intercom stubbed out. A second press while a switch is still '
        + 'running must not skip ahead: the order and the waits belong to the procedure.',
    async run(ctx) {
        await withPad(ctx, async pad => {
            const busy: StartupStepKey[] = [];
            const done: StartupStepKey[] = [];
            const intercom = {
                playMessage: (_keys: string[], then: () => void) => { then(); return true; },
            } as unknown as AudioPlayer;
            const startup = new ShipStartup(ctx.scene, intercom, {
                onStepBusy: step => busy.push(step),
                onStepDone: step => done.push(step),
                onEngineStart: () => {},
                onComplete: () => {},
            });
            ctx.scene['startup'] = startup;
            try {
                await pad.press(ctx, PAD.START);
                await pad.press(ctx, PAD.START);
                ctx.check('a press while BAT is running changes nothing', busy.length === 1, busy.join(' '));

                for (let thrown = 1; thrown <= 4; thrown++) {
                    await ctx.waitUntil(() => done.length === thrown, SWITCH_MAX_FRAMES);
                    if (thrown < 4) await pad.press(ctx, PAD.START);
                }
                ctx.check('all four switches ran in order', done.join(' ') === 'BAT ENG1 ENG2 SYS', done.join(' '));
                ctx.check('the procedure is complete', startup.isComplete());
            } finally {
                ctx.scene['startup'] = undefined;
            }
        });
    },
};

export const gamepadTests: GameTest[] = [
    r1StepsTheModeLoop,
    lockAndBreakLock,
    defensiveAndWeaponButtons,
    stickTurnsInProportion,
    throttleSteps,
    coldShipHasNoThrottle,
    startThrowsColdStartSwitches,
];
