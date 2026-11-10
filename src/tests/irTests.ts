import Phaser from 'phaser';
import { GameTest, TestContext } from './testHarness';
import { Target } from '../entities/ship';
import { InfraredMissile } from '../entities/missiles';
import { IRST_FIELD_OF_REGARD_DEG, IRST_SCAN_FRAMES } from '../radar/data/radarGameSettings';

// In-game tests for the infrared side: that a hull's heat depends on aspect
// and throttle the way its engines say it should, that the IRST is a mode of
// its own - transmitter silent, a narrow window off the nose, switched off in
// every other mode - and sees by heat alone, past the radar's ring tail-on and
// nowhere near it nose-on; that gas blinds it far sooner than it blinds the
// radar and terrain blocks it outright, and that the VIM-90 leaves the rail
// only with tone, guides itself to the hull, and never shows on the target's
// RWR.
// Every ship here is a drone; nobody manoeuvres but the missile.

// A 60-degree RWS cone stepped 1 degree per frame: one sweep leg per 60 frames.
const FRAMES_PER_SWEEP = 60;

// A drone built at this speed is at full throttle: the speed a ship is built
// with is its full throttle (Ship.irIntensityToward). Slow enough that a test's
// geometry does not drift in the time it runs.
const CREEP_SPEED = 0.02;

// An IRST contact within this of a hull's bearing is on that hull.
const ON_BEARING_DEG = 2;

type Point = { x: number; y: number };

function bearingTo(ctx: TestContext, p: Point): number {
    return Phaser.Math.RadToDeg(Math.atan2(p.y - ctx.player.y, p.x - ctx.player.x));
}

// Whether the player's IRST has a live contact on the bearing of `p`.
function irstSees(ctx: TestContext, p: Point): boolean {
    const irst = ctx.player.radar.getIrst();
    if (!irst) return false;
    const bearing = bearingTo(ctx, p);
    return irst.getContacts().some(c =>
        c.missedScans === 0 && Math.abs(Phaser.Math.Angle.WrapDegrees(c.bearingDeg - bearing)) <= ON_BEARING_DEG);
}

// A hot hull: a drone running at full throttle, its tail toward the player
// (facing away) or its nose (facing the player).
function spawnHot(ctx: TestContext, bearingDeg: number, rangePx: number, aspect: 'tail' | 'nose'): Target {
    return ctx.scene.spawnDrone({
        bearingDeg, rangePx, hull: 'cargo', speed: CREEP_SPEED,
        facingDeg: aspect === 'tail' ? bearingDeg : bearingDeg + 180,
    });
}

function press(ctx: TestContext, key: string): void {
    ctx.scene.input.keyboard?.emit(`keydown-${key}`);
}

// (a) The signature itself, read straight off the hull from three places at
// the same range: astern, ahead, and astern again with the engines stopped.
const signatureByAspectAndThrottle: GameTest = {
    name: 'IR: a hull is hottest from astern at full throttle, dim from ahead, nearly dark stopped',
    description: 'One drone, read from dead astern, dead ahead and abeam at full throttle, then from astern '
        + 'with its speed at zero: the tail outshines the nose several times over and the stopped hull is dimmest.',
    async run(ctx) {
        const drone = spawnHot(ctx, ctx.player.getDirection(), 300, 'tail');
        const rad = Phaser.Math.DegToRad(drone.angle);
        const at = (offDeg: number): Point => {
            const r = rad + Phaser.Math.DegToRad(offDeg);
            return { x: drone.x + Math.cos(r) * 200, y: drone.y + Math.sin(r) * 200 };
        };
        const ahead = drone.irIntensityToward(at(0));
        const abeam = drone.irIntensityToward(at(90));
        const astern = drone.irIntensityToward(at(180));
        drone.setCurrentSpeed(0);
        const stopped = drone.irIntensityToward(at(180));

        const detail = `astern ${astern.toFixed(3)}, abeam ${abeam.toFixed(3)}, ahead ${ahead.toFixed(3)}, stopped ${stopped.toFixed(3)}`;
        ctx.check('astern is the brightest aspect', astern > abeam && abeam > ahead, detail);
        ctx.check('the tail outshines the nose at least five times over', astern >= 5 * ahead, detail);
        ctx.check('a stopped hull is dimmer than the same hull nose-on under power', stopped < ahead, detail);
    },
};

