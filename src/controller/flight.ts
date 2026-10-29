import Phaser from 'phaser';
import { Target } from '../entities/ship';
import { FlightDatalink, FusedGroup, correlatesWithPpli } from '../radar/systems/modules/flightDatalink';
import { Track } from '../radar/data/track';
import { Vector2 } from '../types';
import { LINK_TRACK_CORRELATION_PX } from '../radar/data/radarGameSettings';
import { formationSettings, tacticSettings } from '../settings';
import { missileSettings } from '../entities/entitySettings';

// A two-ship element: a lead that makes the decisions and a wingman that
// flies on it. The Flight owns what the two share - the roster, the station
// geometry and the intra-flight datalink - and nothing else: there is no
// per-frame "god" update. Each ship still runs its own radar and its own
// controller; the wingman's controller asks the Flight where its station is
// and how to get there, the way a real wingman looks at its leader.

export type FlightRole = 'lead' | 'wing';

// What the wingman should do this frame to hold or regain its station.
export type StationGuidance = {
    headingDeg: number;
    // Multiple of the ship's cruise speed.
    speedFactor: number;
    // True when the wing is inside BREAKAWAY_PX of the lead and has abandoned
    // its station to open the gap.
    breakaway: boolean;
};

// The group of targets the sort gave one member, as that member can use it.
export type Assignment = {
    // Where the flight's picture puts the group.
    pos: Vector2;
    // The datalinked track on it from the *other* member, freshest first - the
    // cue a member holding no track of its own can be steered and (ring
    // permitting) fired by. Null when only this member's own radar has it.
    remote: Track | null;
};

// How the pair works one group of targets (decision_tree.md, "Flights"):
//   formation     nothing for both to do: fly on the lead (or, with two groups,
//                 the sort - each member takes its own)
//   shooterCover  the lead radiates and holds the track, the wing stays silent
//                 and makes the shot on the lead's link track
//   bracket       the pair splits to either side of the group and shoots from
//                 there
//   grinder       both committed: one shoots and cranks while the other closes,
//                 then they swap
export type FlightTactic = 'formation' | 'shooterCover' | 'bracket' | 'grinder';

// What the flight tells one member to do this frame. The controller picks the
// state and the heading; these are the limits the tactic puts on it.
export type Orders = {
    tactic: FlightTactic;
    // May this member fire at the group now? (Formation: always - the sort,
    // not a tactic, decides whose target is whose.)
    mayShoot: boolean;
    // Keep the transmitter off and work from the link: the shooter of a
    // shooter/cover. The target's RWR then hears one emitter, the lead.
    silent: boolean;
};

// Where the lead's tactical judgement can weigh in on the flight's plan: given
// the tactics that are possible now, which one? Null is no opinion.
export type TacticAdvisor = (legal: FlightTactic[]) => FlightTactic | null;

// What the lead is told of its flight, in words (TacticalPicture): the wingman's
// stance from its status page on the link, its missiles, the plan in force and
// how many groups the link shows. Nothing here is a position or a range.
export type FlightBriefing = {
    wingman: 'in formation' | 'engaged' | 'defending' | 'lost';
    wingmanMissiles: number;
    flightTactic: FlightTactic;
    groupsOnLink: 'none' | 'one group' | 'two or more groups';
};

// A group as the sort remembers it: the last place it was seen, and the fused
// link entry for it if it is on the link this frame.
type HeldGroup = { pos: Vector2; seenAt: number; fresh: FusedGroup | null };

export class Flight {
    readonly lead: Target;
    readonly wing: Target;
    readonly datalink = new FlightDatalink();
    // +1 puts the wing on the lead's right, -1 on its left (screen frame). The
    // wing may cross to the other side to rejoin (see swapSidesIfNeeded).
    wingSide: 1 | -1;
    private swappedAt = -Infinity;
    // The wing's standing emission order while it flies formation: 'search' keeps
    // its radar in RWS as a second pair of eyes, 'silent' holds EMCON and leaves
    // the looking to the lead - the wing is then on the net but not on the air
    // (the footing for the shooter/cover tactic). Either way it goes silent to
    // prosecute a target the lead is feeding it.
    wingRadar: 'search' | 'silent' = 'search';

    // The tactic in force; changed only by the review (chooseTactic) after the
    // dwell. Read it with ordersFor() so the review has run this frame.
    tactic: FlightTactic = 'formation';
    private reviewedAt = -Infinity;
    private pending: { tactic: FlightTactic; since: number } | null = null;
    // Rounds on the rails when this engagement began, to tell whether the
    // flight has shot yet; and who shot last, for the grinder's alternation.
    private engagementRounds: Map<Target, number> | null = null;
    private lastShooter: Target | null = null;
    private openingShooter: Target;

