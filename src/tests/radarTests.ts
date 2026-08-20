import Phaser from 'phaser';
import { GameTest, TestContext } from './testHarness';
import { RADAR_DEFAULT_RANGE_PX } from '../radar/data/radarGameSettings';
import { Target } from '../entities/ship';

// In-game tests for the player radar's signal path: who gets warned by an
// emission, who shows up as a track, and what a jammer does to that track.
//
// Every test states its geometry as a range from the player, expressed as a
// fraction of the radar's own range, because that ratio is what the radar
// equation (and therefore every expectation here) is written in terms of.

// A 60-degree RWS cone stepped 1 degree per frame: one sweep leg per 60 frames.
const FRAMES_PER_SWEEP = 60;

// Ranges as a multiple of the radar's own range (RADAR_DEFAULT_RANGE_PX).
// Past its range the radar has no chance of a return, but its emission is still
// out there: an RWR only has to hear the pulse, not send an echo back.
const OUTSIDE_RADAR_RANGE = 1.15;
// Far enough out that even one-way there is nothing left to receive.
const BEYOND_RWR_RANGE = 2.0;
// Close enough that returns come back reliably, so a missing/displaced track
// can only be the jamming.
const JAMMER_RANGE_FACTOR = 0.45;

// A jammed sweep is displaced by at least JAMMER_DISTANCE_ERROR_MIN_PX (60) in
// range, so anything nearer than this to the real hull is a genuine return, not
// the spoof.
const FAKE_TRACK_MIN_OFFSET_PX = 50;

// Sample the player's track picture once per frame for `frames` frames, and
// report how much of that time it held any track at all — the measure of
// whether the radar can hold a contact, rather than whether it ever caught one.
async function measureTrackPresence(ctx: TestContext, frames: number): Promise<number> {
    let framesWithTrack = 0;
    for (let i = 0; i < frames; i++) {
        await ctx.frames(1);
        if (ctx.player.radar.getTracks().length > 0) framesWithTrack++;
    }
    return framesWithTrack / frames;
}

// Closest approach of any of the player's tracks to where the drone really is.
// Infinity when the radar holds no track at all.
function nearestTrackOffset(ctx: TestContext, drone: Target): number {
    return ctx.player.radar.getTracks().reduce(
        (best, track) => Math.min(best, Phaser.Math.Distance.Between(track.pos.x, track.pos.y, drone.x, drone.y)),
        Infinity,
    );
}

// (a) One-way beats two-way: an emission only has to reach the target, while a
// return has to survive the trip out *and* back. So the range at which a ship
// can be warned that it is being swept is longer than the range at which the
// sweeping radar can see it — being outside a radar's range is no protection
// from knowing it is looking.
const rwrWarnsOutsideRadarRange: GameTest = {
    name: "RWR warns outside the radar's own range",
    description: `A drone at ${OUTSIDE_RADAR_RANGE}x the player's radar range is too far out for the player `
        + 'to form any track on it, but its RWR still hears the sweep.',
    async run(ctx) {
        const rangePx = RADAR_DEFAULT_RANGE_PX * OUTSIDE_RADAR_RANGE;
        const drone = ctx.scene.spawnDrone({
            bearingDeg: ctx.player.getDirection(),
            rangePx,
        });

        let everWarned = false;
        const stopWatching = watchRwr(ctx, drone, () => { everWarned = true; });
        const trackFraction = await measureTrackPresence(ctx, FRAMES_PER_SWEEP * 6);
        stopWatching();

        ctx.check('player forms no track on it', trackFraction === 0,
            `track held for ${(trackFraction * 100).toFixed(0)}% of the run`);
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
        const trackFraction = await measureTrackPresence(ctx, FRAMES_PER_SWEEP * 4);
        stopWatching();

        ctx.check('drone RWR stays silent', !everWarned,
            `range ${Math.round(rangePx)}px, radar range ${RADAR_DEFAULT_RANGE_PX}px`);
        ctx.check('player forms no track', trackFraction === 0,
            `track held for ${(trackFraction * 100).toFixed(0)}% of the run`);
    },
};

// (c) A jamming ship inside the beam rewrites the whole sweep into one coherent
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
            `nearest track ${Number.isFinite(offset) ? `${Math.round(offset)}px` : 'n/a'} `
            + `from the ship (min ${FAKE_TRACK_MIN_OFFSET_PX}px)`);
    },
};

// (d) A missile's seeker is a radar too: once it goes active the ship it is
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
        radar.shoot(ctx.player.getDirection());
        ctx.check('missile left the rail', radar.getWeaponLoad('VIM-220') < loadBefore,
            `load ${loadBefore} -> ${radar.getWeaponLoad('VIM-220')}`);

        // The seeker comes online by closing range, so this waits out the flight.
        const warned = await ctx.waitUntil(
            () => droneSeesMissileSeeker(drone),
            FRAMES_PER_SWEEP * 15,
        );
        ctx.check('drone RWR shows the seeker as its own emitter', warned,
            `sources: ${drone.radar.rwrReceiver.getRwrSources().join(', ') || 'none'}`);
        // Only the seeker locks here: the player is in TWS, whose illumination
        // registers as a search contact, so a lock warning can only be the missile.
        ctx.check('the seeker contact is a lock warning',
            drone.radar.rwrReceiver.getRwrSignals().some(signal => signal.isLocked));
    },
};

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
    jammingShipShowsAsFalseTrack,
    rwrWarnsOfMissileSeeker,
];
