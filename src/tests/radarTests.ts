import Phaser from 'phaser';
import { GameTest, TestContext } from './testHarness';
import { RADAR_DEFAULT_RANGE_PX } from '../radar/data/radarGameSettings';
import { Target } from '../entities/ship';

// In-game tests for the player radar's signal path: how far the emission
// carries, who gets warned by it, what comes back as a track, and what the
// medium and a jammer do to both.
//
// Every test states its geometry as a range from the player, expressed as a
// fraction of the radar's rated range, because that ratio is what the energy
// budget (and therefore every expectation here) is written in terms of. The
// rated range — the 700 px the interface draws — is where a *reference* hull's
// echo drops to the receiver's noise floor. It is a property of the return, not
// a wall the pulse stops at, so several of these tests are about what happens
// on the far side of it.

// A 60-degree RWS cone stepped 1 degree per frame: one sweep leg per 60 frames.
const FRAMES_PER_SWEEP = 60;

// Ranges as a multiple of the radar's rated range (RADAR_DEFAULT_RANGE_PX).
// Past the rated range a reference hull has no chance of a return, but the
// emission is still out there: an RWR only has to hear the pulse, not send an
// echo back. Comfortably past 1.0x rather than just past it: detectionProbability
// never reaches exactly zero (its floor is RADAR_PFA, however faint the
// signal), so a range right on the knee is tested — once per sweep leg, over
// several legs — often enough that an occasional floor-crossing is expected
// rather than a sign the physics broke. Shared with the boosted-cross-section
// broadside case below, which needs the opposite margin (reliably detected,
// not reliably missed), so it cannot be pushed arbitrarily far out — a test
// with no such counterpart (RWR_ONLY_OUTSIDE_RANGE) can afford to.
const OUTSIDE_RADAR_RANGE = 1.3;
// A range with no "must still be detected" case sharing it, so it can sit far
// enough past the knee that the floor's residual chance is comfortably small
// over several sweep legs — while staying well under the one-way horizon
// (~1.69x, where emissionSignal itself reaches the noise floor: see
// RWR_HORIZON_FACTOR in data/signalPath.ts), so the RWR side of the same test
// stays a near-certainty rather than trading one flaky assertion for another.
const RWR_ONLY_OUTSIDE_RANGE = 1.6;
// Far enough out that even one-way there is nothing left to receive.
const BEYOND_RWR_RANGE = 2.0;
// Close enough that returns come back reliably, so a missing/displaced track
// can only be the jamming.
const JAMMER_RANGE_FACTOR = 0.45;
// Inside the rated range, but far enough out that a cloud in the way costs more
// signal than the budget has to spare.
const GAS_FAR_RANGE_FACTOR = 0.71;
// Deep inside it, where there is signal to burn — the same cloud costs the same
// fraction of it and the contact is still there.
const GAS_NEAR_RANGE_FACTOR = 0.29;

// A jammed sweep is displaced by at least JAMMER_DISTANCE_ERROR_MIN_PX (60) in
// range, so anything nearer than this to the real hull is a genuine return, not
// the spoof.
const FAKE_TRACK_MIN_OFFSET_PX = 50;

// A track this close to a hull is that hull's: well inside the tracking
// computer's own cluster radius, and far nearer than any other contact a test
// places.
const TRACK_ON_TARGET_PX = 120;

// Closest approach of any of the player's tracks to where the drone really is.
// Infinity when the radar holds no track at all.
function nearestTrackOffset(ctx: TestContext, drone: Target): number {
    return ctx.player.radar.getTracks().reduce(
        (best, track) => Math.min(best, Phaser.Math.Distance.Between(track.pos.x, track.pos.y, drone.x, drone.y)),
        Infinity,
    );
}