    // The lead's tactician, if it has one. It chooses among the tactics that are
    // legal (legalTactics); the doctrine decides whenever it has no answer.
    private advisor: TacticAdvisor | null = null;

    private leadHeldAt = -Infinity;
    private formationSince = 0;
    private held: HeldGroup[] = [];
    private heldAt = -Infinity;

    constructor(params: { lead: Target; wing: Target; wingSide?: 1 | -1 }) {
        this.lead = params.lead;
        this.wing = params.wing;
        this.wingSide = params.wingSide ?? 1;
        this.openingShooter = this.wing;
    }

    members(): Target[] {
        return [this.lead, this.wing];
    }

    // A destroyed Matter sprite loses its body; the wing's cue to stop flying
    // on it and act as a single ship (AiUnitController).
    leadAlive(): boolean {
        return this.lead.active && Boolean(this.lead.body);
    }

    // The flight's picture as the sort remembers it. The link's fused groups
    // flicker - a track starved for a sweep drops off for a few frames - and a
    // sort recomputed from each frame's groups would trade the two members'
    // targets whenever one blinked. So each group is held at its last known
    // position until it has been missing for PICTURE_HOLD_MS, and a group that
    // reappears (within the correlation gate of where it was) is the same one.
    private heldGroups(now: number): HeldGroup[] {
        if (this.heldAt === now) return this.held;
        this.heldAt = now;

        for (const held of this.held) held.fresh = null;
        for (const group of this.datalink.groups(now)) {
            let best: HeldGroup | undefined;
            let bestPx = LINK_TRACK_CORRELATION_PX;
            for (const held of this.held) {
                if (held.fresh) continue;
                const px = Phaser.Math.Distance.Between(held.pos.x, held.pos.y, group.pos.x, group.pos.y);
                if (px <= bestPx) { best = held; bestPx = px; }
            }
            if (best) {
                best.pos = group.pos;
                best.seenAt = now;
                best.fresh = group;
            } else {
                this.held.push({ pos: group.pos, seenAt: now, fresh: group });
            }
        }
        // Once rounds are in the air the pair is cranking and skating with its
        // noses turned off the group, which is exactly when the radars lose it:
        // it is held for the length of that manoeuvre, not the length of a blink.
        const engaged = this.tactic !== 'formation' && this.roundsFired() > 0;
        const holdMs = engaged ? tacticSettings.ENGAGED_HOLD_MS : tacticSettings.PICTURE_HOLD_MS;
        this.held = this.held.filter(held => now - held.seenAt <= holdMs);
        return this.held;
    }

    // The sort: who takes which target. Groups of the held picture are put in
    // order of azimuth, left to right, and the lead takes the left-most, the wing
    // the right-most. Given one group the lead takes it; the wing takes it too
    // once a tactic has both working it (assignmentFor). Computed from the link
    // alone, so both members get the same answer.
    //
    // Azimuth is measured off the axis from the lead to the picture's centre,
    // not off the lead's nose. With the nose on the picture they are the same
    // thing, but a nose is not stable: crank and skate swing it through 180
    // degrees, which would swap "left" and "right" and have the pair trade
    // targets mid-shot. The axis only moves as the targets do.
    private sortedGroups(now: number): HeldGroup[] {
        const groups = this.heldGroups(now);
        if (groups.length < 2) return [...groups];
        const centre = {
            x: groups.reduce((sum, g) => sum + g.pos.x, 0) / groups.length,
            y: groups.reduce((sum, g) => sum + g.pos.y, 0) / groups.length,
        };
        const axisDeg = Phaser.Math.RadToDeg(Math.atan2(centre.y - this.lead.y, centre.x - this.lead.x));
        const azimuthOf = (group: HeldGroup): number => Phaser.Math.Angle.WrapDegrees(
            Phaser.Math.RadToDeg(Math.atan2(group.pos.y - this.lead.y, group.pos.x - this.lead.x)) - axisDeg,
        );
        return [...groups].sort((a, b) => azimuthOf(a) - azimuthOf(b));
    }

    assignmentFor(ship: Target, now: number): Assignment | null {
        this.review(now);
        const groups = this.sortedGroups(now);
        // One group: the lead has it; the wing has it only when the tactic
        // puts both on it (shooter/cover, bracket, grinder).
        const group = ship === this.lead ? groups[0]
            : groups.length >= 2 ? groups[groups.length - 1]
            : this.tactic !== 'formation' ? groups[0] : undefined;
        if (!group) return null;

        const remote = (group.fresh?.reports ?? [])
            .filter(report => report.sourceId !== ship.id)
            .sort((a, b) => b.timestamp - a.timestamp || b.track.confidence - a.track.confidence)[0];
        return { pos: group.pos, remote: remote?.track ?? null };
    }

