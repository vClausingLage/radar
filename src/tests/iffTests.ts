import Phaser from 'phaser';
import { GameTest, TestContext } from './testHarness';
import { Target } from '../entities/ship';
import { ActiveRadarMissile, SARHMissile } from '../entities/missiles';
import { Track, iffStateOf } from '../radar/data/track';
import { AiUnitController, TacticalPicture, TacticalStateName, Tactician } from '../controller/aiUnitController';
import { FlightTactic } from '../controller/flight';
import { RADAR_DEFAULT_RANGE_PX, IFF_STATE_VALID_MS } from '../radar/data/radarGameSettings';
import Level1 from '../scenes/level1';
import Level2 from '../scenes/level2';
import Level3 from '../scenes/level3';

// In-game tests for IFF: that a friendly transponder answers and an enemy one
// stays silent, that the question and the answer are one-way physics that
// carry past the scope's ring and pay for gas, that a reply is attached to a
// track by geometry alone (so a friend hiding in a foe's gate vouches for it),
// that answers age out, and that the people using IFF - the player by key, the
// AI by itself - get what they should out of it. Every ship here is a
// drone or scripted; a test never reaches the network.

// A 60-degree RWS cone stepped 1 degree per frame: one sweep leg per 60 frames.
const FRAMES_PER_SWEEP = 60;

// A track this close to a hull is that hull's: the echo comes off its nearest surface and carries
// some measurement jitter, but a thermal false alarm is never this close by chance.
const TRACK_ON_HULL_PX = 45;

// Where the contacts sit for the player-facing tests, as a fraction of the
// rated range: comfortably inside the ring, where a cargo hull is held steadily.
const CLOSE_RANGE_FACTOR = 0.5;
// Past the ring, but inside the one-way horizon (~1.69x) where IFF still works.
const PAST_RING_FACTOR = 1.35;
// Past even the one-way horizon: neither leg has anything left.
const PAST_HORIZON_FACTOR = 1.9;

// A track within this of a hull is on it, for the purpose of "was that shot at
// the other ship": inside the IFF gate, so a genuine track that failed to read
// friendly would count, while a thermal false alarm drifting past does not.
const ON_OTHER_SHIP_PX = 70;

type Point = { x: number; y: number };

function rangePx(factor: number): number {
    return RADAR_DEFAULT_RANGE_PX * factor;
}

// The player's track closest to `at`, if one lies within a hull's reach of it.
function trackNear(ctx: TestContext, at: Point, within = TRACK_ON_HULL_PX): Track | undefined {
    let best: Track | undefined;
    let bestPx = within;
    for (const track of ctx.player.radar.getTracks()) {
        const px = Phaser.Math.Distance.Between(track.pos.x, track.pos.y, at.x, at.y);
        if (px <= bestPx) { best = track; bestPx = px; }
    }
    return best;
}

// A track as the radar would hold it, for tests that are about IFF and not
// about whether the radar happens to detect a hull on a given sweep.
function trackAt(pos: Point, iff?: Track['iff']): Track {
    return { id: 1, pos: { x: pos.x, y: pos.y }, dist: 0, dir: 0, speed: 0, age: 5, lastUpdate: 0, confidence: 1, history: [], iff };
}

// Hand the player's radar exactly these tracks. The next sweep leg that
// completes would age them, so a test reads the answer straight away.
function holdTracks(ctx: TestContext, tracks: Track[]): void {
    ctx.player.radar.setTracks(tracks);
}

// Press the I key the way the keyboard does, so the controller's own handler
// runs.
function pressI(ctx: TestContext): void {
    ctx.scene.input.keyboard?.emit('keydown-I');
}

