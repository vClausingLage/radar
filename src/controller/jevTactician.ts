import Phaser from 'phaser';
import type { TacticalPicture, TacticalStateName, Tactician } from './aiUnitController';
import type { FlightTactic } from './flight';

// Jev — TypeSafe's "System One" decision model, reached through OpenRouter —
// as the tactical judgement of an AI fighter. It does not fly the ship: the
// AiUnitController still steers, locks, shoots and drops chaff. Jev answers the
// question a pilot answers between those actions — *what am I doing now?* — by
// picking one of the controller's states from the picture its own sensors hold.
//
// A flight's lead is asked a second question in the same request: which tactic
// the pair should fly (FlightTactic). Same rules: only the tactics that are
// possible are offered, the answer is used only while fresh, confident and
// still on offer, and the scripted flight doctrine decides otherwise. The wing is
// never asked.
//
// Jev is a calibrated classifier, not a chat model: it is handed a state and a
// closed set of options, and returns a probability per option plus a
// confidence. That shapes everything here:
//   - Only legal options are offered. Code decides what is possible (no ENGAGE
//     without a firing solution); Jev decides what is wise.
//   - The picture is words, not coordinates. Jev is no calculator, so ranges and
//     angles are banded by the controller before Jev sees them.
//   - An answer is used only while it is fresh, still legal and confident.
//     Anything else — no answer yet, a network error, an unsure model — hands
//     the decision back to the controller's scripted doctrine for that frame.
//
// The API key never reaches the browser: requests go to the Vite dev server's
// /api/jev proxy (vite.config.ts), which holds AI_KEY. A production build has
// no proxy, so the ship factory only hands out a JevTactician in DEV.

// ── Tunables ───────────────────────────────────────────────────────────────
const JEV_ENDPOINT = '/api/jev';
const DECISION_INTERVAL_MS = 750;   // min gap between asks; one request in flight at a time
const ANSWER_STALE_MS = 2500;       // an answer about a picture older than this is ignored
const REQUEST_TIMEOUT_MS = 4000;
// Below this Jev is unsure and the scripted doctrine decides. Measured against
// recorded duel pictures (decision_tree.md, "Jev tactician"): Jev's unsure
// answers cluster on the genuinely ambiguous moments — the instant a skate
// ends — so 0.5 hands exactly those back to the script.
const MIN_CONFIDENCE = 0.5;
const BACKOFF_START_MS = 2000;      // first wait after a failed request, doubled per failure
const BACKOFF_MAX_MS = 30000;

// The question carries the shape of the fight — the engagement cycle and what
// personality means — so the per-state criteria only have to say when.
const QUESTION = 'You are the tactical judgement of a hostile space fighter in a radar duel. '
    + 'The engagement cycle is INVESTIGATE, ENGAGE, CRANK, then SKATE, and a HUNT down the bearing of a '
    + 'heard radar can lead into it; EVADE interrupts it only when we are locked or a missile is inbound. An aggressive pilot presses the attack, a defensive one '
    + 'takes fewer risks. Given what its own radar and radar warning receiver report, which tactical '
    + 'state should it be in now?';

// The doctrine in decision_tree.md, one line per option. These descriptions are
// all Jev knows about a state — tuning them tunes the opponent. Each says what
// the state does and, above all, *when to choose it*: descriptions of what a
// state does alone left Jev agreeing with doctrine on a third of the recorded
// pictures and dropping chaff against radars that were only searching.
const STATE_CRITERIA: Record<TacticalStateName, string> = {
    PATROL: 'Fly the search pattern with the radar in wide search. Choose when we hold no radar contact, no enemy '
        + 'radar has locked us, and no enemy radar has been heard worth hunting.',
    HUNT: 'Fly down the bearing an enemy radar was heard on, to bring it inside our own radar\'s reach: its emission '
        + 'is heard much further out than our radar can see it. A defensive pilot approaches with its own radar '
        + 'silent at first. Choose when an enemy radar was heard, we hold no contact, and we are not locked.',
    INVESTIGATE: 'Close on the radar contact we hold to mature its track and set up a missile shot. Choose when we '
        + 'hold a contact but have no firing solution yet, and we are not locked.',
    ENGAGE: 'Fire the selected missile at the contact. Choose when we have a firing solution and the contact is '
        + 'inside missile range.',
    CRANK: 'Support our missile in flight: hold the target at the edge of our radar cone while opening range. '
        + 'Choose while our missile is in flight and we still track the target.',
    SKATE: 'Turn away and run from the last known target position to open range. Choose after our shot once the '
        + 'track is lost, or when out of missiles, and keep choosing it while the skate is still opening range. '
        + 'Once range is opened, return to the engagement cycle.',
    EVADE: 'Defend: drop chaff and turn cold or beam. Choose only when an enemy fire-control radar has locked us '
        + 'or a missile is inbound. Against a radar that is only searching, chaff is wasted.',
};

