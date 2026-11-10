import Phaser from 'phaser';
import { Radar } from '../radar/systems/radar';
import { RWR_SEEKER_KEY_PREFIX } from '../radar/systems/modules/rwr';
import { Target } from '../entities/ship';
import { Track, iffStateOf } from '../radar/data/track';
import { world } from '../settings';
import { rwrHorizonPx } from '../radar/data/signalPath';
import { ANTENNA_AZIMUTH_DEG_BY_MODE, RADAR_DEFAULT_RANGE_PX } from '../radar/data/radarGameSettings';
import type { WorldSize } from '../types';
import { Flight, FlightBriefing, FlightRole, FlightTactic, Orders } from './flight';

// Behaviour states. The engagement flow is a cycle rather than a single state:
//   (HUNT →) INVESTIGATE → ENGAGE (shoot) → CRANK (support + open range) → SKATE (bug out)
// EVADE pre-empts everything the moment an enemy fire-control lock is detected.
// A wingman has one more: FORMATION, flying on its lead instead of any of the
// above (see decision_tree.md, "Flights").
enum AIState {
    PATROL,      // No contacts — flying a search ladder
    INVESTIGATE, // Radar contact, closing to lock
    ENGAGE,      // STT lock held — shooting
    CRANK,       // Just fired: turn target to the cone edge to open range (F-pole)
    SKATE,       // Missile away/spent: break lock and run
    EVADE,       // Being locked by an enemy — defend the shot
    HUNT,        // No contact, but an enemy radar was heard — fly down its bearing
    FORMATION,   // Wingman: hold station on the flight lead
    REACQUIRE,   // Flight member lost its own contact mid-attack — turn back to where it was
}

// What a tactician may choose between. FORMATION is the wingman's standing
// order, not a judgement call: only the lead is ever asked.
export type TacticalStateName = Exclude<keyof typeof AIState, 'FORMATION'>;

type Personality = 'aggressive' | 'defensive';

// Whether the unit is under way. An 'inactive' unit is a stationary emplacement:
// it holds position and heading, but its radar, jammer and weapons work normally.
export type UnitActivity = 'active' | 'inactive';

// The tactical judgement a controller can defer to in place of its scripted
// state rules: JevTactician, or a stub in the tests. Asked every frame; null
// means "no opinion this frame", and the scripted doctrine decides.
//
// The lead of a flight is also offered the flight's plan: `legalTactics` are the
// tactics that are possible now, and the answer comes back through
// adviseFlightTactic - one request can carry both questions. Only a lead is ever
// asked (see consulted()).
export interface Tactician {
    advise(
        picture: TacticalPicture, legal: TacticalStateName[], legalTactics?: FlightTactic[],
    ): TacticalStateName | null;
    adviseFlightTactic?(picture: TacticalPicture, legalTactics: FlightTactic[]): FlightTactic | null;
    getDebugLabel(): string;
    destroy(): void;
}

// What the unit knows, in words, for a JevTactician to judge. Ranges and angles
// are banded here because Jev reasons over categories, not coordinates. Built
// only from our own radar, RWR and stores — never from the entity list — so a
// Jev-flown ship is exactly as blind as a scripted one.
export type TacticalPicture = {
    currentState: TacticalStateName;
    personality: Personality;
    radarMode: string;
    contact: 'none' | 'new track' | 'mature track';
    contactRange: 'no contact' | 'inside missile range' | 'outside missile range';
    contactBearing: 'no contact' | 'on the nose' | 'off the nose' | 'behind us';
    // What IFF has said about the contact. 'no IFF reply' is unknown, not a
    // declaration of hostility: nothing answered the question. A friendly
    // reply keeps a track out of the AI's contact list altogether, so that
    // word is for completeness - a doctrine never has to be told not to
    // shoot a friend.
    contactIff: 'no contact' | 'not interrogated' | 'no IFF reply' | 'friendly IFF reply';
    firingSolution: boolean;
    selectedWeapon: 'VIM-220 fire-and-forget' | 'VIM-177 semi-active, needs our lock held' | 'none left';
    missilesLeft: number;
    ourMissileInFlight: boolean;
    skate: 'not skating' | 'still opening range' | 'range opened';
    rwr: 'silent' | 'searched by enemy radar' | 'locked by enemy fire-control radar';
    // The bearing an enemy radar was last heard on, kept after the RWR
    // contact itself has aged out — what HUNT flies down.
    emitterHeard: 'never' | 'heard just now' | 'heard a while ago';
    missileInbound: boolean;
    chaffLeft: number;
    jammerReady: boolean;
    nearWorldEdge: boolean;
    // The flight, for a lead: what its wingman reports on the link, the plan in
    // force and how many groups the link shows. 'no wingman' / 'no flight' for a
    // ship that flies alone. Words, as everything here: the wingman's position
    // never reaches the tactician.
    wingman: FlightBriefing['wingman'] | 'no wingman';
    wingmanMissiles: number;
    flightTactic: FlightTactic | 'no flight';
    groupsOnLink: FlightBriefing['groupsOnLink'];
};

// ── Tunables ───────────────────────────────────────────────────────────────
const FIRE_COOLDOWN_MS = 2500;
const STT_LOCK_DELAY_MS = 2500;       // lock must be held this long before firing
// A shot is only worth taking inside the weapon's reach. The scope's ring (700)
// is further out than a missile flies (nominally 450 for a VIM-220, 504 for a
// VIM-177), so a pilot that fired the moment a track reached the ring spent
// rounds that burned out short of the target, and could only hit a target
// closing head-on. It shoots inside the nominal reach instead (a flight that
// meets a target at the edge of it, as the sort test sets up, closes the last
// few px first). Launch on remote is not held to this: it rides the ring.
const FIRE_RANGE_FRACTION = 1.0;
const INVESTIGATE_STT_MIN_AGE = 2;    // wait ~2 scans of a track before locking it
const CRANK_DURATION_MS = 6000;       // how long to support/crank after a shot
// Whenever a pilot turns its nose off a contact it holds on its own radar - a
// crank, a bracket's split - it keeps the contact this far (deg) inside the
// edge of the cone the radar can hold it in (Radar.holdingHalfAzimuthDeg): 30°
// in RWS and STT, 22.5° in TWS. Not right on the edge, because the bearing it
// steers by is the track's, a scan old, and a crossing target walks on while
// the ship's own turn rate lags behind the command. Past the edge the beam
// never visits the contact again, the track ages out and the attack stops.
const SCOPE_EDGE_MARGIN_DEG = 6;
// A flight member that loses its own contact anyway (it out-turned the cone,
// chaff, a rock) remembers where it last saw it and turns back in towards
// that point for this long, radar in wide search, rather than giving up the
// attack: the contact was there a moment ago and has not gone far.
const REACQUIRE_MEMORY_MS = 10000;
// ... and stops looking once it has flown this close to the remembered point:
// whatever was there has moved on and the search found nothing.
const REACQUIRE_ARRIVAL_PX = 150;
const SKATE_MS_AGGRESSIVE = 3000;
const SKATE_MS_DEFENSIVE = 6000;
const DECOY_COOLDOWN_MS = 1200;       // min gap between chaff drops
const PATROL_LEG_PX = 500;            // straight leg of the search ladder
const PATROL_STEP_PX = 150;           // sideways step between legs
const PATROL_MARGIN_PX = 300;         // keep the ladder this far off the world edge
const ROUTE_ARRIVAL_PX = 60;          // a fixed route's destination counts as reached this close
// An RWR gives a bearing, never a range, and hears an enemy radar far beyond
// the range our own radar can paint it at (emission falls with range², the
// echo with range⁴ — data/signalPath.ts). But it could not have heard it from
// beyond the one-way horizon either, so a heard emitter is remembered as a
// line segment: from where we stood when we heard it, down the bearing, as far
// as that horizon (or the world edge, if nearer). The hunt flies the segment
// until the radar makes a real track or the whole segment has been searched —
// not on a clock: at cruise speed a timer short of the horizon turns back
// before the emitter could even be reached.
const HUNT_LOOKAHEAD_PX = 200;        // steer for a point this far down the line, to fly onto it
const HUNT_RECENT_MS = 4000;          // heard within this = "heard just now" in the picture
// A defensive hunter approaches with its transmitter off — listening is
// silent, radiating would give it away — and only turns its radar on this
// long into the hunt, hopefully close enough to paint what it heard.
const HUNT_PASSIVE_MS = 8000;

