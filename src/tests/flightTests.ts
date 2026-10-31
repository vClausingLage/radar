import Phaser from 'phaser';
import { GameTest, TestContext } from './testHarness';
import { Flight } from '../controller/flight';
import { Target } from '../entities/ship';
import { ActiveRadarMissile } from '../entities/missiles';
import { Track } from '../radar/data/track';
import { AiUnitController } from '../controller/aiUnitController';
import { formationSettings, tacticSettings, targetShipSettings } from '../settings';
import { PPLI_CORRELATION_PX, PPLI_STALE_MS } from '../radar/data/radarGameSettings';
import { MissileGuidance } from '../radar/systems/modules/missileGuidance';

// In-game tests for two-ship flights: that the pair flies together without
// colliding, that the datalink keeps it from treating its own wingman as an
// enemy (the radar cannot tell sides - only the PPLI can), and that none of
// that blinds it to a real one. Every ship here is scripted: a test never
// reaches the network.

// A 60-degree RWS cone stepped 1 degree per frame: one sweep leg per 60 frames.
const FRAMES_PER_SWEEP = 60;

// Hull centres closer than this have touched: a cruiser is ~28 px across, so
// two hulls overlap below ~28. The floor leaves a margin for the hull's
// corners, which stick out past that average.
const MIN_SAFE_SEPARATION_PX = 35;

// Sample the pair every other frame: separation changes by well under a pixel
// a frame, so nothing slips between samples.
const SAMPLE_EVERY_FRAMES = 2;

// Half of the 60 degree RWS search cone: the widest scan a target has to keep
// two ships in.
const RWS_HALF_AZIMUTH_DEG = 30;

// A wing within this of its station counts as "on station".
const ON_STATION_PX = 60;

type PairStats = {
    minSeparation: number;
    bothAliveThroughout: boolean;
    onStationFraction: number;
};

// Fly the flight for `frameCount` frames, recording the closest the hulls
// came, whether both survived and how much of the time the wing held station.
async function flyAndMeasure(ctx: TestContext, flight: Flight, frameCount: number): Promise<PairStats> {
    let minSeparation = Infinity;
    let alive = true;
    let onStation = 0;
    let samples = 0;
    for (let f = 0; f < frameCount; f += SAMPLE_EVERY_FRAMES) {
        await ctx.frames(SAMPLE_EVERY_FRAMES);
        const { lead, wing } = flight;
        if (!lead.active || !lead.body || !wing.active || !wing.body) { alive = false; break; }
        minSeparation = Math.min(minSeparation, Phaser.Math.Distance.Between(lead.x, lead.y, wing.x, wing.y));
        const station = flight.stationPosition();
        if (Phaser.Math.Distance.Between(wing.x, wing.y, station.x, station.y) <= ON_STATION_PX) onStation++;
        samples++;
    }
    return { minSeparation, bothAliveThroughout: alive, onStationFraction: samples ? onStation / samples : 0 };
}

// A route of right-hand then left-hand 90-degree turns from `start`, legs of
// `leg` px. With the wing on the right, the right turns swing the lead's nose
// toward the wing - the dangerous direction - and the left turns away from it.
function zigzagRoute(start: { x: number; y: number }, leg: number): { x: number; y: number }[] {
    const { x, y } = start;
    return [
        { x: x + leg, y },                  // east
        { x: x + leg, y: y + leg },         // south: right turn, toward a wing on the right
        { x: x, y: y + leg },               // west: right turn
        { x: x, y: y },                     // north: right turn
        { x: x - leg, y: y },               // west: left turn, away from the wing
        { x: x - leg, y: y + leg },         // south: left turn
        { x: x, y: y + leg },               // east: left turn
    ];
}

// Hold the player quiet so nothing it radiates warns, draws or hunts the
// flight under test.
function silencePlayer(ctx: TestContext): void {
    ctx.player.radar.enterEmcon();
}

// (a) Formation without collisions, at the speed where a turn is a real
// manoeuvre (turn radius ~134 px) through turns toward and away from the wing.
const holdsStationThroughTurns: GameTest = {
    name: 'A flight holds formation through turns without touching',
    description: 'A scripted pair flies a route of right turns (toward the wing) and left turns (away): '
        + 'both survive, the hulls never come near each other, and the wing is on station most of the run.',
    async run(ctx) {
        silencePlayer(ctx);
        const start = { x: 1200, y: 1100 };
        const flight = ctx.scene.spawnFlight({ ...start, direction: 0, speed: 0.7 });
        flight.lead.controller?.setRoute(zigzagRoute(start, 400));

        const stats = await flyAndMeasure(ctx, flight, 2400);
        ctx.check('both ships survive the run', stats.bothAliveThroughout);
        ctx.check('hulls never come near each other', stats.minSeparation >= MIN_SAFE_SEPARATION_PX,
            `closest ${stats.minSeparation.toFixed(1)} px (floor ${MIN_SAFE_SEPARATION_PX})`);
        ctx.check('wing is on station most of the run', stats.onStationFraction >= 0.5,
            `${(stats.onStationFraction * 100).toFixed(0)}% of samples within ${ON_STATION_PX} px`);
    },
};

// (b) The same at the real patrol speed, where the turn radius (~19 px) is
// smaller than the spacing: the lead pirouettes and its hull swings at the
// wing. A tight square of waypoints keeps the lead turning toward the wing the
// whole time. Then the wing is thrown across to the wrong side of the lead,
// so it has to cross the lead's wake to reach its station.
const clearsLeadInTightTurns: GameTest = {
    name: 'A wing never touches its lead in tight turns or while catching up',
    description: 'At patrol speed the lead turns on a 19 px radius toward its wing, and the wing '
        + 'starts on the lead\'s far side and must come across: the hulls stay apart throughout.',
    async run(ctx) {
        silencePlayer(ctx);
        const start = { x: 1200, y: 1100 };
        const flight = ctx.scene.spawnFlight({ ...start, direction: 0, speed: 0.1 });
        // A 200 px square, flown clockwise, inside the 150 px waypoint-reached
        // radius's reach: the lead is turning right, toward the wing, nearly
        // all the time.
        const square = [
            { x: start.x + 200, y: start.y }, { x: start.x + 200, y: start.y + 200 },
            { x: start.x, y: start.y + 200 }, { x: start.x, y: start.y },
        ];
        flight.lead.controller?.setRoute([...square, ...square, ...square, ...square]);

        const turning = await flyAndMeasure(ctx, flight, 1500);

        // Throw the wing across to the lead's other side: it has to pass the
        // lead to get back to station.
        const station = flight.stationPosition();
        flight.wing.setPosition(2 * flight.lead.x - station.x, 2 * flight.lead.y - station.y);
        const catching = await flyAndMeasure(ctx, flight, 1500);

        ctx.check('both ships survive', turning.bothAliveThroughout && catching.bothAliveThroughout);
        ctx.check('hulls stay apart while the lead turns toward the wing',
            turning.minSeparation >= MIN_SAFE_SEPARATION_PX, `closest ${turning.minSeparation.toFixed(1)} px`);
        ctx.check('hulls stay apart while the wing catches up',
            catching.minSeparation >= MIN_SAFE_SEPARATION_PX, `closest ${catching.minSeparation.toFixed(1)} px`);
    },
};

// (c) No fratricide. A flight alone in an empty world: each radar paints the
// other ship on every sweep and each RWR hears the other's radar. The tracks
// must come back tagged friendly, the warnings must be filtered, and neither
// ship may lock, shoot, hunt or evade over it.
const noFratricide: GameTest = {
    name: 'A flight does not treat its own wingman as a contact',
    description: 'Two ships patrol an empty world with radars on: their radars track each other and their '
        + 'RWRs hear each other, yet neither ever hostile-tracks, locks, fires on, hunts or evades the other.',
    async run(ctx) {
        silencePlayer(ctx);
        // A zigzag route, twice round: the pair flies abreast, and an abreast
        // wingman sits 90 degrees off the nose, outside the 60 degree cone. It is
        // the turns that swing it into view.
        const start = { x: 1200, y: 1100 };
        const flight = ctx.scene.spawnFlight({ ...start, direction: 0, speed: 0.7 });
        const route = zigzagRoute(start, 400);
        flight.lead.controller?.setRoute([...route, ...route]);
        const ships: [Target, Target] = [flight.lead, flight.wing];
        const other = (ship: Target): Target => (ship === flight.lead ? flight.wing : flight.lead);

        let friendlyTrackFrames = 0;
        let hostileTrackOnWingman = 0;
        let heardWingman = 0;
        let rwrShowsWingman = 0;
        const badStates = new Set<string>();
        let lockedOnWingman = false;

        for (let f = 0; f < 2400; f += SAMPLE_EVERY_FRAMES) {
            await ctx.frames(SAMPLE_EVERY_FRAMES);
            for (const ship of ships) {
                const buddy = other(ship);
                const near = (p: { x: number; y: number }): boolean =>
                    Phaser.Math.Distance.Between(p.x, p.y, buddy.x, buddy.y) <= PPLI_CORRELATION_PX;
                if (ship.radar.getTracks().some(t => near(t.pos) && t.friendly)) friendlyTrackFrames++;
                if (ship.radar.getHostileTracks().some(t => near(t.pos))) hostileTrackOnWingman++;
                if (ship.radar.rwrReceiver.getFriendlyContacts().length > 0) heardWingman++;
                if (ship.radar.rwrReceiver.getRwrSignals().length > 0) rwrShowsWingman++;
                const lock = ship.radar.getSttTrack();
                if (lock && near(lock.pos)) lockedOnWingman = true;
                const state = ship.controller?.getStateName();
                if (state && ['EVADE', 'HUNT'].includes(state)) badStates.add(state);
            }
        }

        ctx.check('the radars did track the wingman (tagged friendly)', friendlyTrackFrames > 0,
            `${friendlyTrackFrames} sampled frames with a friendly track`);
        ctx.check('no hostile track is ever held on the wingman', hostileTrackOnWingman === 0,
            `${hostileTrackOnWingman} sampled frames`);
        ctx.check('the RWRs did hear the wingman', heardWingman > 0, `${heardWingman} sampled frames`);
        ctx.check('the wingman never reaches the warning picture', rwrShowsWingman === 0,
            `${rwrShowsWingman} sampled frames showed a contact`);
        // Not "never engages": a thermal false alarm is a track like any other
        // and may draw the lead's attention (the doctrine working, as in the
        // tactician tests). What matters is that it is never the wingman -
        // above - and that the wingman's emissions never provoke a defence.
        ctx.check('neither ever evades or hunts on the wingman\'s emissions',
            badStates.size === 0, badStates.size ? `entered ${[...badStates].join(', ')}` : 'stayed out of EVADE and HUNT');
        ctx.check('no lock was ever held on the wingman', !lockedOnWingman);
    },
};

