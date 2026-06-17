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
        x: 2000, 
        y: 2300
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

// TARGETS
export const targetShipSettings = {
    LOADOUT: {
        'VIM-177': {
            load: 2,
            active: true
        },
        'VIM-220': {
            load: 0,
            active: false
        },
    },
    TURN_RATE_CRUISER: 0.3,  // degrees per frame (at 60fps = 18°/sec)
    TURN_RATE_CARGO: 0.15,   // degrees per frame (at 60fps = 9°/sec)
}