    // The ship's own radar track on its assigned group: the nearest of its
    // hostile tracks inside the correlation gate of the group - the same
    // distance-gated correlation the link uses between members, so one target
    // is one entry whichever radar holds it.
    ownTrackOn(assignment: Assignment, tracks: Track[]): Track | undefined {
        let best: Track | undefined;
        let bestPx = LINK_TRACK_CORRELATION_PX;
        for (const track of tracks) {
            const px = Phaser.Math.Distance.Between(track.pos.x, track.pos.y, assignment.pos.x, assignment.pos.y);
            if (px <= bestPx) { best = track; bestPx = px; }
        }
        return best;
    }

    // Is this track on the group the *other* member of the sort has been given?
    // False while the sort has not split the picture into two groups, or when
    // both members are on the same one. A pilot whose own group it has no
    // track on may fall back to any other contact - but never to its partner's,
    // or the pair would put two missiles on one target and none on the other.
    onPartnersGroup(ship: Target, track: Track, now: number): boolean {
        // Read straight off the sort rather than through assignmentFor(): this
        // is asked by a pilot on the way to a decision and must not trigger the
        // flight's lazy review as a side effect.
        const groups = this.sortedGroups(now);
        if (groups.length < 2) return false;
        const theirs = ship === this.lead ? groups[groups.length - 1] : groups[0];
        return Phaser.Math.Distance.Between(track.pos.x, track.pos.y, theirs.pos.x, theirs.pos.y)
            <= LINK_TRACK_CORRELATION_PX;
    }

    // ── Tactics ────────────────────────────────────────────────────────────

    private wingAlive(): boolean {
        return this.wing.active && Boolean(this.wing.body);
    }

    // Rounds left on a member's rails, any type.
    private rounds(ship: Target): number {
        return ship.radar.getWeaponLoad('VIM-220') + ship.radar.getWeaponLoad('VIM-177');
    }

    // Rounds the flight has fired since this engagement began.
    private roundsFired(): number {
        if (!this.engagementRounds) return 0;
        let fired = 0;
        for (const [ship, before] of this.engagementRounds) fired += Math.max(0, before - this.rounds(ship));
        return fired;
    }

    // The doctrine: which tactic the flight should be flying given what is on
    // the link and what is on the rails. Built only from the shared picture and
    // the members' stores - never from the entity list - so it is exactly what
    // two crews on a net could work out, and it is the one thing a Jev-flown
    // lead will later choose in its place (decision_tree.md, "Flights").
    //
    // Engagements run forward - opener, then grinder - and do not step back
    // while rounds are still unfired: a bracket half made that fell back to
    // shooter/cover would have the wing swing across to its cover station.
    // Null means no opinion: the picture has blinked, and the review leaves the
    // tactic - and any change of mind in progress - exactly as it was.
    chooseTactic(now: number): FlightTactic | null {
        const groups = this.heldGroups(now);
        // No group, or several (the sort gives each member its own): nothing for
        // the pair to do together.
        if (groups.length !== 1 || !this.wingAlive() || !this.leadAlive()) return 'formation';

        const group = groups[0];
        if (!group.fresh) return null;
        // The lead must hold a track of its own on it. A group only the wing has
        // seen is a cue for the lead to go and look, not something to plan on.
        // (Not once rounds are away: cranking and skating turn the lead's nose
        // off the group, and that is no reason to call the engagement over.)
        // Nor once an opener is under way: a lead whose track on a group out near
        // the detection knee starves for a few sweeps does not unmake the plan.
        // Falling back to formation would drop the bracket half made, and the
        // plan would be re-chosen - after the dwell - with the range spent and no
        // room left to split (the pair then fires from the abandon radius at a
        // split the bracket exists to beat). The group itself going away still
        // ends it: no group is 'formation' above, a stale one null just below.
        if (!this.leadHoldsGroup(now)) {
            const underway = this.tactic === 'bracket' || this.tactic === 'shooterCover';
            return this.roundsFired() > 0 || underway ? null : 'formation';
        }

        const leadArmed = this.rounds(this.lead) > 0;
        const wingArmed = this.rounds(this.wing) > 0;
        if (!leadArmed && !wingArmed) return 'formation';
        // One of them is dry: the other shoots and the dry one covers.
        if (!leadArmed || !wingArmed) return 'shooterCover';

        if (this.roundsFired() > 0) return 'grinder';
        if (this.tactic === 'bracket' || this.tactic === 'shooterCover') return this.tactic;

        // Both armed, nothing fired. Far off, there is room to split before the
        // shot; near, the quiet shot is the one to take, if the wing can take
        // it - a VIM-220 is the only round that can fly on the link.
        const rangePx = Phaser.Math.Distance.Between(this.lead.x, this.lead.y, group.pos.x, group.pos.y);
        if (rangePx > tacticSettings.BRACKET_ENTRY_PX) return 'bracket';
        return this.wing.radar.getWeaponLoad('VIM-220') > 0 ? 'shooterCover' : 'grinder';
    }