export class AiUnitController {
    private state: AIState = AIState.PATROL;
    private readonly personality: Personality;

    private readonly scene: Phaser.Scene;
    private readonly ship: Target;
    private turnRate: number;
    private readonly radar: Radar | null;
    private readonly activity: UnitActivity;
    private readonly tactician: Tactician | null;

    private debugText?: Phaser.GameObjects.Text;

    // Engagement timing.
    private nextShotAt = 0;
    private sttLockAcquiredAt: number | null = null;
    private currentSttTargetId: number | null = null;
    private crankUntil = 0;
    private crankSide = 1;             // +1/−1: which way to crank the nose
    private skateUntil = 0;
    private evadeSide = 1;
    // Are we being locked by an enemy fire-control radar? Refreshed from our
    // own RWR every frame before the state rules read it.
    private sttTracked = false;

    // The flight this ship belongs to, and which half of it. A wingman flies
    // FORMATION on its lead for as long as the lead lives; if it dies the wing
    // drops back to the ordinary doctrine as a single ship.
    private flight: Flight | null = null;
    private flightRole: FlightRole = 'lead';
    private wasInFormation = false;
    // Fraction of cruise speed the throttle is set to this frame (a wingman
    // regaining or giving up station); 1 for everyone else.
    private speedFactor = 1;
    // This frame's chosen contact is the lead's datalinked track, not one of
    // our own: we are cued onto it but hold nothing ourselves (a silent wing).
    private contactViaLink = false;
    // ... and this frame's contact is the one the flight's sort gave us, so
    // our shots are confined to it: the other member's target is not ours to
    // spend a round on, however near it sits.
    private contactSorted = false;
    // ... or the contact is the wing's track and only a cue: the lead is
    // pointed at it to go and look, but holds no track of its own to shoot on.
    private contactCueOnly = false;
    // What the flight's tactic lets this ship do this frame (decision_tree.md,
    // "Flights"). Outside a flight: no limits.
    private orders: Orders = { tactic: 'formation', mayShoot: true, silent: false };
    // The picture last handed to the tactician: the flight's plan is asked of it
    // later in the frame (Flight.review), about the same moment.
    private lastPicture: TacticalPicture | null = null;

    // Last known contact position, so SKATE/EVADE can flee a direction even after
    // the lock (and thus the live track) is gone.
    private lastTargetPos: { x: number; y: number } | null = null;
    // Where our own radar last held a matured contact, and when: what REACQUIRE
    // turns back to. Only our own track counts - a link cue was never ours to
    // lose - and it is forgotten on purpose when we turn away (SKATE, EVADE).
    private lastOwnContact: { pos: { x: number; y: number }; seenAt: number } | null = null;
    private nextDecoyAt = 0;

    // Last enemy platform radar the RWR heard: the bearing, when, and the line
    // segment it must lie on (from where we heard it, `lengthPx` down the
    // bearing — see HUNT_LOOKAHEAD_PX above).
    private heardEmitter: {
        bearingDeg: number;
        heardAt: number;
        from: { x: number; y: number };
        lengthPx: number;
    } | null = null;
    private huntStartedAt = 0;

    // Patrol search ladder.
    private patrolRoute: { x: number; y: number }[] = [];
    private patrolIndex = 0;
    private cargoWaypoints: { x: number; y: number }[] = [];
    private cargoWaypointIndex = 0;
    // A generated cargo route is a loop; a route handed in via setRoute() is a
    // flight with a destination, after which the ship holds where it stopped.
    private routeLoops = true;
    private arrived = false;

    constructor(params: {
        scene: Phaser.Scene;
        ship: Target;
        turnRate?: number;
        radar?: Radar | null;
        activity?: UnitActivity;
        // Optional tactical judgement in place of the scripted state rules.
        // Without one (haulers, production builds) the doctrine below decides.
        tactician?: Tactician | null;
    }) {
        this.scene = params.scene;
        this.ship = params.ship;
        this.turnRate = params.turnRate ?? 0;
        this.radar = params.radar ?? null;
        this.activity = params.activity ?? 'active';
        this.tactician = params.tactician ?? null;
        // Cargo is always defensive; cruisers get a coin-flip personality so both
        // aggressive and defensive behaviours show up in a scene.
        this.personality = this.ship.shipType === 'cargo'
            ? 'defensive'
            : (Phaser.Math.Between(0, 1) === 0 ? 'aggressive' : 'defensive');

        this.createDebugText();
        // A stationary unit has no route to fly.
        if (this.activity === 'active') {
            if (this.ship.shipType === 'cargo') {
                this.cargoWaypoints = this.generateCargoRoute();
            } else {
                this.patrolRoute = this.generatePatrolRoute();
            }
        }
    }

    // Release what the controller owns in the scene (the DEV state label). The
    // ship itself belongs to the scene, so it is left alone — this only detaches
    // the brain, e.g. when a scenario wants an inert prop instead of an opponent.
    destroy(): void {
        this.debugText?.destroy();
        this.debugText = undefined;
        this.tactician?.destroy();
        // A lead's advisor closure points back at this controller — unhook it,
        // so a flight that outlives the brain never consults one that is gone.
        if (this.flightRole === 'lead') this.flight?.setTacticAdvisor(null);
    }

    // Fly as one half of a flight. Radar wiring (the datalink) is the
    // factory's job; this only gives the controller its role.
    public joinFlight(flight: Flight, role: FlightRole): void {
        this.flight = flight;
        this.flightRole = role;
        // The lead's tactician can name the flight's plan; the wing has none.
        if (role !== 'lead') return;
        const tactician = this.consulted();
        flight.setTacticAdvisor(tactician?.adviseFlightTactic
            ? legal => this.lastPicture ? tactician.adviseFlightTactic?.(this.lastPicture, legal) ?? null : null
            : null);
    }

    // The tactician this ship defers to: none for a wingman. A wing flies the
    // lead's plan and the scripted doctrine; only the lead is ever asked.
    private consulted(): Tactician | null {
        return this.flight !== null && this.flightRole === 'wing' ? null : this.tactician;
    }

    // The state the controller is in, by name (tests and the DEV label).
    public getStateName(): keyof typeof AIState {
        return AIState[this.state] as keyof typeof AIState;
    }

