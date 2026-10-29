import { Vector2 } from "./types"

// GAME
export const IMAGE_SCALE = 1
export const CAMERA_ZOOM = .8

// WORLD bounds (matches matter.world.setBounds in main.ts).
export const world = {
    WIDTH: 2500,
    HEIGHT: 2500,
    // How close (px) to an edge a ship may get before AI steers away from it.
    BORDER_MARGIN: 300,
}

// PLAYER SHIP
export const playerShipSettings = {
    SPEED: .1,
    TURN_SPEED: .08,
    DIRECTION: 270,
    START_POSITION: { 
        x: 1600, 
        y: 2385
    },
    LOADOUT: {
        'VIM-177': {
            load: 4,
            active: true
        },
        'VIM-220': {
            load: 2,
            active: false
        },
    }
}

// RADAR
// How far an RWR hears a radar is not a number set here: it falls out of the
// energy in the pulse (see radar/data/signalPath.ts and RWR_NOISE_FLOOR), which
// is why the old RWR_RANGE_MULTIPLICATOR is gone rather than wired up. The
// figure it named — about 1.7x the emitter's rated range — is what the current
// noise floor happens to work out to.
export const radarModule = {
    RANGE: 600,
    SCAN_SPEED: 0.04,
}
export const radarDefaultSettings = {
    range: radarModule.RANGE,
    position: { x: 0, y: 0 } as Vector2,
    isScanning: true,
    azimuth: 20,
    scanSpeed: radarModule.SCAN_SPEED,
}

// VISUAL RANGE — limited eyesight: objects beyond this fade out of sight
// rather than popping. Distinct from (and usually shorter than) radar
// detection range — you can be tracked on radar long before you can be seen.
// Measured to the nearest edge of each object's bounds, not its centre, so
// large scenery doesn't fade out while the player is still over part of it.
export const VISIBILITY_RANGE_PX = 300;
// Width of the fade transition, measured inward from VISIBILITY_RANGE_PX: an
// object is fully transparent at the range and fully opaque once this much
// closer than that.
export const VISIBILITY_FADE_BAND_PX = 100;

// VISUAL IDENTIFICATION — how close the player must get to a contact to
// identify it by eye ("visual"/"tally" in the brevity code): the range at
// which the other ship is drawn fully opaque, so what can be identified is
// exactly what can be seen clearly. Radar never answers the identity question.
export const VID_RANGE_PX = VISIBILITY_RANGE_PX - VISIBILITY_FADE_BAND_PX;

// LANDING — what happens when a hull meets terrain (see physics/landing.ts).
// Above MAX_TOUCHDOWN_SPEED any contact is a crash, whatever was hit. Below
// it an obstacle (rock, tower) merely stops the ship, and ground (pad,
// surface) is a landing only if the ship comes in on its tail: travelling
// astern, within TAIL_CONE_DEG of straight back. REVERSE_SPEED is the
// throttle's one astern setting, kept under the limit so a ship backing in is
// slow enough by construction; the player's 1/3 ahead is under it too, which
// is why a nose-first arrival is the crash, not the speed.
export const landingSettings = {
    MAX_TOUCHDOWN_SPEED: 0.06,
    TAIL_CONE_DEG: 30,
    REVERSE_SPEED: 0.04,
}

// TARGETS
export const targetShipSettings = {
    LOADOUT: {
        'VIM-177': {
            load: 4,
            active: true
        },
        'VIM-220': {
            load: 2,
            active: false
        },
    },
    TURN_RATE_CRUISER: 0.3,  // degrees per frame (at 60fps = 18°/sec)
    TURN_RATE_CARGO: 0.15,   // degrees per frame (at 60fps = 9°/sec)
    // Who makes a cruiser's tactical calls unless a scenario says otherwise:
    // Jev (DEV builds only, via the /api/jev proxy) or the scripted doctrine.
    // Jev is only asked once a fight is on (JevTactician.isFight), so a
    // patrolling cruiser costs no requests. 'scripted' takes every cruiser
    // off the network at once.
    CRUISER_BRAIN: 'jev' as 'scripted' | 'jev',
}


// FORMATION — how a two-ship flight holds station (controller/flight.ts).
// The wing flies a point fixed in the lead's body frame: SPACING_PX off to one
// side, TRAIL_PX behind. Spacing is a compromise between radar and flying. Two
// ships abreast at S px merge into one contact on a nose-on radar only beyond
// ~S / tan(RADAR_BEAM_WIDTH_DEG) = 19 S, so a tight pair reads as one ship
// further out; but a cruiser's turn radius is only speed / turn rate (about
// 19 px at the 0.1 patrol speed), so the lead pivots tightly and its hull
// sweeps through a close wingman's airspace. 80 px leaves a clear gap of
// roughly 50 px between hulls (each is ~28 px across).
export const formationSettings = {
    SPACING_PX: 80,            // lateral offset of the wing from the lead
    TRAIL_PX: 0,               // how far behind the lead the wing sits (0 = line abreast)
    // Inside this distance of its station the wing stops pointing at it and
    // flies the lead's heading, nudged by its lateral error, so it settles
    // instead of circling the point.
    CAPTURE_PX: 40,
    CAPTURE_ANGLE_DEG: 50,     // largest heading correction off the lead's while capturing
    // Throttle follows how far the station is ahead (+) or behind (-) along the
    // lead's heading: factor = 1 + along * GAIN, clamped to the two limits.
    SPEED_GAIN_PER_PX: 0.01,
    MIN_SPEED_FACTOR: 0.4,     // slowest the wing will fly to let a lead that is ahead of station pull back
    CATCHUP_SPEED_FACTOR: 1.5, // fastest it will fly to regain station
    // Closer than this to the lead and the wing abandons its station and
    // breaks away from it, whatever the lead is doing. It is sized to the time
    // the wing needs to turn out of the way (a 90 degree break at the cruiser
    // turn rate is 300 frames, during which a lead swinging toward it closes
    // ~30 px) plus the two hull radii.
    BREAKAWAY_PX: 65,
    // A wing this far over to the side its station is not on takes that side
    // as its station instead of crossing behind the lead (see Flight.guidance).
    // Half the spacing: clear of the lead's own centreline, so the swap is not
    // triggered by the wiggle of holding station.
    SWAP_BEYOND_PX: 40,
    // Look-ahead collision guard (Flight.onCollisionCourse): if holding present
    // headings brings the hulls inside PREDICT_CLEAR_PX within the horizon (a
    // few seconds - the wing's turn is 0.3 deg a frame, so it needs that much
    // warning to open the gap), the wing sidesteps. The clearance sits just
    // above BREAKAWAY_PX and below the 80 px station spacing, so holding
    // station abeam never trips it.
    PREDICT_CLEAR_PX: 70,
    PREDICT_HORIZON_FRAMES: 240,
    PREDICT_RANGE_PX: 300,
    SIDESTEP_DEG: 70,          // how far off the lead's heading the wing leaves its path
    // And not again for this long, so a pair turning through each other's
    // frames cannot swap back and forth.
    SWAP_COOLDOWN_MS: 10000,
}