    // The tactics that are possible right now - the only ones a tactician is
    // offered. Code rules on what is possible, the tactician on what is wise
    // (decision_tree.md, "Jev tactician"). Built from the same inputs as
    // chooseTactic - the shared picture and the stores - and always including
    // what the doctrine would choose, so declining to ask costs nothing.
    //   formation     always: flying on the lead is never impossible
    //   shooterCover  one group, the lead holds a track, and somebody has a
    //                 round to shoot (not a bracket half made, and not once a
    //                 fight with both armed has gone on to the grinder)
    //   bracket       one group the lead holds, both armed, nothing fired yet,
    //                 and room to split (or already under way)
    //   grinder       both armed and committed: rounds fired, or the group too
    //                 near to split
    legalTactics(now: number): FlightTactic[] {
        const legal: FlightTactic[] = ['formation'];
        const groups = this.heldGroups(now);
        if (groups.length !== 1 || !this.wingAlive() || !this.leadAlive()) return legal;
        const group = groups[0];
        if (!group.fresh || !this.leadHoldsGroup(now)) return legal;

        const leadArmed = this.rounds(this.lead) > 0;
        const wingArmed = this.rounds(this.wing) > 0;
        if (!leadArmed && !wingArmed) return legal;
        if (!leadArmed || !wingArmed) return [...legal, 'shooterCover'];

        const fired = this.roundsFired() > 0;
        const rangePx = Phaser.Math.Distance.Between(this.lead.x, this.lead.y, group.pos.x, group.pos.y);
        const room = this.tactic === 'bracket' || rangePx > tacticSettings.BRACKET_ENTRY_PX;
        if (!fired && room) legal.push('bracket');
        if (!fired && this.tactic !== 'bracket') legal.push('shooterCover');
        if (fired || !room || this.tactic === 'bracket') legal.push('grinder');
        return legal;
    }

    // The lead's tactician; the Flight asks it, never the wing's.
    setTacticAdvisor(advisor: TacticAdvisor | null): void {
        this.advisor = advisor;
    }

    // The flight as the lead is told of it: what the wingman says on the link,
    // and the plan.
    briefing(now: number): FlightBriefing {
        const status = this.datalink.statusOf(this.wing.id, now);
        const groups = this.heldGroups(now).length;
        return {
            wingman: this.wingAlive() && status ? status.stance : 'lost',
            wingmanMissiles: status?.missiles ?? 0,
            flightTactic: this.tactic,
            groupsOnLink: groups === 0 ? 'none' : groups === 1 ? 'one group' : 'two or more groups',
        };
    }

    // Does the lead's own radar hold a track in the (single) group? A track near
    // the detection knee comes and goes from sweep to sweep, so a hold within
    // the last PICTURE_HOLD_MS counts: the plan does not wobble with it.
    private leadHoldsGroup(now: number): boolean {
        const group = this.heldGroups(now)[0];
        if (group?.fresh?.reports.some(report => report.sourceId === this.lead.id)) this.leadHeldAt = now;
        return now - this.leadHeldAt <= tacticSettings.PICTURE_HOLD_MS;
    }