    // A wingman with a living lead. Everything else - the lead, a lone ship,
    // a wing whose lead has been shot down - flies the ordinary doctrine.
    private inFormation(): boolean {
        return this.flight !== null && this.flightRole === 'wing' && this.flight.leadAlive();
    }

    // Replace the generated loop with a fixed itinerary whose last point is the
    // destination (a landing pad, a station). Cargo flies it as a delivery; a
    // cruiser flies it as an ingress route — a raid — leaving it to engage
    // whatever it finds and rejoining it afterwards (see executePatrol).
    public setRoute(waypoints: { x: number; y: number }[]): void {
        this.cargoWaypoints = waypoints.map(p => ({ x: p.x, y: p.y }));
        this.cargoWaypointIndex = 0;
        this.routeLoops = false;
        this.arrived = false;
    }

    // True once a routed ship has reached its destination and stopped.
    public hasArrived(): boolean {
        return this.arrived;
    }

    private createDebugText(): void {
        if (!import.meta.env.DEV) return;
        this.debugText = this.scene.add.text(this.ship.x, this.ship.y - 24, '', {
            fontSize: '11px',
            color: '#00ff88',
            backgroundColor: '#001a11',
        }).setOrigin(0.5, 1);
    }

    private updateDebugText(): void {
        if (!this.debugText) return;
        const stateNames = ['PATROL', 'INVESTIGATE', 'ENGAGE', 'CRANK', 'SKATE', 'EVADE', 'HUNT', 'FORMATION', 'REACQ'];
        const lock = this.sttLockAcquiredAt !== null
            ? `L:${Math.floor((this.scene.time.now - this.sttLockAcquiredAt) / 1000)}s`
            : 'L:--';
        const w220 = this.radar?.getWeaponLoad('VIM-220') ?? 0;
        const w177 = this.radar?.getWeaponLoad('VIM-177') ?? 0;
        const activity = this.activity === 'inactive' ? ' STATIC' : '';
        const jev = this.tactician ? `\n${this.tactician.getDebugLabel()}` : '';
        this.debugText.setText(
            `AI ${this.ship.id} ${this.personality[0].toUpperCase()}${activity} [${stateNames[this.state]}] ${lock} D:${this.ship.getRemainingDecoys()} M:${w220}/${w177}${jev}`,
        );
        this.debugText.setPosition(this.ship.x, this.ship.y - 24);
    }

    // Called every frame.
    updateContinuous(): void {
        if (!this.ship.active || !this.ship.body) {
            this.destroy();
            return;
        }

        const radar = this.radar;
        this.speedFactor = 1;
        // Losing the lead puts the wing back on its own: its old patrol ladder
        // was laid out around the spawn point, so lay a fresh one from here.
        const inFormation = this.inFormation();
        if (this.wasInFormation && !inFormation) this.patrolRoute = [];
        this.wasInFormation = inFormation;

        const now = this.scene.time.now;
        if (this.flight?.leadAlive()) this.orders = this.flight.ordersFor(this.ship, now);
        else this.orders = { tactic: 'formation', mayShoot: true, silent: false };

        const preferredTrack = this.selectContact(radar?.getHostileTracks() ?? []);
        const sttTrack = radar?.getSttTrack() ?? null;
        this.rememberOwnContact(preferredTrack, now);

        // Weapon doctrine: spend the fire-and-forget VIM-220s first (TWS shots,
        // no lock needed), then fall back to the SARH VIM-177 (needs STT).
        const weapon = this.engagementWeapon();
        // The track the current weapon engages with: the STT lock for the 177,
        // any maintained TWS track for the 220.
        const engagementTrack = weapon === 'VIM-220' ? (preferredTrack ?? null) : sttTrack;

        // Are we being locked by an enemy fire-control radar? (from our RWR)
        this.sttTracked = radar?.rwrReceiver.getPrimaryRwrContact()?.isLocked ?? false;
        const platform = radar?.rwrReceiver.getPlatformContact();
        if (platform) this.hearEmitter(platform.bearingDeg);

        this.updateSttLockTracking(sttTrack?.id ?? null);
        this.updateState(preferredTrack, weapon, engagementTrack);

        switch (this.state) {
            case AIState.EVADE: this.executeEvade(); break;
            case AIState.SKATE: this.executeSkate(); break;
            case AIState.CRANK: this.executeCrank(weapon, engagementTrack); break;
            case AIState.ENGAGE: this.executeEngage(weapon, engagementTrack); break;
            case AIState.INVESTIGATE: this.executeInvestigate(preferredTrack, weapon); break;
            case AIState.HUNT: this.executeHunt(); break;
            case AIState.PATROL: this.executePatrol(); break;
            case AIState.FORMATION: this.executeFormation(); break;
            case AIState.REACQUIRE: this.executeReacquire(); break;
        }
        // Whatever the state, a wingman too close to its lead breaks away from
        // it (Flight.guidance): EVADE or the border turn must not fly it into
        // the lead either.
        this.guardSeparation();
        this.publishStatus();

        // Border avoidance overrides state steering at the world edge. A
        // stationary unit can never reach an edge, so it skips both — and so
        // does a ship that has reached its destination and is holding there.
        if (this.activity === 'active' && !this.arrived) {
            this.avoidBorder();
            this.applyMovement();
        } else {
            this.ship.setVelocity(0, 0);
        }
        this.updateDebugText();
    }

    // The contact this pilot works. A wingman's own track (tagged by the flight
    // datalink) is never one: it is left out of what is investigated or engaged.
    //
    // Alone, tracks are geometry-only (no entity id): take the highest-confidence
    // one. In a flight the shared picture is sorted (Flight.assignmentFor) and
    // each member works its own group: the lead the left-most, the wing the
    // right-most. The lead falls back to its best track if its group is not one
    // it holds; the wing has no business beyond its group, so with none it
    // stays on the lead. A wing with no track of its own on its group but the
    // lead's report of it is cued onto that (contactViaLink), and holds EMCON
    // while it closes.
    private selectContact(tracks: Track[]): Track | undefined {
        this.contactViaLink = false;
        this.contactSorted = false;
        this.contactCueOnly = false;
        const best = tracks.reduce<Track | undefined>(
            (top, t) => (!top || t.confidence > top.confidence ? t : top),
            undefined,
        );
        if (!this.flight || !this.flight.leadAlive()) return best;

        const assignment = this.flight.assignmentFor(this.ship, this.scene.time.now);
        // A wing ordered silent works from the link alone; whatever it still
        // holds of its own is a leftover of the last time it radiated.
        const own = assignment && !(this.flightRole === 'wing' && this.orders.silent)
            ? this.flight.ownTrackOn(assignment, tracks)
            : undefined;
        this.contactSorted = own !== undefined;
        if (this.flightRole === 'lead') {
            // Its own group is not on its radar (a dropout, a sweep not yet
            // round): any other contact will do, but not the one the sort gave
            // the wing - that would double up on one target and leave the
            // lead's own unengaged.
            const now = this.scene.time.now;
            const fallback = own ? undefined : tracks.reduce<Track | undefined>(
                (top, t) => this.flight!.onPartnersGroup(this.ship, t, now) ? top
                    : (!top || t.confidence > top.confidence ? t : top),
                undefined,
            );
            if (own ?? fallback) return own ?? fallback;
            // Nothing of its own: the wing's track on the group is a cue to
            // point the radar and go and look. It is never a firing solution -
            // only the wing has launch-on-remote.
            if (assignment?.remote) {
                this.contactCueOnly = true;
                return assignment.remote;
            }
            return undefined;
        }

        // A wing with empty rails has nothing to prosecute: it stays on the lead.
        if (this.missilesLeft() === 0) return undefined;
        if (own) return own;
        if (assignment?.remote) {
            this.contactViaLink = true;
            return assignment.remote;
        }
        return undefined;
    }

