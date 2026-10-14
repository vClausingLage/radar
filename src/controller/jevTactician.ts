import Phaser from 'phaser';
import type { TacticalPicture, TacticalStateName, Tactician } from './aiUnitController';

// Jev — TypeSafe's "System One" decision model, reached through OpenRouter —
// as the tactical judgement of an AI fighter. It does not fly the ship: the
// AiUnitController still steers, locks, shoots and drops chaff. Jev answers the
// question a pilot answers between those actions — *what am I doing now?* — by
// picking one of the controller's states from the picture its own sensors hold.
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
    + 'The engagement cycle is INVESTIGATE, ENGAGE, CRANK, then SKATE; EVADE interrupts it only when '
    + 'we are locked or a missile is inbound. An aggressive pilot presses the attack, a defensive one '
    + 'takes fewer risks. Given what its own radar and radar warning receiver report, which tactical '
    + 'state should it be in now?';

// The doctrine in decision_tree.md, one line per option. These descriptions are
// all Jev knows about a state — tuning them tunes the opponent. Each says what
// the state does and, above all, *when to choose it*: descriptions of what a
// state does alone left Jev agreeing with doctrine on a third of the recorded
// pictures and dropping chaff against radars that were only searching.
const STATE_CRITERIA: Record<TacticalStateName, string> = {
    PATROL: 'Fly the search pattern with the radar in wide search. Choose when we hold no radar contact and no enemy '
        + 'radar has locked us. Being merely searched is no reason to leave patrol: patrol already turns a defensive '
        + 'pilot away from a searching radar and an aggressive one toward it.',
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

type JevChoiceAnswer = {
    type: 'choice';
    choice: string;
    probabilities: Record<string, number>;
    confidence: number;
};
export type JevResponse = { answers?: { next_state?: JevChoiceAnswer } };
export type JevRequest = {
    state: TacticalPicture;
    questions: { next_state: { type: 'choice'; instructions: string; criteria: Record<string, string> } };
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

type Answer = {
    state: TacticalStateName;
    confidence: number;
    askedInState: TacticalStateName; // the controller's state when the picture was taken
    askedAt: number;
};

export class JevTactician implements Tactician {
    private answer: Answer | null = null;
    private inFlight: AbortController | null = null;
    private nextAskAt = 0;
    private backoffMs = BACKOFF_START_MS;
    private latencyMs: number | null = null;
    // The answer applied on the last advise() — kept apart from `answer`, which
    // a response landing between frames can replace before the label is drawn.
    private applied: Answer | null = null;
    private destroyed = false;

    constructor(private readonly transport: JevTransport = viaDevProxy) {}

    // Called every frame. Kicks off a new ask when due, and returns Jev's state
    // for this picture — or null when there is no usable answer, in which case
    // the controller's scripted doctrine decides. Timing is wall-clock, not game
    // time: the wait is a network round trip, whatever the sim clock is doing.
    advise(picture: TacticalPicture, legal: TacticalStateName[]): TacticalStateName | null {
        const now = performance.now();
        // One legal option is no decision: leave it to the script, and save the call.
        if (legal.length < 2) {
            this.applied = null;
            return null;
        }
        if (!this.inFlight && now >= this.nextAskAt) this.ask(picture, legal, now);

        this.applied = this.isUsable(this.answer, picture, legal, now) ? this.answer : null;
        return this.applied?.state ?? null;
    }

    private isUsable(
        answer: Answer | null,
        picture: TacticalPicture,
        legal: TacticalStateName[],
        now: number,
    ): boolean {
        if (!answer || now - answer.askedAt > ANSWER_STALE_MS) return false;
        if (answer.confidence < MIN_CONFIDENCE || !legal.includes(answer.state)) return false;
        // The answer is about the picture as it stood in `askedInState`. If the
        // controller has since moved on by itself — a shot puts it straight into
        // CRANK — the answer is about a situation that no longer exists.
        return picture.currentState === answer.askedInState || picture.currentState === answer.state;
    }

    private ask(picture: TacticalPicture, legal: TacticalStateName[], now: number): void {
        const controller = new AbortController();
        this.inFlight = controller;
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const request: JevRequest = {
            state: picture,
            questions: {
                next_state: { type: 'choice', instructions: QUESTION, criteria: this.criteriaFor(legal) },
            },
        };
        this.transport(request, controller.signal)
            .then(body => {
                const next = body.answers?.next_state;
                const choice = legal.find(s => s === next?.choice);
                if (!next || !choice) throw new Error('no usable next_state answer');
                this.answer = {
                    state: choice,
                    confidence: next.confidence,
                    askedInState: picture.currentState,
                    askedAt: now,
                };
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

    // Jev leans toward the first option it is shown, so the legal options are
    // shuffled per ask rather than always listing PATROL first.
    private criteriaFor(legal: TacticalStateName[]): Record<string, string> {
        const criteria: Record<string, string> = {};
        for (const state of Phaser.Utils.Array.Shuffle([...legal])) {
            criteria[state] = STATE_CRITERIA[state];
        }
        return criteria;
    }

    // DEV label: whether Jev is flying this frame, how sure it was, how long it took.
    getDebugLabel(): string {
        const shown = this.applied ?? this.answer;
        if (!shown) return 'JEV --';
        const pct = Math.round(shown.confidence * 100);
        const ms = this.latencyMs !== null ? ` ${Math.round(this.latencyMs)}ms` : '';
        return `JEV ${this.applied ? 'ON' : 'off'} ${shown.state} ${pct}%${ms}`;
    }

    destroy(): void {
        this.destroyed = true;
        this.inFlight?.abort();
        this.inFlight = null;
    }
}