    // Look at the doctrine every REVIEW_MS and act on a new answer only once it
    // has stood for DWELL_MS: the flight changes plan on a settled picture, not a
    // flicker. Lazy - called by whoever asks for orders or an assignment -
    // because the Flight has no per-frame update of its own.
    private review(now: number): void {
        if (now - this.reviewedAt < tacticSettings.REVIEW_MS) return;
        this.reviewedAt = now;

        const scripted = this.chooseTactic(now);
        if (scripted === null) return;
        // The lead's tactician may name the plan among the legal ones. Its answer
        // goes through the same dwell as the doctrine's: a picture it changes its
        // mind about every look cannot make the flight flicker.
        const legal = this.legalTactics(now);
        const advised = this.advisor && legal.length >= 2 ? this.advisor(legal) : null;
        const desired = advised !== null && legal.includes(advised) ? advised : scripted;
        if (desired === this.tactic) { this.pending = null; return; }
        if (this.pending?.tactic !== desired) this.pending = { tactic: desired, since: now };
        if (now - this.pending.since < tacticSettings.DWELL_MS) return;

        this.pending = null;
        // An engagement that breaks off (the group lost for a spell while the
        // pair cranks and skates) and re-forms is the same engagement: the
        // rounds already fired still count, so it resumes as the grinder
        // instead of opening afresh, and who shot last is remembered. Only an
        // absence of ENGAGEMENT_MEMORY_MS makes the next group a new fight.
        if (this.tactic === 'formation'
            && (!this.engagementRounds || now - this.formationSince > tacticSettings.ENGAGEMENT_MEMORY_MS)) {
            this.openingShooter = this.lastShooter === this.wing && this.rounds(this.lead) > 0 ? this.lead : this.wing;
            this.engagementRounds = new Map(this.members().map(ship => [ship, this.rounds(ship)]));
        }
        if (desired === 'formation') this.formationSince = now;
        this.tactic = desired;
    }

    // Who takes the shot under shooter/cover: the wing, while it holds a
    // VIM-220 (the one round that flies on the link); the lead once it does not.
    // Normally the wing; the lead if the wing took the last shot before an
    // engagement broke off and re-formed (the turn at the trigger carries over),
    // fixed when the engagement opens so that the wing's own shot does not hand
    // the lead one in the same breath - the second shot is the grinder's.
    private coverShooter(): Target {
        const wingCanFly = this.wing.radar.getWeaponLoad('VIM-220') > 0;
        const leadArmed = this.rounds(this.lead) > 0;
        if (!wingCanFly) return leadArmed ? this.lead : this.wing;
        if (!leadArmed) return this.wing;
        return this.openingShooter;
    }

    // The grinder's shot token: the member that did not shoot last, unless it
    // has nothing left to shoot.
    private grinderShooter(): Target {
        const other = this.lastShooter === this.lead ? this.wing : this.lead;
        return this.lastShooter === null || this.rounds(other) > 0 ? other : this.lastShooter;
    }

    // The angle (deg) between the two members as the group sees them: how far
    // apart the target would have to look to keep both in one scan.
    splitDeg(groupPos: Vector2): number {
        const seen = (ship: Target): number => Phaser.Math.RadToDeg(Math.atan2(ship.y - groupPos.y, ship.x - groupPos.x));
        return Math.abs(Phaser.Math.Angle.WrapDegrees(seen(this.lead) - seen(this.wing)));
    }

    private bracketFormed(now: number): boolean {
        const group = this.heldGroups(now)[0];
        if (!group) return false;
        const nearestPx = Math.min(
            Phaser.Math.Distance.Between(this.lead.x, this.lead.y, group.pos.x, group.pos.y),
            Phaser.Math.Distance.Between(this.wing.x, this.wing.y, group.pos.x, group.pos.y),
        );
        return this.splitDeg(group.pos) >= tacticSettings.BRACKET_SPLIT_DEG
            || nearestPx <= tacticSettings.BRACKET_ABANDON_PX;
    }

    ordersFor(ship: Target, now: number): Orders {
        this.review(now);
        const tactic = this.tactic;
        const isWing = ship === this.wing;
        switch (tactic) {
            case 'shooterCover':
                return {
                    tactic,
                    mayShoot: ship === this.coverShooter(),
                    // Silent only while the wing is the shooter and can fly the
                    // round on the link; if it holds only SARH rounds it has to
                    // radiate to shoot at all.
                    silent: isWing && this.wing.radar.getWeaponLoad('VIM-220') > 0,
                };
            case 'bracket':
                return { tactic, mayShoot: this.bracketFormed(now), silent: false };
            case 'grinder':
                return { tactic, mayShoot: ship === this.grinderShooter(), silent: false };
            default: {
                // One group and a living pair: a tactic is about to be chosen
                // (it needs DWELL_MS to settle), and nobody fires before it is -
                // a lead that shot on its first mature track would pre-empt
                // the quiet shot shooter/cover is there to take. Two groups
                // are the sort's, and a lone ship has no one to wait for.
                const waiting = this.wingAlive() && this.heldGroups(now).length === 1;
                // A fight that has lost its picture for a spell is still on: the
                // turn at the trigger is not forgotten just because the group is
                // not on the link this frame.
                if (this.wingAlive() && this.roundsFired() > 0 && this.rounds(this.lead) > 0 && this.rounds(this.wing) > 0) {
                    return { tactic, silent: false, mayShoot: ship === this.grinderShooter() };
                }
                // And a wing that can take the quiet shot does not radiate while
                // it waits, once the lead holds the track that shot would be
                // fired on (before that the wing may be the one holding it).
                return {
                    tactic,
                    mayShoot: !waiting,
                    silent: waiting && isWing && this.leadHoldsGroup(now)
                        && this.wing.radar.getWeaponLoad('VIM-220') > 0,
                };
            }
        }
    }

