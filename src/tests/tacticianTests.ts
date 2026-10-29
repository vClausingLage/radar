import Phaser from 'phaser';
import { GameTest, TestContext } from './testHarness';
import { Target } from '../entities/ship';
import { ActiveRadarMissile } from '../entities/missiles';
import {
    AiUnitController,
    TacticalPicture,
    TacticalStateName,
    Tactician,
} from '../controller/aiUnitController';
import { Flight, FlightTactic } from '../controller/flight';
import { JevRequest, JevResponse, JevTactician } from '../controller/jevTactician';
import { tacticSettings, targetShipSettings } from '../settings';

// In-game tests for the seam between an AI ship and its tactical judgement
// (a Tactician — Jev in play, a stub here). The judgement is allowed to choose;
// it is not allowed to see more than the ship's own sensors hold, or to talk
// the ship into something the situation does not permit. Those two rules are
// what keep a model-flown opponent honest, so they are what is tested — not
// whether Jev itself chooses well, which needs the network and is tuned
// against recorded pictures instead (decision_tree.md, "Jev tactician").

// A 60-degree RWS cone stepped 1 degree per frame: one sweep leg per 60 frames.
const FRAMES_PER_SWEEP = 60;

// Close enough that each ship's radar holds the other comfortably, far enough
// that the drone's hull sits well clear of the player's.
const DRONE_RANGE_PX = 300;

// The only numbers a tactical picture may carry: stores, counted. Any other
// number would be geometry — a range, bearing or position — which is exactly
// what the picture bands into words before a tactician sees it.
const COUNTED_FIELDS = ['missilesLeft', 'chaffLeft', 'wingmanMissiles'];

// A tactician that answers with a fixed rule and remembers every question.
class RecordingTactician implements Tactician {
    readonly pictures: TacticalPicture[] = [];
    readonly offered: TacticalStateName[][] = [];

    constructor(private readonly rule: (legal: TacticalStateName[]) => TacticalStateName | null) {}

    advise(picture: TacticalPicture, legal: TacticalStateName[]): TacticalStateName | null {
        this.pictures.push(picture);
        this.offered.push(legal);
        return this.rule(legal);
    }

    // The state the controller was in when last asked — i.e. the outcome of
    // the frame before.
    lastState(): TacticalStateName | undefined {
        return this.pictures[this.pictures.length - 1]?.currentState;
    }

    getDebugLabel(): string { return 'STUB'; }
    destroy(): void {}
}

// A stub for the lead of a flight: answers the plan question with a fixed rule
// and remembers what it was asked and what it was told.
class FlightStub implements Tactician {
    readonly pictures: TacticalPicture[] = [];
    readonly offeredTactics: FlightTactic[][] = [];
    // Every call, whether or not it had a flight to talk about.
    asked = 0;
    planCalls = 0;

    constructor(private readonly rule: (legal: FlightTactic[]) => FlightTactic | null) {}

    advise(picture: TacticalPicture, _legal: TacticalStateName[], legalTactics: FlightTactic[] = []): TacticalStateName | null {
        this.asked++;
        this.pictures.push(picture);
        if (legalTactics.length) this.offeredTactics.push(legalTactics);
        return null;
    }

    adviseFlightTactic(_picture: TacticalPicture, legalTactics: FlightTactic[]): FlightTactic | null {
        this.planCalls++;
        return this.rule(legalTactics);
    }

    getDebugLabel(): string { return 'FLIGHT STUB'; }
    destroy(): void {}
}

// Give a drone a working brain again. spawnDrone detaches the AI so props stay
// props; these tests want the AI, but as an emplacement ('inactive') so its
// geometry holds still while its radar, decisions and stores all run.
function attachBrain(ctx: TestContext, drone: Target, tactician: Tactician): AiUnitController {
    drone.controller?.destroy();
    const controller = new AiUnitController(
        ctx.scene, drone, 0, false, drone.radar, drone.id, 'inactive', tactician,
    );
    drone.controller = controller;
    return controller;
}

