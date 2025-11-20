import { Vector2 } from "./types"

// GAME
export const IMAGE_SCALE = 0.5

// PLAYER SHIP
export const shipSettings = {
    SPEED: 2,
    ROTATION_SPEED: 16,
    SIZE: 0.5,
    DIRECTION: 20,
    START_POSITION: { 
        x: 350, 
        y: 700 
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
    RANGE: 400,
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