// (a) The basic exchange, through the key. Two cargo hulls inside the ring, one
// on the player's code and one on the enemy's, a few degrees apart. Before the
// key neither has been asked; after it the friend's track is friendly and the
// enemy's is unknown - no reply, which is all the code can say.
const friendlyAnswersHostileDoesNot: GameTest = {
    name: 'IFF: a friendly track replies, a hostile one stays unknown',
    description: 'A friendly and a hostile cargo hull sit inside the ring, 40 degrees apart. Both are tracked '
        + 'and neither is interrogated; the I key asks, and only the friend\'s track reads friendly.',
    async run(ctx) {
        const boresight = ctx.player.getDirection();
        const friend = ctx.scene.spawnDrone({
            bearingDeg: boresight - 20, rangePx: rangePx(CLOSE_RANGE_FACTOR), hull: 'cargo', side: 'friendly',
        });
        const foe = ctx.scene.spawnDrone({
            bearingDeg: boresight + 20, rangePx: rangePx(CLOSE_RANGE_FACTOR), hull: 'cargo', side: 'hostile',
        });

        const both = await ctx.waitUntil(() => {
            const a = trackNear(ctx, friend);
            const b = trackNear(ctx, foe);
            return Boolean(a && b && a !== b);
        }, FRAMES_PER_SWEEP * 10);
        ctx.check('the radar holds a track on each hull', both);
        const friendTrack = trackNear(ctx, friend);
        const foeTrack = trackNear(ctx, foe);
        ctx.check('before the question neither track has been interrogated',
            friendTrack !== undefined && foeTrack !== undefined
            && iffStateOf(friendTrack) === 'not interrogated' && iffStateOf(foeTrack) === 'not interrogated');

        pressI(ctx);
        ctx.check('the I key interrogates: the friend\'s track reads friendly',
            friendTrack !== undefined && iffStateOf(friendTrack) === 'friendly',
            friendTrack ? iffStateOf(friendTrack) : 'no track');
        ctx.check('the enemy\'s track reads unknown - no reply, not a declaration',
            foeTrack !== undefined && iffStateOf(foeTrack) === 'unknown',
            foeTrack ? iffStateOf(foeTrack) : 'no track');
    },
};

// (b) One-way physics. The reply is a transponder answering a question, not an
// echo, so it carries well past the ring the scope draws (where a hull's echo
// has long been lost) and stops at the one-way horizon.
const replyCarriesPastTheRing: GameTest = {
    name: 'IFF: the reply carries past the radar ring, and stops at the one-way horizon',
    description: 'A friendly transponder 1.35x the rated range out answers (an echo from there would be marginal '
        + 'at best); one 1.9x out, beyond the one-way horizon, does not. The radar holds a given track on each.',
    async run(ctx) {
        const boresight = ctx.player.getDirection();
        const near = ctx.scene.spawnDrone({
            bearingDeg: boresight, rangePx: rangePx(PAST_RING_FACTOR), hull: 'cargo', side: 'friendly',
        });
        // Off to the side so the two interrogation beams do not overlap.
        const far = ctx.scene.spawnDrone({
            bearingDeg: boresight + 20, rangePx: rangePx(PAST_HORIZON_FACTOR), hull: 'cargo', side: 'friendly',
        });
        await ctx.frames(3);

        holdTracks(ctx, [trackAt(near, undefined), trackAt(far, undefined)]);
        const [nearTrack, farTrack] = ctx.player.radar.getTracks();
        ctx.check('the nearer track is past the scope\'s ring',
            Phaser.Math.Distance.Between(ctx.player.x, ctx.player.y, near.x, near.y) > RADAR_DEFAULT_RANGE_PX);

        ctx.check('the interrogator fires', ctx.player.radar.interrogate());
        ctx.check('a friendly 1.35x out answers', iffStateOf(nearTrack) === 'friendly', iffStateOf(nearTrack));
        ctx.check('a friendly 1.9x out, past the one-way horizon, does not', iffStateOf(farTrack) === 'unknown',
            iffStateOf(farTrack));
    },
};