// (b) Passive, so the transmitter is silent - and nobody is warned. One hull
// tail-on beyond the radar's ring, one nose-on at the same range, both inside
// the IRST's narrow window: the first is seen, the second is not; brought to
// 300 px, the nose is seen.
const irstSeesByHeat: GameTest = {
    name: 'IRST: sees a hot tail past the radar ring in IRST mode, a nose only close in, and warns no one',
    description: 'Radar in IRST mode. A tail-on drone at 750 px, 5 degrees off the nose, is an IRST contact; a '
        + 'nose-on one at 750 px is not, but is once moved to 300 px. Neither drone ever has anything on its RWR.',
    async run(ctx) {
        ctx.player.radar.enterIrst();
        const boresight = ctx.player.getDirection();
        const tail = spawnHot(ctx, boresight - 5, 750, 'tail');
        const nose = spawnHot(ctx, boresight + 5, 750, 'nose');

        let warned = false;
        const watch = () => {
            if (tail.radar.rwrReceiver.getRwrSources().length > 0) warned = true;
            if (nose.radar.rwrReceiver.getRwrSources().length > 0) warned = true;
            return false;
        };
        await ctx.waitUntil(watch, IRST_SCAN_FRAMES * 3);
        ctx.check('the tail-on hull at 750 px is an IRST contact', irstSees(ctx, tail));
        ctx.check('the nose-on hull at 750 px is not', !irstSees(ctx, nose));

        const r = Phaser.Math.DegToRad(boresight + 5);
        nose.setPosition(ctx.player.x + Math.cos(r) * 300, ctx.player.y + Math.sin(r) * 300);
        await ctx.waitUntil(watch, IRST_SCAN_FRAMES * 3);
        ctx.check('brought to 300 px, the nose-on hull is seen', irstSees(ctx, nose));
        ctx.check('the radar never left IRST mode', ctx.player.radar.getMode() === 'irst');
        ctx.check('neither hull was ever warned', !warned);
    },
};

// (c) The medium. A thin band of gas across the line of sight to a hot tail:
// the IRST loses it outright, while the radar - paying for the same gas twice,
// out and back, but in a band gas barely absorbs - keeps tracking it. The two
// are one display, so each is asked in its own mode, one after the other.
const gasBlindsIrstBeforeRadar: GameTest = {
    name: 'IRST: a gas band the radar still sees through blinds it',
    description: 'A tail-on cargo hull at 250 px is an IRST contact (IRST mode) and a radar track (RWS). A thin '
        + 'gas band laid across the line between: in IRST mode the contact is gone, in RWS the track stays.',
    async run(ctx) {
        const radar = ctx.player.radar;
        const boresight = ctx.player.getDirection();
        const drone = spawnHot(ctx, boresight, 250, 'tail');
        const tracked = () => radar.getTracks().some(t =>
            Phaser.Math.Distance.Between(t.pos.x, t.pos.y, drone.x, drone.y) < 60);

        // The radar track is built in the clear and then held through the gas:
        // a creeping hull behind gas sits in the clutter's Doppler notch, so
        // the question is whether the track survives, not whether it can be
        // started there.
        radar.enterIrst();
        const seen = await ctx.waitUntil(() => irstSees(ctx, drone), IRST_SCAN_FRAMES * 3);
        radar.enterRws();
        const held = await ctx.waitUntil(tracked, FRAMES_PER_SWEEP * 6);
        // ... and let it mature, as it had all along when the IRST still ran
        // beside the radar: a young track is coasted for fewer missed scans.
        await ctx.frames(FRAMES_PER_SWEEP * 6);
        ctx.check('in clear space it is an IRST contact and a radar track', seen && held,
            `IRST ${seen}, radar ${held}`);

        // 220 px of path at density 0.45: IR keeps exp(-99 x 0.03) = 5 % of the
        // heat (signal ~0.65, blind), the radar exp(-99 x 0.016) = 20 % of
        // its round trip (still ~12x over the floor at this range). Thin rather
        // than dense, so the gas's own clutter does not raise the CFAR floor.
        ctx.scene.spawnGasCloud({
            bearingDeg: boresight, rangePx: 125, alongDeg: boresight + 90, lengthPx: 500, radius: 110, density: 0.45,
        });
        let irstFrames = 0;
        let trackFrames = 0;
        const frames = FRAMES_PER_SWEEP * 6;
        const samples = frames / 10;
        await ctx.frames(FRAMES_PER_SWEEP);
        for (let f = 0; f < frames; f += 10) {
            await ctx.frames(10);
            if (tracked()) trackFrames++;
        }
        radar.enterIrst();
        await ctx.frames(IRST_SCAN_FRAMES * 2);
        for (let f = 0; f < frames; f += 10) {
            await ctx.frames(10);
            if (irstSees(ctx, drone)) irstFrames++;
        }
        ctx.check('behind the gas the IRST never sees it', irstFrames === 0, `${irstFrames}/${samples} samples`);
        ctx.check('the radar still tracks it most of the time', trackFrames >= samples * 0.6, `${trackFrames}/${samples} samples`);
    },
};