// The question the lead is asked about its flight. The shape of the fight again
// goes in the question; the criteria below say when.
const FLIGHT_QUESTION = 'You lead a two-ship flight of hostile space fighters against enemies on the radar link. '
    + 'A flight opens with a bracket or a shooter and cover, and once missiles are away trades shots as a grinder. '
    + 'Formation is flying on the lead with no target to work together. Given what the lead\'s radar, the link and '
    + 'the wingman\'s status page report, which flight tactic should the pair fly now?';

const TACTIC_CRITERIA: Record<FlightTactic, string> = {
    formation: 'Fly on the lead with nothing to work together. Choose when no group is on the link that we both '
        + 'can work, when neither of us has a missile worth a shot, or when the wingman is defending itself or lost.',
    shooterCover: 'The wingman takes the shot in silence on our track while we keep radiating. Choose when we hold '
        + 'a track on one group and the target should not hear a second radar, when the group is close, or when '
        + 'only one of us still has missiles.',
    bracket: 'Split to either side of the group and shoot from two bearings. Choose when we hold a track on one '
        + 'group still outside missile range, both of us have missiles, nothing has been fired yet and there '
        + 'is room to open out.',
    grinder: 'Trade shots: the one who did not shoot last shoots, the other presses on. Choose once missiles '
        + 'have been fired at the group, or when it is already too close to split, and both of us still have missiles.',
};

type JevChoiceAnswer = {
    type: 'choice';
    choice: string;
    probabilities: Record<string, number>;
    confidence: number;
};
type JevQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> };
export type JevResponse = { answers?: { next_state?: JevChoiceAnswer; next_tactic?: JevChoiceAnswer } };
// One request, up to two questions: next_state when the controller has a real
// choice of states, next_tactic when a flight lead has a real choice of tactics.
export type JevRequest = {
    state: TacticalPicture;
    questions: { next_state?: JevQuestion; next_tactic?: JevQuestion };
};

// How an ask reaches Jev. The default goes through the dev server's proxy; the
// tests hand in a canned one so the gating can be checked without a network.
export type JevTransport = (request: JevRequest, signal: AbortSignal) => Promise<JevResponse>;