// (c2) The weapons end of the same filter. The wingman sits dead ahead of the
// lead in its TWS cone, plainly tracked: the trigger is pulled and the lock
// requested. A track the datalink has identified is not a firing solution.
const fireControlRefusesWingman: GameTest = {
    name: 'Fire control will not shoot or lock a wingman',
    description: 'The wingman sits 250 px ahead of the lead, tracked and tagged friendly: pulling the '
        + 'trigger in TWS launches nothing and requesting STT leaves the radar searching.',
    async run(ctx) {
        silencePlayer(ctx);
        const start = { x: 1200, y: 1100 };
        const flight = ctx.scene.spawnFlight({ ...start, direction: 0, speed: 0, inert: true });
        flight.wing.setPosition(start.x + 250, start.y);
        const { lead } = flight;
        lead.radar.enterTws();

        const tagged = await ctx.waitUntil(() => lead.radar.getTracks().some(t =>
            t.friendly && Phaser.Math.Distance.Between(t.pos.x, t.pos.y, flight.wing.x, flight.wing.y) < 100), 600);
        ctx.check('the lead tracks the wingman and tags it friendly', tagged);

        lead.radar.selectWeapon('VIM-220');
        lead.radar.shoot();
        ctx.check('the trigger launches nothing', lead.radar.getWeaponLoad('VIM-220') === 2,
            `VIM-220 load ${lead.radar.getWeaponLoad('VIM-220')}`);
        lead.radar.enterStt();
        ctx.check('a lock request is refused', lead.radar.getMode() !== 'stt', `mode ${lead.radar.getMode()}`);
    },
};

// (d) The friend filter must not blind the flight. An emitting prop dead ahead:
// the lead hunts it, tracks it and shoots it, wingman or no wingman.
const stillFights: GameTest = {
    name: 'A flight still tracks and engages a real enemy',
    description: 'An emitting drone sits ahead of the flight: its lead tracks the drone (not the wingman), '
        + 'turns into the engagement and launches. (With one target the flight flies a tactic: shooter/cover has '
        + 'the wingman take the opening shot, so it launches too - the lead after it.)',
    async run(ctx) {
        silencePlayer(ctx);
        const start = { x: 1200, y: 1100 };
        const flight = ctx.scene.spawnFlight({ ...start, direction: 0, speed: 0.1 });
        // On the player's code: the flight's enemy, not its friend (see placeDrone).
        const drone = ctx.scene.spawnDrone({ bearingDeg: 0, rangePx: 1, facingDeg: 180, emitting: true, side: 'friendly' });
        drone.setPosition(start.x + 350, start.y);
        drone.setCurrentSpeed(0);

        let tracked = false;
        const fired = await ctx.waitUntil(() => {
            if (flight.lead.radar.getHostileTracks().some(t =>
                Phaser.Math.Distance.Between(t.pos.x, t.pos.y, drone.x, drone.y) < 120)) tracked = true;
            return flight.lead.radar.getWeaponLoad('VIM-220') < 2 || flight.lead.radar.getWeaponLoad('VIM-177') < 4;
        }, 3600);

        ctx.check('the lead holds a hostile track on the drone', tracked);
        ctx.check('the lead launches on it', fired,
            `loads VIM-220 ${flight.lead.radar.getWeaponLoad('VIM-220')}, VIM-177 ${flight.lead.radar.getWeaponLoad('VIM-177')}`);
        const wingFired = flight.wing.radar.getWeaponLoad('VIM-220') < 2 || flight.wing.radar.getWeaponLoad('VIM-177') < 4;
        ctx.check('the wingman takes its shot too, as the shooter of shooter/cover', wingFired);
    },
};

// (e) What the player's radar makes of the pair. Abreast and 80 px apart,
// a flight is not two contacts to a nose-on radar even at 500 px: the tracking
// computer associates every return within TRACK_GATE_RADIUS_PX (200) of an
// existing track with that track, so the pair is held as one track riding
// between the two hulls. (The resolution cell, S / tan(beamwidth) ~ 1500 px,
// would be the limit only if the gate did not get there first.) Pull the wing
// out past the gate and the same radar holds two.
const pairReadsAsOneContact: GameTest = {
    name: 'A flight in formation reads as one contact; split up it reads as two',
    description: 'The player looks nose-on at an abreast pair 500 px away: its radar holds one track riding '
        + 'between the hulls. With the wing 240 px out it holds two, one on each ship.',
    async run(ctx) {
        const boresight = ctx.player.getDirection();
        const rangePx = 500;
        const rad = Phaser.Math.DegToRad(boresight);
        const flight = ctx.scene.spawnFlight({
            x: ctx.player.x + Math.cos(rad) * rangePx,
            y: ctx.player.y + Math.sin(rad) * rangePx,
            direction: boresight + 180,
            speed: 0,
            inert: true,
        });

        // Tracks within reach of the pair, sampled over eight sweeps. A sweep
        // can miss a hull on a bad Pd roll, so the claims are about the
        // picture over time: the most tracks ever held, and whether any one
        // of them sat close to both hulls.
        const picture = async (): Promise<{ maxTracks: number; sharedTrack: boolean; onEach: boolean }> => {
            let maxTracks = 0;
            let sharedTrack = false;
            let onEach = false;
            for (let f = 0; f < FRAMES_PER_SWEEP * 8; f += 10) {
                await ctx.frames(10);
                const mid = { x: (flight.lead.x + flight.wing.x) / 2, y: (flight.lead.y + flight.wing.y) / 2 };
                const around = ctx.player.radar.getTracks().filter(t =>
                    Phaser.Math.Distance.Between(t.pos.x, t.pos.y, mid.x, mid.y) < 250);
                maxTracks = Math.max(maxTracks, around.length);
                const within = (t: { pos: { x: number; y: number } }, ship: Target, px: number): boolean =>
                    Phaser.Math.Distance.Between(t.pos.x, t.pos.y, ship.x, ship.y) < px;
                if (around.some(t => within(t, flight.lead, formationSettings.SPACING_PX)
                    && within(t, flight.wing, formationSettings.SPACING_PX))) sharedTrack = true;
                const onLead = around.find(t => within(t, flight.lead, 60));
                const onWing = around.find(t => within(t, flight.wing, 60));
                if (onLead && onWing && onLead.id !== onWing.id) onEach = true;
            }
            return { maxTracks, sharedTrack, onEach };
        };

        const together = await picture();
        ctx.check('in formation the pair is one track', together.maxTracks === 1,
            `most tracks held near the pair: ${together.maxTracks}`);
        ctx.check('that track rides between the hulls', together.sharedTrack);

        // Wing out to the side, past the association gate but still inside
        // the 60 degree cone (at 500 px, 240 px abeam is 26 degrees off).
        const side = Phaser.Math.DegToRad(boresight + 90);
        flight.wing.setPosition(flight.lead.x + Math.cos(side) * 240, flight.lead.y + Math.sin(side) * 240);
        const apart = await picture();
        ctx.check('240 px apart it holds a track on each ship', apart.onEach,
            `most tracks held near the pair: ${apart.maxTracks}`);
    },
};

