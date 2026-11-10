export const missileSettings = {
    "VIM-177": {
        SPEED: .6,
        TURN_SPEED: 0.7,
        BURN_TIME: 14
    },
    // Infrared, short range, fire-and-forget (Fox Two). Fast and agile with a
    // short burn: its seeker, not its motor, is what limits the shot.
    // TURN_SPEED here is a hard turn-rate limit in deg/s on what proportional
    // navigation commands (MissileGuidance.guideInfrared), not the blend
    // factor the radar missiles steer by. 0.65 px/step at 50 deg/s is a turn
    // radius of ~45 px.
    "VIM-90": {
        SPEED: .65,
        TURN_SPEED: 50,
        BURN_TIME: 8,
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