    // Deconfliction: may `ship` fire at a target at `targetPos` without its
    // flight mate being in the way? The seeker keeps off friends it has the PPLI
    // of (MissileRadar.setFriendPicture), but that is the missile's last line,
    // not the shooter's licence: a mate on the target would be masked by the
    // same correlation, and a mate in the seeker's acquisition basket would
    // draw the missile's search onto a ship it cannot choose. So the shooter
    // holds fire, from the link's PPLI alone, when a mate is
    //   - inside the target's correlation gate (the target and the mate are one
    //     PPLI return), or
    //   - where a VIM-220 coming off the line from the shooter would look: the
    //     seeker wakes ACTIVE_RADAR_ACTIVATION_RANGE short of the target on
    //     that line, and sees ACTIVE_RADAR_AZIMUTH either side of it out to
    //     ACTIVE_RADAR_RANGE. Anything in that cone is in the same basket as
    //     the target.
    // A missile can still physically meet a mate; this only makes it unlikely.
    // The bracket's split and the cover's station keep the mate out of the cone
    // in the ordinary course.
    clearToFire(ship: Target, targetPos: Vector2, now: number): boolean {
        const mates = this.datalink.wingmen(ship.id, now);
        if (mates.length === 0) return true;
        if (correlatesWithPpli(targetPos, mates, now)) return false;

        const seeker = missileSettings['VIM-220'];
        const lineDeg = Phaser.Math.RadToDeg(Math.atan2(targetPos.y - ship.y, targetPos.x - ship.x));
        const toTargetPx = Phaser.Math.Distance.Between(ship.x, ship.y, targetPos.x, targetPos.y);
        const wakePx = Math.min(seeker.ACTIVE_RADAR_ACTIVATION_RANGE, toTargetPx);
        const rad = Phaser.Math.DegToRad(lineDeg);
        const wake = { x: targetPos.x - Math.cos(rad) * wakePx, y: targetPos.y - Math.sin(rad) * wakePx };
        return !mates.some(mate => {
            const fromWakePx = Phaser.Math.Distance.Between(wake.x, wake.y, mate.pos.x, mate.pos.y);
            const bearingDeg = Phaser.Math.RadToDeg(Math.atan2(mate.pos.y - wake.y, mate.pos.x - wake.x));
            return fromWakePx <= seeker.ACTIVE_RADAR_RANGE
                && Math.abs(Phaser.Math.Angle.WrapDegrees(bearingDeg - lineDeg)) <= seeker.ACTIVE_RADAR_AZIMUTH;
        });
    }

    // The side (+1 right, -1 left, screen frame) a member breaks to when it
    // turns off the group - to crank or to open the bracket: its own, away from
    // its partner. Two ships that each cranked toward the world centre, or
    // toward their own line of sight to a group that sits between them, would
    // swing across one another's noses.
    outboardSide(ship: Target): 1 | -1 {
        return ship === this.wing ? this.wingSide : this.wingSide === 1 ? -1 : 1;
    }

    // A member fired: the grinder's token passes to the other.
    recordShot(ship: Target): void {
        this.lastShooter = ship;
    }