    // ── State machine ──────────────────────────────────────────────────────

    // Which weapon the next engagement uses: fire-and-forget VIM-220s first,
    // then the SARH VIM-177s.
    private engagementWeapon(): 'VIM-220' | 'VIM-177' {
        return (this.radar?.getWeaponLoad('VIM-220') ?? 0) > 0 ? 'VIM-220' : 'VIM-177';
    }

    // Pick the next state. With a tactician attached, its answer wins whenever
    // it has a usable one; the scripted doctrine covers every other frame.
    private updateState(
        track: Track | undefined,
        weapon: 'VIM-220' | 'VIM-177',
        engagementTrack: Track | null,
    ): void {
        const readyToEngage = this.isReadyToEngage(weapon, engagementTrack);
        const legal = this.legalStates(track, readyToEngage, engagementTrack);
        const tactician = this.consulted();
        const picture = tactician ? this.buildPicture(track, weapon, readyToEngage) : null;
        this.lastPicture = picture;
        const legalTactics = this.flightRole === 'lead' && this.flight?.leadAlive()
            ? this.flight.legalTactics(this.scene.time.now) : [];
        const advice = picture ? tactician?.advise(picture, legal, legalTactics) ?? null : null;
        // Whatever the tactician says, it cannot talk the ship into a state the
        // situation does not allow — that check is the controller's, not its.
        const advised = advice !== null && legal.includes(advice) ? advice : null;

        const next = advised !== null
            ? AIState[advised]
            : this.scriptedState(track, readyToEngage, engagementTrack);
        if (next !== null) this.enter(next);
    }

    // Ready to shoot? The 177 needs its STT lock; the 220 just needs a matured
    // TWS track (radar mode is set up during INVESTIGATE).
    // A cued wing needs no TWS track: a 220 on the lead's link track just needs
    // that track fresh, inside our ring and a round on the rail. The 177 has no
    // such option - it rides our own illumination - so it never counts here.
    private isReadyToEngage(weapon: 'VIM-220' | 'VIM-177', engagementTrack: Track | null): boolean {
        // The tactic can hold fire (the cover, the bracket not yet formed, the
        // grinder's member without the shot token), and a cue is no solution.
        if (!this.orders.mayShoot || this.contactCueOnly) return false;
        // ... and so can a flight mate standing where the round would look.
        if (engagementTrack && !this.deconflicted(engagementTrack)) return false;
        if (this.contactViaLink) {
            return weapon === 'VIM-220' && engagementTrack !== null
                && engagementTrack.age >= INVESTIGATE_STT_MIN_AGE
                && Boolean(this.radar?.canShootOnRemote(engagementTrack));
        }
        if (engagementTrack !== null && !this.inReach(weapon, engagementTrack)) return false;
        return weapon === 'VIM-220'
            ? engagementTrack !== null
                && engagementTrack.age >= INVESTIGATE_STT_MIN_AGE
                && this.radar?.getMode() === 'tws'
            : engagementTrack !== null;
    }

    // Is the track inside the share of the weapon's reach worth firing at?
    private inReach(weapon: 'VIM-220' | 'VIM-177', track: Track): boolean {
        const reach = this.radar?.getMissileRange(weapon) ?? 0;
        return track.dist <= reach * FIRE_RANGE_FRACTION;
    }

    // A shot at `track` is clear of the flight mate (Flight.clearToFire). Outside
    // a flight there is no one to check.
    private deconflicted(track: Track): boolean {
        return !this.flight?.leadAlive() || this.flight.clearToFire(this.ship, track.pos, this.scene.time.now);
    }

    // The hand-written doctrine (decision_tree.md). Null means carry on: a
    // post-shot manoeuvre is still running.
    private scriptedState(
        track: Track | undefined,
        readyToEngage: boolean,
        engagementTrack: Track | null,
    ): AIState | null {
        const now = this.scene.time.now;

        // Highest priority: an enemy has a fire-control lock on us → defend.
        if (this.sttTracked) return AIState.EVADE;

        // A wingman with nothing sorted to it stays on its lead - unless it is
        // still working through a shot it took (crank, skate), which runs to
        // completion before it rejoins.
        if (this.inFormation() && !track && !this.finishingShot(now) && !this.canReacquire()) return AIState.FORMATION;

        // Cargo never prosecutes an attack; it just flies its route (evade above
        // still applies).
        if (this.ship.shipType === 'cargo') return AIState.PATROL;

        // Post-shot maneuvers run to completion before re-evaluating.
        if (this.state === AIState.SKATE && now < this.skateUntil) return null;
        if (this.state === AIState.CRANK) {
            // Keep cranking while the window is open and the engagement source
            // (STT lock / TWS track) survives. A flight member that lost it with
            // the window still open turns back in to find it - the shot needs
            // supporting and the partner is still pressing; otherwise bug out.
            if (now < this.crankUntil && engagementTrack) return null;
            if (now < this.crankUntil && !track && this.canReacquire()) return AIState.REACQUIRE;
            return AIState.SKATE;
        }

        if (readyToEngage) return AIState.ENGAGE;
        // A hunt is only broken off for a real track: one confirmed by a second
        // paint (age ≥ INVESTIGATE_STT_MIN_AGE). A single return may be a
        // thermal false alarm (RADAR_PFA) or a sidelobe flicker, and chasing it
        // throws away the one solid lead we have — the bearing. The beam keeps
        // sweeping down that bearing, so a real target ahead is painted again
        // within a scan or two and matures on its own.
        const confirmed = track !== undefined && track.age >= INVESTIGATE_STT_MIN_AGE;
        if (track && (confirmed || !this.canHunt())) return AIState.INVESTIGATE;
        // A contact of our own, lost a moment ago, is a better lead than a
        // heard bearing: it had a range.
        if (!track && this.canReacquire()) return AIState.REACQUIRE;
        if (this.canHunt()) return AIState.HUNT;
        return AIState.PATROL;
    }

    // Remember where our own radar holds the contact we work. A cue off the
    // link is not remembered (it was never ours to lose), nor a contact seen
    // while turning away from it on purpose.
    private rememberOwnContact(track: Track | undefined, now: number): void {
        if (!track || this.contactViaLink || this.contactCueOnly) return;
        if (track.age < INVESTIGATE_STT_MIN_AGE) return;
        if (this.state === AIState.SKATE || this.state === AIState.EVADE) return;
        this.lastOwnContact = { pos: { x: track.pos.x, y: track.pos.y }, seenAt: now };
    }