// (d) Terrain: a rock between the sensor and a hot tail hides it completely;
// the same tail beside the rock, in the clear, is seen.
const terrainBlocksIrst: GameTest = {
    name: 'IRST: a rock in the line of sight hides a hot tail',
    description: 'IRST mode. Two tail-on drones at 400 px, one straight behind a small rock at 200 px, one 8 '
        + 'degrees aside, still inside the window: only the one in the clear is an IRST contact.',
    async run(ctx) {
        ctx.player.radar.enterIrst();
        const boresight = ctx.player.getDirection();
        ctx.scene.spawnAsteroid({ bearingDeg: boresight, rangePx: 200, radiusPx: 15 });
        const hidden = spawnHot(ctx, boresight, 400, 'tail');
        const clear = spawnHot(ctx, boresight + 8, 400, 'tail');
        await ctx.frames(IRST_SCAN_FRAMES * 3);
        ctx.check('the drone in the clear is seen', irstSees(ctx, clear));
        ctx.check('the drone behind the rock is not', !irstSees(ctx, hidden));
    },
};

// (e) The whole IR shot with the radar silent: IRST mode, lock (E), VIM-90, a
// hit - and the target's RWR says nothing the whole way, because nothing in
// the chain transmits. The target sits off the nose, so the missile has to
// turn onto it: proportional navigation on its own seeker's line of sight.
const vim90OnIrstLockHits: GameTest = {
    name: 'VIM-90: launched on an IRST lock in IRST mode, it guides itself to the hull unannounced',
    description: 'Radar in IRST mode, a tail-on drone at 220 px, 6 degrees off the nose. E locks it, Space '
        + 'releases a VIM-90; the drone is destroyed and its RWR never shows a thing.',
    async run(ctx) {
        ctx.player.radar.enterIrst();
        const drone = spawnHot(ctx, ctx.player.getDirection() + 6, 220, 'tail');
        await ctx.waitUntil(() => irstSees(ctx, drone), IRST_SCAN_FRAMES * 3);

        press(ctx, 'E');
        const irst = ctx.player.radar.getIrst();
        ctx.check('E locks the IRST', irst?.isLocked() === true);
        ctx.check('the lock key did not leave IRST mode', ctx.player.radar.getMode() === 'irst');
        ctx.player.radar.selectWeapon('VIM-90');
        let missile: InfraredMissile | null = null;
        const onSpawn = (m: unknown) => { if (m instanceof InfraredMissile) missile = m; };
        ctx.scene.events.on('missile-spawned', onSpawn);
        press(ctx, 'SPACE');
        ctx.scene.events.off('missile-spawned', onSpawn);
        ctx.check('a VIM-90 leaves the rail', missile !== null && ctx.player.radar.getWeaponLoad('VIM-90') === 1,
            `load ${ctx.player.radar.getWeaponLoad('VIM-90')}`);

        let warned = false;
        const hit = await ctx.waitUntil(() => {
            if (drone.active && drone.radar.rwrReceiver.getRwrSources().length > 0) warned = true;
            return !drone.active;
        }, 60 * 9);
        ctx.check('the drone is hit', hit);
        ctx.check('its RWR never showed the shooter or the missile', !warned);
    },
};