// Sample the player's track picture once per frame for `frames` frames.
// `trackFraction` is how much of that time it held *any* track at all — a
// coarse measure that also counts a stray thermal false alarm having nothing
// to do with `drone` (see RADAR_FALSE_ALARM_RATE), so it is reported for
// context rather than asserted on directly. `everOnDrone` is the real claim a
// "no track formed on this drone" test wants: whether a track ever actually
// sat close enough to be it, which a false alarm elsewhere does not affect.
async function measureTrackPresence(
    ctx: TestContext,
    drone: Target,
    frames: number,
): Promise<{ trackFraction: number; everOnDrone: boolean }> {
    let framesWithTrack = 0;
    let everOnDrone = false;
    for (let i = 0; i < frames; i++) {
        await ctx.frames(1);
        if (ctx.player.radar.getTracks().length > 0) framesWithTrack++;
        if (nearestTrackOffset(ctx, drone) < TRACK_ON_TARGET_PX) everOnDrone = true;
    }
    return { trackFraction: framesWithTrack / frames, everOnDrone };
}

// (a) One-way beats two-way: an emission only has to reach the target, while a
// return has to survive the trip out *and* back. So the range at which a ship
// can be warned that it is being swept is longer than the range at which the
// sweeping radar can see it — being outside a radar's rated range is no
// protection from knowing it is looking.
const rwrWarnsOutsideRadarRange: GameTest = {
    name: "RWR warns outside the radar's own range",
    description: `A drone at ${RWR_ONLY_OUTSIDE_RANGE}x the player's radar range is too far out for the player `
        + 'to form any track on it, but its RWR still hears the sweep.',
    async run(ctx) {
        const rangePx = RADAR_DEFAULT_RANGE_PX * RWR_ONLY_OUTSIDE_RANGE;
        const drone = ctx.scene.spawnDrone({
            bearingDeg: ctx.player.getDirection(),
            rangePx,
        });

        let everWarned = false;
        const stopWatching = watchRwr(ctx, drone, () => { everWarned = true; });
        const { trackFraction, everOnDrone } = await measureTrackPresence(ctx, drone, FRAMES_PER_SWEEP * 6);
        stopWatching();

        ctx.check('player forms no track on it', !everOnDrone,
            `any-track held for ${(trackFraction * 100).toFixed(0)}% of the run`);
        ctx.check('drone RWR still hears the sweep', everWarned,
            `range ${Math.round(rangePx)}px, radar range ${RADAR_DEFAULT_RANGE_PX}px`);
    },
};

// (b) The other end of the same rule: past the beam's reach there is no energy
// left to receive, so a ship out there is not warned at all — it never learns
// the player is there.
const rwrSilentFarOut: GameTest = {
    name: 'RWR stays silent far outside the sweep',
    description: `A drone at ${BEYOND_RWR_RANGE}x radar range receives too little energy to notice: `
        + 'no RWR contact, and no track for the player either.',
    async run(ctx) {
        const rangePx = RADAR_DEFAULT_RANGE_PX * BEYOND_RWR_RANGE;
        const drone = ctx.scene.spawnDrone({
            bearingDeg: ctx.player.getDirection(),
            rangePx,
        });

        let everWarned = false;
        const stopWatching = watchRwr(ctx, drone, () => { everWarned = true; });
        const { trackFraction, everOnDrone } = await measureTrackPresence(ctx, drone, FRAMES_PER_SWEEP * 4);
        stopWatching();

        ctx.check('drone RWR stays silent', !everWarned,
            `range ${Math.round(rangePx)}px, radar range ${RADAR_DEFAULT_RANGE_PX}px`);
        ctx.check('player forms no track', !everOnDrone,
            `any-track held for ${(trackFraction * 100).toFixed(0)}% of the run`);
    },
};

