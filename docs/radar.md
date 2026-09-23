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
`TrackingComputer`, `RwrReceiver`, `Jammer`, `FireControl`, `TerrainMapper`,
`CfarDetector`.

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

A narrower beam is not just a narrower cone: `beamGain()` in
`data/signalPath.ts` turns the *width itself* into more signal, normalised to
1 at RWS's 60° (the width the rest of the energy budget is quoted for). STT's
6° beam comes out to a gain of 10 — squared into `returnSignal` (transmit and
receive both cross the same narrow aperture), once into `emissionSignal` (a
listener only catches the transmit side) — which is why a lock holds through
conditions a search sweep would have lost the contact in.

`Antenna` is the mechanical dish: a reflector that physically points wherever
it is tracking, so `scanAngleDeg()` — how far the beam is steered off the
ship's own nose — always reads 0, and it pays nothing in gain for pointing
off-centre within its gimbal limits. `PhasedArrayAntenna` (same file) is the
other kind: `trackTo` snaps to the commanded bearing every frame with no
servo lag at all, but `scanAngleDeg()` reports the real offset, and
`scanLossFactor()` in `data/signalPath.ts` — the classic AESA cosine scan
loss — costs it gain and beamwidth for that offset the mechanical dish never
pays. `Radar`'s constructor takes either behind an optional `antenna` param
(default: mechanical); nothing in the current scenarios constructs the array
yet — it is ready infrastructure for a hull the campaign design has not
assigned, not a gap in a hull that exists.

### `modules/emitter.ts` — `Emitter`
Turns a beam direction into a `Pulse` (a ray, `Phaser.Geom.Line`, plus energy
and angle metadata). Searching casts one ray per frame — the target's extent is
reconstructed later from many single-ray hits accumulated across the sweep.
A staring STT beam has no sweep to accumulate over, so it is sampled by a fan of
rays at `STT_BEAM_RAY_SPACING_DEG` spanning the beam width instead. The emission
is also what *other* ships' RWR can detect.