// (f) A wing with its lead shot down is a single ship again: it stops flying
// the lead's station, takes up the ordinary doctrine and keeps flying.
const leadLostWingFliesOn: GameTest = {
    name: 'A wing whose lead is destroyed flies on alone',
    description: 'The lead is destroyed mid-patrol: the wingman survives, leaves FORMATION for the '
        + 'ordinary patrol and keeps moving, and the dead lead stops counting as a friend.',
    async run(ctx) {
        silencePlayer(ctx);
        const flight = ctx.scene.spawnFlight({ x: 1200, y: 1100, direction: 0, speed: 0.4 });
        await ctx.frames(300);
        ctx.check('the wing starts in formation', flight.wing.controller?.getStateName() === 'FORMATION',
            `state ${flight.wing.controller?.getStateName()}`);

        flight.lead.destroy();
        const before = { x: flight.wing.x, y: flight.wing.y };
        await ctx.frames(600);

        ctx.check('the wing survives', flight.wing.active && Boolean(flight.wing.body));
        // PATROL, or INVESTIGATE if a contact (a false alarm, or the coasting
        // ghost of the lead's own track) caught its eye: the doctrine's, not
        // the flight's.
        ctx.check('it has left formation for the ordinary doctrine',
            flight.wing.controller?.getStateName() !== 'FORMATION', `state ${flight.wing.controller?.getStateName()}`);
        ctx.check('it keeps flying',
            Phaser.Math.Distance.Between(before.x, before.y, flight.wing.x, flight.wing.y) > 50);
        ctx.check('the datalink no longer lists a wingman',
            flight.datalink.wingmen(flight.wing.id, ctx.scene.time.now).length === 0);
    },
};

// ── Shared picture, sort and launch on remote ──────────────────────────────

type Point = { x: number; y: number };

// A silent prop at an absolute position, holding station, broadside to the
// flight. A cargo hull, the biggest reflector, so both drones are tracked at
// once and steadily: the test is about what the flight does with a picture,
// not about the detection curve.
function placeDrone(ctx: TestContext, at: Point): Target {
    // On the player's side (IFF code 0): the flight is hostile, code 1, so these
    // are its enemies. A drone on the flight's own code would answer its
    // interrogation as friendly and never be engaged.
    const drone = ctx.scene.spawnDrone({ bearingDeg: 0, rangePx: 1, facingDeg: 90, hull: 'cargo', side: 'friendly' });
    drone.setPosition(at.x, at.y);
    return drone;
}

// A flight heading east at (1200, 1100) with two drones 450 px ahead, 115 px
// either side of its track. 230 px apart they are two groups to the link's
// 200 px correlation gate; only 14 degrees off the axis, so both fall in the
// first sweep and mature together, before the lead has turned to either.
const LEFT_DRONE: Point = { x: 1650, y: 985 };   // north of an eastbound flight = its left
const RIGHT_DRONE: Point = { x: 1650, y: 1215 };

// VIM-220s a ship has in the air.
function missilesOf(ctx: TestContext, ship: Target): ActiveRadarMissile[] {
    return ctx.scene.children.list.filter((o): o is ActiveRadarMissile =>
        o instanceof ActiveRadarMissile && o.active && o.owner === ship);
}

// A track as the lead's radar would hold it, for tests that need one the link
// does not carry.
function trackAt(pos: Point): Track {
    return { id: 1, pos: { ...pos }, dist: 0, dir: 0, speed: 0, age: 5, lastUpdate: 0, confidence: 1, history: [] };
}

// A flight at (1200, 1100) facing the two drones with the whole picture built
// before anyone is allowed to act on it. The scripted lead engages the first
// track that matures, so left to itself it would fire on whichever drone its
// sweep happened to find first and there would be nothing to sort - a race the
// test is not about. So the pair starts inert (radars on, brains off, holding
// still); once both drones are groups on the link and the sort has settled,
// the brains are switched on and decide from that picture. `wingRadar` is the
// wing's standing order and radar mode until then.
async function armedAfterPicture(
    ctx: TestContext, wingRadar: 'search' | 'silent', arm = true,
): Promise<{ flight: Flight; drones: Target[] }> {
    silencePlayer(ctx);
    const flight = ctx.scene.spawnFlight({ x: 1200, y: 1100, direction: 0, speed: 0, inert: true });
    const drones = [placeDrone(ctx, LEFT_DRONE), placeDrone(ctx, RIGHT_DRONE)];
    flight.wingRadar = wingRadar;
    flight.lead.radar.enterRws();
    if (wingRadar === 'search') flight.wing.radar.enterRws();

    const haveBoth = (): boolean => flight.datalink.groups(ctx.scene.time.now).length === 2;
    let steady = 0;
    for (let f = 0; f < 1500 && steady < 30; f++) {
        await ctx.frames(1);
        steady = haveBoth() ? steady + 1 : 0;
    }
    ctx.check('the lead holds both drones as groups on the link before the brains start', steady >= 30);
    if (arm) ctx.scene.armFlight(flight);
    return { flight, drones };
}

// (g) The sort. Two drones ahead, 300 px apart: from the one shared picture the
// lead takes the left-most group and the wing the right-most, and each one's
// missile goes to its own.
const sortsOneEach: GameTest = {
    name: 'A flight sorts two targets: lead takes the left, wing the right',
    description: 'Two silent drones 300 px apart sit ahead of a scripted flight. Both members compute the sort '
        + 'from the shared picture: the lead gets the left drone, the wing the right one, and each ends up '
        + 'launching a VIM-220 that flies at its own.',
    async run(ctx) {
        const { flight } = await armedAfterPicture(ctx, 'search');
        const near = (a: Point, b: Point): boolean => Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y) < 120;

        let sortedRight = false;
        let sortedWrong = false;
        // Once a missile has flown 150 px off the rail it has turned onto its
        // target: is it pointed at its own drone rather than the other?
        // (Heading, not position: the two drones are only 230 px apart, and
        // after the pass a missile is wherever it ended up.) Judged only
        // while it is still short of the drones.
        const firstSeen = new Map<ActiveRadarMissile, Point>();
        const pointedAtOwn = { lead: [] as boolean[], wing: [] as boolean[] };
        const sample = (who: 'lead' | 'wing', own: Point, other: Point): void => {
            for (const m of missilesOf(ctx, flight[who])) {
                const from = firstSeen.get(m) ?? { x: m.x, y: m.y };
                firstSeen.set(m, from);
                const flown = Phaser.Math.Distance.Between(m.x, m.y, from.x, from.y);
                if (flown < 150 || flown > 450) continue;
                const headingDeg = Phaser.Math.RadToDeg(Math.atan2(m.direction.y, m.direction.x));
                const errorTo = (p: Point): number => Math.abs(Phaser.Math.Angle.WrapDegrees(
                    Phaser.Math.RadToDeg(Math.atan2(p.y - m.y, p.x - m.x)) - headingDeg));
                pointedAtOwn[who].push(errorTo(own) < errorTo(other));
            }
        };

        for (let f = 0; f < 3000; f += 5) {
            await ctx.frames(5);
            const now = ctx.scene.time.now;
            const lead = flight.assignmentFor(flight.lead, now);
            const wing = flight.assignmentFor(flight.wing, now);
            if (lead && wing) {
                if (near(lead.pos, LEFT_DRONE) && near(wing.pos, RIGHT_DRONE)) sortedRight = true;
                else sortedWrong = true;
            }
            sample('lead', LEFT_DRONE, RIGHT_DRONE);
            sample('wing', RIGHT_DRONE, LEFT_DRONE);
            if (pointedAtOwn.lead.length >= 6 && pointedAtOwn.wing.length >= 6) break;
        }

        ctx.check('both members sorted, lead on the left drone and wing on the right', sortedRight);
        ctx.check('the sort never put them on the wrong drones', !sortedWrong);
        const fraction = (xs: boolean[]): number => xs.length ? xs.filter(Boolean).length / xs.length : 0;
        ctx.check('the lead launched and its missile flies at the left drone',
            pointedAtOwn.lead.length >= 6 && fraction(pointedAtOwn.lead) >= 0.8,
            `${pointedAtOwn.lead.length} samples, ${(fraction(pointedAtOwn.lead) * 100).toFixed(0)}% pointed at its own`);
        ctx.check('the wing launched and its missile flies at the right drone',
            pointedAtOwn.wing.length >= 6 && fraction(pointedAtOwn.wing) >= 0.8,
            `${pointedAtOwn.wing.length} samples, ${(fraction(pointedAtOwn.wing) * 100).toFixed(0)}% pointed at its own`);
    },
};