// (a) Code rules on what is possible. A drone with nothing in the world
// emitting at it has nothing to defend against — so EVADE is not on offer, and
// a tactician that insists on it is overruled rather than obeyed. Chaff is the
// tangible proof: EVADE spends it, and none may go. The player sits in EMCON:
// even behind it, its sidelobes (ANTENNA_SIDELOBE_LEVEL) could warn the drone
// now and then, and a warned drone may evade. (The drone may still chase a
// thermal false alarm — RADAR_FALSE_ALARM_RATE — which is the doctrine
// working, so the claim is "never EVADE", not "never anything but PATROL".)
const illegalAdviceRefused: GameTest = {
    name: 'A tactician cannot pick a state the situation forbids',
    description: 'A drone with no emitter in the world hears no RWR warning. Its tactician answers EVADE '
        + 'every frame; the controller refuses it, never evades and keeps its chaff.',
    async run(ctx) {
        ctx.player.radar.enterEmcon();
        const boresight = ctx.player.getDirection();
        const drone = ctx.scene.spawnDrone({
            bearingDeg: boresight + 180,
            rangePx: DRONE_RANGE_PX,
            facingDeg: boresight + 180,
            emitting: true,
        });
        const stub = new RecordingTactician(() => 'EVADE');
        attachBrain(ctx, drone, stub);
        const chaffBefore = drone.getRemainingDecoys();

        await ctx.frames(FRAMES_PER_SWEEP * 3);

        const everOffered = stub.offered.some(legal => legal.includes('EVADE'));
        const states = [...new Set(stub.pictures.map(p => p.currentState))];
        ctx.check('EVADE was never on offer', !everOffered,
            `offered: ${[...new Set(stub.offered.flat())].join(', ') || 'nothing'}`);
        ctx.check('the drone never evaded', !states.includes('EVADE'), `states seen: ${states.join(', ')}`);
        ctx.check('no chaff was spent', drone.getRemainingDecoys() === chaffBefore,
            `chaff ${chaffBefore} -> ${drone.getRemainingDecoys()}`);
    },
};

// (b) A tactician knows what the ship knows — no more. The player is 300 px
// away, behind the drone's radar and outside the player's main beam: the truth
// says "enemy close by", the sensors mostly say nothing. So every frame the
// picture is compared with the drone's radar and RWR at that same moment — it
// reports a contact exactly when the radar holds a track (a false alarm
// included: that is what the sensor believes), a warning exactly when the RWR
// hears one (a sidelobe leak included: at this range the player's
// ANTENNA_SIDELOBE_LEVEL floor is sometimes audible behind it, which is why
// the claim is agreement with the sensors, not silence). And it says it in
// words: no coordinate, range or bearing reaches the tactician.
const pictureIsOwnSensorsOnly: GameTest = {
    name: 'A tactician only sees what its own sensors hold',
    description: 'A drone 300 px behind the player: every frame its picture reports a contact and a '
        + 'warning exactly when its own radar and RWR hold one, and carries no geometry as numbers.',
    async run(ctx) {
        const boresight = ctx.player.getDirection();
        const drone = ctx.scene.spawnDrone({
            bearingDeg: boresight + 180,
            rangePx: DRONE_RANGE_PX,
            facingDeg: boresight + 180,
            emitting: true,
        });
        // Read the sensors in the same call the picture is handed over, so the
        // two describe the same instant.
        const sensors: { tracks: number; warnings: number }[] = [];
        const stub = new RecordingTactician(() => {
            sensors.push({
                tracks: drone.radar.getTracks().length,
                warnings: drone.radar.rwrReceiver.getRwrSignals().length,
            });
            return null;
        });
        attachBrain(ctx, drone, stub);

        await ctx.frames(FRAMES_PER_SWEEP * 3);

        const contactMismatches = stub.pictures.filter((p, i) => (p.contact !== 'none') !== (sensors[i].tracks > 0));
        const warningMismatches = stub.pictures.filter((p, i) => (p.rwr !== 'silent') !== (sensors[i].warnings > 0));
        const numericFields = [...new Set(stub.pictures.flatMap(p =>
            Object.entries(p).filter(([, v]) => typeof v === 'number').map(([k]) => k)))];
        const geometry = numericFields.filter(k => !COUNTED_FIELDS.includes(k));

        ctx.check('the tactician was asked', stub.pictures.length > 0, `${stub.pictures.length} pictures`);
        ctx.check('a contact exactly when the radar holds a track', contactMismatches.length === 0,
            `${contactMismatches.length} of ${stub.pictures.length} frames disagree`);
        ctx.check('a warning exactly when the RWR hears one', warningMismatches.length === 0,
            `${warningMismatches.length} of ${stub.pictures.length} frames disagree`);
        ctx.check('no geometry as numbers', geometry.length === 0,
            `numeric fields: ${numericFields.join(', ') || 'none'}`);
    },
};