// (c) Gas costs IFF energy like any other emission.
const gasCostsTheReply: GameTest = {
    name: 'IFF: gas on the path costs the interrogation and the reply their energy',
    description: 'A friendly transponder 1.2x out answers in clear space; with a thick gas band across the '
        + 'path the same exchange fails.',
    async run(ctx) {
        const boresight = ctx.player.getDirection();
        const friend = ctx.scene.spawnDrone({
            bearingDeg: boresight, rangePx: rangePx(1.2), hull: 'cargo', side: 'friendly',
        });
        await ctx.frames(3);

        holdTracks(ctx, [trackAt(friend)]);
        ctx.player.radar.interrogate();
        const clear = iffStateOf(ctx.player.radar.getTracks()[0]);
        ctx.check('in clear space the friend answers', clear === 'friendly', clear);

        // The interrogator is cycling for IFF_COOLDOWN_MS; let it finish, then lay a cloud across the path.
        ctx.scene.spawnGasCloud({
            bearingDeg: boresight, rangePx: rangePx(0.6), alongDeg: boresight + 90, lengthPx: 400, radius: 120, density: 1,
        });
        await ctx.frames(100);
        holdTracks(ctx, [trackAt(friend)]);
        ctx.check('the interrogator fires again', ctx.player.radar.interrogate());
        const gassed = iffStateOf(ctx.player.radar.getTracks()[0]);
        ctx.check('through the cloud the same exchange fails', gassed === 'unknown', gassed);
    },
};

// (d) The classic trap. A reply is attached to a track by where it comes from,
// never by who sent it. A friend and an enemy in one gate are one track, the
// friend answers, and the whole track reads friendly - an enemy hiding in a
// friend's gate gets waved through.
const mergedTrackReadsFriendly: GameTest = {
    name: 'IFF: a friend and a foe in one resolution cell read as one friendly track',
    description: 'A hostile hull and a friendly one sit side by side, close enough that the radar tracks them as '
        + 'one contact. Interrogated, the track reads friendly - the correlation is geometry, not identity.',
    async run(ctx) {
        const boresight = ctx.player.getDirection();
        const rad = Phaser.Math.DegToRad(boresight);
        const range = rangePx(CLOSE_RANGE_FACTOR);
        const foe = ctx.scene.spawnDrone({ bearingDeg: boresight, rangePx: range, hull: 'cargo', side: 'hostile' });
        const friend = ctx.scene.spawnDrone({ bearingDeg: boresight, rangePx: range, hull: 'cargo', side: 'friendly' });
        // 20 px abreast across the line of sight: under the radar's cross-range
        // resolution at this range, so the echoes join into one plot.
        friend.setPosition(foe.x - Math.sin(rad) * 20, foe.y + Math.cos(rad) * 20);
        foe.setCollidesWith(0);
        friend.setCollidesWith(0);

        const mid = { x: (foe.x + friend.x) / 2, y: (foe.y + friend.y) / 2 };
        const tracked = await ctx.waitUntil(() => Boolean(trackNear(ctx, mid)), FRAMES_PER_SWEEP * 10);
        ctx.check('the radar holds a track on the pair', tracked);
        const onPair = ctx.player.radar.getTracks().filter(t =>
            Phaser.Math.Distance.Between(t.pos.x, t.pos.y, mid.x, mid.y) < 120);
        ctx.check('it is one track, not two', onPair.length === 1, `${onPair.length} tracks near the pair`);

        pressI(ctx);
        const track = trackNear(ctx, mid);
        ctx.check('the merged track reads friendly - the trap',
            track !== undefined && iffStateOf(track) === 'friendly', track ? iffStateOf(track) : 'no track');
        ctx.check('the hostile hull really is hostile', foe.iffCode === 1 && friend.iffCode === 0);
    },
};