// (c) The return leg is decided by energy, and how much energy comes back
// depends on how much hull was pointed at the beam. Two identical cargo
// haulers at the same range, one bow-on and one broadside: the broadside one
// throws back over twice the signal and is tracked from beyond the range ring,
// where the bow-on one is not detectable at all. This is the mechanic behind
// beaming a search radar — and the reason the ring is a display, not a limit.
const crossSectionDecidesRange: GameTest = {
    name: 'Aspect decides how far a hull is seen',
    description: `Two cargo hulls at ${OUTSIDE_RADAR_RANGE}x radar range, one broadside and one bow-on. `
        + 'The broadside hull returns enough energy to track past the range ring; the bow-on one does not.',
    async run(ctx) {
        const rangePx = RADAR_DEFAULT_RANGE_PX * OUTSIDE_RADAR_RANGE;
        const boresight = ctx.player.getDirection();
        // Off boresight to either side, so both sit inside the 60-degree cone
        // at the same range and neither can shadow the other.
        const broadside = ctx.scene.spawnDrone({
            bearingDeg: boresight - 20,
            rangePx,
            facingDeg: boresight - 20 + 90,
            hull: 'cargo',
        });
        const bowOn = ctx.scene.spawnDrone({
            bearingDeg: boresight + 20,
            rangePx,
            facingDeg: boresight + 20 + 180,
            hull: 'cargo',
        });

        let broadsideSeen = false;
        for (let i = 0; i < FRAMES_PER_SWEEP * 10; i++) {
            await ctx.frames(1);
            if (nearestTrackOffset(ctx, broadside) < TRACK_ON_TARGET_PX) broadsideSeen = true;
        }

        ctx.check('the broadside hull is tracked past the range ring', broadsideSeen,
            `range ${Math.round(rangePx)}px, radar range ${RADAR_DEFAULT_RANGE_PX}px`);
        ctx.check('the bow-on hull is not', nearestTrackOffset(ctx, bowOn) >= TRACK_ON_TARGET_PX,
            `nearest track ${formatOffset(nearestTrackOffset(ctx, bowOn))} from it`);
    },
};

// (d) The range ring is where the interface stops, and fire control stops with
// it. The radar can hold a contact beyond it — test (c) is exactly that — but a
// track the scope is not drawing is not a firing solution: the trigger does
// nothing. The rule binds the AI too, since it drives the same radar.
const noShotAtAnUndisplayedTrack: GameTest = {
    name: 'Fire control will not shoot at what the scope does not show',
    description: `A broadside cargo hull at ${OUTSIDE_RADAR_RANGE}x radar range is tracked, but sits `
        + 'outside the range the interface draws, so the VIM-220 stays on the rail.',
    async run(ctx) {
        const radar = ctx.player.radar;
        const drone = ctx.scene.spawnDrone({
            bearingDeg: ctx.player.getDirection(),
            rangePx: RADAR_DEFAULT_RANGE_PX * OUTSIDE_RADAR_RANGE,
            facingDeg: ctx.player.getDirection() + 90,
            hull: 'cargo',
        });

        // TWS is the VIM-220's mode, and the shot needs a maintained track.
        radar.enterTws();
        const tracked = await ctx.waitUntil(
            () => nearestTrackOffset(ctx, drone) < TRACK_ON_TARGET_PX,
            FRAMES_PER_SWEEP * 10,
        );
        ctx.check('the radar holds a track on it', tracked,
            `nearest track ${formatOffset(nearestTrackOffset(ctx, drone))} from the hull`);

        radar.selectWeapon('VIM-220');
        const loadBefore = radar.getWeaponLoad('VIM-220');
        radar.shoot();

        ctx.check('the trigger does nothing', radar.getWeaponLoad('VIM-220') === loadBefore,
            `load ${loadBefore} -> ${radar.getWeaponLoad('VIM-220')}`);
    },
};

