import { Vector2 } from "./types"

// GAME
export const IMAGE_SCALE = 1
export const CAMERA_ZOOM = .8

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

// DECOYS (Täuschkörper / chaff)
export const decoySettings = {
    COUNT: 5,                 // how many the player carries
    RADIUS: 70,               // px — size of the chaff cloud
    LIFETIME_MS: 8000,        // how long a cloud lingers before dissipating
    BLOCK_PROBABILITY: 0.5,   // chance a beam passing through is blocked
}

// MISSILES
export const missileSettings = {
    "VIM-177": {
        SPEED: 7,
        TURN_SPEED: 0.7,
        BURN_TIME: 20
    },
    "VIM-220": {
        SPEED: 6,
        TURN_SPEED: 0.5,
        BURN_TIME: 25,
        // The onboard seeker comes online when this close (px) to its target,
        // rather than after a fixed time.
        ACTIVE_RADAR_ACTIVATION_RANGE: 250,
        ACTIVE_RADAR_RANGE: 250,
        ACTIVE_RADAR_AZIMUTH: 30
    }
}