    // A contact we held and lost recently enough to be worth turning back for.
    // In a flight only: a lone ship's doctrine after losing the track is the
    // skate (decision_tree.md), while a pair that loses a contact mid-bracket
    // has a partner still pressing and a geometry worth keeping.
    private canReacquire(): boolean {
        return this.flight !== null && this.flight.leadAlive()
            && this.ship.shipType !== 'cargo'
            && this.activity === 'active'
            // A wing with empty rails has nothing to prosecute: it stays on
            // the lead (selectContact), and so does not go looking either.
            && !(this.flightRole === 'wing' && this.missilesLeft() === 0)
            && this.lastOwnContact !== null
            && this.scene.time.now - this.lastOwnContact.seenAt < REACQUIRE_MEMORY_MS;
    }

    private finishingShot(now: number): boolean {
        return this.state === AIState.CRANK || (this.state === AIState.SKATE && now < this.skateUntil);
    }

    // A remembered emitter bearing is worth flying down — by a warship, not
    // by cargo, and not by an emplacement that cannot move — until we have
    // flown past the far end of the segment it must lie on.
    private canHunt(): boolean {
        return this.ship.shipType !== 'cargo'
            && this.activity === 'active'
            && this.heardEmitter !== null
            && this.alongHeardLine() < this.heardEmitter.lengthPx;
    }

    // Record a bearing the RWR just heard as the segment the emitter lies on:
    // from here, down the bearing, out to the RWR horizon of a standard search
    // radar or the world edge, whichever is nearer — nothing beyond either
    // could have been heard. Every new hearing redraws it from where we are now,
    // so a moving emitter keeps pulling the line after it.
    private hearEmitter(bearingDeg: number): void {
        const from = { x: this.ship.x, y: this.ship.y };
        const rad = Phaser.Math.DegToRad(bearingDeg);
        const dx = Math.cos(rad);
        const dy = Math.sin(rad);
        const { width, height } = this.worldSize();
        // Distance along the bearing to the world edge (slab method, one exit).
        const toEdgeX = dx > 0 ? (width - from.x) / dx : dx < 0 ? -from.x / dx : Infinity;
        const toEdgeY = dy > 0 ? (height - from.y) / dy : dy < 0 ? -from.y / dy : Infinity;
        const lengthPx = Math.max(0, Math.min(rwrHorizonPx(RADAR_DEFAULT_RANGE_PX), toEdgeX, toEdgeY));
        this.heardEmitter = { bearingDeg, heardAt: this.scene.time.now, from, lengthPx };
    }

    // How far down the heard line we have come: our position projected onto it.
    private alongHeardLine(): number {
        if (!this.heardEmitter) return 0;
        const { from, bearingDeg } = this.heardEmitter;
        const rad = Phaser.Math.DegToRad(bearingDeg);
        return (this.ship.x - from.x) * Math.cos(rad) + (this.ship.y - from.y) * Math.sin(rad);
    }

    // ── Tactician interface ────────────────────────────────────────────────

    // The states that make physical sense right now — the only ones a
    // tactician is offered. Code rules on what is possible; the tactician
    // only judges what is wise among those.
    private legalStates(
        track: Track | undefined,
        readyToEngage: boolean,
        engagementTrack: Track | null,
    ): TacticalStateName[] {
        const rwr = this.radar?.rwrReceiver;
        const legal: TacticalStateName[] = ['PATROL'];
        if (track) legal.push('INVESTIGATE');
        if (this.canHunt()) legal.push('HUNT');
        if (!track && this.canReacquire()) legal.push('REACQUIRE');
        if (readyToEngage && this.missilesLeft() > 0) legal.push('ENGAGE');
        // Cranking supports a shot already in the air, so it needs one.
        if (engagementTrack && this.scene.time.now < this.crankUntil) legal.push('CRANK');
        if (this.lastTargetPos) legal.push('SKATE');
        if (rwr && rwr.getRwrSignals().length > 0) legal.push('EVADE');
        return legal;
    }

    private buildPicture(
        track: Track | undefined,
        weapon: 'VIM-220' | 'VIM-177',
        readyToEngage: boolean,
    ): TacticalPicture {
        const radar = this.radar;
        const rwr = radar?.rwrReceiver.getPrimaryRwrContact();
        const weaponRange = radar?.getMissileRange(weapon) ?? 0;
        const offNoseDeg = track
            ? Math.abs(Phaser.Math.Angle.WrapDegrees(this.bearingTo(track.pos) - this.ship.angle))
            : 0;
        const margin = world.BORDER_MARGIN;
        const { x, y } = this.ship;

        return {
            currentState: AIState[this.state] as TacticalStateName,
            personality: this.personality,
            radarMode: radar?.getMode() ?? 'none',
            contact: !track ? 'none' : track.age >= INVESTIGATE_STT_MIN_AGE ? 'mature track' : 'new track',
            contactRange: !track ? 'no contact'
                : track.dist <= weaponRange ? 'inside missile range' : 'outside missile range',
            contactBearing: !track ? 'no contact'
                : offNoseDeg <= 30 ? 'on the nose' : offNoseDeg <= 100 ? 'off the nose' : 'behind us',
            contactIff: !track ? 'no contact'
                : iffStateOf(track) === 'friendly' ? 'friendly IFF reply'
                : iffStateOf(track) === 'unknown' ? 'no IFF reply' : 'not interrogated',
            firingSolution: readyToEngage,
            selectedWeapon: this.missilesLeft() === 0 ? 'none left'
                : weapon === 'VIM-220' ? 'VIM-220 fire-and-forget' : 'VIM-177 semi-active, needs our lock held',
            missilesLeft: this.missilesLeft(),
            // The crank window opens on a shot; it is the AI's own estimate of
            // how long a missile it fired needs supporting.
            ourMissileInFlight: this.scene.time.now < this.crankUntil,
            // The skate runs on the personality's clock (skateDurationMs); Jev
            // is no clock, so it is told where in the run we are.
            skate: this.state !== AIState.SKATE ? 'not skating'
                : this.scene.time.now < this.skateUntil ? 'still opening range' : 'range opened',
            rwr: !rwr ? 'silent' : rwr.isLocked ? 'locked by enemy fire-control radar' : 'searched by enemy radar',
            emitterHeard: !this.heardEmitter ? 'never'
                : this.scene.time.now - this.heardEmitter.heardAt < HUNT_RECENT_MS ? 'heard just now' : 'heard a while ago',
            // A missile seeker reports on its own prefixed key: hearing one is
            // the RWR telling us a weapon has gone active against us.
            missileInbound: radar?.rwrReceiver.getRwrSources().some(k => k.startsWith(RWR_SEEKER_KEY_PREFIX)) ?? false,
            chaffLeft: this.ship.getRemainingDecoys(),
            jammerReady: radar?.isJammerReady() ?? false,
            nearWorldEdge: x < margin || y < margin || x > this.worldSize().width - margin || y > this.worldSize().height - margin,
            ...this.flightPicture(),
        };
    }

    // The flight part of the picture. Only a lead has one: its wingman's status
    // comes off the link, never from the wingman itself.
    private flightPicture(): Pick<TacticalPicture, 'wingman' | 'wingmanMissiles' | 'flightTactic' | 'groupsOnLink'> {
        if (!this.flight || this.flightRole !== 'lead') {
            return { wingman: 'no wingman', wingmanMissiles: 0, flightTactic: 'no flight', groupsOnLink: 'none' };
        }
        const briefing = this.flight.briefing(this.scene.time.now);
        return {
            wingman: briefing.wingman,
            wingmanMissiles: briefing.wingmanMissiles,
            flightTactic: briefing.flightTactic,
            groupsOnLink: briefing.groupsOnLink,
        };
    }

