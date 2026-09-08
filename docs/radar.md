# Radar System

The radar is built as a chain of subsystems that mirror the signal path of a
real airborne fire-control radar. Each stage is its own module, so the data
flow reads the same way a real radar processes a return:

```
Antenna sweep ─▶ Emitter ─▶ (world) ─▶ Receiver ─▶ TrackingComputer ─▶ Renderer
                   │                                                        ▲
                   └─ emits RWR warning to other ships' RwrReceiver ────────┘
```

A single `Radar` instance is attached to every ship (`radar.attachTo(ship)`).
The player's radar additionally gets a `RadarRenderer` (injected by the ship
factory); target radars run the exact same tracking pipeline but render
nothing, so they can detect, track and shoot silently.

---

## Modules

### `systems/radar.ts` — `Radar`
The sensor and orchestrator. Holds the current mode, owns the signal-path
subsystem instances, runs the per-frame `update()` and dispatches to
`updateRws()` or `updateStt()`. Also owns STT lock management and the
world-interrogation helpers (`nearestHit`, `illuminateRwr`, `detectJamming`).

Weapons are *not* its job — it delegates firing and missile concerns to
`FireControl`, supplying it the track picture each frame (and per shot). The
weapon-facing methods on `Radar` (`shoot`, `cycleLoadout`, `addVim220Waypoint`,
`clearVim220Waypoints`, `getActiveMissileRange`, `setLoadout`) are thin
forwarders to `FireControl`, kept so callers talk only to the radar.

Key collaborators it constructs/holds: `Antenna`, `Emitter`, `Receiver`,
`TrackingComputer`, `RwrReceiver`, `Jammer`, `FireControl`.

### `systems/fireControl.ts` — `FireControl`
The weapons system. The radar produces tracks; FireControl consumes them to
launch and guide missiles. It holds the weapon inventory (`LoadoutManager`), the
in-flight missiles and their `MissileGuidance`, and the VIM-220 mid-course
datalink (waypoint buffer + fade). It deliberately holds **no** radar/signal-path
state — the radar feeds it a per-frame `GuidanceContext` (STT track, live
entities, decoys) via `update()` and a per-shot `ShootContext` (owner ship, STT
track, tracks) via `shoot()`. The mode→weapon mapping (STT → VIM-177, TWS →
VIM-220) lives here. Also draws the live seeker cones; like the radar renderer,
that runs player-only (the renderer is injected via `setRadarRenderer`).

### `Antenna` (in `radar.ts`)
Models the mechanically/electronically scanned beam. Each frame it advances the
beam one step across the azimuth and reports `{ direction, sweepComplete }`.
`sweepComplete` flips true at each edge of the sweep — that is the cue to hand
the accumulated returns to the tracking computer. Azimuths: **RWS 60°**,
**TWS 45°**, **STT 60° cone** (the gimbal limit; the beam stares rather than
sweeps).

While tracking, `trackTo(commanded, delta)` drives the dish toward a commanded
bearing at `ANTENNA_SLEW_RATE_DEG_PER_SEC` and returns where it *actually*
ended up. The two diverge whenever the target's bearing rate beats the servo —
that lag is what lets a target out-turn a lock.

### `modules/emitter.ts` — `Emitter`
Turns a beam direction into a `Pulse` (a ray, `Phaser.Geom.Line`, plus energy
and angle metadata). Searching casts one ray per frame — the target's extent is
reconstructed later from many single-ray hits accumulated across the sweep.
A staring STT beam has no sweep to accumulate over, so it is sampled by a fan of
rays at `STT_BEAM_RAY_SPACING_DEG` spanning the beam width instead. The emission
is also what *other* ships' RWR can detect.

### `modules/receiver.ts` — `Receiver`
Converts raw ray hit-points into `RadarReturn`s (point, range, angle) and
applies a simplified **radar equation** as a probabilistic detection test:

```
P_detect = 1 − (range / maxRange)^4
```

Distant returns are dropped probabilistically, so contacts flicker more at the
edge of range — as real returns do.

It also owns the two ways a return can be lost on the path rather than at the
target:

- `isBlockedByDecoy()` — a chaff cloud between antenna and target swallows the
  return with a fixed per-cloud probability.
- `isAbsorbedByGas()` — a gas cloud (`entities/gasCloud.ts`) absorbs energy
  along the path instead of blocking it. Beer-Lambert: the surviving fraction
  is `exp(−2 · Σ pathLengthInside · density · ATTENUATION_PER_PX)`, doubled
  because the echo travels back out the same way. Because the penalty scales
  with how much gas is actually crossed, clipping a cloud's edge is cheap and
  looking down the length of a band is hopeless — the counter is to change the
  geometry, not to out-power it. Applied to ship *and* terrain returns, so the
  ground map thins out over gas too.