    // Where to point when closing on `losDeg` (the line of sight to the group),
    // and how fast.
    //
    // Shooter/cover (and the wait for it to be chosen): the wing does not close
    // on the group at all. It stays on its station abeam of the lead - silent,
    // and shooting from the lead's track - so the two never converge on one
    // point.
    //
    // Bracket and grinder: each swings out to its own side of the axis from the
    // flight's centre to the group, the lead to one and the wing to the other,
    // pointing off the line of sight by at most BRACKET_MAX_LOS_OFFSET_DEG so
    // the group stays in its radar cone while the pair opens out, and flies
    // straight at it once on its ray (BRACKET_HALF_ANGLE_DEG off the axis).
    // Opening outward from each other, they never cross. The grinder keeps the
    // geometry the bracket made rather than re-converging, so the shooter can
    // crank without turning into its partner.
    closing(ship: Target, losDeg: number, now: number): { headingDeg: number; speedFactor: number } {
        const orders = this.ordersFor(ship, now);
        const tactic = orders.tactic;
        if (ship === this.wing && (tactic === 'shooterCover' || orders.silent)) {
            const guidance = this.guidance(ship);
            return { headingDeg: guidance.headingDeg, speedFactor: guidance.speedFactor };
        }
        const group = this.heldGroups(now)[0];
        if (tactic === 'formation' || !group) return { headingDeg: losDeg, speedFactor: 1 };

        // A flight working a group holds off it: the point is pressure, not a
        // collision, and a hull rammed into the target is a hull lost.
        const standingOff = Phaser.Math.Distance.Between(ship.x, ship.y, group.pos.x, group.pos.y)
            < tacticSettings.STANDOFF_PX;
        const speedFactor = standingOff ? 0 : 1;
        if (tactic === 'shooterCover') return { headingDeg: losDeg, speedFactor };

        const centreX = (this.lead.x + this.wing.x) / 2;
        const centreY = (this.lead.y + this.wing.y) / 2;
        const axisBackDeg = Phaser.Math.RadToDeg(Math.atan2(centreY - group.pos.y, centreX - group.pos.x));
        const bearingFromGroupDeg = Phaser.Math.RadToDeg(Math.atan2(ship.y - group.pos.y, ship.x - group.pos.x));
        const side = this.outboardSide(ship);
        // How far round to its own side the ship already is, seen from the group.
        const aroundDeg = side * Phaser.Math.Angle.WrapDegrees(axisBackDeg - bearingFromGroupDeg);
        const offsetDeg = Phaser.Math.Clamp(
            (tacticSettings.BRACKET_HALF_ANGLE_DEG - aroundDeg) * tacticSettings.BRACKET_OFFSET_GAIN,
            0, tacticSettings.BRACKET_MAX_LOS_OFFSET_DEG,
        );
        return { headingDeg: losDeg + side * offsetDeg, speedFactor };
    }

    // Will the two hulls pass closer than PREDICT_CLEAR_PX in the next
    // PREDICT_HORIZON_FRAMES if both hold their present headings? Station-keeping
    // alone cannot be trusted with this: a wing that is ahead of the lead, or on
    // the inside of its turn, is overtaken faster than its own slow turn can
    // open the gap, and break-away (inside BREAKAWAY_PX) comes too late to turn
    // it round. The look-ahead starts the turn while there is still room.
    private onCollisionCourse(wing: Target, gapPx: number): boolean {
        const { PREDICT_CLEAR_PX, PREDICT_HORIZON_FRAMES, PREDICT_RANGE_PX } = formationSettings;
        if (gapPx > PREDICT_RANGE_PX) return false;
        const velocity = (ship: Target): Vector2 => {
            const rad = Phaser.Math.DegToRad(ship.angle);
            return { x: Math.cos(rad) * ship.getSpeed(), y: Math.sin(rad) * ship.getSpeed() };
        };
        const vw = velocity(wing);
        const vl = velocity(this.lead);
        const px = wing.x - this.lead.x;
        const py = wing.y - this.lead.y;
        const vx = vw.x - vl.x;
        const vy = vw.y - vl.y;
        const speedSq = vx * vx + vy * vy;
        if (speedSq < 1e-6) return false;
        const t = Phaser.Math.Clamp(-(px * vx + py * vy) / speedSq, 0, PREDICT_HORIZON_FRAMES);
        return t > 0 && Math.hypot(px + vx * t, py + vy * t) < PREDICT_CLEAR_PX;
    }

    // Open the lateral gap: leave the lead's path at SIDESTEP_DEG off its
    // heading, to the side the wing is already on (its station side if it is
    // on the centreline). Ahead of the lead, run for it; behind or abeam, let
    // it go by.
    private sidestep(wing: Target): StationGuidance {
        const headingRad = Phaser.Math.DegToRad(this.lead.angle);
        const alongPx = (wing.x - this.lead.x) * Math.cos(headingRad) + (wing.y - this.lead.y) * Math.sin(headingRad);
        const acrossPx = (wing.x - this.lead.x) * -Math.sin(headingRad) + (wing.y - this.lead.y) * Math.cos(headingRad);
        const side = acrossPx === 0 ? this.wingSide : Math.sign(acrossPx);
        return {
            headingDeg: this.lead.angle + side * formationSettings.SIDESTEP_DEG,
            speedFactor: alongPx > 0 ? formationSettings.CATCHUP_SPEED_FACTOR : formationSettings.MIN_SPEED_FACTOR,
            breakaway: true,
        };
    }