// (c) And when the advice is legal, it is the advice that flies. Both halves on
// the same geometry — a drone nose-on to the player, tracking it and swept by
// it: with no opinion from the tactician the scripted doctrine goes to
// INVESTIGATE on the contact; with a tactician holding PATROL, the drone holds
// PATROL with that same contact on its scope.
const legalAdviceOverridesDoctrine: GameTest = {
    name: "A tactician's legal advice overrides the scripted doctrine",
    description: 'A drone tracking the player investigates by doctrine; given a tactician that says PATROL, '
        + 'it patrols with the contact still on its scope.',
    async run(ctx) {
        const drone = ctx.scene.spawnDrone({
            bearingDeg: ctx.player.getDirection(),
            rangePx: DRONE_RANGE_PX,
            emitting: true,
        });

        // Doctrine alone. Stopped the moment it investigates: left to run, it
        // would set up a shot at the player and end the test with a missile.
        const silent = new RecordingTactician(() => null);
        attachBrain(ctx, drone, silent);
        const investigated = await ctx.waitUntil(() => silent.lastState() === 'INVESTIGATE', FRAMES_PER_SWEEP * 8);
        ctx.check('by doctrine, the drone investigates its contact', investigated,
            `last state ${silent.lastState() ?? 'none'}`);

        const holdPatrol = new RecordingTactician(() => 'PATROL');
        attachBrain(ctx, drone, holdPatrol);
        await ctx.frames(FRAMES_PER_SWEEP * 4);

        const heldContact = holdPatrol.pictures.some(p => p.contact !== 'none');
        const states = [...new Set(holdPatrol.pictures.map(p => p.currentState))];
        ctx.check('the contact is still on its scope', heldContact);
        ctx.check('advised PATROL, it holds PATROL', states.length === 1 && states[0] === 'PATROL',
            `states seen: ${states.join(', ')}`);
    },
};