const viaDevProxy: JevTransport = async (request, signal) => {
    const res = await fetch(JEV_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<JevResponse>;
};

// An answer about the picture as it stood in `askedIn` (the controller's state,
// or the flight's tactic, when the picture was taken).
type Answer<T extends string> = {
    choice: T;
    confidence: number;
    askedIn: T;
    askedAt: number;
};

export class JevTactician implements Tactician {
    private answer: Answer<TacticalStateName> | null = null;
    private tacticAnswer: Answer<FlightTactic> | null = null;
    private inFlight: AbortController | null = null;
    private nextAskAt = 0;
    private backoffMs = BACKOFF_START_MS;
    private latencyMs: number | null = null;
    // The answers applied on the last advise() — kept apart from the stored
    // ones, which a response landing between frames can replace before the
    // label is drawn.
    private applied: Answer<TacticalStateName> | null = null;
    private appliedTactic: Answer<FlightTactic> | null = null;
    private destroyed = false;
    // No fight on the last advise(): Jev was not consulted.
    private idle = false;

    constructor(private readonly transport: JevTransport = viaDevProxy) {}

    // Called every frame. Kicks off a new ask when due, and returns Jev's state
    // for this picture — or null when there is no usable answer, in which case
    // the controller's scripted doctrine decides. Timing is wall-clock, not game
    // time: the wait is a network round trip, whatever the sim clock is doing.
    //
    // A flight lead also passes the tactics that are legal for its flight. One
    // request carries every question that has a real choice behind it - the
    // state, the tactic, or both - so the flight costs no extra calls; the
    // tactic's answer is read back by adviseFlightTactic.
    advise(
        picture: TacticalPicture, legal: TacticalStateName[], legalTactics: FlightTactic[] = [],
    ): TacticalStateName | null {
        const now = performance.now();
        // One legal option is no decision, and outside a fight the doctrine's
        // answer is the obvious one: leave both to the script, and save the call.
        this.idle = !JevTactician.isFight(picture);
        const askState = legal.length >= 2;
        const askTactic = legalTactics.length >= 2;
        if (this.idle || (!askState && !askTactic)) {
            this.applied = null;
            this.appliedTactic = null;
            return null;
        }
        if (!this.inFlight && now >= this.nextAskAt) {
            this.ask(picture, askState ? legal : [], askTactic ? legalTactics : [], now);
        }

        this.applied = askState && this.isUsable(this.answer, picture.currentState, legal, now) ? this.answer : null;
        return this.applied?.choice ?? null;
    }

    // Jev's flight tactic for this picture, under the same gate as its state:
    // fresh, confident, still legal, and about the plan that is still in force.
    // Null hands the plan back to the flight's scripted doctrine.
    adviseFlightTactic(picture: TacticalPicture, legalTactics: FlightTactic[]): FlightTactic | null {
        this.appliedTactic = legalTactics.length >= 2
            && picture.flightTactic !== 'no flight'
            && this.isUsable(this.tacticAnswer, picture.flightTactic, legalTactics, performance.now())
            ? this.tacticAnswer : null;
        return this.appliedTactic?.choice ?? null;
    }

    // Jev is asked only where judgement changes the outcome: from the moment
    // our radar holds something, a shot is in the air, we are running from one,
    // or an enemy has locked us. Patrolling, and hunting down a bearing the RWR
    // heard, are routine the doctrine flies as well as Jev would — and they
    // are most of a sortie, so most of the calls this saves.
    static isFight(picture: TacticalPicture): boolean {
        return picture.contact !== 'none'
            || picture.ourMissileInFlight
            || picture.skate !== 'not skating'
            || picture.rwr === 'locked by enemy fire-control radar'
            || picture.missileInbound
            || picture.currentState === 'EVADE';
    }

    private isUsable<T extends string>(
        answer: Answer<T> | null,
        current: T,
        legal: T[],
        now: number,
    ): boolean {
        if (!answer || now - answer.askedAt > ANSWER_STALE_MS) return false;
        if (answer.confidence < MIN_CONFIDENCE || !legal.includes(answer.choice)) return false;
        // The answer is about the picture as it stood in `askedIn`. If the
        // controller has since moved on by itself — a shot puts it straight into
        // CRANK, a flight's dwell settles on another plan — the answer is about
        // a situation that no longer exists.
        return current === answer.askedIn || current === answer.choice;
    }

    private ask(
        picture: TacticalPicture,
        legal: TacticalStateName[],
        legalTactics: FlightTactic[],
        now: number,
    ): void {
        const controller = new AbortController();
        this.inFlight = controller;
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const request: JevRequest = { state: picture, questions: {} };
        if (legal.length) {
            request.questions.next_state = { type: 'choice', instructions: QUESTION, criteria: this.criteriaFor(legal, STATE_CRITERIA) };
        }
        if (legalTactics.length) {
            request.questions.next_tactic = {
                type: 'choice', instructions: FLIGHT_QUESTION, criteria: this.criteriaFor(legalTactics, TACTIC_CRITERIA),
            };
        }
        this.transport(request, controller.signal)
            .then(body => {
                const state = JevTactician.pick(legal, body.answers?.next_state, picture.currentState, now);
                const tactic = picture.flightTactic !== 'no flight'
                    ? JevTactician.pick(legalTactics, body.answers?.next_tactic, picture.flightTactic, now) : null;
                // An ask is a failure only if every question in it went unanswered.
                if (!state && !tactic) throw new Error('no usable answer');
                if (state) this.answer = state;
                if (tactic) this.tacticAnswer = tactic;
                this.latencyMs = performance.now() - now;
                this.backoffMs = BACKOFF_START_MS;
                this.nextAskAt = now + DECISION_INTERVAL_MS;
            })
            .catch((err: unknown) => {
                if (this.destroyed) return;
                console.warn(`[jev] ask failed, scripted doctrine flies for ${this.backoffMs} ms:`, err);
                this.nextAskAt = performance.now() + this.backoffMs;
                this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
            })
            .finally(() => {
                clearTimeout(timeout);
                if (this.inFlight === controller) this.inFlight = null;
            });
    }

    // One question's answer, if it named an option that was on offer.
    private static pick<T extends string>(
        legal: T[], answer: JevChoiceAnswer | undefined, askedIn: T, now: number,
    ): Answer<T> | null {
        const choice = legal.find(option => option === answer?.choice);
        return answer && choice ? { choice, confidence: answer.confidence, askedIn, askedAt: now } : null;
    }

    // Jev leans toward the first option it is shown, so the legal options are
    // shuffled per ask rather than always listing the same one first.
    private criteriaFor<T extends string>(legal: T[], table: Record<T, string>): Record<string, string> {
        const criteria: Record<string, string> = {};
        for (const option of Phaser.Utils.Array.Shuffle([...legal])) {
            criteria[option] = table[option];
        }
        return criteria;
    }

    // DEV label: whether Jev is flying this frame, how sure it was, how long it took.
    getDebugLabel(): string {
        if (!this.applied && !this.appliedTactic && !this.inFlight && this.idle) return 'JEV idle (no fight)';
        const shown = this.applied ?? this.answer;
        const plan = this.appliedTactic ? ` | plan ${this.appliedTactic.choice} ${Math.round(this.appliedTactic.confidence * 100)}%` : '';
        if (!shown) return `JEV --${plan}`;
        const pct = Math.round(shown.confidence * 100);
        const ms = this.latencyMs !== null ? ` ${Math.round(this.latencyMs)}ms` : '';
        return `JEV ${this.applied ? 'ON' : 'off'} ${shown.choice} ${pct}%${ms}${plan}`;
    }

    destroy(): void {
        this.destroyed = true;
        this.inFlight?.abort();
        this.inFlight = null;
    }
}