// (h) Launch on remote with the wing's own radar silent. The wing is ordered
// to keep EMCON; the lead radiates and feeds it the right-hand drone over the
// link; the wing prosecutes it, and a VIM-220 leaves its rail having never
// transmitted a pulse - so neither drone's RWR ever had a reason to hear it.
const emconWingLaunchesOnRemote: GameTest = {
    name: 'An EMCON wing launches a VIM-220 on the lead\'s link track',
    description: 'The wing holds EMCON from the start; the lead finds two drones and shares them. The wing is '
        + 'sorted the right one, closes silently and fires on the lead\'s track. Up to the launch its radar never '
        + 'leaves EMCON and neither drone\'s RWR hears it; the missile is a link-guided one.',
    async run(ctx) {
        const { flight, drones } = await armedAfterPicture(ctx, 'silent');
        const wingKey = String(flight.wing.id);
        const leadKey = String(flight.lead.id);

        let radiatedBeforeLaunch = false;
        let wingHeardBeforeLaunch = false;
        let leadHeard = false;
        const launched = { value: false };
        for (let f = 0; f < 3000 && !launched.value; f += 2) {
            await ctx.frames(2);
            const sources = drones.flatMap(d => d.radar.rwrReceiver.getRwrSources());
            if (sources.includes(leadKey)) leadHeard = true;
            if (flight.wing.radar.getWeaponLoad('VIM-220') < 2) { launched.value = true; break; }
            if (flight.wing.radar.getMode() !== 'emcon') radiatedBeforeLaunch = true;
            if (sources.includes(wingKey)) wingHeardBeforeLaunch = true;
        }

        ctx.check('the wing launched a VIM-220', launched.value);
        ctx.check('its radar was in EMCON at every sample up to the launch', !radiatedBeforeLaunch);
        ctx.check('the lead did radiate and the drones heard it (the RWRs work)', leadHeard);
        ctx.check('neither drone ever heard the wing before the launch', !wingHeardBeforeLaunch);
        const missile = missilesOf(ctx, flight.wing)[0];
        ctx.check('the missile is guided from the link', Boolean(missile?.targetViaLink));
    },
};

// A silent flight, the lead set up by hand: the wing sits `behindPx` behind it
// with a drone `aheadPx` in front of the lead. The lead can be turned on and
// off at will; nothing else in the flight moves, shoots or radiates.
function linkRig(ctx: TestContext, behindPx: number, aheadPx = 400): { flight: Flight; drone: Target } {
    silencePlayer(ctx);
    const start = { x: 1200, y: 1100 };
    const flight = ctx.scene.spawnFlight({ ...start, direction: 0, speed: 0, inert: true });
    flight.wing.setPosition(start.x - behindPx, start.y);
    const drone = placeDrone(ctx, { x: start.x + aheadPx, y: start.y });
    flight.wing.radar.selectWeapon('VIM-220');
    return { flight, drone };
}

// The lead's track on the drone, as the link carries it to the wing.
function leadTrackOnLink(ctx: TestContext, flight: Flight): Track | undefined {
    return flight.datalink.remoteTracks(flight.wing.id, ctx.scene.time.now)[0]?.track;
}

// (i) No lead track, no remote shot. Nothing on the link: refused. The lead
// finds the drone: the shot is available. The lead goes silent: its tracks are
// gone from the link within a few frames and the shot is refused again, even
// though the wing still holds the old report in its hand.
const noLeadTrackNoShot: GameTest = {
    name: 'A wing cannot launch on remote without a fresh lead track',
    description: 'With the lead silent there is nothing on the link: a VIM-220 cannot be launched on an invented '
        + 'track. Once the lead tracks the drone the wing can launch; when the lead goes silent and its track '
        + 'drops off the link, the old report no longer launches anything.',
    async run(ctx) {
        const { flight, drone } = linkRig(ctx, 150);
        const { wing, lead } = flight;
        const invented = trackAt(drone);

        wing.radar.shootOnRemote(invented);
        ctx.check('with nothing on the link an invented track launches nothing',
            wing.radar.getWeaponLoad('VIM-220') === 2 && !wing.radar.canShootOnRemote(invented));

        lead.radar.enterTws();
        const shared = await ctx.waitUntil(() => leadTrackOnLink(ctx, flight) !== undefined, 1200);
        ctx.check('the lead tracks the drone and shares it', shared);
        const real = leadTrackOnLink(ctx, flight) ?? invented;
        ctx.check('the wing could launch on it now', wing.radar.canShootOnRemote(real));

        lead.radar.enterEmcon();
        await ctx.frames(60);
        ctx.check('the lead\'s track has dropped off the link', leadTrackOnLink(ctx, flight) === undefined);
        wing.radar.shootOnRemote(real);
        ctx.check('the old report launches nothing', wing.radar.getWeaponLoad('VIM-220') === 2 && !wing.radar.canShootOnRemote(real),
            `VIM-220 load ${wing.radar.getWeaponLoad('VIM-220')}`);
    },
};

// (j) The ring binds the shooter. The same lead track, the wing 850 px from it
// and then 550: refused outside the wing's 700 px ring, launched inside.
const remoteTrackNeedsRing: GameTest = {
    name: 'A remote track outside the wing\'s ring cannot be fired on',
    description: 'The lead holds a track on a drone 400 px ahead of it. A wing 850 px from the drone is outside its '
        + 'own display range and cannot launch on that track; moved to 550 px, it can.',
    async run(ctx) {
        const { flight, drone } = linkRig(ctx, 450);
        const { wing, lead } = flight;
        lead.radar.enterTws();
        await ctx.waitUntil(() => leadTrackOnLink(ctx, flight) !== undefined, 1200);
        const track = leadTrackOnLink(ctx, flight);
        ctx.check('the lead shares a track on the drone', track !== undefined);
        if (!track) return;

        const rangeFromWing = (): number => Phaser.Math.Distance.Between(wing.x, wing.y, track.pos.x, track.pos.y);
        ctx.check('the wing is outside its ring', rangeFromWing() > 700, `${rangeFromWing().toFixed(0)} px`);
        wing.radar.shootOnRemote(track);
        ctx.check('outside the ring nothing launches', wing.radar.getWeaponLoad('VIM-220') === 2);

        wing.setPosition(drone.x - 550, drone.y);
        // The jump is a teleport to the PPLI (position differenced into a
        // velocity of thousands of px/s, which widens the friend-correlation gate
        // over the whole sky for a frame); let the link settle before shooting.
        await ctx.frames(5);
        const fresh = leadTrackOnLink(ctx, flight) ?? track;
        wing.radar.shootOnRemote(fresh);
        ctx.check('inside the ring the same track launches', wing.radar.getWeaponLoad('VIM-220') === 1,
            `VIM-220 load ${wing.radar.getWeaponLoad('VIM-220')}`);
    },
};

// (k) The RWR bearing filter hides a search emitter on a wingman's bearing, but
// a *lock* is never a wingman's: an enemy locking us from behind the wingman
// must still be defended against.
const lockOnWingmanBearingEvades: GameTest = {
    name: 'A lock heard on the wingman\'s bearing still triggers EVADE',
    description: 'A search contact on the wingman\'s bearing is hidden and provokes nothing; the same bearing '
        + 'with a fire-control lock is shown and puts the ship into EVADE.',
    async run(ctx) {
        silencePlayer(ctx);
        const flight = ctx.scene.spawnFlight({ x: 1200, y: 1100, direction: 0, speed: 0.1 });
        const { lead, wing } = flight;
        const hear = (locked: boolean): void => {
            const bearingDeg = Phaser.Math.RadToDeg(Math.atan2(wing.y - lead.y, wing.x - lead.x));
            lead.radar.rwrReceiver.receive('999', bearingDeg, locked, ctx.scene.time.now);
        };

        for (let f = 0; f < 20; f++) { hear(false); await ctx.frames(1); }
        ctx.check('a search emitter on the wingman\'s bearing is hidden', lead.radar.rwrReceiver.getRwrSignals().length === 0);
        ctx.check('and does not make the lead evade', lead.controller?.getStateName() !== 'EVADE',
            `state ${lead.controller?.getStateName()}`);

        for (let f = 0; f < 20; f++) { hear(true); await ctx.frames(1); }
        ctx.check('a lock on the same bearing is on the warning picture',
            lead.radar.rwrReceiver.getRwrSignals().some(c => c.isLocked));
        ctx.check('and the lead evades', lead.controller?.getStateName() === 'EVADE',
            `state ${lead.controller?.getStateName()}`);
    },
};

// ── Tactics (phase 3) ──────────────────────────────────────────────────────

// Closest the two hulls came in any tactic test, across the run of the suite;
// read by the last of them.
let tacticMinSeparation = Infinity;
let tacticMinWhere = '';
// Where a member was lost, if one ever was.
let tacticCasualty = '';

// The drones of the tactic rigs cannot be hurt (their bodies collide with
// nothing, so that a whole engagement can be watched rather than its first hit),
// which means a round that reaches one would fly straight through it, turn
// round on the link track it was given and come back through the flight that
// fired it - the rig, not the tactic, putting the flight in its own line of
// fire. So a round that arrives at such a drone is spent there, as it would
// be on a real one. Nothing else is touched: the flight's hulls stay as
// exposed to its own missiles as in the game.
const DRONE_HIT_PX = 40;
let tacticDrones: Target[] = [];

function absorbMissilesAtDrones(anyShip: Target): void {
    for (const o of anyShip.scene.children.list) {
        if (!(o instanceof ActiveRadarMissile) || !o.active) continue;
        if (tacticDrones.some(d => d.active && Phaser.Math.Distance.Between(o.x, o.y, d.x, d.y) <= DRONE_HIT_PX)) o.destroy();
    }
}