// (e) Gas is an absorbing medium, not a wall. It taxes the energy in the beam
// (twice over, since the echo comes back through it), so what it really costs
// the radar is range: the same cloud that loses a contact well out is no
// obstacle at all to one close in, which still has signal to spare.
const gasCostsRangeNotSight: GameTest = {
    name: 'Gas costs the radar range, not sight',
    description: 'One band of gas across the nose, with a drone behind it at each of two ranges. '
        + 'The far one is absorbed away; the near one is tracked straight through the same cloud.',
    async run(ctx) {
        const boresight = ctx.player.getDirection();
        // A band lying across the boresight, close in, so both drones are
        // looked at through it.
        ctx.scene.spawnGasCloud({
            bearingDeg: boresight,
            rangePx: 150,
            alongDeg: boresight + 90,
            lengthPx: 400,
        });

        const far = ctx.scene.spawnDrone({
            bearingDeg: boresight - 20,
            rangePx: RADAR_DEFAULT_RANGE_PX * GAS_FAR_RANGE_FACTOR,
        });
        const near = ctx.scene.spawnDrone({
            bearingDeg: boresight + 20,
            rangePx: RADAR_DEFAULT_RANGE_PX * GAS_NEAR_RANGE_FACTOR,
        });

        const frames = FRAMES_PER_SWEEP * 8;
        let farFrames = 0;
        let nearFrames = 0;
        for (let i = 0; i < frames; i++) {
            await ctx.frames(1);
            if (nearestTrackOffset(ctx, far) < TRACK_ON_TARGET_PX) farFrames++;
            if (nearestTrackOffset(ctx, near) < TRACK_ON_TARGET_PX) nearFrames++;
        }

        ctx.check('the far contact is lost in the cloud', farFrames / frames < 0.15,
            `held for ${((farFrames / frames) * 100).toFixed(0)}% of the run`);
        ctx.check('the near contact is held through the same cloud', nearFrames / frames > 0.6,
            `held for ${((nearFrames / frames) * 100).toFixed(0)}% of the run`);
    },
};

// (f) A jamming ship inside the beam rewrites the whole sweep into one coherent
// false contact, so the player's track sits somewhere the ship is not.
const jammingShipShowsAsFalseTrack: GameTest = {
    name: 'Jamming ship shows as a displaced false track',
    description: 'A drone with its jammer running and its cone on the player is tracked, '
        + 'but the track it produces is offset from where the ship really is.',
    async run(ctx) {
        const drone = ctx.scene.spawnDrone({
            bearingDeg: ctx.player.getDirection(),
            rangePx: RADAR_DEFAULT_RANGE_PX * JAMMER_RANGE_FACTOR,
            emitting: true,
        });
        // Burst before the first sweep completes, so no honest track is ever
        // built to compare against.
        drone.radar.activateJammer();

        const tracked = await ctx.waitUntil(
            () => ctx.player.radar.getTracks().length > 0,
            FRAMES_PER_SWEEP * 6,
        );
        const offset = nearestTrackOffset(ctx, drone);

        ctx.check('jammer is transmitting', drone.radar.jammer.isActive());
        ctx.check('player forms a track', tracked,
            `${ctx.player.radar.getTracks().length} track(s)`);
        ctx.check('no track sits on the real hull', offset >= FAKE_TRACK_MIN_OFFSET_PX,
            `nearest track ${formatOffset(offset)} from the ship (min ${FAKE_TRACK_MIN_OFFSET_PX}px)`);
    },
};