### `modules/trackingComputer.ts` — `TrackingComputer`
The heart of the simulation. It builds **tracks purely from geometry** — there
are no entity IDs in the return data. Per call (one RWS sweep, or every STT
frame):

1. **Clustering** — chain single-linkage (BFS frontier): a return joins a
   cluster if it is within `CLUSTER_RADIUS` of *any* member. This keeps a wide
   ship body as one contact instead of splitting it.
2. **α-trimmed centroid** — cluster returns are sorted by sweep angle and the
   outer `TRIM_FRACTION` on each end is discarded before averaging. This is the
   *spatial* noise filter: it rejects the unstable polygon-edge hits that
   otherwise make the centroid jump when a target is only partially in the cone.
3. **Association** — each centroid is matched to the nearest existing track
   within `GATE_RADIUS`, where the gate is centred on the track's
   **velocity-predicted** position (not its last position).
4. **α-β filter** — the matched track's position and velocity are smoothed:
   ```
   innovation = measurement − predicted
   pos += ALPHA * innovation
   vel += BETA  * innovation
   ```
   This is the *temporal* noise filter. `ALPHA` trades smoothness against lag.
5. **Aging & cap** — unmatched tracks lose confidence and are dropped after
   `MAX_MISSED_SCANS`. In TWS the track list is capped to the
   `maxTracks` highest-confidence tracks.

> **Units caveat:** `track.speed`/`velX`/`velY` are measured in **pixels per
> scan**, not physics pixels-per-step. Missile guidance must not feed
> `track.speed` into a lead-intercept solver directly (see MissileGuidance).

`createFakeHits()` is the jamming variant of `processHits()`: it displaces every
buffered hit by a *single shared* bearing/range offset before running the same
detection test. The shared offset keeps the spoofed returns clustered, so the
tracking computer forms one coherent **false track** that replaces the real
contact (the genuine returns are discarded). See `Jammer` below.

### `modules/jammer.ts` — `Jammer`
Active radar deception. Owned by every ship's radar (like `RwrReceiver`), though
only the player triggers it (key **J**). A burst runs for `JAMMER_DURATION_MS`,
then sits on cooldown until `JAMMER_COOLDOWN_MS` have elapsed *from activation*.
While active it projects a `JAMMER_CONE_DEG` cone ahead of the ship.

The victim radar drives the effect, not the jammer: each frame `Radar.detectJamming()`
checks every contact and a jammer "takes" if **(a)** the victim's beam actually
paints the jamming ship and **(b)** the victim sits inside that jammer's cone
(`Jammer.covers()`). On a hit:

- **RWS/TWS** — the sweep's hits are routed through `Receiver.createFakeHits()`
  with the jammer's error, producing a ghost track offset from (and replacing)
  the real one. The error is rolled once per activation, so the ghost is stable.
- **STT** — the concentrated beam is *not* spoofed; instead each jammed frame has
  a `JAMMER_STT_DEGRADE_PROB` chance to swallow the return, feeding the existing
  missed-frame lock-break counter. So a jammer can *starve* a lock but not fake it.

All tunables live in `radar/data/radarGameSettings.ts`.

### `modules/terrainMapper.ts` — `TerrainMapper` (+ `renderer/terrainRenderer.ts`)
The ground-mapping half of the radar. Terrain — asteroids and fixed structures
(the surface, the launchpad, the dish station's rock and tower; `Terrain` in
`radar/data/types.ts`) — is **not** trackable: it is passed to `Radar.update`
as a separate `terrain` list, one list for the whole scene that every radar,
the dish station's own included, is occluded by. Each piece is one Matter body
shaped to its sprite (`entities/spriteOutlines.ts`, traced with
`tools/traceOutline.js`), and the raycaster reads that body — so a rock's
dents shadow and echo as drawn. A body the antenna stands inside is skipped
(the ship parked on the pad, the dish inside its own tower); otherwise terrain
and ship returns compete for the beam — the nearer return wins — so terrain
masks ships behind it (and a near ship masks the terrain behind it), but a
terrain hit never enters the receiver/tracking pipeline. Instead the raw hit
point goes to the `TerrainMapper`, which keeps a short phosphor-decay buffer
(`TERRAIN_SAMPLE_TTL_MS`) and hands it to the `TerrainRenderer`: soft stacked
green blobs that blur into a coherent shape as the sweep paints neighbouring
returns, plus a dark radar shadow cast from each return away from the antenna
out to max range. Player-only, like the `RadarRenderer` — AI radars discard
terrain returns (but their beams are still blocked by terrain).

### `modules/rwr.ts` — `RwrReceiver`
Radar Warning Receiver. A passive receiver: when another ship's emission hits
this ship it records an `RwrContact` (bearing, locked?, timestamp). Contacts
age out after `CONTACT_TTL_MS`. The HUD reads these for the threat display.

