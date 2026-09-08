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
}