// (e) An answer is only good for so long.
const answersAgeOut: GameTest = {
    name: 'IFF: an answer ages out and the track goes back to not interrogated',
    description: 'A friendly track is interrogated; it still reads friendly well inside the validity window '
        + 'and has reverted to not interrogated once the window has passed.',
    async run(ctx) {
        const boresight = ctx.player.getDirection();
        const friend = ctx.scene.spawnDrone({
            bearingDeg: boresight, rangePx: rangePx(0.4), hull: 'cargo', side: 'friendly',
        });
        const tracked = await ctx.waitUntil(() => Boolean(trackNear(ctx, friend)), FRAMES_PER_SWEEP * 10);
        ctx.check('the radar holds a track on the friend', tracked);
        const track = trackNear(ctx, friend);
        if (!track) return;

        pressI(ctx);
        ctx.check('interrogated: friendly', iffStateOf(track) === 'friendly');
        await ctx.frames(Math.floor(IFF_STATE_VALID_MS / 1000 * 60 / 2));
        ctx.check('half the validity window later it still reads friendly', iffStateOf(track) === 'friendly');
        await ctx.frames(Math.ceil(IFF_STATE_VALID_MS / 1000 * 60 / 2) + 60);
        ctx.check('past the window the track is back to not interrogated', iffStateOf(track) === 'not interrogated',
            iffStateOf(track));
    },
};

// (f) The player's key is for tracks. With nothing on the scope there is
// nothing to point the interrogator at: no question goes out, no cooldown is
// spent, and the HUD offers no button.
const keyNeedsATrack: GameTest = {
    name: 'IFF: the I key does nothing with no track, and the scope indicator follows the tracks',
    description: 'On an empty scope the key sends nothing and the scope indicator is hidden. Once a hull is tracked '
        + 'the indicator appears and the next press goes out - the empty press did not use up the cooldown.',
    async run(ctx) {
        const iffButtonVisible = (): boolean => ctx.player.radar.iffIndicatorShown();
        // A thermal false alarm can put a one-scan track up; wait for a clear scope.
        const clear = await ctx.waitUntil(() => ctx.player.radar.getTracks().length === 0, FRAMES_PER_SWEEP * 4);
        ctx.check('the scope is empty to start with', clear);
        pressI(ctx);
        ctx.check('the key with no track sends no question', !ctx.player.radar.canInterrogate());
        ctx.check('the scope indicator is hidden with no track', !iffButtonVisible());

        const boresight = ctx.player.getDirection();
        const friend = ctx.scene.spawnDrone({
            bearingDeg: boresight, rangePx: rangePx(0.4), hull: 'cargo', side: 'friendly',
        });
        const tracked = await ctx.waitUntil(() => Boolean(trackNear(ctx, friend)), FRAMES_PER_SWEEP * 10);
        ctx.check('a hull comes up on the scope', tracked);
        await ctx.frames(2);
        ctx.check('the scope indicator appears once there is a track', iffButtonVisible());
        pressI(ctx);
        const track = trackNear(ctx, friend);
        ctx.check('the next press goes out at once', track !== undefined && iffStateOf(track) === 'friendly',
            track ? iffStateOf(track) : 'no track');
    },
};

// (g) Fire control. The player's trigger is not gated by IFF - a friendly
// reply is information, shooting is the pilot's call - but an AI set never
// releases on a track that answered friendly.
const aiNeverFiresOnFriendlyReply: GameTest = {
    name: 'IFF: an AI never fires on a friendly-reply track; the player still may',
    description: 'The same TWS shot on the same track: an AI drone holds fire when the track has answered '
        + 'friendly and fires when it has not; the player\'s radar fires on a friendly-reply track.',
    async run(ctx) {
        const fireOn = (radar: Target['radar'], at: Point, iff: Track['iff']): boolean => {
            radar.enterTws();
            radar.selectWeapon('VIM-220');
            radar.setTracks([trackAt(at, iff)]);
            const before = radar.getWeaponLoad('VIM-220');
            radar.shoot();
            return radar.getWeaponLoad('VIM-220') < before;
        };
        const reply: Track['iff'] = { state: 'friendly', at: ctx.scene.time.now };
        const silent: Track['iff'] = { state: 'unknown', at: ctx.scene.time.now };

        const holder = ctx.scene.spawnDrone({ bearingDeg: 180, rangePx: 300, side: 'hostile' });
        const ahead = { x: holder.x + 300, y: holder.y };
        ctx.check('an AI set does not fire on a friendly-reply track', !fireOn(holder.radar, ahead, reply));

        const shooter = ctx.scene.spawnDrone({ bearingDeg: 90, rangePx: 400, side: 'hostile' });
        ctx.check('the same AI set fires on a track that did not answer',
            fireOn(shooter.radar, { x: shooter.x + 300, y: shooter.y }, silent));

        const player = ctx.player;
        ctx.check('the player fires on a friendly-reply track - the call is theirs',
            fireOn(player.radar, { x: player.x + 300, y: player.y }, reply));
    },
};

