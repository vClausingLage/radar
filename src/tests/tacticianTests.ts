import { GameTest, TestContext } from './testHarness';
import { Target } from '../entities/ship';
import {
    AiUnitController,
    TacticalPicture,
    TacticalStateName,
    Tactician,
} from '../controller/aiUnitController';
import { JevRequest, JevResponse, JevTactician } from '../controller/jevTactician';

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
const COUNTED_FIELDS = ['missilesLeft', 'chaffLeft'];

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
            firingSolution: false,
            selectedWeapon: 'VIM-220 fire-and-forget',
            missilesLeft: 6,
            ourMissileInFlight: false,
            skate: 'not skating',
            rwr: 'locked by enemy fire-control radar',
            missileInbound: false,
            chaffLeft: 5,
            jammerReady: true,
            nearWorldEdge: false,
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
    },
};

export const tacticianTests: GameTest[] = [
    illegalAdviceRefused,
    pictureIsOwnSensorsOnly,
    legalAdviceOverridesDoctrine,
    jevGatesItsAnswers,
];