// (g) A missile's seeker is a radar too: once it goes active the ship it is
// homing on gets a lock warning from the missile itself, separate from the
// launching ship's own emissions.
const rwrWarnsOfMissileSeeker: GameTest = {
    name: 'RWR warns of an inbound missile seeker',
    description: 'A VIM-220 fired at a drone brings its onboard radar online at terminal range. '
        + "The drone's RWR picks the seeker up as its own emitter, locked.",
    async run(ctx) {
        const radar = ctx.player.radar;
        const drone = ctx.scene.spawnDrone({
            bearingDeg: ctx.player.getDirection(),
            rangePx: 320,
        });

        // The VIM-220 is a TWS shot: it needs a maintained track, not a lock.
        radar.enterTws();
        const tracked = await ctx.waitUntil(() => radar.getTracks().length > 0, FRAMES_PER_SWEEP * 6);
        ctx.check('player holds a TWS track to shoot on', tracked);

        radar.selectWeapon('VIM-220');
        const loadBefore = radar.getWeaponLoad('VIM-220');
        radar.shoot();
        ctx.check('missile left the rail', radar.getWeaponLoad('VIM-220') < loadBefore,
            `load ${loadBefore} -> ${radar.getWeaponLoad('VIM-220')}`);

        // The seeker comes online by closing range, so this waits out the flight.
        const warned = await ctx.waitUntil(
            () => droneSeesMissileSeeker(drone),
            FRAMES_PER_SWEEP * 15,
        );
        ctx.check('drone RWR shows the seeker as its own emitter', warned,
            `sources: ${drone.radar.rwrReceiver.getRwrSources().join(', ') || 'none'}`);

        // The seeker announces itself before it can do anything about the drone:
        // hearing a radar is one-way, so its search emission carries well past
        // the range it can actually track from. The warning only goes red once
        // the missile has the drone in its own tracking beam.
        // Only the seeker locks here: the player is in TWS, whose illumination
        // registers as a search contact, so a lock warning can only be the missile.
        const locked = await ctx.waitUntil(
            () => drone.radar.rwrReceiver.getRwrSignals().some(signal => signal.isLocked),
            FRAMES_PER_SWEEP * 10,
        );
        ctx.check('the seeker warning goes to a lock as it closes', locked);
    },
};

