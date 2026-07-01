/**
 * Shared radar game settings.
 *
 * Sections are grouped by the module that consumes the values, so tuning a
 * specific behaviour starts near its owning system while still keeping the
 * constants out of implementation files.
 */

// ── Radar core (systems/radar.ts) ───────────────────────────────────────────

// Default ship-radar range in world pixels.
export const RADAR_DEFAULT_RANGE_PX = 700;

// Default sweep width used when an emitter sends a pulse without an explicit
// antenna cone.
export const RADAR_DEFAULT_SWEEP_WIDTH_DEG = 60;

// Physics steps per second (Matter default), used to convert the missiles'
// per-step speed and per-second burn time into a max-range distance (px).
export const PHYSICS_FPS = 60;

// TWS tracks at most this many targets simultaneously.
export const MAX_TWS_TRACKS = 3;

// Narrow STT tracking cone width (deg): wide enough to tolerate inter-frame
// target movement, narrow enough to concentrate illumination energy.
export const STT_BEAM_DEG = 25;

// Frames without a return before STT lock breaks (~0.75 s at 60 fps).
export const STT_LOCK_BREAK_FRAMES = 45;

// How long (ms) the placed VIM-220 waypoints take to fade out once the missile
// carrying them has passed its first waypoint or been destroyed.
export const VIM220_WAYPOINT_FADE_MS = 600;

// Radar equation exponent: detection probability falls off with
// (range / maxRange)^RADAR_DETECTION_RANGE_POWER.
export const RADAR_DETECTION_RANGE_POWER = 4;

// ── Antenna sweep (systems/modules/antenna.ts) ──────────────────────────────

// Degrees the antenna sweep moves per update frame.
export const ANTENNA_SWEEP_STEP_DEG = 1;

// Search-cone width per radar mode. STT uses the RWS cone for display and
// allowed lock offset; the actual STT beam width is STT_BEAM_DEG.
export const ANTENNA_AZIMUTH_DEG_BY_MODE = {
  rws: 60,
  tws: 45,
  stt: 60,
} as const;

// ── Tracking computer (systems/modules/trackingComputer.ts) ────────────────

// Returns within this distance (px) of each other belong to the same contact.
export const TRACK_CLUSTER_RADIUS_PX = 80;

// Gate radius (px) around the predicted track position for association.
export const TRACK_GATE_RADIUS_PX = 200;

// Drop a track after this many consecutive scans with no return.
export const TRACK_MAX_MISSED_SCANS = 4;

// Alpha-trimmed mean: discard this fraction of cluster points from each angular
// end before computing the centroid. Removes unstable polygon-edge hits.
export const TRACK_TRIM_FRACTION = 0.15;

// Alpha-beta filter gains. Alpha smooths position, beta smooths velocity.
// Lower alpha means smoother track with higher lag.
export const TRACK_FILTER_ALPHA = 0.35;
export const TRACK_FILTER_BETA = 0.08;

// ── Missile radar / guidance (systems/modules/*missile*.ts) ────────────────

// How many consecutive decoy-occluded frames an STT missile lock survives
// before it breaks (~0.5 s at 60 fps).
export const MISSILE_RADAR_MAX_MISSED_LOCK_FRAMES = 30;

// Age missiles once per real second regardless of frame rate.
export const MISSILE_AGE_TICK_MS = 1000;

// Throttle active-radar missile debug logging to this interval.
export const MISSILE_DEBUG_LOG_INTERVAL_MS = 500;

// Missile age below this value is the boost phase: hold launch heading off the
// rail before steering.
export const MISSILE_BOOST_PHASE_MAX_AGE = 2;

// A waypoint counts as reached within this distance (px).
export const VIM220_WAYPOINT_REACHED_DISTANCE_PX = 24;

// ── RWR receiver (systems/modules/rwr.ts) ──────────────────────────────────

// How long (ms) to keep a contact alive without a refresh signal.
export const RWR_CONTACT_TTL_MS = 2500;

// ── Jammer (systems/modules/jammer.ts, renderer/radarRenderer.ts) ──────────

