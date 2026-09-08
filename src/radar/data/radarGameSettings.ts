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

// Narrow STT tracking beam width (deg). This is a real angular gate, not a
// display value: only reflectors inside the beam return energy, so a target
// the antenna fails to keep centred simply stops being seen.
export const STT_BEAM_DEG = 6;

// Angular spacing (deg) of the rays that sample a tracking beam. One ray would
// be a pencil of zero width; a fan at fixed spacing gives the beam its actual
// angular extent at whatever width it is currently using, and the several
// returns off a target's hull feed the tracking computer's clustering the same
// way a sweep's worth of RWS hits does. Finer than a ship's angular size at
// max range, so nothing slips between rays.
export const STT_BEAM_RAY_SPACING_DEG = 1.5;

// A lock is designated off an RWS track, whose position can be a whole sweep
// old — far more bearing error than the track beam is wide. So the beam opens
// up for a short acquisition dwell, finds the target for real, and only then
// collapses to STT_BEAM_DEG. Same reason a real set has an acquisition beam
// distinct from its tracking beam.
export const STT_ACQUISITION_BEAM_DEG = 20;
export const STT_ACQUISITION_FRAMES = 30;

// Frames without a return before STT lock breaks (~0.75 s at 60 fps).
export const STT_LOCK_BREAK_FRAMES = 45;

// How long (ms) the placed VIM-220 waypoints take to fade out once the missile
// carrying them has passed its first waypoint or been destroyed.
export const VIM220_WAYPOINT_FADE_MS = 600;

// ── Signal path / energy budget (data/signalPath.ts) ───────────────────────
//
// RADAR_DEFAULT_RANGE_PX above is a *display* setting: how far out the scope
// draws its cone, its range ring and its contacts. It is not a wall the pulse
// stops at. What the radar can actually do is settled by energy instead:
//
//   - The pulse spreads as it travels, so the energy reaching a ship out there
//     falls with the square of the range — one way. That ship only has to hear
//     it to know it is being swept, which is why an RWR warns well beyond the
//     range shown on the emitter's own scope.
//   - A return makes the trip twice and reflects off a hull in between, so it
//     falls with the fourth power of the range and scales with how much hull
//     is presented. That is what decides whether a track forms.
//
// Both are normalised so that 1 is the least signal a radar receiver can still
// make a detection out of — its noise floor. The rated range is *defined* as
// the range where a reference hull in clear space returns exactly that, which
// is why an average contact fades out about at the ring, a big one is still
// there beyond it, and a small one has gone before it.
export const RADAR_TWO_WAY_RANGE_POWER = 4;
export const RADAR_ONE_WAY_RANGE_POWER = 2;

// Noise floor of a passive warning receiver, as a fraction of a radar
// receiver's. An RWR has the easier job — it listens for the transmitter
// itself rather than for a faint echo of it — so it clears its floor further
// out. The free-space warning range that follows is rated / sqrt(0.35), a bit
// under 1.7x rated: being outside a radar's range is no protection from
// knowing it is looking at you.
export const RWR_NOISE_FLOOR = 0.35;

// Hull width (px, measured across the line of sight) the rated range is quoted
// for — a cruiser bow-on. A contact presenting more than this throws back more
// energy and is seen further out; less, and it fades earlier. This is what
// makes aspect matter: a cargo hauler broadside is well over twice the
// reflector it is bow-on, so beaming a search radar is a real tactic and not
// just a display quirk.
export const RADAR_REFERENCE_CROSS_SECTION_PX = 28;

// Ceiling on that ratio, so one absurdly long hull cannot make every pulse
// worth tracing halfway across the world.
export const RADAR_MAX_CROSS_SECTION = 4;

// ── Antenna sweep (systems/modules/antenna.ts) ──────────────────────────────

// Degrees the antenna sweep moves per update frame.
export const ANTENNA_SWEEP_STEP_DEG = 1;