// (d) Jev's own gate, with the network replaced by canned answers. An answer is
// flown only if it is confident and names a state that was on offer; a question
// with one possible answer is never asked; and a failed ask costs nothing but
// the advice. Driven straight through advise(), frame by frame, so the canned
// promise has a turn to resolve between asks.
const jevGatesItsAnswers: GameTest = {
    name: 'Jev advice is used only when confident and on offer',
    description: 'Canned Jev answers: a confident legal choice is flown; an unsure one, an unoffered one and '
        + 'a failed request all leave the decision to the doctrine; a single-option picture is never asked.',
    async run(ctx) {
        const picture: TacticalPicture = {
            currentState: 'PATROL',
            personality: 'aggressive',
            radarMode: 'rws',
            contact: 'none',
            contactRange: 'no contact',
            contactBearing: 'no contact',
            contactIff: 'no contact',
            firingSolution: false,
            selectedWeapon: 'VIM-220 fire-and-forget',
            missilesLeft: 6,
            ourMissileInFlight: false,
            skate: 'not skating',
            rwr: 'locked by enemy fire-control radar',
            emitterHeard: 'heard just now',
            missileInbound: false,
            chaffLeft: 5,
            jammerReady: true,
            nearWorldEdge: false,
            wingman: 'no wingman',
            wingmanMissiles: 0,
            flightTactic: 'no flight',
            groupsOnLink: 'none',
        };
        const offered: TacticalStateName[] = ['PATROL', 'EVADE'];
        const canned = (choice: string, confidence: number) => async (): Promise<JevResponse> => ({
            answers: { next_state: { type: 'choice', choice, confidence, probabilities: {} } },
        });

        // Ask, give the canned answer a few frames to land, then ask again.
        const adviceAfterAnswer = async (jev: JevTactician, legal = offered) => {
            jev.advise(picture, legal);
            await ctx.frames(3);
            const advice = jev.advise(picture, legal);
            jev.destroy();
            return advice;
        };

        const confident = await adviceAfterAnswer(new JevTactician(canned('EVADE', 0.9)));
        ctx.check('a confident, offered answer is flown', confident === 'EVADE', `advice ${confident}`);

        const unsure = await adviceAfterAnswer(new JevTactician(canned('EVADE', 0.3)));
        ctx.check('an unsure answer is not', unsure === null, `advice ${unsure}`);

        const unoffered = await adviceAfterAnswer(new JevTactician(canned('ENGAGE', 0.95)));
        ctx.check('an answer naming an unoffered state is not', unoffered === null, `advice ${unoffered}`);

        const failing = new JevTactician(async () => { throw new Error('canned failure'); });
        const afterFailure = await adviceAfterAnswer(failing);
        ctx.check('a failed request leaves no advice', afterFailure === null, `advice ${afterFailure}`);

        let asked = 0;
        const counting = new JevTactician(async (_request: JevRequest) => { asked++; return canned('PATROL', 1)(); });
        await adviceAfterAnswer(counting, ['PATROL']);
        ctx.check('a single-option picture is never asked', asked === 0, `${asked} requests`);

        // No fight: nothing on the scope, no lock, no missile, only a radar
        // heard somewhere. PATROL or HUNT is the doctrine's call, not Jev's.
        asked = 0;
        const calm: TacticalPicture = { ...picture, rwr: 'searched by enemy radar' };
        counting.advise(calm, ['PATROL', 'HUNT']);
        await ctx.frames(3);
        counting.advise(calm, ['PATROL', 'HUNT']);
        ctx.check('outside a fight Jev is never asked', asked === 0, `${asked} requests`);
    },
};

// (e) An RWR warning is a lead, not a passing scare. The player's search beam
// sweeps a drone whose nose points away — its own radar cannot see the player,
// only its RWR hears him. Then the player goes silent: the RWR contact ages
// out, but the drone keeps hunting down the bearing it heard instead of
// dropping back into its patrol.
const rwrBearingIsHunted: GameTest = {
    name: 'A heard radar is hunted after the warning fades',
    description: 'A drone facing away from the player hears his search radar and hunts; after the player '
        + 'goes to EMCON and the RWR falls silent, it is still hunting that bearing.',
    async run(ctx) {
        const boresight = ctx.player.getDirection();
        const drone = ctx.scene.spawnDrone({
            bearingDeg: boresight,
            rangePx: DRONE_RANGE_PX,
            facingDeg: boresight,
            emitting: true,
        });
        // 'active' so the hunt is allowed; at speed 0 and turn rate 0 the
        // drone still cannot move or turn, so its radar never finds the player.
        drone.controller?.destroy();
        const stub = new RecordingTactician(() => null);
        drone.controller = new AiUnitController(
            ctx.scene, drone, 0, false, drone.radar, drone.id, 'active', stub,
        );

        const hunting = await ctx.waitUntil(() => stub.lastState() === 'HUNT', FRAMES_PER_SWEEP * 6);
        ctx.check('hearing the player, the drone hunts', hunting, `last state ${stub.lastState() ?? 'none'}`);

        ctx.player.radar.enterEmcon();
        const silent = await ctx.waitUntil(() => drone.radar.rwrReceiver.getRwrSignals().length === 0, 400);
        const before = stub.pictures.length;
        await ctx.frames(30);
        // The claim is "never back to PATROL", not "only HUNT": the drone may
        // still chase a thermal false alarm (RADAR_FALSE_ALARM_RATE) into
        // INVESTIGATE — that is the doctrine working, as in (a).
        const after = [...new Set(stub.pictures.slice(before).map(p => p.currentState))];
        ctx.check('the RWR has gone silent', silent);
        ctx.check('it keeps after the bearing instead of patrolling', !after.includes('PATROL'),
            `states after the warning faded: ${after.join(', ')}`);
        ctx.player.radar.enterRws();
    },
};