function noteSeparation(flight: Flight, where: string): number {
    const { lead, wing } = flight;
    if (!flight.leadAlive() || !wing.active || !wing.body) {
        tacticCasualty ||= `${where}: ${flight.tactic}, lead alive ${flight.leadAlive()}, wing alive ${wing.active && Boolean(wing.body)}`;
        return 0;
    }
    absorbMissilesAtDrones(lead);
    const px = Phaser.Math.Distance.Between(lead.x, lead.y, wing.x, wing.y);
    if (px < tacticMinSeparation) {
        tacticMinSeparation = px;
        tacticMinWhere = `${where}: ${flight.tactic}, lead ${lead.controller?.getStateName()}, wing ${wing.controller?.getStateName()}`;
    }
    return px;
}

// A flight heading east from (1200, 1100) at cruise, `aheadPx` of open space in
// front of the lead and one silent drone in it. The drone cannot be hurt (its
// body collides with nothing, so a missile that reaches it flies on through),
// which lets a test watch a whole engagement rather than its first hit; radar
// rays do not care, they test the body's polygon. As in armedAfterPicture the
// flight starts inert until the lead holds the drone on the link, so the
// doctrine decides from a picture rather than racing its first sweep.
async function oneDroneRig(
    ctx: TestContext, aheadPx: number, wingSide: 1 | -1 = 1,
): Promise<{ flight: Flight; drone: Target; picture: boolean }> {
    silencePlayer(ctx);
    const flight = ctx.scene.spawnFlight({ x: 1200, y: 1100, direction: 0, speed: 0.5, inert: true, wingSide });
    const drone = placeDrone(ctx, { x: 1200 + aheadPx, y: 1100 });
    drone.setCollidesWith(0);
    tacticDrones = [drone];
    flight.lead.radar.enterRws();

    const leadHolds = (): boolean => {
        const groups = flight.datalink.groups(ctx.scene.time.now);
        return groups.length === 1 && groups[0].reports.some(r => r.sourceId === flight.lead.id);
    };
    let steady = 0;
    for (let f = 0; f < 1500 && steady < 10; f++) {
        await ctx.frames(1);
        steady = leadHolds() ? steady + 1 : 0;
    }
    ctx.scene.armFlight(flight);
    return { flight, drone, picture: steady >= 10 };
}

// The same, but the flight comes upon the drone: it starts 950 px short of it, at a crawl (so the plan is settled before the range has gone)
// with its brains on, flying the ingress route to the drone's position, and the
// doctrine decides when the drone first appears on the link - at the edge of
// detection, outside the weapons ring, which is where a bracket is for. (A
// picture built by hand at that range is a coin toss: a cargo hull at 780 px
// is just on the detection knee.)
function comingUponDrone(
    ctx: TestContext, wingSide: 1 | -1,
): { flight: Flight; drone: Target } {
    silencePlayer(ctx);
    const flight = ctx.scene.spawnFlight({ x: 1000, y: 1100, direction: 0, speed: 0.25, wingSide });
    const drone = placeDrone(ctx, { x: 1950, y: 1100 });
    drone.setCollidesWith(0);
    tacticDrones = [drone];
    flight.lead.controller?.setRoute([{ x: 1950, y: 1100 }]);
    return { flight, drone };
}

// Rounds on a member's rails.
function roundsOf(ship: Target): number {
    return ship.radar.getWeaponLoad('VIM-220') + ship.radar.getWeaponLoad('VIM-177');
}

// (l) Shooter/cover. One drone 400 px ahead, both members armed: the lead
// radiates and holds the track, the wing stays silent, and the first round off
// a rail is the wing's - on the lead's link track. The drone's RWR hears one
// emitter all the way, the lead; the shooter is the one it never heard.
const shooterCoverWingShoots: GameTest = {
    name: 'Tactic shooter/cover: the silent wing takes the shot, the lead holds the track',
    description: 'One drone 400 px ahead of an armed pair. The flight picks shooter/cover; the lead radiates, the '
        + 'wing is in EMCON at every sample up to its launch and the drone\'s RWR never hears it, the wing fires '
        + 'first, and the lead does not fire before it.',
    async run(ctx) {
        const { flight, drone, picture } = await oneDroneRig(ctx, 400);
        ctx.check('the lead holds the drone on the link before the brains start', picture);
        const wingKey = String(flight.wing.id);
        const leadKey = String(flight.lead.id);

        let wingRadiated = false;
        let wingHeard = false;
        let leadHeard = false;
        let leadFiredFirst = false;
        let leadFiredWhen = '';
        let tacticSeen = false;
        let leadRadiated = false;
        let launched = false;
        for (let f = 0; f < 3000 && !launched; f += 2) {
            await ctx.frames(2);
            noteSeparation(flight, 'shooterCover');
            const sources = drone.radar.rwrReceiver.getRwrSources();
            if (sources.includes(leadKey)) leadHeard = true;
            if (flight.tactic === 'shooterCover') tacticSeen = true;
            if (flight.lead.radar.getMode() !== 'emcon') leadRadiated = true;
            if (roundsOf(flight.lead) < 6 && !leadFiredFirst) { leadFiredFirst = true; leadFiredWhen = `f${f} tactic ${flight.tactic}, lead ${flight.lead.controller?.getStateName()}, mode ${flight.lead.radar.getMode()}, wing rounds ${roundsOf(flight.wing)}`; }
            if (roundsOf(flight.wing) < 6) { launched = true; break; }
            if (flight.wing.radar.getMode() !== 'emcon') wingRadiated = true;
            if (sources.includes(wingKey)) wingHeard = true;
        }

        ctx.check('the flight chose shooter/cover', tacticSeen, `tactic ${flight.tactic}`);
        ctx.check('the wing launched', launched);
        ctx.check('the wing was in EMCON at every sample up to its launch', !wingRadiated);
        ctx.check('the lead radiated and the drone heard it', leadRadiated && leadHeard);
        ctx.check('the drone never heard the wing before the launch', !wingHeard);
        ctx.check('the lead did not fire before the wing', !leadFiredFirst, leadFiredWhen);
        ctx.check('the wing\'s missile flies on the link', Boolean(missilesOf(ctx, flight.wing)[0]?.targetViaLink));
    },
};

// The bracket run both sides share: fly the pair up on a drone from 950 px and
// report how the geometry developed. `wingSide` mirrors it.
async function bracketRun(ctx: TestContext, wingSide: 1 | -1) {
    const { flight, drone } = comingUponDrone(ctx, wingSide);
    const rangeTo = (ship: Target): number => Phaser.Math.Distance.Between(ship.x, ship.y, drone.x, drone.y);
    const half = RWS_HALF_AZIMUTH_DEG;

    let died = '';
    let sustained = 0;
    let bestSustained = 0;
    let sustainedFrom: { lead: number; wing: number } | null = null;
    let sustainedTo = { lead: 0, wing: 0 };
    let bracketSeen = false;
    let shotBeforeSplit = false;
    let crossedNose = false;
    const tactics: string[] = [];
    const startRange = { lead: rangeTo(flight.lead), wing: rangeTo(flight.wing) };
    let last = '';
    let roundsBefore = roundsOf(flight.lead) + roundsOf(flight.wing);
    for (let f = 0; f < 5000; f += 2) {
        await ctx.frames(2);
        if (!flight.leadAlive() || !flight.wing.active || !flight.wing.body) {
            noteSeparation(flight, 'bracket');
            died = `f${f} lead alive ${flight.leadAlive()}, wing alive ${flight.wing.active}; last: ${last}`;
            break;
        }
        last = `${flight.tactic} L(${flight.lead.x.toFixed(0)},${flight.lead.y.toFixed(0)},${flight.lead.controller?.getStateName()}) W(${flight.wing.x.toFixed(0)},${flight.wing.y.toFixed(0)},${flight.wing.controller?.getStateName()})`;
        noteSeparation(flight, 'bracket');
        if (tactics[tactics.length - 1]?.split('@')[0] !== flight.tactic) tactics.push(`${flight.tactic}@${rangeTo(flight.lead).toFixed(0)}`);
        if (flight.tactic === 'bracket') bracketSeen = true;
        const split = flight.splitDeg(drone);
        const roundsNow = roundsOf(flight.lead) + roundsOf(flight.wing);
        if (roundsNow < roundsBefore) {
            // The shot itself, not the stores afterwards: once a legitimate round
            // is away the pair cranks, and its split says nothing about the gate.
            if (flight.tactic === 'bracket' && split <= half) shotBeforeSplit = true;
            roundsBefore = roundsNow;
        }
        // Side of the lead's track the wing is on: the lead->drone axis, wing's
        // cross product sign. A wing that flew across the lead's nose would flip it.
        const ax = drone.x - flight.lead.x;
        const ay = drone.y - flight.lead.y;
        const cross = ax * (flight.wing.y - flight.lead.y) - ay * (flight.wing.x - flight.lead.x);
        if (rangeTo(flight.lead) > 450 && Math.sign(cross) !== 0 && Math.sign(cross) !== wingSide) crossedNose = true;

        if (split > half) {
            sustained += 2;
            sustainedFrom ??= { lead: rangeTo(flight.lead), wing: rangeTo(flight.wing) };
            sustainedTo = { lead: rangeTo(flight.lead), wing: rangeTo(flight.wing) };
            bestSustained = Math.max(bestSustained, sustained);
        } else {
            sustained = 0;
            if (bestSustained < 120) sustainedFrom = null;
        }
        if (bestSustained >= 240) break;
    }
    return { flight, died, bracketSeen, bestSustained, sustainedFrom, sustainedTo, startRange,
        shotBeforeSplit, crossedNose, tactics };
}