// The jammer runs for JAMMER_DURATION_MS, then sits on cooldown until
// JAMMER_COOLDOWN_MS have elapsed from activation. The usable gap between
// bursts is cooldown minus duration.
export const JAMMER_DURATION_MS = 10000;
export const JAMMER_COOLDOWN_MS = 20000;

// Full cone width (deg) projected ahead of the jamming ship. An enemy emitter
// must sit inside this cone and within radar range for returns to be spoofed.
export const JAMMER_CONE_DEG = 20;

// Magnitude of the random bearing/range offset applied to a spoofed return.
// The same offset is reused for every hit in a sweep so the fake returns
// cluster into one coherent false track, and it is re-rolled on each activation.
export const JAMMER_ANGLE_ERROR_MIN_DEG = 8;
export const JAMMER_ANGLE_ERROR_MAX_DEG = 25;
export const JAMMER_DISTANCE_ERROR_MIN_PX = 60;
export const JAMMER_DISTANCE_ERROR_MAX_PX = 180;

// STT concentrates far more energy than the jammer can overcome, so it is not
// spoofed. Instead each jammed frame has this chance to swallow the return,
// feeding the existing missed-frame lock-break counter (STT_LOCK_BREAK_FRAMES).
export const JAMMER_STT_DEGRADE_PROB = 0.5;

// ── Radar world renderer (renderer/radarRenderer.ts) ───────────────────────

// Radius of VIM-220 waypoint markers in world pixels.
export const VIM220_WAYPOINT_MARKER_RADIUS_PX = 5;

// Waypoint markers are pentagons.
export const VIM220_WAYPOINT_MARKER_SIDES = 5;

// Side length for RWS/STT square contact markers.
export const RADAR_CONTACT_MARKER_SIZE_PX = 10;

// Length of the rendered track velocity vector.
export const RADAR_TRACK_VECTOR_LENGTH_PX = 20;

// Number of past track positions retained and drawn as a fading dot trail.
export const RADAR_TRACK_HISTORY_LENGTH = 7;

// Radius of each track-history trail dot.
export const RADAR_TRACK_HISTORY_DOT_RADIUS_PX = 1.5;

// Length of the perpendicular caps on the selected missile max-range indicator.
export const MISSILE_RANGE_CAP_LENGTH_PX = 12;

// ── Radar HUD renderer (renderer/interfaceRenderer.ts) ─────────────────────

// Desired RWR screen image height in fixed-screen HUD pixels.
export const RWR_WIDGET_HEIGHT_PX = 270;

// Margin of the RWR widget from the bottom-left viewport corner, in screen px.
export const RWR_WIDGET_MARGIN_PX = 20;

// Spacing between ship-local radar buttons.
export const RADAR_BUTTON_SPACING_X_PX = 12;
export const RADAR_BUTTON_SPACING_Y_PX = 6;

// Distance from the ship center to the speed-button stack.
export const SPEED_BUTTON_OFFSET_X_PX = 120;

// Vertical offsets for warning text stacked above the ship.
export const RADAR_WARNING_OFFSET_Y_PX = -100;
export const LOCK_WARNING_OFFSET_Y_PX = -140;
export const GO_STT_WARNING_OFFSET_Y_PX = -180;
export const MISSILE_TTA_OFFSET_Y_PX = -220;

// RWR contact marker sizing. The marker radius is relative to the widget size.
export const RWR_MARKER_RADIUS_FACTOR = 0.35;
export const RWR_CONTACT_DIAMOND_SIZE_PX = 8;

// Pulsing red locked-contact flare on the RWR widget.
export const RWR_THREAT_PULSE_TIME_DIVISOR_MS = 120;
export const RWR_THREAT_BASE_RADIUS_PX = 7;
export const RWR_THREAT_FLARE_RADIUS_PX = 7;
export const RWR_THREAT_MIN_ALPHA = 0.45;
export const RWR_THREAT_ALPHA_RANGE = 0.55;
export const RWR_THREAT_SPIKES = 8;

// ── Decoys ───────────────────────────────────────────────────────────────────
export const decoySettings = {
    COUNT: 5,                 // how many the player carries
    RADIUS: 50,               // px — size of the chaff cloud
    LIFETIME_MS: 8000,        // how long a cloud lingers before dissipating
    BLOCK_PROBABILITY: 0.7,   // chance a beam passing through is blocked
}