// ── The lead's flight tactic ───────────────────────────────────────────────

// A flight heading east from (1200, 1100), inert until the lead holds a drone
// 400 px ahead on the link; then the lead gets `leadStub` and the wing `wingStub`
// (the wing must never be asked, so a stub there is the test). The drone
// cannot be hurt and swallows rounds that reach it, as in the tactic tests.
// 400 px is inside the room a bracket needs, both members armed, so the legal
// plans are formation, shooter/cover and grinder.
async function leadWithTactician(
    ctx: TestContext, leadStub: Tactician, wingStub: Tactician | null = null,
): Promise<{ flight: Flight; drone: Target }> {
    ctx.player.radar.enterEmcon();
    const flight = ctx.scene.spawnFlight({ x: 1200, y: 1100, direction: 0, speed: 0.5, inert: true });
    const drone = ctx.scene.spawnDrone({ bearingDeg: 0, rangePx: 1, facingDeg: 90, hull: 'cargo', side: 'friendly' });
    drone.setPosition(1600, 1100);
    drone.setCollidesWith(0);
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
    ctx.check('the lead holds the drone on the link before the brains start', steady >= 10);
    const roles: [Target, 'lead' | 'wing', Tactician | null][] = [
        [flight.lead, 'lead', leadStub], [flight.wing, 'wing', wingStub],
    ];
    for (const [ship, role, tactician] of roles) {
        const controller = new AiUnitController(
            ctx.scene, ship, targetShipSettings.TURN_RATE_CRUISER, false, ship.radar, ship.id, 'active', tactician,
        );
        ship.setController(controller);
        controller.joinFlight(flight, role);
    }
    return { flight, drone };
}

// Run the flight, spent rounds at the drone absorbed, for up to `frames`, until
// `until` holds. Returns the scene times at which the tactic changed.
async function flyFlight(
    ctx: TestContext, flight: Flight, drone: Target, frames: number, until: () => boolean = () => false,
): Promise<{ at: number; tactic: FlightTactic }[]> {
    const changes: { at: number; tactic: FlightTactic }[] = [{ at: ctx.scene.time.now, tactic: flight.tactic }];
    for (let f = 0; f < frames && !until(); f++) {
        await ctx.frames(1);
        for (const o of ctx.scene.children.list) {
            if (o instanceof ActiveRadarMissile && o.active
                && Phaser.Math.Distance.Between(o.x, o.y, drone.x, drone.y) <= 40) o.destroy();
        }
        if (changes[changes.length - 1].tactic !== flight.tactic) changes.push({ at: ctx.scene.time.now, tactic: flight.tactic });
    }
    return changes;
}

// (f) Code decides what is possible. Bracket needs room to split, and at 400 px
// there is none: it is not on offer, so a tactician that insists on it is
// overruled and the doctrine's plan (the quiet shot) is flown.
const illegalTacticRefused: GameTest = {
    name: 'A tactician cannot pick a flight tactic the situation forbids',
    description: 'A lead whose tactician answers "bracket" every time, with the drone too near to split. '
        + 'Bracket is never offered and never flown; the doctrine\'s shooter/cover is.',
    async run(ctx) {
        const stub = new FlightStub(() => 'bracket');
        const { flight, drone } = await leadWithTactician(ctx, stub);
        const seen = new Set<string>();
        await flyFlight(ctx, flight, drone, 900, () => { seen.add(flight.tactic); return false; });
        ctx.check('the tactician was asked about the flight', stub.offeredTactics.length > 0,
            `${stub.offeredTactics.length} offers`);
        ctx.check('bracket was never on offer', !stub.offeredTactics.some(o => o.includes('bracket')),
            `offered: ${[...new Set(stub.offeredTactics.flat())].join(', ')}`);
        ctx.check('bracket was never flown', !seen.has('bracket'), `tactics flown: ${[...seen].join(', ')}`);
        ctx.check('the doctrine\'s shooter/cover was', seen.has('shooterCover'), `tactics flown: ${[...seen].join(', ')}`);
    },
};