// (m) Bracket. A drone first held at the edge of the weapons ring is beyond the
// shoot-now range, so the pair splits first: after the split the drone sees the
// two of them more than its radar's half-azimuth apart, for a sustained spell,
// and each is closer to it than it was.
const bracketSplitsAndCloses: GameTest = {
    name: 'Tactic bracket: the pair splits past the target\'s half-azimuth and both close',
    description: 'A flight closing on one drone from 950 px away. It brackets: seen from the drone the lead and '
        + 'wing are more than 30 degrees (the RWS half-azimuth) apart for at least 4 seconds, both are closing on '
        + 'it through that spell, nobody has fired before the split, and the hulls stay clear.',
    async run(ctx) {
        const r = await bracketRun(ctx, 1);
        ctx.check('both members survive', r.died === '', r.died);
        ctx.check('the flight chose bracket', r.bracketSeen, r.tactics.join(' > '));
        ctx.check('the pair is more than 30 degrees apart as the drone sees it, sustained',
            r.bestSustained >= 240, `${r.bestSustained} frames`);
        if (r.sustainedFrom) {
            ctx.check('the lead closed on the drone over the spell', r.sustainedTo.lead < r.sustainedFrom.lead - 15,
                `${r.sustainedFrom.lead.toFixed(0)} -> ${r.sustainedTo.lead.toFixed(0)} px`);
            ctx.check('the wing closed on the drone over the spell', r.sustainedTo.wing < r.sustainedFrom.wing - 15,
                `${r.sustainedFrom.wing.toFixed(0)} -> ${r.sustainedTo.wing.toFixed(0)} px`);
        } else {
            ctx.check('there was a spell of split to measure closing over', false);
        }
        ctx.check('nobody fired from the bracket before it was formed', !r.shotBeforeSplit);
        ctx.check('the wing never crossed the lead\'s track on the way out', !r.crossedNose);
    },
};

// (n) The same with the wing on the left, to prove the split is mirrored and
// the wing again stays on its own side: no crossing of the lead's nose.
const bracketMirrored: GameTest = {
    name: 'Tactic bracket mirrored: a wing on the left stays on its side',
    description: 'The bracket with the wing to the lead\'s left: it still splits past 30 degrees and the wing '
        + 'never crosses the lead\'s line to the target.',
    async run(ctx) {
        const r = await bracketRun(ctx, -1);
        ctx.check('both members survive', r.died === '', r.died);
        ctx.check('the flight chose bracket', r.bracketSeen, r.tactics.join(' > '));
        ctx.check('the pair is more than 30 degrees apart, sustained', r.bestSustained >= 240, `${r.bestSustained} frames`);
        ctx.check('the wing never crossed the lead\'s track on the way out', !r.crossedNose);
    },
};

// Shots as they happen: which member's rails lost a round, in order.
type ShotLog = { who: 'lead' | 'wing'; otherArmed: boolean; tactic: string }[];

// (o) Grinder. One drone 400 px ahead, the wing opens with the quiet shot and
// the rest of the engagement is a grinder: the member that just fired does not
// fire again while the other still has a round to give.
const grinderAlternates: GameTest = {
    name: 'Tactic grinder: shots alternate between the members',
    description: 'One drone 400 px ahead and a pair with four rounds each in total. After the opening shot the flight '
        + 'is a grinder: across the shots that follow the same member never fires twice in a row while the '
        + 'other has rounds left.',
    async run(ctx) {
        const rig = await oneDroneRig(ctx, 400);
        const { flight, picture } = rig;
        let drone = rig.drone;
        ctx.check('the lead holds the drone on the link before the brains start', picture);
        const { lead, wing } = flight;
        const rounds = { lead: roundsOf(lead), wing: roundsOf(wing) };
        const log: ShotLog = [];
        let grinderSeen = false;
        // (Every frame: two shots in one sample could not be put in order.)
        for (let f = 0; f < 6000 && log.length < 4; f++) {
            await ctx.frames(1);
            // A drone that is shot down is replaced 400 px ahead of the lead,
            // so the fight goes on for as many shots as the test wants to see.
            if (!drone.active) {
                const rad = Phaser.Math.DegToRad(lead.angle);
                drone = placeDrone(ctx, { x: lead.x + Math.cos(rad) * 400, y: lead.y + Math.sin(rad) * 400 });
            }
            noteSeparation(flight, 'grinder');
            if (flight.tactic === 'grinder') grinderSeen = true;
            for (const who of ['lead', 'wing'] as const) {
                const now = roundsOf(flight[who]);
                if (now < rounds[who]) {
                    log.push({ who, otherArmed: roundsOf(flight[who === 'lead' ? 'wing' : 'lead']) > 0, tactic: flight.tactic });
                    rounds[who] = now;
                }
            }
        }
        ctx.check('the flight went to the grinder after the opening shot', grinderSeen, `tactic ${flight.tactic}`);
        ctx.check('at least three shots were fired', log.length >= 3, log.map(l => `${l.who}(${l.tactic})`).join(' > '));
        // The promise is the grinder's: judge the shots taken under it. (An
        // engagement the flight lost for over a minute starts afresh as a bracket
        // or an opener, whose shots follow their own rules.)
        const pairs = log.filter((shot, i) => i > 0 && shot.tactic === 'grinder');
        const repeated = log.some((shot, i) =>
            i > 0 && shot.tactic === 'grinder' && shot.who === log[i - 1].who && shot.otherArmed);
        ctx.check('some shots were taken in the grinder', pairs.length >= 1, log.map(l => `${l.who}(${l.tactic})`).join(' > '));
        ctx.check('no member shot twice in a row while the other had rounds', !repeated, log.map(l => `${l.who}(${l.tactic})`).join(' > '));
        ctx.check('both members shot', log.some(l => l.who === 'lead') && log.some(l => l.who === 'wing'));
    },
};

// (p) Hysteresis. Over a steady engagement the tactic changes only when the
// picture has settled: no two changes closer together than the dwell, and only
// the few a single engagement has (opener, then grinder) in its first 25 s.
const tacticHolds: GameTest = {
    name: 'Tactic hysteresis: the tactic does not flicker over a steady engagement',
    description: 'A pair against one drone for 3000 frames: no two changes of tactic come closer together than '
        + 'the dwell time, and at most three happen in the first 1500 frames.',
    async run(ctx) {
        const { flight, picture } = await oneDroneRig(ctx, 400);
        ctx.check('the lead holds the drone on the link before the brains start', picture);
        const changes: { tactic: string; frame: number }[] = [{ tactic: flight.tactic, frame: 0 }];
        for (let f = 0; f < 3000; f += 2) {
            await ctx.frames(2);
            noteSeparation(flight, 'hysteresis');
            if (changes[changes.length - 1].tactic !== flight.tactic) changes.push({ tactic: flight.tactic, frame: f });
        }
        const list = changes.map(c => `${c.tactic}@${c.frame}`).join(' > ');
        const dwellFrames = tacticSettings.DWELL_MS / (1000 / 60);
        const gaps = changes.slice(1).map((c, i) => c.frame - changes[i].frame);
        // (Frames are sampled in pairs and the clock is the scene's, so allow a few frames of slack.)
        ctx.check('no two changes closer than the dwell', gaps.every(g => g >= dwellFrames - 6), list);
        ctx.check('at most three changes in the first 1500 frames',
            changes.filter(c => c.frame <= 1500 && c.frame > 0).length <= 3, list);
        ctx.check('it did leave formation', changes.length > 1, list);
    },
};