// TACTICS — how a two-ship flight divides the work on one group of targets
// (controller/flight.ts, decision_tree.md "Flights"). Gameplay, not radar: the
// radar facts these lean on (the RWS half-azimuth, the ring) are cited, not set.
export const tacticSettings = {
    // The doctrine is looked at this often, not every frame, and a new answer
    // must stand for DWELL_MS before the flight acts on it. A radar picture
    // flickers (a track starved for a sweep, a group merging with its neighbour);
    // a flight that re-planned on every flicker would swing its wing from one
    // station to another and back. 500 ms is half a sweep leg; 1500 ms is three
    // looks in a row.
    REVIEW_MS: 500,
    DWELL_MS: 1500,
    // A group that blinks out of the shared picture keeps its place in the sort
    // (and the flight keeps its tactic) for this long. A target near the
    // detection knee drops out for a sweep or two at a time, so the hold is a
    // couple of sweep legs - long enough to bridge that, short enough that a
    // destroyed target frees the pair within seconds.
    PICTURE_HOLD_MS: 1500,
    // The hold once rounds have been fired: a pair that has shot cranks and
    // skates with its noses off the group (the skate alone runs 3-6 s), and
    // that is when its radars lose it. The group is kept for the length of the
    // manoeuvre rather than the length of a blink, so the engagement is not
    // abandoned and restarted between shots.
    ENGAGED_HOLD_MS: 8000,
    // A flight that has fired and then lost the group (the target ran, or the
    // pair skated out of sight) and finds it again within this long is in the
    // same fight: it resumes as the grinder, not as a fresh opener, and the
    // turn at the trigger is where it was left. A minute is longer than any
    // crank-and-skate and shorter than a patrol leg.
    ENGAGEMENT_MEMORY_MS: 60000,

    // Bracket: each member flies along a ray this many degrees either side of
    // the axis from the flight to the group, so the target sees the two
    // 2 x this apart at the end. 60 degrees is well past the 30 degree
    // half-azimuth of an RWS search cone (the widest a target has): the target
    // cannot keep both inside one scan, and while it points at one the other
    // is outside the beam altogether.
    // A flight working a group closes no nearer than this (px) to it: hold
    // station there. Outside the hull radii and the missile seeker's 250 px
    // activation range (a round that misses a group this close has already lit
    // its seeker), inside any shot the flight can take.
    STANDOFF_PX: 200,

    BRACKET_HALF_ANGLE_DEG: 60,
    // How far a member may point off the line of sight to the group while it
    // swings out to its ray. The member's own radar looks along its nose, and a
    // TWS cone is only 22.5 degrees either side, so the split is made just
    // inside that edge: the group stays in the cone while the pair opens out.
    // The angle opens by tan(offset) per e-fold of range closed, which is why a
    // bracket needs room to run (below).
    BRACKET_MAX_LOS_OFFSET_DEG: 22,
    // Steering gain: line-of-sight offset per degree still to open (saturates
    // at the maximum above, falls to zero as the member reaches its ray).
    BRACKET_OFFSET_GAIN: 0.5,
    // A bracket is picked only when the group is at least this far off. A hull
    // is first held around the 700 px ring and the flight needs DWELL_MS to
    // settle on a plan, so a group seen at the edge arrives here with ~600 px
    // to go. Closing at 22 degrees opens the pair by tan(22 deg) = 0.40 rad per
    // e-fold of range, so the 35 degree split below, from 80 px abeam, needs the
    // range to fall by about a factor of 1.8: done around 330 px. A group first
    // held nearer than this has no room left for it, and the flight takes the
    // quiet shot from where it is (shooter/cover).
    BRACKET_ENTRY_PX: 450,
    // The pair is "bracketed" once the target sees them this far apart: past
    // the 30 degree RWS half-azimuth with a few degrees in hand. Nobody shoots
    // from a bracket before this (the point of the geometry is that the target
    // cannot answer both) ...
    BRACKET_SPLIT_DEG: 35,
    // ... unless the group is this close to either of them, when there is no
    // room left to finish the split and the flight shoots from where it is.
    BRACKET_ABANDON_PX: 250,
}