// (h) The skirmish bug IFF is for. Two enemy cruisers that are not in a flight
// carry the same code; each sees the other as a radar contact and, without IFF,
// goes and shoots it. With IFF each one asks, hears its own code answer and
// leaves it be. The control run switches IFF off and watches them fight, so
// the quiet is the IFF's doing and not the geometry's.
async function flyTwoEnemies(ctx: TestContext, iffOn: boolean): Promise<{ shotsAtEachOther: number; shotsAtAnything: number }> {
    ctx.player.radar.enterEmcon();
    ctx.scene.iffEnabled = iffOn;
    const a = ctx.scene.spawnAiShip({ x: 1200, y: 1100, direction: 0, speed: 0.1 });
    const b = ctx.scene.spawnAiShip({ x: 1700, y: 1100, direction: 180, speed: 0.1 });
    // A shot counts as at the other ship when the track it was launched on -
    // by the shooter's own track number - lies on that ship. (A thermal false
    // alarm can draw a shot of its own anywhere; that is not what is measured.)
    const counted = new Set<object>();
    let atEachOther = 0;
    for (let f = 0; f < FRAMES_PER_SWEEP * 40; f++) {
        await ctx.frames(1);
        for (const m of ctx.scene.children.list) {
            if (!(m instanceof SARHMissile || m instanceof ActiveRadarMissile) || counted.has(m)) continue;
            const shooter = m.owner === a ? a : m.owner === b ? b : null;
            if (!shooter) continue;
            const other = shooter === a ? b : a;
            if (!other.active || !other.body) continue;
            const track = shooter.radar.getTracks().find(t => t.id === m.targetId);
            if (!track) continue;
            counted.add(m);
            if (Phaser.Math.Distance.Between(track.pos.x, track.pos.y, other.x, other.y) < ON_OTHER_SHIP_PX) atEachOther++;
        }
    }
    return { shotsAtEachOther: atEachOther, shotsAtAnything: counted.size };
}

const enemiesDoNotEngageEachOther: GameTest = {
    name: 'IFF: two enemy ships outside a flight do not engage each other',
    description: 'Two scripted enemy cruisers 500 px apart, nose to nose and not in a flight, see each other on '
        + 'radar. Their automatic IFF gets their own code back, so over 40 sweeps neither fires on the other.',
    async run(ctx) {
        const result = await flyTwoEnemies(ctx, true);
        ctx.check('neither cruiser fires on the other', result.shotsAtEachOther === 0,
            `${result.shotsAtEachOther} shots at each other, ${result.shotsAtAnything} launched in all`);
    },
};

const enemiesEngageWithoutIff: GameTest = {
    name: 'IFF control: with IFF off the same two enemy ships do engage each other',
    description: 'The same two cruisers with IFF switched off for the scene: one of them fires on the other, so '
        + 'the quiet of the previous test is the IFF and not the geometry.',
    async run(ctx) {
        const result = await flyTwoEnemies(ctx, false);
        ctx.check('without IFF a cruiser fires on the other', result.shotsAtEachOther > 0,
            `${result.shotsAtEachOther} shots at each other, ${result.shotsAtAnything} launched in all`);
    },
};

