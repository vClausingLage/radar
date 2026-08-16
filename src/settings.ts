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
export const radarModule = {
    RANGE: 600,
    RWR_RANGE_MULTIPLICATOR: 1.7,
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