// (g) And when the advice is legal, it is the advice that flies - after the
// dwell, like the doctrine's own plan: the same picture, the doctrine's
// shooter/cover, and a tactician that says grinder.
const legalTacticOverridesDoctrine: GameTest = {
    name: "A tactician's legal flight tactic overrides the doctrine, after the dwell",
    description: 'The same picture, a tactician that answers "grinder" (legal, not what the doctrine would pick). '
        + 'The flight changes to it, and not sooner than the dwell after the first time it was offered.',
    async run(ctx) {
        let firstOffered: number | null = null;
        const stub = new FlightStub(legal => {
            firstOffered ??= ctx.scene.time.now;
            return legal.includes('grinder') ? 'grinder' : null;
        });
        const { flight, drone } = await leadWithTactician(ctx, stub);
        const changes = await flyFlight(ctx, flight, drone, 900, () => flight.tactic === 'grinder');
        const change = changes.find(c => c.tactic === 'grinder');
        ctx.check('the flight went to the grinder', change !== undefined,
            changes.map(c => c.tactic).join(' > '));
        if (change && firstOffered !== null) {
            const settled = change.at - firstOffered;
            ctx.check('and not before the dwell had run', settled >= tacticSettings.DWELL_MS - 40,
                `${Math.round(settled)} ms after first asked (dwell ${tacticSettings.DWELL_MS})`);
        }
    },
};

