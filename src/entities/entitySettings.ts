export const missileSettings = {
    "VIM-177": {
        SPEED: .6,
        TURN_SPEED: 0.7,
        BURN_TIME: 14
    },
    "VIM-220": {
        SPEED: .5,
        TURN_SPEED: 0.8,
        BURN_TIME: 15,
        // The onboard seeker comes online when this close (px) to its target,
        // rather than after a fixed time.
        ACTIVE_RADAR_ACTIVATION_RANGE: 250,
        ACTIVE_RADAR_RANGE: 250,
        ACTIVE_RADAR_AZIMUTH: 30
    }
}