// A tactician that only listens: it records every picture it is shown.
class PictureRecorder implements Tactician {
    readonly pictures: TacticalPicture[] = [];
    advise(picture: TacticalPicture, _legal: TacticalStateName[], _tactics: FlightTactic[] = []): TacticalStateName | null {
        this.pictures.push(picture);
        return null;
    }
    getDebugLabel(): string { return 'RECORDER'; }
    destroy(): void {}
}

// (i) Jev's picture gains an IFF word for the contact it holds.
const pictureCarriesIffWords: GameTest = {
    name: 'IFF: the tactical picture carries the contact\'s IFF in words',
    description: 'An enemy-coded AI drone tracks the player (code 0): after its automatic interrogation gets '
        + 'nothing back, its picture says "no IFF reply" for the contact, and never "friendly IFF reply".',
    async run(ctx) {
        const boresight = ctx.player.getDirection();
        const drone = ctx.scene.spawnDrone({
            bearingDeg: boresight, rangePx: 300, facingDeg: boresight + 180, emitting: true, side: 'hostile',
        });
        const recorder = new PictureRecorder();
        drone.controller?.destroy();
        // An emplacement: it holds still while its radar, IFF and decisions all run.
        drone.controller = new AiUnitController(ctx.scene, drone, 0, false, drone.radar, drone.id, 'inactive', recorder);
        ctx.player.radar.enterEmcon();

        await ctx.frames(FRAMES_PER_SWEEP * 6);
        const words = [...new Set(recorder.pictures.map(p => p.contactIff))];
        ctx.check('the picture says no IFF reply for an unanswered contact', words.includes('no IFF reply'), words.join(', '));
        ctx.check('and never calls an enemy-coded question answered', !words.includes('friendly IFF reply'));
    },
};

// (j) The campaign is unchanged: its levels have no IFF, and a scene without
// IFF has neither button nor answers.
const campaignHasNoIff: GameTest = {
    name: 'IFF: campaign levels have no IFF; free play does',
    description: 'Every campaign level reports IFF unavailable; free play reports it available. With IFF off in '
        + 'the scene the interrogator never fires and no track is ever marked.',
    async run(ctx) {
        ctx.check('level 1 has no IFF', !new Level1().iffAvailable());
        ctx.check('level 2 has no IFF', !new Level2().iffAvailable());
        ctx.check('level 3 has no IFF', !new Level3().iffAvailable());
        ctx.check('free play has IFF', ctx.scene.iffAvailable());

        ctx.scene.iffEnabled = false;
        const boresight = ctx.player.getDirection();
        const friend = ctx.scene.spawnDrone({
            bearingDeg: boresight, rangePx: rangePx(0.4), hull: 'cargo', side: 'friendly',
        });
        const tracked = await ctx.waitUntil(() => Boolean(trackNear(ctx, friend)), FRAMES_PER_SWEEP * 10);
        ctx.check('a hull is tracked', tracked);
        await ctx.frames(2);
        pressI(ctx);
        const track = trackNear(ctx, friend);
        ctx.check('with IFF off the key interrogates nothing', track !== undefined && iffStateOf(track) === 'not interrogated');
        ctx.check('and the scope indicator stays hidden', !(ctx.player.radar.iffIndicatorShown()));
    },
};

export const iffTests: GameTest[] = [
    friendlyAnswersHostileDoesNot,
    replyCarriesPastTheRing,
    gasCostsTheReply,
    mergedTrackReadsFriendly,
    answersAgeOut,
    keyNeedsATrack,
    aiNeverFiresOnFriendlyReply,
    enemiesDoNotEngageEachOther,
    enemiesEngageWithoutIff,
    pictureCarriesIffWords,
    campaignHasNoIff,
];