// (h) Terrain shadows the seeker the same way it shadows the ship radar. A
// VIM-220 flown on a waypoint route — a blind shot needs no track — at a drone
// parked behind a rock: the drone hears the seeker (hearing is one-way and the
// rock stops nothing on that side), but the echo cannot come back through it,
// so no lock ever forms and the missile dies against the rock it was flown
// into. The same blind shot with the rock out of the way locks the same kind
// of hull, so the difference is the terrain, not the missile.
const seekerBlindedByTerrain: GameTest = {
    name: 'Terrain shadows the missile seeker',
    description: 'A waypoint-routed VIM-220 flown at a drone behind a rock: the drone hears the '
        + 'seeker but is never locked by it. The same shot with no rock in the way locks.',
    async run(ctx) {
        const radar = ctx.player.radar;
        const boresight = ctx.player.getDirection();

        const along = (bearingDeg: number, rangePx: number): { x: number; y: number } => {
            const rad = Phaser.Math.DegToRad(bearingDeg);
            return {
                x: ctx.player.x + Math.cos(rad) * rangePx,
                y: ctx.player.y + Math.sin(rad) * rangePx,
            };
        };
        // A full two-point route launches the VIM-220 with no track at all:
        // it flies to WP1, goes active there, and searches down the WP1→WP2
        // leg — which runs straight at the drone.
        const launchBlindRoute = (bearingDeg: number, droneRangePx: number): void => {
            radar.clearVim220Waypoints();
            radar.addVim220Waypoint(along(bearingDeg, 150));
            radar.addVim220Waypoint(along(bearingDeg, droneRangePx + 300));
        };
        const everLocked = async (drone: Target, frames: number): Promise<boolean> => {
            for (let i = 0; i < frames; i++) {
                await ctx.frames(1);
                if (drone.radar.rwrReceiver.getRwrSignals().some(s => s.isLocked)) return true;
            }
            return false;
        };

        // ── A: the rock stands between the seeker and its target ──
        ctx.scene.spawnAsteroid({ bearingDeg: boresight, rangePx: 350, radiusPx: 60 });
        const occluded = ctx.scene.spawnDrone({ bearingDeg: boresight, rangePx: 560 });

        radar.enterTws();
        radar.selectWeapon('VIM-220');
        const loadBefore = radar.getWeaponLoad('VIM-220');
        launchBlindRoute(boresight, 560);
        radar.shoot();
        ctx.check('missile left the rail', radar.getWeaponLoad('VIM-220') === loadBefore - 1,
            `load ${loadBefore} -> ${radar.getWeaponLoad('VIM-220')}`);

        // The seeker announces itself once it goes active at the first waypoint.
        // Hearing is one-way and stops for nothing, so the rock hides nothing
        // on this side: the warning arrives as an ordinary (green) contact.
        const heard = await ctx.waitUntil(
            () => droneSeesMissileSeeker(occluded),
            FRAMES_PER_SWEEP * 12,
        );
        ctx.check('the drone behind the rock hears the seeker', heard,
            `sources: ${occluded.radar.rwrReceiver.getRwrSources().join(', ') || 'none'}`);

        // The echo is another matter: it has to come back through the rock,
        // and the missile finishes against the rock long before the geometry
        // between it and the hull could ever clear. A seeker blind to terrain
        // locks the drone from the far side of the rock in exactly this window.
        const lockedThroughRock = await everLocked(occluded, FRAMES_PER_SWEEP * 10);
        ctx.check('the seeker never locks the hull behind the rock', !lockedThroughRock);

        // ── B: the same blind shot with nothing in the way ──
        // Closer than the occluded hull: at 350px the seeker already has real
        // signal margin (2.4x the floor for a reference hull at WP1) the moment
        // it goes active, so the flight time between activation and lock does
        // not depend on how small the cruiser's bow-on figure is.
        const clear = ctx.scene.spawnDrone({ bearingDeg: boresight + 90, rangePx: 350 });
        const loadB = radar.getWeaponLoad('VIM-220');
        launchBlindRoute(boresight + 90, 350);
        radar.shoot();
        const loadAfterB = radar.getWeaponLoad('VIM-220');
        let clearHeard = false;
        const locked = await ctx.waitUntil(
            () => {
                if (droneSeesMissileSeeker(clear)) clearHeard = true;
                return clear.radar.rwrReceiver.getRwrSignals().some(s => s.isLocked);
            },
            FRAMES_PER_SWEEP * 15,
        );
        ctx.check('the second shot left the rail', loadAfterB === loadB - 1,
            `load ${loadB} -> ${loadAfterB}`);
        ctx.check('the seeker was heard at all', clearHeard,
            `sources: ${clear.radar.rwrReceiver.getRwrSources().join(', ') || 'none'}`);
        ctx.check('without the rock the seeker locks the same kind of hull', locked,
            `sources: ${clear.radar.rwrReceiver.getRwrSources().join(', ') || 'none'}`);
    },
};

function formatOffset(offset: number): string {
    return Number.isFinite(offset) ? `${Math.round(offset)}px` : 'n/a';
}

// A missile seeker keys its RWR contact by its own emitter id (see MissileRadar),
// which is what separates it from the launching ship's search radar.
function droneSeesMissileSeeker(drone: Target): boolean {
    return drone.radar.rwrReceiver.getRwrSources().some(source => source.startsWith('missile-'));
}

// RWR contacts age out after a couple of seconds, so "was it ever warned" has to
// be sampled every frame rather than read at the end of the run.
function watchRwr(ctx: TestContext, drone: Target, onWarned: () => void): () => void {
    const sample = (): void => {
        if (drone.radar.rwrReceiver.getRwrSignals().length > 0) onWarned();
    };
    ctx.scene.events.on(Phaser.Scenes.Events.POST_UPDATE, sample);
    return () => ctx.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, sample);
}

export const radarTests: GameTest[] = [
    rwrWarnsOutsideRadarRange,
    rwrSilentFarOut,
    crossSectionDecidesRange,
    noShotAtAnUndisplayedTrack,
    gasCostsRangeNotSight,
    jammingShipShowsAsFalseTrack,
    rwrWarnsOfMissileSeeker,
    seekerBlindedByTerrain,
];