### `modules/receiver.ts` — `Receiver`
Converts raw ray hit-points into `RadarReturn`s — but not one at a time.
`integrationGroups()` first clusters the raw hits one sweep-leg pass leaves on
one hull (a tight radius, `RECEIVER_INTEGRATION_RADIUS_PX`, well under the
tracking computer's own cluster radius) and sums their signal, then the group
is accepted or dropped once. This matters because `Pfa` never reaches exactly
zero (below): testing several hits from the same encounter independently
would let a genuinely faint target eventually clear the floor just by being
rolled enough times, which is an artefact of the test, not a real detection.

Each group is accepted or dropped on its combined signal strength
(`returnSignal` in `data/signalPath.ts`) against a Neyman-Pearson detection
curve — Swerling I's closed form, `Pd = Pfa ^ (1 / (1 + signal))`
(`detectionProbability`). `Pfa` (`RADAR_PFA`) sets how fast Pd climbs with
signal, and it is a hard floor, not just a knob: Pd is monotonically
increasing in signal, so no return, however faint, can ever score below it —
only approach it as signal goes to zero. That floor is also what makes a
**false alarm** possible: once per swept ray, `Radar.updateRws()` rolls
that same floor probability against an empty cell and, if it hits, drops a
phantom return at a random range along the beam's full reach — unlike a real
echo, receiver noise does not thin out with distance, so a false alarm is
exactly as likely at the far edge as close in. It is deliberately rolled at a
lower, separately-tuned rate (`RADAR_FALSE_ALARM_RATE`) than `Pfa` itself: a
real set spreads `Pfa` across thousands of range-Doppler-azimuth cells, this
one ray per frame, so using `Pfa` directly would flare a phantom on almost
every sweep leg. A false alarm's confidence and lifetime in the tracking
computer are exactly a real return's — nothing marks it as fake — so it fades
the same way a stray return would, off `TRACK_MAX_MISSED_SCANS` and decaying
`confidence`, rather than being filtered out by anything that knows it was
never real.

A detected return's reported position is also not exact: `measurementJitterPx`
adds Gaussian range/bearing noise scaled by `resolution / sqrt(2 · signal)`, so
a strong, close contact is nearly exact and a faint one at the edge of the
picture visibly wanders scan to scan — the accuracy half of detection theory,
distinct from the resolution question of whether two contacts can be told
apart at all (still open — see the realism roadmap).

The hull's own presented cross-section is not fixed either. `nearestHit()`
weights the width-based `crossSection()` measurement by `specularFactor()` —
how square-on the *specific facet struck* faces the beam, not just how much
of the silhouette is turned broadside — and `Receiver.scintillation()` then
multiplies a dwell's combined signal by a mean-1 random draw before the
detection test, so the same hull at the same aspect still returns a
different signal scan to scan. Both make a marginal contact fade in and out
in bursts across several sweeps, closer to how a real return actually
behaves than a single fixed number would.

The receiver also owns the two ways a return can be lost on the path rather
than at the target:

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
   cluster if it falls in the *same resolution cell* as any member
   (`sameResolutionCell()` in `data/signalPath.ts` — `|Δrange| <
   RADAR_PULSE_LENGTH_PX` and `|Δbearing| < RADAR_BEAM_WIDTH_DEG`, the same two
   constants the ground map is quoted against, not an isotropic px radius).
   This keeps a wide ship body as one contact instead of splitting it, and it
   is why two ships in close formation read as one fat contact at long range
   and split into two as they close — cross-range resolution is a fixed
   angle, so the px gap it takes to tell them apart grows with range.
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

### `modules/cfarDetector.ts` — `CfarDetector`
Ground/volume clutter and the adaptive (CFAR) threshold it forces on ship
detection, scoped to RWS/TWS — STT does not use it. Every terrain hit the
ground map paints and every sample along a gas volume's spine also logs a
clutter return into a world-space grid (`CLUTTER_CELL_PX`, deliberately not
the ship-return resolution cell — clutter belongs to a place, not to the
antenna's momentary view of it). `noiseFloorMultiplier(point)` is real
cell-averaging CFAR: the mean density across a `CFAR_REFERENCE_CELLS` window
around a point, excluding the cell under test itself (the guard cell, so a
return cannot inflate its own threshold). `Receiver.processHits` divides a
hit's signal by that multiplier before the usual Pfa test — a target sitting
against a rock or inside a cloud has to clear a floor raised right there, not
the flat one everywhere else, which is what makes clutter *mask* a contact
rather than merely dim it uniformly.

### `modules/rwr.ts` — `RwrReceiver`
Radar Warning Receiver. A passive receiver: when another ship's emission hits
this ship it records an `RwrContact` (bearing, locked?, timestamp). Contacts
age out after `CONTACT_TTL_MS`. The HUD reads these for the threat display.

A contact does not require standing in the exact instantaneous beam:
`Radar.illuminateRwr()` also tests ships off to the side at
`ANTENNA_SIDELOBE_LEVEL` times the beam's gain — real antennas leak in every
direction, just far more weakly — always as a plain (green) search contact,
never a lock, and rate-limited to once per sweep leg rather than every frame
(`detectionProbability`'s floor is never quite zero, so rolling it every frame
for hundreds of frames would turn a rare sidelobe leak into a near-certainty).
STT skips this test entirely: staring has no natural once-per-leg cadence to
gate it on.

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
      seeker activates, searches its forward cone and locks the nearest
      *detectable* contact. The seeker runs the same energy budget as the ship
      radar (see `data/signalPath.ts`): a candidate must return at least the
      noise floor (`MISSILE_SEEKER_MIN_SIGNAL`) — out and back at the fourth
      power of range, scaled by the hull's presented cross-section weighted by
      the specular glint of the facet struck, taxed by gas, and shadowed by
      terrain standing between the seeker and the hull (same occlusion rules as
      the ship radar's beam). Unlike the ship radar there is no probabilistic
      fade-in at the edge: the seeker re-tests every frame, and a per-frame roll
      of a never-zero `Pfa` would eventually lock anything, so a
      continuously-dwelling set is modelled as the hard SNR gate it is. The
      seeker's rated range is quoted at its own beam width — no `beamGain`
      term. From then on it holds track by *geometry*, not identity: it points
      its gimbal where it estimates the target to be and re-detects whatever is
      inside `MISSILE_SEEKER_BEAM_DEG` that frame — so a target that out-turns
      the gimbal falls out of the beam, and another ship that wanders into it
      gets locked instead.

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
- Tracking behaviour is tuned by `GATE_RADIUS`, `TRIM_FRACTION`, `ALPHA`,
  `BETA`, `MAX_MISSED_SCANS` in `trackingComputer.ts`, and by
  `RADAR_BEAM_WIDTH_DEG`/`RADAR_PULSE_LENGTH_PX` (the resolution cell
  `cluster()` groups returns by — shared with the ground map) in
  `radarGameSettings.ts`.
- Jammer behaviour (duration, cooldown, cone width, error magnitude, STT degrade
  chance) is tuned by the `JAMMER_*` constants in `radar/data/radarGameSettings.ts`.