// (h) The doctrine covers every frame the tactician has no usable answer for.
// At the flight level: no opinion at all. At Jev's own gate: an unsure answer,
// an unoffered one, a failed request and a stale answer, driven through the
// canned transport, plus the one-request rule.
const unusableTacticAdviceFallsBack: GameTest = {
    name: 'Low-confidence, stale or failed flight advice falls back to the doctrine',
    description: 'A tactician with no opinion leaves the doctrine\'s shooter/cover in force. Canned Jev answers: a '
        + 'confident legal plan is used; an unsure one, an unoffered one, a failed request and a stale answer '
        + 'are not; one request carries both questions, and one legal tactic is never asked.',
    async run(ctx) {
        const silent = new FlightStub(() => null);
        const { flight, drone } = await leadWithTactician(ctx, silent);
        const changes = await flyFlight(ctx, flight, drone, 700);
        ctx.check('with no opinion the doctrine opens with shooter/cover', changes[1]?.tactic === 'shooterCover',
            changes.map(c => c.tactic).join(' > '));

        const picture: TacticalPicture = {
            currentState: 'INVESTIGATE', personality: 'aggressive', radarMode: 'tws',
            contact: 'mature track', contactRange: 'inside missile range', contactBearing: 'on the nose', contactIff: 'no IFF reply',
            firingSolution: false, selectedWeapon: 'VIM-220 fire-and-forget', missilesLeft: 4,
            ourMissileInFlight: false, skate: 'not skating', rwr: 'silent', emitterHeard: 'never',
            missileInbound: false, chaffLeft: 5, jammerReady: true, nearWorldEdge: false,
            wingman: 'in formation', wingmanMissiles: 4, flightTactic: 'formation', groupsOnLink: 'one group',
        };
        const offered: FlightTactic[] = ['formation', 'shooterCover'];
        const canned = (choice: string, confidence: number) => async (): Promise<JevResponse> => ({
            answers: { next_tactic: { type: 'choice', choice, confidence, probabilities: {} } },
        });
        // A flight lead with one legal state is asked only the plan.
        const adviceAfterAnswer = async (jev: JevTactician, tactics = offered, waitMs = 0) => {
            jev.advise(picture, ['PATROL'], tactics);
            await ctx.frames(3);
            if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
            jev.advise(picture, ['PATROL'], tactics);
            const advice = jev.adviseFlightTactic(picture, tactics);
            jev.destroy();
            return advice;
        };

        const confident = await adviceAfterAnswer(new JevTactician(canned('shooterCover', 0.9)));
        ctx.check('a confident, offered plan is used', confident === 'shooterCover', `advice ${confident}`);
        const unsure = await adviceAfterAnswer(new JevTactician(canned('shooterCover', 0.3)));
        ctx.check('an unsure one is not', unsure === null, `advice ${unsure}`);
        const unoffered = await adviceAfterAnswer(new JevTactician(canned('bracket', 0.95)));
        ctx.check('one that was not on offer is not', unoffered === null, `advice ${unoffered}`);
        const failed = await adviceAfterAnswer(new JevTactician(async () => { throw new Error('canned failure'); }));
        ctx.check('a failed request leaves no advice', failed === null, `advice ${failed}`);
        const stale = await adviceAfterAnswer(new JevTactician(canned('shooterCover', 0.9)), offered, 2700);
        ctx.check('a stale answer is not used', stale === null, `advice ${stale}`);

        const requests: JevRequest[] = [];
        const recording = new JevTactician(async (request: JevRequest) => { requests.push(request); return {}; });
        recording.advise(picture, ['PATROL', 'INVESTIGATE'], offered);
        recording.destroy();
        ctx.check('one request carries both questions', requests.length === 1
            && Boolean(requests[0].questions.next_state) && Boolean(requests[0].questions.next_tactic),
            `${requests.length} requests, questions ${Object.keys(requests[0]?.questions ?? {}).join(', ')}`);
        const criteria = Object.keys(requests[0]?.questions.next_tactic?.criteria ?? {});
        ctx.check('the plan question offers exactly the legal tactics',
            criteria.length === offered.length && offered.every(t => criteria.includes(t)), criteria.join(', '));

        let asked = 0;
        const counting = new JevTactician(async (_request: JevRequest) => { asked++; return {}; });
        counting.advise(picture, ['PATROL'], ['formation']);
        await ctx.frames(3);
        counting.advise(picture, ['PATROL'], ['formation']);
        counting.destroy();
        ctx.check('one legal tactic and one legal state is never asked', asked === 0, `${asked} requests`);
    },
};

