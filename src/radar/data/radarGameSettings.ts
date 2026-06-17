/**
 * Exports shared radar settings and constants.
 */

// Frames without a return before STT lock breaks (~0.75 s at 60 fps).
export const STT_LOCK_BREAK_FRAMES = 45;

// TWS tracks at most this many targets simultaneously.
export const MAX_TWS_TRACKS = 3;

// How long (ms) the placed VIM-220 waypoints take to fade out once the missile
// carrying them has passed its first waypoint or been destroyed.
export const VIM220_WAYPOINT_FADE_MS = 600;

// Physics steps per second (Matter default), used to convert the missiles'
// per-step speed and per-second burn time into a max-range distance (px).
export const PHYSICS_FPS = 60;

// ── Jammer (active radar deception) ─────────────────────────────────────────
// The jammer runs for JAMMER_DURATION_MS, then sits on cooldown until
// JAMMER_COOLDOWN_MS have elapsed *from activation* (so the usable gap between
// bursts is COOLDOWN − DURATION).
export const JAMMER_DURATION_MS = 10000;
export const JAMMER_COOLDOWN_MS = 20000;

// Half-angle aside: this is the FULL cone width (deg) projected ahead of the
// jamming ship. An enemy emitter must sit inside this cone (and within radar
// range) for its returns to be spoofed.
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