// (f) Tone. Cued by a radar lock, the seeker has to see heat down that line
// itself: nose-on at 330 px it does not and the round stays on the rail;
// turned tail-on at the same range it does and the round goes.
const vim90NeedsTone: GameTest = {
    name: 'VIM-90: on an STT cue it needs tone - none nose-on at 330 px, tone tail-on',
    description: 'The radar locks a cargo drone 330 px out. Nose-on, Space with VIM-90 selected is refused '
        + '(no tone) and the load stays at 2; the drone turned tail-on, the same press releases a round.',
    async run(ctx) {
        const boresight = ctx.player.getDirection();
        const drone = spawnHot(ctx, boresight, 330, 'nose');
        const radar = ctx.player.radar;
        await ctx.waitUntil(() => radar.getTracks().length > 0, FRAMES_PER_SWEEP * 6);
        radar.enterStt();
        const locked = await ctx.waitUntil(() => radar.getSttTrack() !== null, 60);
        ctx.check('the radar holds a lock', locked);

        radar.selectWeapon('VIM-90');
        press(ctx, 'SPACE');
        ctx.check('nose-on: no tone, nothing released', radar.getWeaponLoad('VIM-90') === 2,
            `load ${radar.getWeaponLoad('VIM-90')}`);

        drone.setAngle(bearingTo(ctx, drone));
        drone.setCurrentSpeed(CREEP_SPEED);
        await ctx.frames(5);
        ctx.check('the lock held through the turn', radar.getSttTrack() !== null);
        press(ctx, 'SPACE');
        ctx.check('tail-on: tone, the round goes', radar.getWeaponLoad('VIM-90') === 1,
            `load ${radar.getWeaponLoad('VIM-90')}`);
    },
};

// (g) The mode itself. The IRST works only in IRST mode, looks only inside its
// narrow window, and switching to a radar mode switches it off: contacts and
// lock gone. The transmitter is silent in IRST mode, so a drone dead ahead is
// never warned.
const irstIsItsOwnMode: GameTest = {
    name: 'IRST: its own mode - a narrow window off the nose, off in every other mode',
    description: 'Two tail-on drones at 300 px, one 4 degrees off the nose and one just outside the IRST window. '
        + 'In IRST mode only the inner drone is a contact and is never warned, E locks it, and stepping on '
        + 'to EMCON clears contacts and lock. Back in RWS the IRST stays empty.',
    async run(ctx) {
        const radar = ctx.player.radar;
        const irst = radar.getIrst();
        const boresight = ctx.player.getDirection();
        // IRST before anything radiates: an RWR keeps a contact for a while
        // after the beam has gone, so a search sweep first would leave one.
        radar.enterIrst();
        const inside = spawnHot(ctx, boresight + 4, 300, 'tail');
        const outside = spawnHot(ctx, boresight - (IRST_FIELD_OF_REGARD_DEG / 2 + 4), 300, 'tail');

        let warned = false;
        await ctx.waitUntil(() => {
            if (inside.radar.rwrReceiver.getRwrSources().length > 0) warned = true;
            return false;
        }, IRST_SCAN_FRAMES * 3);
        ctx.check('in IRST mode the drone inside the window is a contact', irstSees(ctx, inside));
        ctx.check('the drone just outside the window is not', !irstSees(ctx, outside));
        ctx.check('the transmitter is silent: the drone ahead is never warned', !warned && !radar.isTransmitting());

        press(ctx, 'E');
        ctx.check('E locks the IRST', irst?.isLocked() === true);
        press(ctx, 'X');
        ctx.check('X steps on to EMCON', radar.getMode() === 'emcon', radar.getMode());
        ctx.check('leaving IRST mode drops lock and contacts',
            irst?.isLocked() === false && irst?.getContacts().length === 0);

        radar.enterRws();
        await ctx.frames(IRST_SCAN_FRAMES * 3);
        ctx.check('in RWS the IRST holds no contacts', irst?.getContacts().length === 0,
            `${irst?.getContacts().length} contacts`);
    },
};

export const irTests: GameTest[] = [
    signatureByAspectAndThrottle,
    irstIsItsOwnMode,
    irstSeesByHeat,
    gasBlindsIrstBeforeRadar,
    terrainBlocksIrst,
    vim90OnIrstLockHits,
    vim90NeedsTone,
];