// (i) The lead's picture carries the wingman as words, taken from the link, and
// never from the entity list - the same standard as every other field. The
// wing is alive and within sight of the lead but has no controller, so it puts
// nothing on the link beyond its position: the lead is told "lost". Once it
// flies, the link carries its status and the lead is told what it is doing.
const flightPictureIsLinkOnly: GameTest = {
    name: 'The lead\'s picture carries the wingman as link words, never from the entity list',
    description: 'A wingman in plain sight but silent on the link reads "lost"; once it reports, it reads '
        + '"in formation", with its missile count and the groups on the link taken from the link. '
        + 'No geometry as numbers.',
    async run(ctx) {
        const stub = new FlightStub(() => null);
        ctx.player.radar.enterEmcon();
        const flight = ctx.scene.spawnFlight({ x: 1200, y: 1100, direction: 0, speed: 0.1, inert: true });
        const drone = ctx.scene.spawnDrone({ bearingDeg: 0, rangePx: 1, facingDeg: 90, hull: 'cargo', side: 'friendly' });
        drone.setPosition(1600, 1100);
        drone.setCollidesWith(0);
        flight.lead.radar.enterRws();
        const lead = new AiUnitController(
            ctx.scene, flight.lead, targetShipSettings.TURN_RATE_CRUISER, false, flight.lead.radar, flight.lead.id, 'active', stub);
        flight.lead.setController(lead);
        lead.joinFlight(flight, 'lead');

        await ctx.frames(240);
        const silent = stub.pictures.slice();
        ctx.check('the lead was asked', silent.length > 0, `${silent.length} pictures`);
        ctx.check('a wingman silent on the link reads "lost" although it is alive beside the lead',
            flight.wing.active && silent.every(p => p.wingman === 'lost' && p.wingmanMissiles === 0),
            [...new Set(silent.map(p => p.wingman))].join(', '));

        const wing = new AiUnitController(
            ctx.scene, flight.wing, targetShipSettings.TURN_RATE_CRUISER, false, flight.wing.radar, flight.wing.id, 'active', null);
        flight.wing.setController(wing);
        wing.joinFlight(flight, 'wing');
        await ctx.frames(240);
        const reporting = stub.pictures.slice(silent.length + 30);
        const words = [...new Set(reporting.map(p => p.wingman))];
        const rails = flight.wing.radar.getWeaponLoad('VIM-220') + flight.wing.radar.getWeaponLoad('VIM-177');
        ctx.check('a wingman reporting on the link reads as what it is doing',
            reporting.length > 0 && reporting.every(p => p.wingman !== 'lost' && p.wingman !== 'no wingman'), words.join(', '));
        // (The page is a frame behind a launch, so a count may read one high.)
        ctx.check('its missile count is the one on its status page',
            reporting.every(p => p.wingmanMissiles === rails || p.wingmanMissiles === rails + 1),
            `${[...new Set(reporting.map(p => p.wingmanMissiles))].join(', ')} vs ${rails}`);
        ctx.check('the groups on the link are the link\'s',
            reporting.every(p => p.groupsOnLink === 'one group' || p.groupsOnLink === 'none'),
            [...new Set(reporting.map(p => p.groupsOnLink))].join(', '));
        ctx.check('the plan in force is in the picture', reporting.every(p => p.flightTactic !== 'no flight'),
            [...new Set(reporting.map(p => p.flightTactic))].join(', '));
        const numericFields = [...new Set(stub.pictures.flatMap(p =>
            Object.entries(p).filter(([, v]) => typeof v === 'number').map(([k]) => k)))];
        const geometry = numericFields.filter(k => !COUNTED_FIELDS.includes(k));
        ctx.check('no geometry as numbers', geometry.length === 0, `numeric fields: ${numericFields.join(', ')}`);
    },
};

// (j) Only the lead is asked. Both controllers are handed a tactician; the
// wing's is never consulted - not for its state, not for the flight.
const wingIsNeverAsked: GameTest = {
    name: 'The wing is never asked',
    description: 'A tactician on each member of a flight working one drone: the lead\'s is asked every frame; '
        + 'the wing\'s is never consulted, for a state or for a plan.',
    async run(ctx) {
        const leadStub = new FlightStub(() => null);
        const wingStub = new FlightStub(() => 'grinder');
        const { flight, drone } = await leadWithTactician(ctx, leadStub, wingStub);
        await flyFlight(ctx, flight, drone, 600);
        ctx.check('the lead\'s tactician was asked', leadStub.asked > 0, `${leadStub.asked} calls`);
        ctx.check('the wing\'s was not, for a state', wingStub.asked === 0, `${wingStub.asked} calls`);
        ctx.check('the lead\'s was asked for a plan', leadStub.planCalls > 0, `${leadStub.planCalls} calls`);
        ctx.check('the wing\'s never was', wingStub.planCalls === 0 && wingStub.pictures.length === 0,
            `${wingStub.planCalls} plan calls, ${wingStub.pictures.length} pictures`);
    },
};

export const tacticianTests: GameTest[] = [
    illegalAdviceRefused,
    pictureIsOwnSensorsOnly,
    legalAdviceOverridesDoctrine,
    jevGatesItsAnswers,
    rwrBearingIsHunted,
    illegalTacticRefused,
    legalTacticOverridesDoctrine,
    unusableTacticAdviceFallsBack,
    flightPictureIsLinkOnly,
    wingIsNeverAsked,
];