    private swapSidesIfNeeded(wing: Target): void {
        const now = wing.scene.time.now;
        if (this.tactic === 'bracket' || this.tactic === 'shooterCover' || now - this.swappedAt < formationSettings.SWAP_COOLDOWN_MS) return;
        const headingRad = Phaser.Math.DegToRad(this.lead.angle);
        // The lead's right-hand unit vector (screen y points down).
        const acrossPx = (wing.x - this.lead.x) * -Math.sin(headingRad) + (wing.y - this.lead.y) * Math.cos(headingRad);
        if (acrossPx * this.wingSide < -formationSettings.SWAP_BEYOND_PX) {
            this.wingSide = this.wingSide === 1 ? -1 : 1;
            this.swappedAt = now;
        }
    }

    // World position of the wing's station: fixed in the lead's body frame, so
    // it swings with every turn the lead makes.
    stationPosition(): { x: number; y: number } {
        const headingRad = Phaser.Math.DegToRad(this.lead.angle);
        const fx = Math.cos(headingRad);
        const fy = Math.sin(headingRad);
        // Screen y points down, so the lead's right-hand side is (-fy, fx).
        const rx = -fy * this.wingSide;
        const ry = fx * this.wingSide;
        return {
            x: this.lead.x + rx * formationSettings.SPACING_PX - fx * formationSettings.TRAIL_PX,
            y: this.lead.y + ry * formationSettings.SPACING_PX - fy * formationSettings.TRAIL_PX,
        };
    }

    // Steering and throttle for the wingman. Heading: point at the station
    // while it is far, fly the lead's heading (corrected by the lateral error)
    // once inside the capture radius. Throttle: faster when the station has
    // run ahead along the lead's heading, slower when the wing has overshot.
    //
    // Why a break-away exists: a cruiser's turn radius is only speed / turn
    // rate, a couple of dozen px at patrol speed, so the lead pivots almost on
    // the spot and its hull sweeps toward a wing on the inside of the turn
    // faster than the wing's own (equally slow) turn can answer. The station
    // geometry alone cannot be trusted to keep the hulls apart, so inside
    // BREAKAWAY_PX the wing flies directly away from the lead until it is
    // clear, then rejoins.
    //
    // Rejoining from the wrong side: after a fight the wing can come back on the
    // side of the lead its station is not on. Flying across to the station would
    // take it behind the lead's tail just as the lead's patrol turn swings that
    // tail toward it - the turn radius is a few dozen px, the wing's own turn is
    // as slow - so a wing that is already well over to the other side simply
    // takes that side as its station instead (swapSidesIfNeeded). Wingmen cross
    // over by agreement all the time; here it is never done in a tactic whose
    // geometry is set by the sides (shooter/cover, bracket).
    guidance(wing: Target): StationGuidance {
        this.swapSidesIfNeeded(wing);
        const { CAPTURE_PX, CAPTURE_ANGLE_DEG, SPEED_GAIN_PER_PX, MIN_SPEED_FACTOR,
            CATCHUP_SPEED_FACTOR, BREAKAWAY_PX } = formationSettings;
        const leadHeading = this.lead.angle;

        const gapPx = Phaser.Math.Distance.Between(wing.x, wing.y, this.lead.x, this.lead.y);
        if (gapPx < BREAKAWAY_PX) {
            const awayDeg = Phaser.Math.RadToDeg(Math.atan2(wing.y - this.lead.y, wing.x - this.lead.x));
            // A wing whose nose still points at the lead cannot turn out in the
            // room left (a cruiser turns at 0.3 deg/frame): it hangs on its
            // thrust until it has swung round, rather than running on into the
            // hull it is trying to leave.
            const facingLead = Math.abs(Phaser.Math.Angle.WrapDegrees(awayDeg - wing.angle)) > 90;
            return { headingDeg: awayDeg, speedFactor: facingLead ? 0 : CATCHUP_SPEED_FACTOR, breakaway: true };
        }

        if (this.onCollisionCourse(wing, gapPx)) return this.sidestep(wing);

        const station = this.stationPosition();
        const dx = station.x - wing.x;
        const dy = station.y - wing.y;
        const headingRad = Phaser.Math.DegToRad(leadHeading);
        const along = dx * Math.cos(headingRad) + dy * Math.sin(headingRad);
        const lateral = (-dx * Math.sin(headingRad) + dy * Math.cos(headingRad));

        const speedFactor = Phaser.Math.Clamp(1 + along * SPEED_GAIN_PER_PX, MIN_SPEED_FACTOR, CATCHUP_SPEED_FACTOR);

        const errorPx = Math.hypot(dx, dy);
        const headingDeg = errorPx > CAPTURE_PX
            ? Phaser.Math.RadToDeg(Math.atan2(dy, dx))
            : leadHeading + Phaser.Math.Clamp(lateral / CAPTURE_PX, -1, 1) * CAPTURE_ANGLE_DEG;
        return { headingDeg, speedFactor, breakaway: false };
    }
}
