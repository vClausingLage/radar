import { Vector2 } from "./types"

// GAME
export const IMAGE_SCALE = 1
export const CAMERA_ZOOM = .5

// PLAYER SHIP
export const shipSettings = {
    SPEED: 2,
    ROTATION_SPEED: 16,
    SIZE: 0.5,
    DIRECTION: 270,
    START_POSITION: { 
        x: 2100, 
        y: 2370
    },
    LOADOUT: {
        'AIM-177': {
            load: 4,
            active: true
        },
        'AIM-220': {
            load: 2,
            active: false
        },
    }
}

// RADAR
export const radarModule = {
    RANGE: 450,
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
export const targetSettings = {
    LOADOUT: {
        'AIM-177': {
            load: 2,
            active: true
        },
        'AIM-220': {
            load: 0,
            active: false
        },
    },
    SIZE: 0.5,
}

// MISSILES
export const missileSettings = {
    "AIM-177": {
        SPEED: 7,
        TURN_SPEED: 0.7,
        BURN_TIME: 20
    },
    "AIM-220": {
        SPEED: 6,
        TURN_SPEED: 0.5,
        BURN_TIME: 25
    }
}