// (q) The sort holds through a blink. Two drones and the sort settled; the link
// then reports only the left-hand group for a spell shorter than the hold, as if
// the right-hand track had starved for a sweep. Neither member's assignment may
// change - the lead keeps the left group, the wing the right - and once the
// right-hand group has been missing for longer than the hold it is let go.
const sortSurvivesDropout: GameTest = {
    name: 'The sort holds through a brief group dropout',
    description: 'Two drones sorted one each. The link then drops the right-hand group for under the hold time: the '
        + 'lead keeps the left group and the wing the right one throughout; dropped for longer, the wing\'s '
        + 'assignment is released.',
    async run(ctx) {
        const { flight } = await armedAfterPicture(ctx, 'search', false);
        const near = (a: Point | undefined, b: Point): boolean =>
            a !== undefined && Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y) < 120;
        const assigned = (): { lead?: Point; wing?: Point } => ({
            lead: flight.assignmentFor(flight.lead, ctx.scene.time.now)?.pos,
            wing: flight.assignmentFor(flight.wing, ctx.scene.time.now)?.pos,
        });
        const before = assigned();
        ctx.check('before the dropout the lead has the left drone and the wing the right',
            near(before.lead, LEFT_DRONE) && near(before.wing, RIGHT_DRONE));

        const real = flight.datalink.groups.bind(flight.datalink);
        flight.datalink.groups = (now: number) => real(now).filter(g => g.pos.y < 1100);
        let swapped = false;
        const holdFrames = Math.floor(tacticSettings.PICTURE_HOLD_MS / 16.7 * 0.5);
        for (let f = 0; f < holdFrames; f++) {
            await ctx.frames(1);
            const a = assigned();
            if (!near(a.lead, LEFT_DRONE) || !near(a.wing, RIGHT_DRONE)) swapped = true;
        }
        ctx.check('through a dropout shorter than the hold nothing changes hands', !swapped);

        await ctx.frames(Math.ceil(tacticSettings.PICTURE_HOLD_MS / 16.7) + 20);
        const after = assigned();
        ctx.check('a group missing for longer than the hold is released',
            after.wing === undefined || !near(after.wing, RIGHT_DRONE), `wing ${JSON.stringify(after.wing)}`);
        flight.datalink.groups = real;
    },
};

// (r) Wing to lead cueing. The wing sees a drone to the north that the lead's
// nose is not pointed at; the lead is pointed onto it by the wing's link track,
// radiates, finds it itself - and fires nothing until it does.
const wingCuesLead: GameTest = {
    name: 'Tactic cueing: the wing\'s link track points the lead, and is no firing solution',
    description: 'The lead flies east with a drone to its north that only the wing (facing north, searching) can see. '
        + 'The lead turns onto the wing\'s link track and then finds the drone on its own radar; it fires nothing '
        + 'while the wing\'s track is all it has.',
    async run(ctx) {
        silencePlayer(ctx);
        const flight = ctx.scene.spawnFlight({ x: 1200, y: 1100, direction: 0, speed: 0.3, inert: true });
        const drone = placeDrone(ctx, { x: 1200, y: 760 });
        drone.setCollidesWith(0);
        // Broadside to the wing's view (it looks up the page), the biggest echo.
        drone.setAngle(0);
        const { lead, wing } = flight;
        wing.setAngle(-90);
        wing.radar.enterRws();
        lead.radar.enterRws();
        // Only the lead gets a brain: the wing is the instrument that sees.
        const controller = new AiUnitController({
            scene: ctx.scene, ship: lead, turnRate: targetShipSettings.TURN_RATE_CRUISER, radar: lead.radar, activity: 'active',
        });
        lead.setController(controller);
        controller.joinFlight(flight, 'lead');

        const held = (): boolean => lead.radar.getHostileTracks().length > 0;
        const dbg: string[] = [];
        let cuedWhileBlind = false;
        let firedBlind = false;
        let found = false;
        const roundsAtStart = roundsOf(lead);
        for (let f = 0; f < 2400 && !found; f += 2) {
            await ctx.frames(2);
            noteSeparation(flight, 'cueing');
            if (held()) { found = true; break; }
            const wingReports = flight.datalink.remoteTracks(lead.id, ctx.scene.time.now).length > 0;
            const bearingNorth = Math.abs(Phaser.Math.Angle.WrapDegrees(lead.angle - -90));
            if (f % 40 === 0) dbg.push(`f${f} ${controller.getStateName()} a${lead.angle.toFixed(0)} rep${wingReports} wm${wing.radar.getMode()} lt${lead.radar.getHostileTracks().length}`);
            if (wingReports && controller.getStateName() === 'INVESTIGATE' && bearingNorth < 60) cuedWhileBlind = true;
            if (roundsOf(lead) < roundsAtStart) firedBlind = true;
        }
        ctx.check('the lead was pointed north on the wing\'s track before it held anything itself', cuedWhileBlind, dbg.join(' | '));
        ctx.check('the lead then found the drone on its own radar', found);
        ctx.check('and fired nothing while it held only the wing\'s track', !firedBlind);
    },
};

// (s) A launch on remote survives the lead's picture collapsing. When the lead
// goes STT for a VIM-177 its tracker keeps one track and renumbers the rest
// when the lock is dropped: the tracks the wing's missile was being steered
// onto vanish from the link, then come back under new numbers. The link is
// altered at the datalink's edge to do exactly that (a real STT round trip
// would also take a minute of sweeping to rebuild): first the track is absent,
// then it is back as number + 1000. The missile must keep flying to where the
// track last was through the gap, and take the new number when it returns.
const remoteMissileSurvivesCollapse: GameTest = {
    name: 'Tactic link: a remote-launched missile survives the lead\'s picture collapsing',
    description: 'The wing launches on the lead\'s link track. The link then loses that track for half a second '
        + '(as when the lead drops into STT on something else) and returns it under a new number. The missile '
        + 'stays alive, keeps heading for the last link position through the gap, and is re-associated with the '
        + 'new number.',
    async run(ctx) {
        const { flight, drone } = linkRig(ctx, 100, 400);
        drone.setCollidesWith(0);
        const { wing, lead } = flight;
        // Off the lead's line, so a round launched at the drone does not fly through the lead.
        wing.setPosition(wing.x, wing.y + 120);
        lead.radar.enterTws();
        await ctx.waitUntil(() => leadTrackOnLink(ctx, flight) !== undefined, 1200);
        const track = leadTrackOnLink(ctx, flight);
        ctx.check('the lead shares a track on the drone', track !== undefined);
        if (!track) return;
        await ctx.frames(5);
        wing.radar.shootOnRemote(leadTrackOnLink(ctx, flight) ?? track);
        const missile = missilesOf(ctx, wing)[0];
        ctx.check('the wing launched on the link', Boolean(missile?.targetViaLink));
        if (!missile) return;
        const oldId = missile.targetId;
        // The missile flies straight off the rail for MISSILE_BOOST_PHASE_MAX_AGE
        // seconds before any guidance runs: let it start steering.
        await ctx.frames(140);

        const real = flight.datalink.remoteTracks.bind(flight.datalink);
        // Gap: the lead's tracks are gone from the link.
        flight.datalink.remoteTracks = () => [];
        await ctx.frames(30);
        const headingDeg = Phaser.Math.RadToDeg(Math.atan2(missile.direction.y, missile.direction.x));
        const toDroneDeg = Phaser.Math.RadToDeg(Math.atan2(drone.y - missile.y, drone.x - missile.x));
        ctx.check('through the gap the missile is alive and has kept the last link position',
            missile.active && missile.linkAimPos !== undefined);
        ctx.check('and is still flying at the target',
            Math.abs(Phaser.Math.Angle.WrapDegrees(headingDeg - toDroneDeg)) < 20,
            `${headingDeg.toFixed(0)} deg vs ${toDroneDeg.toFixed(0)} to the drone`);

        // Back under new numbers.
        flight.datalink.remoteTracks = (selfId: number, now: number) =>
            real(selfId, now).map(r => ({ ...r, track: { ...r.track, id: r.track.id + 1000 } }));
        await ctx.frames(5);
        ctx.check('the missile took the new track number', missile.active && missile.targetId === (oldId ?? 0) + 1000,
            `was ${oldId}, now ${missile.targetId}`);
        flight.datalink.remoteTracks = real;
    },
};

// ── Seeker PPLI and shooter deconfliction ──────────────────────────────────

// A VIM-220 with its seeker already live, `behindPx` short of `ahead` on the
// same row, flying east, with the uplink of `owner`. Its hull is taken out of
// Matter's collision (the test is about what the seeker chooses, not about the
// round arriving), and guidance is run by hand with `wing` the only hull in
// its world, exactly as Radar.update would hand it over.
function seekerRig(ctx: TestContext, flight: Flight, owner: Target | undefined, behindPx: number): ActiveRadarMissile {
    const { wing } = flight;
    const missile = ctx.scene.add.activeRadarMissile({
        x: wing.x - behindPx, y: wing.y, dirX: 1, dirY: 0, owner,
    });
    missile.setCollidesWith(0);
    missile.setVelocity(0, 0);
    missile.missileAge = 5;                  // past the boost phase
    missile.missileRadar.activate();
    return missile;
}

function guide(ctx: TestContext, flight: Flight, missile: ActiveRadarMissile, guidance: MissileGuidance): void {
    guidance.update([missile], 1000 / 60, {
        sttTrack: null, tracks: [], remoteTracks: [],
        targets: [flight.wing], decoyCircles: [], gasVolumes: [], terrain: [],
        datalink: flight.datalink,
        now: ctx.scene.time.now,
    });
    missile.setVelocity(0, 0);               // hold the geometry: it is the seeker under test
}

// A flight holding still, wing 80 px abeam, radars off: the datalink still
// carries both PPLIs, which is all these tests need of it.
function stillFlight(ctx: TestContext): Flight {
    silencePlayer(ctx);
    return ctx.scene.spawnFlight({ x: 1200, y: 1100, direction: 0, speed: 0, inert: true });
}