// Maximum rate (deg/s) the antenna servo can slew the beam while tracking in
// STT. A target whose bearing rate exceeds this out-turns the antenna: the
// beam falls behind, the returns stop, and the lock starves.
// Tuned to this world's kinematics: ships make ~0.5 px/step, so a target
// crossing at a few hundred pixels' range turns through roughly 5-15 deg/s of
// bearing. Above this the beam cannot keep station on it.
export const ANTENNA_SLEW_RATE_DEG_PER_SEC = 20;

// Search-cone width per radar mode. For STT this is the antenna's gimbal
// limit — the beam cannot be pointed outside it — and the cone still drawn on
// the HUD; the illuminating beam itself is STT_BEAM_DEG wide.
export const ANTENNA_AZIMUTH_DEG_BY_MODE = {
  rws: 60,
  tws: 45,
  stt: 60,
  // Full-circle search for the fixed early-warning dish (systems/radar.ts 'dome').
  dome: 360,
  // Transmitter off — the antenna never sweeps, so this value is never read.
  emcon: 0,
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

// Course and speed reported on a track are fitted across a window of past track
// positions instead of being read straight off the alpha-beta velocity. A
// single update's velocity carries that update's full centroid wander; a slope
// across the window averages it out. Longer is steadier but slower to show a
// turn.
//
// The window is sized in updates, so each mode needs its own. A search sweep
// advances a cruising contact ~6 px, far above the ~1 px of wander between
// sweeps, and four of them suffice — and four is as many as it can afford,
// since four sweeps is already three and a half seconds of lag behind a turn.
// A single STT frame advances the same contact only 0.1 px against 1-2 px of
// per-frame wander — twenty times more noise than signal — so STT has to
// integrate across a couple of seconds of frames before the motion emerges.
// It can afford to: those two seconds cost the reported course its currency,
// but the alpha-beta filter driving the antenna and the gate is untouched, so
// the lock itself stays as quick as ever.
export const TRACK_COURSE_WINDOW_SCANS = 4;
export const TRACK_STT_COURSE_WINDOW_FRAMES = 120; // shorter: more 'liveliness' on the direction, longer: more stability on the direction update

// Minimum detectable velocity for the search picture, in px per sweep, quoted
// at the reference range below. Between sweeps the centroid of a motionless
// contact still wanders as the beam paints a different part of its hull, while
// a contact at cruise moves ~6 px; anything fitted below this threshold is that
// wander, not motion, so the track reports zero speed and holds its last
// heading instead of swinging one through every point of the compass.
export const TRACK_MIN_COURSE_SPEED_PX = 1.2;

// The same threshold for STT, in px per frame at the reference range. Across the
// 120-frame baseline the fitted slope of a motionless contact stays around
// 0.014 px/frame there, while a ship at cruise makes 0.1, so this sits between
// the two: a locked contact genuinely under way keeps its course, one sitting
// still reports none, and the SARH seeker is never handed wander as a lead
// angle. The cost is the blind zone any real set has — a contact crawling at a
// fifth of cruise is not resolved as moving, and the missile pursues it instead
// of leading it.
export const TRACK_STT_MIN_COURSE_SPEED_PX = 0.02;

// Range the two thresholds above are quoted at, and the exponent the threshold
// grows by with the contact's range. Centroid wander is not a fixed number of
// pixels: the beam's angular width spreads into a wider cross-range cell the
// further out the contact is, and the range-power falloff leaves fewer returns
// per sweep to average, so the wander grows faster than the range does. Both
// modes measure roughly 4x the wander at 573 px that they do at 300 px — close
// to the square of the range ratio — and a threshold that did not grow with it
// would put a moving vector on every distant contact.
export const TRACK_COURSE_RANGE_REF_PX = 300;
export const TRACK_COURSE_RANGE_EXPONENT = 2;

// ── Missile radar / guidance (systems/modules/*missile*.ts) ────────────────

// How many consecutive frames an STT missile lock survives with no return
// (chaff-masked, or the target out-turning the seeker) before it breaks
// (~0.5 s at 60 fps).
export const MISSILE_RADAR_MAX_MISSED_LOCK_FRAMES = 30;

// Seeker beam width (deg) once the missile radar is tracking. Wider than the
// ship's STT beam — a small dish on a missile cannot focus as tightly — but
// still a real gate the target can fall out of.
export const MISSILE_SEEKER_BEAM_DEG = 10;

// Maximum rate (deg/s) the seeker gimbal can slew while tracking. Much faster
// than the ship antenna, but finite: a hard cross-turn at short range can
// still drive the target off the seeker's beam.
export const MISSILE_SEEKER_SLEW_RATE_DEG_PER_SEC = 240;

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

// ── Terrain mapping (systems/modules/terrainMapper.ts) ─────────────────────
// Asteroids are painted like a ground-mapping radar, not tracked: raw beam
// returns persist briefly (phosphor decay) and render as speckled resolution
// cells with a radar shadow cast away from the antenna.

// How long a terrain return stays on screen before fading out entirely.
export const TERRAIN_SAMPLE_TTL_MS = 5000;

// Cap on stored terrain returns (oldest dropped first).
export const TERRAIN_MAX_SAMPLES = 600;

// Azimuth resolution of the mapping picture: the beam is this wide, so one
// echo smears across this much bearing (wider in px the further out it is)
// and the shadow behind a return is at least this wide. With the antenna
// stepping ANTENNA_SWEEP_STEP_DEG per frame, neighbouring returns overlap
// into a continuous band instead of a chain of dots.
export const TERRAIN_BEAM_WIDTH_DEG = 3;

// Range resolution: a pulse of finite length keeps echoing after its leading
// edge has hit, so every return is drawn stretched at least this far behind
// the surface.
export const TERRAIN_PULSE_LENGTH_PX = 10;

// Bloom: a surface facing the antenna square-on echoes far harder than one
// caught at a grazing angle, and a strong echo saturates the receiver so the
// scope video stays lit past the true range extent - the paint smears deeper
// into the shadow. Extra depth (px) behind a surface at normal incidence;
// it falls off with the cosine of the incidence angle towards the limbs.
export const TERRAIN_BLOOM_DEPTH_PX = 30;

// How unevenly that bloom wanders along the surface (0 = uniform, 1 = wildly
// lumpy). Modelled as a slow random walk from one return to the next, so the
// depth of the paint varies organically rather than tracing the hull shape.
export const TERRAIN_BLOOM_ROUGHNESS = 0.5;

// Speckle: the echo of a rough surface is the sum of many scatterers with
// random phase, so a cell lights up as grainy dashes of random brightness
// with gaps rather than a solid patch. Dashes per pulse length of depth (a
// deeper, bloomed return gets proportionally more), the longest dash (px,
// tangential to the beam), and the fraction of scatterers too faint to
// register at all.
export const TERRAIN_SPECKLES_PER_PULSE_LENGTH = 8;
export const TERRAIN_SPECKLE_LENGTH_PX = 5;
export const TERRAIN_SPECKLE_DROPOUT_PROB = 0.25;

// Radar shadow behind the mapped surface. Returns are binned by bearing from
// the antenna and each bin is filled once, from its nearest return out to the
// display range, so the shadow is one flat tone whatever the distance.
export const TERRAIN_SHADOW_BIN_DEG = 1;
export const TERRAIN_SHADOW_ALPHA = 0.45;

// ── Support dish radar (entities/dishRadarStation.ts) ──────────────────────
// A stationary early-warning dish on an asteroid: it drives the standard Radar
// in 'dome' mode (full 360° cover) at long range, and datalinks its tracks to
// the player (contacts drawn cyan, bearing available on request over comms).

// Detection range (px) of the support dish radar.
export const SURVEILLANCE_RANGE_PX = 2000;

// Colour of the shared datalink picture (contacts + coverage ring + sweep line),
// distinct from the player radar's own green returns.
export const DATALINK_COLOR = 0x00aeef;

// ── Decoys ───────────────────────────────────────────────────────────────────
export const decoySettings = {
    COUNT: 5,                 // how many the player carries
    RADIUS: 50,               // px — size of the chaff cloud
    LIFETIME_MS: 8000,        // how long a cloud lingers before dissipating
    BLOCK_PROBABILITY: 0.7,   // chance a beam passing through is blocked
}

// ── Gas clouds (entities/gasCloud.ts, data/signalPath.ts) ────────────────────
// A gas cloud is an absorbing medium, not an obstacle: it has no collision body
// and never blocks a beam outright. It is a cost in the radar's energy budget —
// energy crossing it is lost exponentially with the distance travelled inside
// (Beer-Lambert), and the loss counts twice for a return because the echo has to
// come back out again. So a cloud does not hide a contact, it shortens the range
// at which the contact can be found: with enough signal left over — a close
// target, a big one, or a narrow beam's worth of concentration — the radar still
// sees straight through it, and it is only out at the edge of the budget that the
// contact flickers and then goes. The same absorption dims a warning receiver's
// view of the emitter, but only once, since nothing is coming back.
//
// Geometrically a cloud is a capsule: everything within RADIUS px of the spine
// running from its start point to its end point. That capsule is the single
// source of truth — the visual puffs are laid out along it, and the signal path
// measures its length against it.
export const gasCloudSettings = {
    RADIUS: 140,                // px — half-width of the capsule around the spine
    DENSITY: 0.8,               // 0..1 — how absorbing the medium is
    SPREAD_MS: 20000,           // time for the cloud to grow from its start point to its end point (0 = fully formed at spawn)
    // One-way optical depth added per px of path through density 1.0. Tuned so
    // the gas is a serious obstruction rather than merely annoying. A beam
    // crossing a default cloud through its middle (280 px at density 0.8) keeps
    // exp(-280 x 0.8 x 0.008) ≈ 17 % of its energy one way, and 3 % of it over
    // the round trip: against a fourth-power range law that pulls a 700 px radar
    // in to roughly 290 px through the core, and its RWR warning range in to
    // about 480 px. Clipping the edge is survivable (80 px of path still leaves
    // ~540 px of detection), and looking down the length of a long band is
    // hopeless, which is the whole point: the penalty is geometric, so the
    // counter is to change the geometry — or to close the range.
    ATTENUATION_PER_PX: 0.008,
    PATH_SAMPLE_PX: 8,          // step at which the signal path samples a beam to measure the distance inside a cloud

    // ── Appearance ──
    //
    // Two layers, because "thick" and "glowing" are different jobs and one
    // blend mode cannot do both. The BODY layer is NORMAL-blended and actually
    // occludes the starfield and the ships behind it, which is what makes the
    // cloud read as matter rather than as a light effect. The GLOW layer is a
    // sparser SCREEN pass laid on top for the luminous nebula edge — kept thin
    // on purpose, since SCREEN drives every channel towards white and too much
    // of it bleaches the core instead of colouring it.
    DEPTH: 5,                   // drawn over ships and radar marks (which sit at depth 0)
    COLOR: 0x6fe3b0,            // tint of every puff
    PUFF_TEXTURE_PX: 128,       // size of the generated soft radial-falloff sprite
    PUFF_SLICE_FACTOR: 0.30,    // spacing of puff slices along the spine, as a fraction of RADIUS
    MIN_SLICES: 6,              // floor, so a short cloud is still a cloud and not a few blobs
    MAX_PUFFS: 700,             // draw-call ceiling for a very long cloud (one texture, so they batch)

    BODY_PUFFS_PER_SLICE: 6,    // the mass; overlap is what reads as volume
    BODY_ALPHA: { min: 0.16, max: 0.34 },
    BODY_SIZE_FACTOR: { min: 0.8, max: 1.35 },  // puff diameter as a fraction of RADIUS

    GLOW_PUFFS_PER_SLICE: 2,    // the sheen on top of the mass
    GLOW_ALPHA: { min: 0.07, max: 0.16 },
    GLOW_SIZE_FACTOR: { min: 1.2, max: 1.9 },   // wider than the body, so it haloes the edge

    PUFF_LATERAL_SPREAD: 0.75,  // how far off the spine a puff may sit, as a fraction of RADIUS
    SWIRL_PX: 14,               // amplitude of the slow per-puff drift
    SWIRL_SPEED: { min: 0.00006, max: 0.00022 },  // rad/ms — desynchronised so the gas churns
    EDGE_FADE: 0.12,            // fraction of the spread over which a newly reached puff fades in
};