### `modules/missileGuidance.ts` — `MissileGuidance`
The seeker/autopilot for missiles in flight. Ages missiles once per second and
steers each one per its type. Guidance phases:

- **Boost (age < 2):** hold the launch heading (flies straight off the rail).
- **VIM-177 (SARH):** rides the ship's STT illumination, and has no other
  guidance source — it is steered from the STT *track*, never from the target
  entity. An STT track is refreshed every frame, so its smoothed velocity is in
  the same per-frame units as the missile's speed and the intercept can be led;
  pursuit is the fallback. Lose the lock and the missile flies ballistic.
- **VIM-220 (ARH):**
  1. **Waypoint route** (if the player set one) — fly to WP1, then steer along
     the WP1→WP2 leg.
  2. **Mid-course** — pure pursuit toward its assigned TWS track position
     (pursuit, not lead, because track speed is in scan units).
  3. **Terminal** — once `missileAge ≥ ACTIVE_RADAR_ACTIVATION_TIME` the onboard
     seeker activates, searches its forward cone (range + azimuth basket) and
     locks the nearest unmasked contact it finds. From then on it holds track by
     *geometry*, not identity: it points its gimbal where it estimates the
     target to be and re-detects whatever is inside `MISSILE_SEEKER_BEAM_DEG`
     that frame — so a target that out-turns the gimbal falls out of the beam,
     and another ship that wanders into it gets locked instead.

`interceptVector()` solves the quadratic time-of-flight; `pursue()` is the
fallback that simply points at the target's current position.

### `renderer/radarRenderer.ts` — `RadarRenderer`
Draws the cone, sweep/lock beam, contact boxes, the loadout/range/TTA readout
on the right cone edge, the jammer status readout on the left cone edge, the
jamming cone wedge, and VIM-220 waypoints. **Player-only** — created in the ship
factory and injected via `radar.setRadarRenderer()`. Draws directly to the
scene's shared `Graphics` object, which `main.ts` clears each frame.

### `renderer/interfaceRenderer.ts` — `InterfaceRenderer`
The HUD around the player ship: mode buttons (RWS/TWS/STT/SHOOT), speed
buttons (1/3, 2/3, FULL and REV — slow astern, the landing setting), zoom,
radar-warning text, and the RWR threat diamonds.

---

## Modes

| Mode | Azimuth | Tracks | Beam behaviour | Weapon |
|------|---------|--------|----------------|--------|
| **RWS** (Range While Search) | 60° | unlimited | sweeps | — |
| **TWS** (Track While Scan) | 45° | up to 3 | sweeps | VIM-220 |
| **STT** (Single Target Track) | 60° gimbal limit | 1 (locked) | stares at the track | VIM-177 |

- **RWS ↔ TWS** switch freely and keep their tracks.
- **STT** can be entered from RWS or TWS; it locks the highest-confidence
  track and concentrates the beam on it. Leaving STT re-acquires from scratch.
- STT is a closed loop, and nothing in it reads a target's true position: the
  tracking computer's predicted position commands the antenna, the antenna slews
  toward that command at a finite rate, the beam illuminates whatever is really
  inside it, and those returns correct the prediction.
- A lock is designated off an RWS track that may be a whole sweep old, so the
  beam opens to `STT_ACQUISITION_BEAM_DEG` for a short dwell before collapsing
  to the `STT_BEAM_DEG` tracking beam.
- The lock breaks if the commanded bearing leaves the ±30° gimbal limit, or
  after a sustained loss of return — which a target can cause by masking behind
  terrain, chaff or jamming, *or* by driving its bearing rate past what the
  antenna servo can follow.

---

## Weapons

| Missile | Guidance | Requires | Notes |
|---------|----------|----------|-------|
| **VIM-177** | Semi-Active Radar Homing (SARH) | STT lock | Needs continuous ship illumination; ship must keep the lock. |
| **VIM-220** | Active Radar Homing (ARH) | TWS track | Ship guides it mid-course; its own radar takes over at terminal. Supports mid-course waypoints. |

Tunables live in `src/settings.ts` (`missileSettings`): speed, burn time, and
for the VIM-220 the active-radar activation time, range and azimuth.

---

## Extending

- New mode → add to the `Mode` union, give `Antenna.getAzimuth` a case, and
  branch in `Radar.update`.
- New missile → add an entity class, a guidance branch in
  `MissileGuidance.update`, and a fire path in `FireControl.shoot`.
- Tracking behaviour is tuned entirely by the constants at the top of
  `trackingComputer.ts` (`CLUSTER_RADIUS`, `GATE_RADIUS`, `TRIM_FRACTION`,
  `ALPHA`, `BETA`, `MAX_MISSED_SCANS`).
- Jammer behaviour (duration, cooldown, cone width, error magnitude, STT degrade
  chance) is tuned by the `JAMMER_*` constants in `radar/data/radarGameSettings.ts`.