// (t) The seeker keeps off a wingman it holds the PPLI of. A round that has
// missed its target and is searching with the wingman 120 px ahead in its cone
// would lock him - the control proves it, the same seeker without the uplink -
// but with the launcher's PPLI fresh it never does.
const seekerKeepsOffWingman: GameTest = {
    name: 'A missile with fresh PPLI does not lock a flight mate in its search cone',
    description: 'A VIM-220 launched by the lead, seeker live and searching, with the wingman 120 px ahead in the '
        + 'cone and nothing else around. Given the flight\'s PPLI it never locks him in 120 frames; the same '
        + 'seeker without an uplink (a ship with no flight) locks him straight away.',
    async run(ctx) {
        const flight = stillFlight(ctx);
        await ctx.frames(3);                                      // let both terminals publish
        const guidance = new MissileGuidance();

        const control = seekerRig(ctx, flight, undefined, 120);
        const protectedRound = seekerRig(ctx, flight, flight.lead, 120);
        let controlLocked = false;
        let locked: number | null = null;
        for (let f = 0; f < 120; f++) {
            await ctx.frames(1);
            // The control has no flight behind it: it is handed no datalink.
            guidance.update([control], 1000 / 60, {
                sttTrack: null, tracks: [], remoteTracks: [], targets: [flight.wing], decoyCircles: [],
                gasVolumes: [], terrain: [], datalink: null, now: ctx.scene.time.now,
            });
            control.setVelocity(0, 0);
            guide(ctx, flight, protectedRound, guidance);
            if (control.missileRadar.getLockedTargetId() === flight.wing.id) controlLocked = true;
            locked ??= protectedRound.missileRadar.getLockedTargetId();
        }
        ctx.check('without the PPLI the same seeker locks the wingman', controlLocked);
        ctx.check('with fresh PPLI it never does', locked === null, `locked ${locked}`);
        ctx.check('the wingman is still a hull in the seeker\'s world: it is in its target list and active',
            flight.wing.active && Boolean(flight.wing.body));
        control.destroy();
        protectedRound.destroy();
    },
};

// (u) The PPLI on the missile is only as fresh as the launcher keeps it. Kill
// the launching ship and the copy ages out (PPLI_STALE_MS): the same seeker,
// still searching, now locks the wingman.
const staleUplinkLosesFriends: GameTest = {
    name: 'A missile whose launcher is destroyed loses its friend picture and can lock the wingman',
    description: 'The same seeker and geometry, the lead then destroyed: it still keeps off the wingman while the '
        + 'last PPLI is fresh, and after PPLI_STALE_MS with nobody refreshing it, it locks him.',
    async run(ctx) {
        const flight = stillFlight(ctx);
        await ctx.frames(3);
        const guidance = new MissileGuidance();
        const missile = seekerRig(ctx, flight, flight.lead, 120);
        for (let f = 0; f < 20; f++) { await ctx.frames(1); guide(ctx, flight, missile, guidance); }
        ctx.check('while the launcher is alive the wingman is not locked',
            missile.missileRadar.getLockedTargetId() === null);

        flight.lead.destroy();
        const frameMs = 1000 / 60;
        const freshFrames = Math.floor(PPLI_STALE_MS / frameMs) - 6;
        let lockedWhileFresh = false;
        for (let f = 0; f < freshFrames; f++) {
            await ctx.frames(1);
            guide(ctx, flight, missile, guidance);
            if (missile.missileRadar.getLockedTargetId() !== null) lockedWhileFresh = true;
        }
        ctx.check('the last PPLI keeps protecting him until it goes stale', !lockedWhileFresh);

        for (let f = 0; f < 60; f++) { await ctx.frames(1); guide(ctx, flight, missile, guidance); }
        ctx.check('once it is stale the seeker locks the wingman',
            missile.missileRadar.getLockedTargetId() === flight.wing.id,
            `locked ${missile.missileRadar.getLockedTargetId()}`);
        missile.destroy();
    },
};

// (v) The shooter's own check. Geometry first (Flight.clearToFire, from the link's
// PPLI only), then the live thing: a flight that has chosen a tactic and is
// ready to shoot holds fire while its mate sits on the target, and fires once
// it clears.
const shooterHoldsFireForMate: GameTest = {
    name: 'A shooter holds fire when its mate is on the target, and fires once the mate clears',
    description: 'clearToFire: false with the mate inside the target\'s correlation gate or in the seeker\'s cone '
        + 'ahead of the launch point, true with the mate abeam of the shooter. Live: a flight with its lead '
        + 'pinned beside the drone fires nothing for 600 frames; released, it fires.',
    async run(ctx) {
        // Geometry. Target 400 px east of the shooter (the wing), mate (the lead) moved around.
        const flight = stillFlight(ctx);
        const { lead, wing } = flight;
        const target = { x: wing.x + 400, y: wing.y };
        const clear = async (matePos: Point): Promise<boolean> => {
            lead.setPosition(matePos.x, matePos.y);
            await ctx.frames(3);
            return flight.clearToFire(wing, target, ctx.scene.time.now);
        };
        ctx.check('mate abeam of the shooter: clear', await clear({ x: wing.x, y: wing.y - 80 }));
        ctx.check('mate on the target, inside the correlation gate: held',
            !(await clear({ x: target.x - 30, y: target.y + 30 })));
        ctx.check('mate 150 px short of the target on the line, in the seeker\'s cone: held',
            !(await clear({ x: target.x - 150, y: target.y + 20 })));
        ctx.check('mate 300 px to the side of the target, outside the cone: clear',
            await clear({ x: target.x - 100, y: target.y - 300 }));

        // Live. Same rig as the tactic tests: a drone 400 px ahead, both armed, lead holding it.
        lead.destroy();
        wing.destroy();
        const rig = await liveFireRig(ctx);
        const roundsAtStart = roundsOf(rig.flight.lead) + roundsOf(rig.flight.wing);
        const near = { x: rig.drone.x - 30, y: rig.drone.y + 40 };
        let engagedPlan = false;
        for (let f = 0; f < 600; f++) {
            await ctx.frames(1);
            rig.flight.lead.setPosition(near.x, near.y);
            if (rig.flight.tactic !== 'formation') engagedPlan = true;
        }
        const heldRounds = roundsOf(rig.flight.lead) + roundsOf(rig.flight.wing);
        ctx.check('the flight had a plan to shoot on', engagedPlan, `tactic ${rig.flight.tactic}`);
        ctx.check('no round left a rail with the lead on the target', heldRounds === roundsAtStart,
            `${roundsAtStart} -> ${heldRounds}`);

        // The mate clears: back 300 px, the wing to its station beside it.
        rig.flight.lead.setPosition(1200, 1100);
        rig.flight.wing.setPosition(1200, 1180);
        const fired = await ctx.waitUntil(() => roundsOf(rig.flight.lead) + roundsOf(rig.flight.wing) < roundsAtStart, 1500);
        ctx.check('once the mate has cleared, the flight fires', fired,
            `${roundsAtStart} -> ${roundsOf(rig.flight.lead) + roundsOf(rig.flight.wing)}`);
    },
};

// A flight with its brains on and the lead holding a drone 400 px ahead, the
// same starting picture as the tactic tests; the drone absorbs missiles.
async function liveFireRig(ctx: TestContext): Promise<{ flight: Flight; drone: Target }> {
    const { flight, drone } = await oneDroneRig(ctx, 400);
    return { flight, drone };
}


// (t) The floor under all of it. Across every tactic test the closest the two
// hulls came never reached the floor the formation tests use.
const tacticsKeepClear: GameTest = {
    name: 'Tactics never bring the hulls together',
    description: 'The minimum hull-centre separation over every tactic test of this run stays above the floor '
        + 'the formation tests use.',
    async run(ctx) {
        ctx.check('some tactic test measured the pair', Number.isFinite(tacticMinSeparation));
        ctx.check('neither member was ever lost', tacticCasualty === '', tacticCasualty);
        ctx.check('the hulls never came closer than the formation floor',
            tacticMinSeparation > MIN_SAFE_SEPARATION_PX, `${tacticMinSeparation.toFixed(1)} px at ${tacticMinWhere}`);
        await ctx.frames(1);
    },
};

export const flightTests: GameTest[] = [
    holdsStationThroughTurns,
    clearsLeadInTightTurns,
    noFratricide,
    fireControlRefusesWingman,
    stillFights,
    pairReadsAsOneContact,
    leadLostWingFliesOn,
    sortsOneEach,
    emconWingLaunchesOnRemote,
    noLeadTrackNoShot,
    remoteTrackNeedsRing,
    lockOnWingmanBearingEvades,
    sortSurvivesDropout,
    shooterCoverWingShoots,
    bracketSplitsAndCloses,
    bracketMirrored,
    grinderAlternates,
    tacticHolds,
    wingCuesLead,
    remoteMissileSurvivesCollapse,
    seekerKeepsOffWingman,
    staleUplinkLosesFriends,
    shooterHoldsFireForMate,
    tacticsKeepClear,
];