    // What this ship tells the flight about itself on the link, every frame: the
    // wingman's status page that the lead's picture is read from.
    private publishStatus(): void {
        if (!this.flight) return;
        const stance = this.state === AIState.EVADE ? 'defending'
            : this.state === AIState.FORMATION || this.state === AIState.PATROL ? 'in formation' : 'engaged';
        this.flight.datalink.publishStatus(this.ship.id, { stance, missiles: this.missilesLeft() }, this.scene.time.now);
    }

    private missilesLeft(): number {
        return (this.radar?.getWeaponLoad('VIM-220') ?? 0) + (this.radar?.getWeaponLoad('VIM-177') ?? 0);
    }

    // Transition with logging + entry side effects.
    private enter(state: AIState): void {
        if (this.state === state) return;
        // Turning away is a decision to let the contact go: nothing to come
        // back for afterwards.
        if (state === AIState.SKATE || state === AIState.EVADE) this.lastOwnContact = null;
        if (state === AIState.SKATE) {
            this.skateUntil = this.scene.time.now + this.skateDurationMs();
        }
        // Only a hunt begun from patrol opens silent. One resumed after losing
        // a contact keeps radiating: the enemy already knows we are there,
        // and going quiet would only throw away the picture.
        if (state === AIState.HUNT) {
            this.huntStartedAt = this.state === AIState.PATROL
                ? this.scene.time.now
                : this.scene.time.now - HUNT_PASSIVE_MS;
        }
        if (state === AIState.EVADE) {
            this.evadeSide = Phaser.Math.Between(0, 1) === 0 ? 1 : -1;
        }
        // The crank side turns the nose toward open space (world centre), off
        // the last target position — for a shot (executeEngage) that is the
        // track just fired on, for a tactician's choice its last contact.
        if (state === AIState.CRANK && this.lastTargetPos) {
            this.crankSide = this.crankSideFor(this.lastTargetPos);
        }
        this.state = state;
    }

    private skateDurationMs(): number {
        return this.personality === 'aggressive' ? SKATE_MS_AGGRESSIVE : SKATE_MS_DEFENSIVE;
    }

    private updateSttLockTracking(sttTargetId: number | null): void {
        if (sttTargetId !== null) {
            if (this.currentSttTargetId !== sttTargetId) {
                this.sttLockAcquiredAt = this.scene.time.now;
                this.currentSttTargetId = sttTargetId;
            }
        } else {
            this.sttLockAcquiredAt = null;
            this.currentSttTargetId = null;
        }
    }

    // ── State behaviours ───────────────────────────────────────────────────

    private executePatrol(): void {
        if (this.radar?.getMode() !== 'rws') this.radar?.enterRws();

        if (this.ship.shipType === 'cargo') {
            this.followCargoRoute();
            return;
        }

        // A raider handed an ingress route flies it instead of a search ladder:
        // the route is its search. Whatever its radar finds on the way pulls it
        // off into the engagement cycle, and it rejoins the route afterwards.
        if (!this.routeLoops) {
            this.followCargoRoute();
            return;
        }

        this.followPatrolLadder();
    }

    // Hold station on the flight lead. By default the wing keeps a search radar
    // running (RWS) so the flight has a second pair of eyes; the flight can
    // order it silent instead (Flight.wingRadar). The geometry - where the
    // station is, how fast to close - is the Flight's.
    private executeFormation(): void {
        if (!this.flight) return;
        const mode = this.flight.wingRadar === 'silent' || this.orders.silent ? 'emcon' : 'rws';
        if (this.radar?.getMode() !== mode) {
            if (mode === 'emcon') this.radar?.enterEmcon(); else this.radar?.enterRws();
        }
        const guidance = this.flight.guidance(this.ship);
        this.speedFactor = guidance.speedFactor;
        this.turnTowardAngle(guidance.headingDeg);
    }

    // The lead is never to be flown into, in any state: inside the break-away
    // radius the wing overrides its steering and runs directly away from it.
    private guardSeparation(): void {
        if (this.flightRole !== 'wing' || !this.flight?.leadAlive()) return;
        const guidance = this.flight.guidance(this.ship);
        if (!guidance.breakaway) return;
        this.speedFactor = guidance.speedFactor;
        this.turnTowardAngle(guidance.headingDeg);
    }

    // Fly down the bearing an enemy radar was heard on, to bring it inside our
    // own radar's reach — the RWR heard it far beyond that. The aggressive
    // pilot searches all the way in; the defensive one listens in EMCON
    // first, so the hunted ship's RWR has nothing to hear, then radiates.
    // A confirmed track turns the hunt into INVESTIGATE (scriptedState).
    //
    // The ship steers onto the line, not parallel to it: a border turn or an
    // evade may have pushed it off, and flying the bare bearing from there
    // would search a strip beside the one the emitter is on.
    private executeHunt(): void {
        if (!this.heardEmitter) return;
        const passive = this.personality === 'defensive'
            && this.scene.time.now - this.huntStartedAt < HUNT_PASSIVE_MS;
        if (passive) {
            if (this.radar?.getMode() !== 'emcon') this.radar?.enterEmcon();
        } else if (this.radar?.getMode() !== 'rws') {
            this.radar?.enterRws();
        }
        const { from, bearingDeg, lengthPx } = this.heardEmitter;
        const ahead = Math.min(Math.max(this.alongHeardLine(), 0) + HUNT_LOOKAHEAD_PX, lengthPx);
        const rad = Phaser.Math.DegToRad(bearingDeg);
        this.turnToward({ x: from.x + Math.cos(rad) * ahead, y: from.y + Math.sin(rad) * ahead });
    }

    // Turn back in towards where our own radar last held the contact, in wide
    // search (RWS: the widest cone, and no lock to keep), until it is back on
    // the scope (INVESTIGATE takes over), the memory runs out, or we arrive
    // and it is not there.
    private executeReacquire(): void {
        const memory = this.lastOwnContact;
        if (!memory) return;
        if (this.radar?.getMode() !== 'rws') this.radar?.enterRws();
        if (this.isNearPosition(memory.pos, REACQUIRE_ARRIVAL_PX)) {
            this.lastOwnContact = null;
            return;
        }
        this.lastTargetPos = { ...memory.pos };
        this.turnToward(memory.pos);
    }

    private executeInvestigate(track: Track | undefined, weapon: 'VIM-220' | 'VIM-177'): void {
        if (!track) return;
        this.lastTargetPos = { x: track.pos.x, y: track.pos.y };
        this.closeOn(track.pos);
        this.tryJam(track.pos);

        // A lead cued by the wing's track radiates to find the target itself.
        if (this.contactCueOnly) {
            if (this.radar?.getMode() === 'emcon') this.radar.enterRws();
            return;
        }

        // Cued by the lead's link track, we hold nothing ourselves. With a 220
        // we close in silence (a transmitter would only announce us) until the
        // track is inside our ring and ENGAGE can launch on it; without one we
        // must radiate to find the target ourselves.
        if (this.contactViaLink) {
            // ... unless the tactic has both radiate: a bracket (or grinder) is
            // pressure on the target's scope, and its RWR is meant to hear two
            // emitters on two bearings. Only the cover and the sort's own
            // remote shots stay quiet.
            const quiet = this.orders.tactic === 'formation' || this.orders.silent;
            const wanted = weapon === 'VIM-220' && quiet ? 'emcon' : 'rws';
            if (this.radar?.getMode() !== wanted) {
                if (wanted === 'emcon') this.radar?.enterEmcon(); else this.radar?.enterRws();
            }
            return;
        }

        // Wait until the track has matured (~2 scans), then set up the radar for
        // the chosen weapon: TWS for the fire-and-forget 220 (no lock needed),
        // STT lock for the SARH 177 — but only once the shot is in reach.
        // A lock is the loudest thing a radar can do: the target's RWR turns
        // it into a red spike and a reason to defend. Spiking it from outside
        // missile range only hands it the warning early, so the attack is
        // planned in TWS (heard as a plain search) and the lock is the last step
        // before the trigger.
        if (track.age >= INVESTIGATE_STT_MIN_AGE && this.radar) {
            // Holding fire (the cover) keeps the track in TWS, never the lock
            // the 177 needs: STT would collapse the flight's picture.
            // Only the *taking* of the lock waits for reach. Leaving STT throws
            // the whole picture away, so a lock already held is kept even if
            // the target opens past reach again — no flicker at the boundary.
            const mode = this.radar.getMode();
            const holdInTws = weapon === 'VIM-220' || !this.orders.mayShoot
                || (mode !== 'stt' && !this.inReach(weapon, track));
            if (holdInTws) {
                if (mode !== 'tws') this.radar.enterTws();
            } else if (mode !== 'stt') {
                this.radar.enterStt();
            }
        }
    }

    private executeEngage(weapon: 'VIM-220' | 'VIM-177', track: Track | null): void {
        if (!track) return;
        this.lastTargetPos = { x: track.pos.x, y: track.pos.y };
        this.closeOn(track.pos);

        this.tryJam(track.pos);

        // The 177 shot is gated on holding the lock; the 220 track matured
        // during INVESTIGATE and can be fired as soon as the launcher is ready.
        const now = this.scene.time.now;
        const lockHeld = this.sttLockAcquiredAt !== null ? now - this.sttLockAcquiredAt : 0;
        const gateOpen = weapon === 'VIM-220' || lockHeld >= STT_LOCK_DELAY_MS;

        if (gateOpen && now >= this.nextShotAt && this.tryShoot(weapon, track)) {
            this.nextShotAt = now + FIRE_COOLDOWN_MS;
            this.tryDeployDecoy();

            // Enter the crank through enter() so its entry side-effects can't
            // be skipped: it picks the crank side off lastTargetPos (set above
            // from this track), turning the nose toward open space.
            this.crankUntil = now + CRANK_DURATION_MS;
            this.enter(AIState.CRANK);
        }
    }

    private executeCrank(weapon: 'VIM-220' | 'VIM-177', track: Track | null): void {
        // Lost the engagement source (cone exit, chaff, …) → let updateState skate.
        if (!track) return;
        this.lastTargetPos = { x: track.pos.x, y: track.pos.y };

        this.tryJam(track.pos);

        // Hold the target at the cone edge, less the margin: as far off the
        // nose as the radar can still keep it (TWS cranks tighter, its cone is
        // 45° against the 60° search cone), so it stays illuminated while we
        // build lateral separation and slow the closure.
        const bearing = this.bearingTo(track.pos);
        this.turnTowardAngle(bearing + this.crankSide * this.scopeEdgeOffsetDeg());

        // Follow-up shot while cranking — this is where the 220s get "spammed"
        // (fireVim220 walks outward across un-engaged tracks by itself).
        const now = this.scene.time.now;
        if (this.orders.mayShoot && now >= this.nextShotAt && this.tryShoot(weapon, track)) {
            this.nextShotAt = now + FIRE_COOLDOWN_MS;
            this.tryDeployDecoy();
        }
    }

    // Select the weapon and pull the trigger. Returns true only if a missile
    // actually left the rail — the radar answers that directly, so a refused
    // shot (all tracks engaged, wrong radar mode, ...) reads as no shot rather
    // than being inferred from the load count. A cued wing launches on the
    // lead's link track (shootOnRemote); everyone else shoots from their own
    // picture.
    private tryShoot(weapon: 'VIM-220' | 'VIM-177', track: Track): boolean {
        if (!this.radar) return false;
        this.radar.selectWeapon(weapon);
        if (this.radar.getWeaponLoad(weapon) <= 0 || !this.deconflicted(track)) return false;
        const fired = this.contactViaLink
            ? this.radar.shootOnRemote(track)
            : this.radar.shoot(this.contactSorted ? track : undefined);
        if (fired) this.flight?.recordShot(this.ship);
        return fired;
    }

    private executeSkate(): void {
        // Break our own lock and go back to searching while we run.
        if (this.radar?.getMode() === 'stt') this.radar.enterRws();
        if (this.lastTargetPos) this.turnAwayFrom(this.lastTargetPos);
    }

    private executeEvade(): void {
        // Chaff first — in this sim that is what actually defeats a track.
        this.tryDeployDecoy();

        // Break our own lock and search while defending.
        if (this.radar?.getMode() === 'stt') this.radar.enterRws();

        // Threat bearing from the RWR (points at the emitter). Defensive runs cold;
        // aggressive beams (perpendicular) to keep the fight closer.
        const rwr = this.radar?.rwrReceiver.getPrimaryRwrContact();
        const threatBearing = rwr?.bearingDeg
            ?? (this.lastTargetPos ? this.bearingTo(this.lastTargetPos) : this.ship.angle);
        const heading = this.personality === 'defensive'
            ? threatBearing + 180
            : threatBearing + 90 * this.evadeSide;
        this.turnTowardAngle(heading);
    }

    // The extent of the world this ship flies in: the scene's own (Game.world),
    // read structurally so the controller does not import the scene it is
    // driven from; the default square for a scene that does not say.
    private worldSize(): WorldSize {
        return (this.scene as Phaser.Scene & { world?: WorldSize }).world
            ?? { width: world.WIDTH, height: world.HEIGHT };
    }

    // ── Routes ─────────────────────────────────────────────────────────────

    // Boustrophedon search ladder around the current position, clamped to world.
    private generatePatrolRoute(): { x: number; y: number }[] {
        const clampX = (x: number) => Phaser.Math.Clamp(x, PATROL_MARGIN_PX, this.worldSize().width - PATROL_MARGIN_PX);
        const clampY = (y: number) => Phaser.Math.Clamp(y, PATROL_MARGIN_PX, this.worldSize().height - PATROL_MARGIN_PX);

        const points: { x: number; y: number }[] = [];
        let x = this.ship.x;
        let y = this.ship.y;
        let dir = Phaser.Math.Between(0, 1) === 0 ? 1 : -1;
        for (let rung = 0; rung < 4; rung++) {
            x += dir * PATROL_LEG_PX;
            points.push({ x: clampX(x), y: clampY(y) });
            y += PATROL_STEP_PX;
            points.push({ x: clampX(x), y: clampY(y) });
            dir *= -1;
        }
        return points;
    }

    private followPatrolLadder(): void {
        if (this.patrolRoute.length === 0) this.patrolRoute = this.generatePatrolRoute();
        if (this.isNearPosition(this.patrolRoute[this.patrolIndex], 120)) {
            this.patrolIndex++;
            if (this.patrolIndex >= this.patrolRoute.length) {
                this.patrolRoute = this.generatePatrolRoute();
                this.patrolIndex = 0;
            }
        }
        this.turnToward(this.patrolRoute[this.patrolIndex]);
    }

    private generateCargoRoute(): { x: number; y: number }[] {
        const cx = this.ship.x;
        const cy = this.ship.y;
        const r = 800;
        return [
            { x: cx + r, y: cy },
            { x: cx, y: cy + r },
            { x: cx - r, y: cy },
            { x: cx, y: cy - r },
        ];
    }

    private followCargoRoute(): void {
        if (this.cargoWaypoints.length === 0 || this.arrived) return;
        const last = this.cargoWaypointIndex === this.cargoWaypoints.length - 1;
        // Intermediate turn points are passed wide; the destination of a fixed
        // route has to be reached, so it is flown closer before we call it.
        const threshold = last && !this.routeLoops ? ROUTE_ARRIVAL_PX : 150;
        if (this.isNearPosition(this.cargoWaypoints[this.cargoWaypointIndex], threshold)) {
            if (last && !this.routeLoops) {
                this.arrived = true;
                return;
            }
            this.cargoWaypointIndex = (this.cargoWaypointIndex + 1) % this.cargoWaypoints.length;
        }
        this.turnToward(this.cargoWaypoints[this.cargoWaypointIndex]);
    }

    // ── Steering / helpers ─────────────────────────────────────────────────

    // If within BORDER_MARGIN of an edge and heading further toward it, steer back.
    private avoidBorder(): boolean {
        const margin = world.BORDER_MARGIN;
        const { x, y } = this.ship;
        const rad = Phaser.Math.DegToRad(this.ship.angle);
        const dirX = Math.cos(rad);
        const dirY = Math.sin(rad);

        let steerX = 0;
        if (x < margin && dirX < 0) steerX = 1;
        else if (x > this.worldSize().width - margin && dirX > 0) steerX = -1;

        let steerY = 0;
        if (y < margin && dirY < 0) steerY = 1;
        else if (y > this.worldSize().height - margin && dirY > 0) steerY = -1;

        if (steerX === 0 && steerY === 0) return false;

        this.turnToward({
            x: x + (steerX !== 0 ? steerX : dirX) * 1000,
            y: y + (steerY !== 0 ? steerY : dirY) * 1000,
        });
        return true;
    }

    // Throttled chaff drop; no-op while cooling down or out of decoys.
    private tryDeployDecoy(): void {
        const now = this.scene.time.now;
        if (now < this.nextDecoyAt || this.ship.getRemainingDecoys() <= 0) return;
        this.ship.deployDecoy();
        this.nextDecoyAt = now + DECOY_COOLDOWN_MS;
    }

    // Burst the jammer when the target sits inside the cone the nose projects
    // and the transmitter is off cooldown. Jamming only spoofs radars inside
    // that cone, so a burst fired off-boresight would be wasted.
    private tryJam(pos: { x: number; y: number }): void {
        const radar = this.radar;
        if (!radar || !radar.isJammerReady() || !radar.isJammerAimedAt(pos)) return;
        radar.activateJammer();
    }

    private bearingTo(pos: { x: number; y: number }): number {
        return Phaser.Math.RadToDeg(Math.atan2(pos.y - this.ship.y, pos.x - this.ship.x));
    }

    // +1 or −1: which crank side turns the nose from the target bearing toward the
    // world centre (keeps the ship from cranking itself into a wall).
    private sideTowardCenter(targetPos: { x: number; y: number }): number {
        const toCenter = Phaser.Math.RadToDeg(
            Math.atan2(this.worldSize().height / 2 - this.ship.y, this.worldSize().width / 2 - this.ship.x),
        );
        const delta = Phaser.Math.Angle.WrapDegrees(toCenter - this.bearingTo(targetPos));
        return delta >= 0 ? 1 : -1;
    }

    // Close on a contact. Alone that is straight at it; in a flight the tactic
    // shapes the approach (Flight.closing): the bracket's split, the cover's
    // station. The geometry is the flight's, the throttle and turn are ours.
    //
    // A heading the flight asks for that would put a contact we hold on our
    // own radar outside our cone is clamped to the cone's edge, less the
    // margin: the bracket opens as wide as our scope allows and no wider. A
    // contact we work off the link, or with the transmitter off, has no cone
    // of ours to keep.
    private closeOn(position: { x: number; y: number }): void {
        const los = this.bearingTo(position);
        if (!this.flight?.leadAlive() || this.contactCueOnly) { this.turnTowardAngle(los); return; }
        const closing = this.flight.closing(this.ship, los, this.scene.time.now);
        this.speedFactor = closing.speedFactor;
        let heading = closing.headingDeg;
        if (!this.contactViaLink && this.radar?.holdingHalfAzimuthDeg() != null) {
            const limit = this.scopeEdgeOffsetDeg();
            heading = los + Phaser.Math.Clamp(Phaser.Math.Angle.WrapDegrees(heading - los), -limit, limit);
        }
        this.turnTowardAngle(heading);
    }

    // How far (deg) the nose may point off a contact we hold for the radar, in
    // its present mode, to keep it: the cone's half-width less the margin.
    // With no cone (transmitter silent) there is nothing to keep, and the
    // search cone's figure stands in.
    private scopeEdgeOffsetDeg(): number {
        const half = this.radar?.holdingHalfAzimuthDeg() ?? ANTENNA_AZIMUTH_DEG_BY_MODE.rws / 2;
        return Math.max(0, half - SCOPE_EDGE_MARGIN_DEG);
    }

    // Which way to crank: in a flight, outboard - away from the partner - so a
    // pair that fires together does not turn across each other. Alone, toward
    // the world centre.
    private crankSideFor(targetPos: { x: number; y: number }): number {
        return this.flight?.leadAlive() ? this.flight.outboardSide(this.ship) : this.sideTowardCenter(targetPos);
    }

    private turnToward(position: { x: number; y: number }): void {
        this.turnTowardAngle(this.bearingTo(position));
    }

    private turnAwayFrom(position: { x: number; y: number }): void {
        this.turnTowardAngle(this.bearingTo(position) + 180);
    }

    private turnTowardAngle(desiredAngleDeg: number): void {
        // A stationary unit holds its heading — every state still computes its
        // desired bearing, it just cannot act on it. Same for a ship that has
        // landed at the end of its route.
        if (this.activity === 'inactive' || this.arrived) return;
        const angleDelta = Phaser.Math.Angle.WrapDegrees(desiredAngleDeg - this.ship.angle);
        const turnStep = Phaser.Math.Clamp(angleDelta, -this.turnRate, this.turnRate);
        this.ship.setAngle(this.ship.angle + turnStep);
    }

    private applyMovement(): void {
        const angleRad = Phaser.Math.DegToRad(this.ship.angle);
        const speed = this.ship.getSpeed() * this.speedFactor;
        this.ship.setVelocity(Math.cos(angleRad) * speed, Math.sin(angleRad) * speed);
    }

    private isNearPosition(pos: { x: number; y: number }, threshold: number): boolean {
        return Phaser.Math.Distance.Between(pos.x, pos.y, this.ship.x, this.ship.y) < threshold;
    }
}
