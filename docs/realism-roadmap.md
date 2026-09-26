# Realism roadmap

Where the radar simulation can move closer to a real airborne fire-control
radar, topic by topic. Each section states what the code does today, what a
real set does differently, and which module owns the change — per the rule
that structure mirrors hardware, not coding principles.

The topics follow Marshall Bruner's radar series (Reflectivity, Sampling,
Resolution, Radar Equation, SNR, Phased Array, CFAR), with the radartutorial.eu
material by Christian Wolff and MATLAB's radar-principles videos as background.
The learning path that goes with this document is `docs/learning-path.html`.

The energy budget in `radar/data/signalPath.ts` is the foundation all of this
builds on: everything is a signal ratio against a noise floor, and the rated
range is a display setting, not a wall. Nothing below changes that; it adds the
terms the budget is still missing.

---

## 1. Reflectivity (RCS) — `signalPath.ts crossSection()`

**Was.** RCS was the hull's projected width across the line of sight, relative
to `RADAR_REFERENCE_CROSS_SECTION_PX` and clamped to `RADAR_MAX_CROSS_SECTION`.
Deterministic, linear in width, smooth in aspect.

**Done.**

- **Specular glint.** `Radar.nearestHit()` already computed
  `surfaceNormalAt()` for the hit, used only by the ground map. `specularFactor()`
  in `signalPath.ts` now weights the ship hit's crossSection by the incidence
  cosine at the *specific facet struck*, raised to `RADAR_SPECULAR_EXPONENT`
  (2, matching the exponent `TerrainMapper.resolveCell` already shades the
  ground map by) — a flat facet dead-on glints harder than its share of the
  silhouette alone suggests, and the same width can read very differently
  depending on which part of the hull the ray happened to land on. This is
  what makes beaming and stealth shaping physically real rather than a width
  effect.
- **Scintillation.** `Receiver.scintillation()` multiplies a dwell's combined
  signal by a mean-1 random draw before the detection test, once per dwell
  (all of one sweep leg's hits on one target share it) rather than once per
  hit — a slow fluctuation, decorrelating scan to scan rather than frame to
  frame. Uses Swerling III/IV's model (chi-squared, 4 degrees of freedom —
  the mean of two independent Exp(1) draws) rather than Swerling I's own
  single exponential: half the variance, still a standard named fluctuation
  and still real dwell-to-dwell scintillation, but Swerling I's long tail and
  mass near zero cost noticeably more reliability on an already-thin energy
  budget than the extra realism was worth. Retuned `RWR_ONLY_OUTSIDE_RANGE`
  and re-picked `DEFAULT_TEST_SEED` in `testHarness.ts` afterward — both
  scintillation and specular glint add random draws to the same per-frame
  path the detection curve and false alarms already draw from, which shifts
  which specific rolls land where for a fixed seed (see §3's note on the
  same effect).

**Deliberately left out** (not asked for, and each is its own decision):

- **Material factor.** A per-hull `rcsFactor` multiplier would need a hull
  that actually uses a different value to be worth adding — infrastructure
  for a stealth hull that does not exist yet, rather than a realism gap in
  what is already in the game.
- Still tracked in `TO_DO.md`: ~~the missile seeker (`MissileRadar`) does not
  use `returnSignal` at all~~ — **done, see §8**: the seeker now runs the same
  energy budget and measures the hull it is looking at.

## 2. Radar equation — `signalPath.ts returnSignal()/emissionSignal()`

**Was.** `σ · T² · (R0/R)^4`, with the rated range standing in for
`Pt·G²·λ² / noise`. A legitimate normalisation of the real equation, but with
no antenna gain term and no sidelobes.

**Done.**

- **Antenna gain per mode.** `beamGain(beamWidthDeg)` in `signalPath.ts`
  (∝ `ANTENNA_REFERENCE_BEAM_WIDTH_DEG` / beamwidth, normalised to 1 at RWS's
  60°) feeds into `returnSignal` (squared — transmit and receive both cross
  the aperture) and `emissionSignal` (once — only the transmit side is this
  radar's). STT's 6° beam comes out to gain 10, so a lock holds through
  conditions a search sweep would have lost the contact in; the wider dish and
  the missile's 10° seeker were left out of this pass (see below).
- **Sidelobes.** `Radar.illuminateRwr()` now tests ships outside the main beam
  too, at `ANTENNA_SIDELOBE_LEVEL` (0.02, a flat one-lobe simplification) times
  the beam's gain. Rate-limited to once per sweep leg rather than every frame
  it is not gated by the ray actually crossing the hull — `detectionProbability`'s
  floor is `RADAR_PFA`, never exactly zero, so re-rolling it every frame for
  hundreds of frames running turned a rare leak into a near-certainty, the same
  failure mode false alarms are built to have and sidelobes accidentally did
  too before the fix. STT does not roll a sidelobe check at all: it has no
  natural once-per-leg cadence to gate one on, and extending its stare to
  every nearby ship every frame would reintroduce the same problem.

**Also fixed along the way**, because building this exposed a real, pre-existing
gap rather than a new one:

- **Non-coherent integration.** `Receiver.processHits()` used to threshold
  every raw ray hit independently. One sweep-leg pass across one hull
  ordinarily leaves several hits, not one — testing each against the *same*
  nonzero `Pfa` floor independently meant a genuinely faint target could still
  be "detected" by accumulating enough separate rolls, which is a Monte Carlo
  artefact of testing one encounter N times, not a radar seeing further.
  `integrationGroups()` now clusters a dwell's hits (tight radius,
  `RECEIVER_INTEGRATION_RADIUS_PX`) and sums their signal before testing once.
  A genuine partial fix for the still-open dwell/integration item below.
- **`RADAR_PFA` retuned down** (0.05 → 0.008) once the above was in place: Pfa
  is a hard floor on Pd (Pd is monotonic increasing in signal, so it can only
  approach Pfa from above, never go below it), so the old value — picked to
  match the placeholder curve's old knee — left "essentially never detected"
  claims too exposed to that floor over a realistic multi-sweep watch.

**Still open.**

- ~~**Dwell / integration is now partial, not full.** The sum-then-threshold
  fix above is a first pass, not the real thing: proper non-coherent
  integration has a gain closer to √N than N, and a resolution-cell grid
  (roadmap item 4/5) is the honest way to decide which hits belong to the
  same dwell, rather than a fixed pixel radius.~~ **Done — see §13.**
- ~~**Missile seeker and dish aperture** were explicitly left out of the gain
  wiring~~ — the seeker is now on the signal path (§8), with its rated range
  quoted at its own beam width, so it needs no `beamGain` term; the dish
  aperture question does not arise for a fixed 60° search sweep whose rated
  range already embodies that width.

## 3. Signal-to-noise ratio — `signalPath.ts detectionProbability()`, `receiver.ts`

**Was.** `Pd = 1 − 1/SNR`. The receiver never produced a return where nothing
was there: no false alarms.

**Done.**

- **Real detection curve.** `detectionProbability()` is now Swerling I's closed
  form, `Pd = Pfa ^ (1 / (1 + signal))`, with `RADAR_PFA` in
  `radarGameSettings.ts` as the tunable knob — set to keep the curve's knee
  close to where the old placeholder had it (signal ≈ 1-2), so
  `RADAR_REFERENCE_CROSS_SECTION_PX`, the gas attenuation and the rest of the
  budget still mean what they were tuned to mean.
- **Thermal false alarms.** `Radar.updateRws()` rolls a separately-tuned
  `RADAR_FALSE_ALARM_RATE` once per swept ray (not `RADAR_PFA` itself — this
  radar has one ray per frame, not the many cells a real set's `Pfa` assumes,
  so using `Pfa` directly would flare a phantom on almost every sweep leg) and
  drops a phantom return at a random range along the beam's full reach on a
  hit, bypassing the normal signal test since the roll itself *is* the Pfa
  event (`falseAlarmBuffer` in `radar.ts`, kept apart from the real-hit
  `sweepBuffer`). The tracker's `confidence` and `TRACK_MAX_MISSED_SCANS` do
  the rejecting — a phantom is indistinguishable from a real return once it
  reaches the tracking computer, so it ages out exactly the way a stray return
  would. `Radar.displayedTracks()` does **not** gate on confidence yet: the
  existing "fire the instant a track exists" contract (see the missile-seeker
  RWR test) would need loosening first, so a false alarm inside display range
  can in principle be shot at — left as a follow-up, not a bug.
- **Measurement noise that shrinks with SNR.** `measurementJitterPx()` in
  `signalPath.ts` scales a reference jitter (`RADAR_MEASUREMENT_JITTER_REF_PX`,
  capped by `RADAR_MEASUREMENT_JITTER_MAX_PX`) by `1/√(2·signal)`, applied in
  `Receiver.jitteredReturn()` to range and bearing (not raw x/y — a set's
  accuracy is a range error and an angular error) before the point is rebuilt
  for the tracking computer. A strong, close contact is nearly exact; a faint
  one at the edge visibly wanders scan to scan.

Verified against the existing `src/tests/radarTests.ts` suite (two of its
checks had to change: the two "player forms no track" RWR tests asserted
`trackFraction === 0`, which a rare false alarm can now legitimately violate
without the drone itself ever being seen — they now assert no track ever sat
*on the drone* specifically, via the existing `nearestTrackOffset` helper,
which is both the more correct claim and naturally immune to unrelated noise
elsewhere on the picture).

## 4. Sampling — `antenna.ts`, `receiver.ts`, `trackingComputer.ts`

**Was.** One ray per frame, `ANTENNA_SWEEP_STEP_DEG = 1` at 60 fps. Range a
continuous float.

**Done.**

- **Range bins.** `Receiver.jitteredReturn()` now snaps a detected return's
  range and bearing to `RADAR_PULSE_LENGTH_PX` / `RADAR_BEAM_WIDTH_DEG` after
  applying measurement jitter — accuracy first (how far off the true value the
  noisy measurement lands), then resolution (which bin that measurement gets
  reported in), the same order a real receiver does it in. These two
  constants used to be `TERRAIN_*`-prefixed and terrain-only; moved to the
  Antenna section of `radarGameSettings.ts` and shared, since it is the same
  beam and the same pulse regardless of what it is looking at.

**Still open.**

- **Sweep period is the track sample rate.** RWS updates a track once a
  second, TWS at 45° faster. That is Nyquist for manoeuvres: a target turning
  hard between sweeps aliases and the gate loses it. Already emergent; make
  `TRACK_GATE_RADIUS_PX` a function of sweep period × maximum expected
  acceleration so RWS and TWS gate differently, as they should. Left alone
  this pass — it is a track-association question, not a resolution one, and
  didn't need touching to unify ship and terrain resolution.
- **Servo consistency.** Search sweeps at 60°/s while the STT servo slews at
  `ANTENNA_SLEW_RATE_DEG_PER_SEC = 20`. A phased array (§6) is the clean way
  out, and §6 is still open too.

## 5. Resolution — `trackingComputer.ts cluster()`, `radarGameSettings.ts`

**Was.** Ships clustered within an isotropic `TRACK_CLUSTER_RADIUS_PX = 80` at
any range (now removed). Terrain had proper range (`TERRAIN_PULSE_LENGTH_PX`)
and azimuth (`TERRAIN_BEAM_WIDTH_DEG`) resolution. The two paths disagreed
about one radar.

**Done.**

- **Anisotropic resolution cell.** `sameResolutionCell()` in `signalPath.ts`
  replaces the px radius: `|Δrange| < RADAR_PULSE_LENGTH_PX && |Δbearing| <
  RADAR_BEAM_WIDTH_DEG`, range resolution a constant px width, cross-range
  resolution a constant angle (so its px width grows with range).
  `TrackingComputer.cluster()` groups returns by it — two ships in formation
  merge into one contact at long range and split as they close, verified
  directly (30 px apart: one cluster at 800 px, two at 200 px). Ship and
  terrain returns are now quoted against the exact same two constants.
- **Resolution vs accuracy** are now distinct in code: cell size in
  `sameResolutionCell()`, measurement jitter (§3, `measurementJitterPx()`) in
  `receiver.ts` — and jitter is applied *before* binning in
  `jitteredReturn()`, so the two compose in the right order (a noisy
  measurement gets reported at whatever resolution the set can actually
  claim, not the other way round).

## 6. Phased array — `antenna.ts`

**Was.** `Antenna` was purely mechanical: fixed step, servo lag, one beam.

**Done.**

- **`Antenna` (mechanical) and `PhasedArrayAntenna`** behind a shared
  interface (structurally — `PhasedArrayAntenna extends Antenna`, overriding
  only what actually differs). `PhasedArrayAntenna.trackTo` steers
  instantly — no slew-rate lag at all — verified directly: commanding a 90°
  jump snaps a mechanical dish to 0.32° that frame (its real
  `ANTENNA_SLEW_RATE_DEG_PER_SEC` limit) and the array to the full 90°. Gain
  and beamwidth fall as cos θ off the array's own boresight
  (`scanLossFactor()` in `signalPath.ts`, applied everywhere `beamGain()`
  already was), verified at 1 / 0.866 / 0.5 / ~0 for 0° / 30° / 60° / 90° —
  so a lock held at the edge of the gimbal on this antenna is measurably
  weaker, where the same lock on a mechanical dish costs nothing at any
  pointing angle. `Radar`'s constructor takes an optional `antenna` instance
  (default: mechanical), so every one of the three existing construction
  sites (`shipFactory.ts` ×2, `dishRadarStation.ts`) is byte-for-byte
  unchanged — `scanLossFactor(0) = 1`, a true no-op for anything that does
  not opt in.

**Deliberately left unassigned.** Nothing currently constructs a `Radar` with
`PhasedArrayAntenna` — the roadmap's own suggestion ("player gets the dish,
the enemy cruiser or the support station gets the array") is a campaign
design decision (which units feel more dangerous to fight), not a realism
gap in code that already exists, so it was not made unilaterally. Wiring one
in is now a one-line change at whichever ship factory call site the design
wants it: `new Radar({ scene, range, antenna: new PhasedArrayAntenna() })`.

**Still open** (not requested as part of this pass, and each is a real
project on its own):

- **Interleaved modes.** An AESA can search while dwelling on a priority
  track a few frames per sweep — search-while-track. The mode machine
  already separates sweep and stare; interleaving is a scheduler above it.
- ~~**Beam shape instead of a line.** Weight each hit's signal by a main-lobe
  pattern (sinc² or Gaussian in off-axis angle) rather than the current flat
  in-beam/sidelobe split. Edge-of-beam hits weakening smoothly is why
  `trimmedCentroid()` exists as a discrete trim; amplitude-weighted
  centroiding could replace it — a poor man's monopulse.~~ **Done — see §12.**

## 7. CFAR — `systems/modules/cfarDetector.ts`

**Was.** Fixed threshold. No clutter, so CFAR had nothing to do.

**Done.**

- **Clutter + `CfarDetector`.** A ground/volume clutter map, in world-space
  cells (`CLUTTER_CELL_PX`) rather than the ship-return resolution cell — a
  simplification: clutter belongs to a place, not to how far the antenna's
  momentary view of it can resolve. Terrain hits log `CLUTTER_TERRAIN_DENSITY`
  where the ground map is already painting; gas volumes log the weaker
  `CLUTTER_GAS_DENSITY` along their spine every frame (a further
  simplification — logged regardless of the current beam angle, since a real
  set would only log where it has actually looked, but gas is diffuse enough
  that a single ray's worth of gating would not represent it fairly either).
  `noiseFloorMultiplier()` is real cell-averaging CFAR: the mean density
  across a `CFAR_REFERENCE_CELLS` window around a point, excluding the cell
  under test itself (the guard cell, so a target's own return cannot inflate
  its own threshold) — `Receiver.processHits` divides a hit's signal by it
  before the normal Pfa test, mathematically the same move as raising the
  threshold. Verified directly: a realistic rock-sized clutter patch pushes
  the multiplier to 2.5× at its centre, 1.875× at its edge, exactly 1× (no
  effect) somewhere clean — a ship sitting against terrain genuinely needs
  more signal to be pulled out, the textbook masking effect.
- Scoped to the search picture (RWS/TWS) — STT already runs on a boosted,
  narrow-beam signal and stares at one target rather than building a picture
  of the ground around it, so wiring clutter into STT's lock-maintenance
  logic was a separate decision this pass did not make.

**Still open — MTI / Doppler is not this, and does not follow from it.**
CFAR only changes what threshold a return is judged against; it still judges
returns by *amplitude*. Real MTI/Doppler processing rejects clutter by
*radial velocity* instead — a moving ship has a Doppler-shifted return, static
clutter does not, and that is a genuinely different physical quantity
(frequency/phase shift on the carrier) that nothing in this raycasting engine
represents anywhere: there is no carrier, no phase, no per-pulse frequency —
a "hit" is a geometric ray intersection with an instantaneous energy value.
Giving returns a radial-velocity component and a filter that rejects
near-zero-Doppler ones is a real, separate piece of work, not a small
extension of the clutter map above — it is closer in size to another item on
this list than a sub-bullet of this one. (It was eventually done as the
scan-to-scan stand-in — see §9.)

---

## 8. The seeker on the shared signal path — `systems/modules/missileRadar.ts`

**Was.** `MissileRadar` detected by geometry alone: a hard range gate at its
rated range plus a forward cone, with two coin flips layered on (chaff
blocking, gas absorption). No hull geometry, no aspect, no terrain — a cargo
hauler was exactly as easy for a VIM-220 to find as a cruiser, and a target
hiding behind a rock was lockable by a seeker that could not see it from the
ship radar.

**Done.**

- **Energy test.** `returnStrength()` measures the hull through the same
  raycaster the ship radar uses (`Ray` widened to take anything with a Matter
  body, so the seeker needs no entity imports): cross-section by aspect
  (`crossSection(polygon, seekerPos)`) weighted by the specular glint of the
  facet the measuring ray actually lands on, fed to `returnSignal` against the
  seeker's rated range, taxed by gas (`gasTransmission`, counted twice for the
  round trip — the old per-frame absorption coin flip is gone). Candidates are
  pre-gated at the echo horizon (`echoHorizonPx`, newly exported from
  `signalPath.ts`) — past it no hull can return even the floor.
- **Terrain occlusion.** `isShadowed()` casts the seeker-to-hull ray against
  every registered terrain body and zeroes the return when a nearer hit hides
  it — the same rules `Radar.nearestHit` runs: a body the seeker stands inside
  cannot shadow, only a hit *nearer than the return* does.
- **Hard SNR gate, not a detection roll.** The seeker re-tests every frame it
  is live, and `detectionProbability`'s floor (`RADAR_PFA`) never reaches zero
  — a per-frame roll would eventually lock a hull with nothing left of it, the
  exact Monte-Carlo artefact `Receiver.processHits` exists to avoid for the
  sweep pipeline. A set that dwells continuously is honestly modelled as the
  hard gate it is: `MISSILE_SEEKER_MIN_SIGNAL` = 1, the noise floor everything
  is normalised against. Transients ride out on
  `MISSILE_RADAR_MAX_MISSED_LOCK_FRAMES` as before.
- **No `beamGain`.** The seeker's rated range (`ACTIVE_RADAR_RANGE`, 250) is
  quoted at its own beam width, so its envelope means what it always meant and
  no beam-gain term double-counts a concentration that short range already
  embodies.

**Deliberately left out.** No sweep buffer, clustering, CFAR or false alarms —
the seeker has no picture to defend, only a gate. Chaff stays a coin flip (its
elevation is the chaff-as-reflector item, a separate decision). RWR hearing
stays un-occluded by terrain, exactly as the ship radar's `illuminateRwr`
treats terrain — hearing is one-way and both receivers share the rule. No beam
shaping (§6's open beam-pattern item covers the ship radar first).

**Verified.** New suite entry *Terrain shadows the missile seeker*: a
waypoint-routed VIM-220 — a blind shot needs no track — flown at a drone
behind a rock. The drone hears the seeker (one-way hearing stops for nothing)
but is never locked by it, and the missile dies against the rock it was flown
into; the same blind shot with no rock in the way locks the same kind of hull.
The suite's other seeker test (`RWR warns of an inbound missile seeker`)
passes unchanged — the seeker's lock now lands somewhat closer to the target
than the old hard 250px gate allowed, which is the point: the energy budget,
not an envelope, decides.

---

## 9. Radial velocity (scan-to-scan Doppler / MTI) — `trackingComputer.ts`, `cfarDetector.ts`

**Was.** CFAR judged every return by amplitude alone; a contact parked in
clutter was masked exactly like a moving one, and the "minimum detectable
velocity" lived only in the reported course's fitted-slope heuristic
(`reportCourse`), answering nothing about whether the *set* believes the
contact.

**Done — as the honest geometric stand-in, not phase Doppler.** There is no
carrier and no phase anywhere in this raycasting engine, so per-pulse Doppler
does not exist and cannot be bolted on: nothing can measure a frequency
shift. What the engine can measure is the scan-to-scan stand-in — classical
*area MTI*. The tracking computer already fits every track's course and speed
across scans, so the radial rate a contact shows (its fitted velocity
projected on the line of sight) is real measured information, and clutter is
the one thing that has none of it.

- **The gate** (`TrackingComputer.isClutterLike`): a contact sitting in
  significant clutter (`CfarDetector.clutterDensity` ≥
  `MTI_ACTIVATION_DENSITY`) whose fitted radial rate is below the blind speed
  is rejected as clutter itself — the measurement still updates the α-β
  filter (the set keeps watching, so a contact that starts moving can prove
  itself within a couple of scans, the way a real MTI filter is blind for its
  first pulses), but the echo is not accepted as target evidence: confidence
  decays and the missed-scan counter runs, aging a stationary contact out.
- **One threshold, two jobs**: the blind speed *is* the reported course's
  minimum detectable velocity (`TRACK_MIN_COURSE_SPEED_PX`, scaled by range
  exactly as `reportCourse` scales it) — the same number serves the display
  and the MTI filter, the way a real set's MDS does.
- **Scoped to the search picture** (RWS/TWS, like CFAR): STT stares with a
  boosted narrow beam and maintains a lock; there is no picture for a notch
  to protect.

**What it buys, on top of CFAR's amplitude threshold**: a contact parked in
clutter is suppressed — no radial rate, no acceptance, and it never holds a
stable track — while the identical hull under way lifts out of the same
clutter. A contact crossing *tangentially* sits in the notch too: that is a
real MTI's blind speed, not a bug.

**Still open**: the notch is centred on zero *world-frame* radial velocity
(static clutter). A real moving radar must compensate its own platform motion
before the notch means anything; here the radar's own velocity is ignored, so
a fast-moving radar does not smear its clutter map the way a real one's
residue does. Also still open: giving the seeker a notch (its own target is
almost always closing, so it would rarely bite) and a true Doppler spectrum —
which needs the carrier this engine does not have.

**Verified.** New suite entry *MTI: a parked contact in clutter is rejected, a
moving one is not*: two cargo hulls, each beside its own rock — the parked one
never holds a confirmed track (confidence never reaches 0.5, transients decay
under the gate), the same hull moving radially is tracked normally.

---

## 10. Chaff is a reflector, not a dice roll — `radar.ts nearestDecoyEcho`, `receiver.ts`

**Was.** `Receiver.isBlockedByDecoy` was a flat per-cloud coin flip (70%) with
no echo of its own — chaff deleted a return; it never produced one.

**Done.** A chaff cloud is a reflector: `decoySettings.CROSS_SECTION` (3.5×
the reference hull) is fed through the same energy budget as any hull, so the
cloud *paints a contact and forms a track* — the tracking computer cannot
tell it from a hull, which is the whole point of throwing it. The cloud
competes for the beam under the same nearest-wins rule terrain already runs:
nearer than the target, its echo is what the radar sees and the hull behind
it stops being sampled; a nearer ship still masks the cloud. Applied in both
the RWS sweep and the STT beam fan (where the cloud's echo can land inside
the gate and drag the lock — self-screening chaff works close in, escort
chaff creates a decoy contact), and in the missile seeker
(`MissileRadar.isMaskedByDecoy`, deterministic nearest-wins instead of the old
`BLOCK_PROBABILITY` roll). `Receiver.isBlockedByDecoy` is gone.

**Deliberately left out**: chaff as a *seeker target* (a real seeker can lock
the cloud; this seeker only loses its target behind it — making decoys
`GuidanceTarget`s is a separate decision), and any bloom/thinning of the
cloud's RCS over its lifetime (the cloud is constant until it expires, while
its sprite fades).

**Verified.** New suite entry *Chaff returns as its own contact and hides the
hull behind it*: a drone deploying chaff between itself and the radar has its
track dragged off the hull onto the cloud (80px away, never back on the
hull), and the hull behind the cloud stops being sampled entirely.

---

## 11. Jamming is an energy contest — `signalPath.ts jammerSignal`, `radar.ts detectJamming`

**Was.** Deception jamming always succeeded when the geometry allowed it: a
burst within the cone rewrote the sweep at a fixed rolled offset, and STT
frames were swallowed at a flat 0.5 probability — regardless of how loud the
echo was or how close the target was. Burn-through did not exist.

**Done.** The jammer is now an emission in the same units everything else is
measured in: `jammerSignal(range, ratedRange)` = `JAMMER_POWER × (rated/range)²`
— one-way, quoted so `JAMMER_POWER` is the J/S against a *reference hull's
echo at the rated range*, where that echo is exactly 1. The victim's own
echo signal S is the strongest integration group of the sweep's real hits
(`Receiver.dwellSignal` — the same grouping `processHits` tests, so several
distinct contacts or chaff clouds cannot gang up as one overpowering echo).

- **RWS/TWS** (`sweepComplete`): the burst must *win* — J ≥ S — before the
  sweep is rewritten into a false track; a weaker burst loses and the real
  returns process normally. Burn-through falls straight out of the range
  laws: the echo strengthens as the fourth power of closing range while the
  burst only strengthens as the square, so any jammer sized like this one
  rewrites a sweep out at the ring and is powerless against a close or large
  contact. No new tunable: the contest is decided entirely by
  `JAMMER_POWER` and geometry.
- **STT**: the flat `JAMMER_STT_DEGRADE_PROB` becomes the *ceiling*, scaled by
  `min(J/S, 1)` per frame — a lock whose concentrated beam has signal to burn
  shrugs the jammer off; one held far out or on a small hull degrades toward
  the ceiling as it loses the same contest.
- **The victim knows** (`registerJammingStrobes`): a jamming burst is itself a
  loud emission, heard one-way regardless of the contest — a jammer that
  cannot fool the radar is still being heard by it. The victim's RWR records
  the jammer as a strobe (`RwrContact.isJammer`, keyed by the jammer ship's
  own id, registered after `illuminateRwr` so it supersedes that ship's
  search symbol for the burst), rendered as a filled yellow diamond.

**Deliberately left out**: home-on-jam for the ARH missile (the geometry
loop nearly supports it; it needs the jammer to be a `GuidanceTarget` — same
open decision as chaff-as-seeker-target), velocity gating of the jammer's
own noise in the victim (no Doppler, see §9), and deinterleaving multiple
simultaneous jammers (the first affecting jammer wins, as before).

**Verified.** Two new suite entries: *Burn-through* — a broadside cargo hull
at 0.45× range with its jammer running is tracked **on the hull** (the burst
loses J/S); and *strobe* — the victim RWR shows the jammer as a strobe. The
existing spoof test moved out to 0.8× range, where the burst genuinely wins,
and passes with the ghost displaced as before.

---

## 12. The beam has a shape — `signalPath.ts beamPattern`, `radar.ts nearestHit`

**Was.** A hit was in the beam or it was not: full gain inside, a flat
`ANTENNA_SIDELOBE_LEVEL` leak outside, and `TrackingComputer.trimmedCentroid()`
cut the outer fraction of every cluster by angle to control the edge hits
that geometry alone could not price.

**Done.**

- **`beamPattern(offAxisDeg, beamWidthDeg)`**: a Gaussian main lobe
  normalised to 1 on boresight and −3 dB at half the beamwidth (so
  `beamWidthDeg` means the same thing it means in the resolution cell),
  floored at `ANTENNA_SIDELOBE_LEVEL` — a real antenna leaks in every
  direction, so the pattern's floor stands in for the whole lobe structure
  outside the main lobe, the same simplification `illuminateRwr` always
  made, now as the pattern's floor rather than a separate branch.
- **Applied to returns** (`Radar.nearestHit`): a hit's cross-section is
  weighted by the pattern at its own bearing off the beam centre. An STT
  beam is sampled by a fan of rays, so a hull lit by an edge ray returns
  measurably less than one lit dead-centre; a search sweep's pencil ray is
  its own boresight, so its hits sit at pattern ≈ 1 and the sweep picture is
  unchanged.
- **Applied to the RWR path** (`illuminateRwr`): a hull the beam rests on
  hears full gain (the crossing point *is* on the boresight ray); a hull
  wholly off the beam hears the pattern at its own bearing — near the lobe
  nearly full, decaying smoothly to the sidelobe floor — replacing the flat
  binary split while keeping the once-per-leg sidelobe cadence.
- **Amplitude-weighted centroid** (`TrackingComputer.weightedCentroid`):
  each return now carries the effective signal its detection was made on
  (`RadarReturn.signal`), and the cluster centroid is weighted by it — the
  bearing measurement a monopulse comparator forms. The old discrete α-trim
  falls out of the amplitudes continuously: looks near boresight came back
  with more of the beam pattern and they steer the contact; a grazing
  hull-edge look came back faint and barely moves it; a noise spike carries
  exactly the floor it cleared. `TRACK_TRIM_FRACTION` is gone.

**Deliberately left out**: two-way monopulse angle-error extraction (the
difference between two squinted beams) — the weighted centroid is the
estimate, not a ±Δ bearing channel; and a true sinc² pattern with real
sidelobe structure.

**Verified.** The full suite passes against the reweighted pipeline — the
aspect, gas, jamming, MTI and chaff tests all still hold, and the
amplitude-weighted centroid keeps the aspect-decides-range test's
broadside/bow-on separation. The beam pattern also made false alarms respect
the CFAR floor: the thermal false-alarm spawn is now divided by the same
noise-floor multiplier real hits are judged against — clutter residue
suppresses noise spikes exactly as it suppresses weak echoes, instead of
making noise most believable where a real set declares nothing.

---

## 13. Non-coherent integration and the resolution-cell dwell — `receiver.ts`

**Was.** A dwell's hits summed with gain N (each extra look worth a full
hit's signal), and the grouping that decided which hits were one dwell used
a fixed 40px radius next to the tracking computer's anisotropic resolution
cell — two answers to the same radar's question.

**Done.**

- **~√N integration law** (`RADAR_INTEGRATION_GAIN_EXPONENT` = 0.5): the
  group's summed signal is divided by N to that exponent — a real
  square-law detector integrating non-coherently buys roughly √N in
  effective SNR, not N. Each extra look is now worth *part* of a hit rather
  than a whole one, so far and marginal contacts are harder to hold than the
  sum-then-threshold made them.
- **Resolution-cell grouping**: `integrationGroups()` chains hits by
  `sameResolutionCell` — the same anisotropic cell the tracking computer
  clusters returns by — so "which hits are one look at one contact" and "can
  two contacts be told apart" share one physical answer. A hull deeper than
  the pulse length spans several range bins and integrates as several
  groups; the tracking computer's cluster merges the resulting returns
  exactly as it would two contacts it cannot resolve.
- **Adjacent bins are one plot**: the resolution comparison is inclusive —
  returns quantised into *adjacent* bins differ by exactly one resolution
  element, and the binning is the receiver's own reporting grid, not a
  property of the targets, so its boundary must not split what one hull
  produced (a real set's plot extractor groups detected cells that touch
  the same way).
- **Scintillation is one draw per dwell** (per `processHits` call, i.e. per
  scan), shared by every cell the dwell lit — not one draw per cell. The
  fluctuation is the target's aspect toward this scan, not the receiver's
  cell grid; per-cell draws made the *composition* of detected cells wander
  scan to scan, which the tracker reads as centroid motion a stationary
  hull never made.
- **The J/S contest weighs S the same way**: `Receiver.dwellSignal` returns
  the strongest group's effective signal under the same √N law, so the
  jammer competes against what the detector would actually accept.
- **Deception ghosts are jammer-powered** (`createFakeHits`): the spoofed
  look is priced as a reflector of whatever size makes its return read at
  the burst's power at the spoofed range — a deception jammer transmits a
  false echo of its own, and a ghost priced off the hull would be fainter
  than the real contact it replaced.

**Verified.** The full suite holds across the reweighted receiver: the
aspect test still separates broadside from bow-on at 1.3× range (the √N law
costs the broadside hull part of its old sum-N margin and it still tracks
past the ring), the jamming ghost still forms and displaces, and the
pre-existing marginal tests keep their outcomes. The one environmental
caveat unchanged from before: the gas test's frame-supply cadence in
headless runs.

---

## Suggested order

1. ~~**Detection curve + false alarms + SNR-scaled measurement noise** (§3).~~
   **Done.** Small, in `signalPath.ts`/`receiver.ts`; makes the tracker's
   existing machinery earn its keep.
2. ~~**Per-mode beam gain + sidelobe RWR** (§2).~~ **Done.** Turned out to need
   two more fixes underneath it (non-coherent integration, a `RADAR_PFA`
   retune) once the added sidelobe rolls exposed a floor-over-many-looks issue
   already latent in §3's detection curve — see §2's "also fixed" note.
3. ~~**Specular + Swerling RCS** (§1).~~ **Done.** Reused the normal already
   computed; used Swerling III/IV rather than I for the fluctuation, see §1.
4. ~~**Cell-based receiver: range bins + anisotropic resolution** (§4, §5).~~
   **Done.** `RADAR_BEAM_WIDTH_DEG`/`RADAR_PULSE_LENGTH_PX` now live in the
   Antenna section and drive both terrain and `TrackingComputer.cluster()`.
5. ~~**Clutter → CFAR** (§7).~~ **Done**, and it was genuinely the long arc
   this list said it would be. Doppler/MTI followed later anyway (§9) — as
   the scan-to-scan stand-in, not phase processing.
6. ~~**`PhasedArrayAntenna`** (§6).~~ **Done**, and left unassigned to any
   ship — see §6 for why, and the one line it takes to wire in.
7. ~~**The seeker on the shared signal path** (§8).~~ **Done.** Energy budget,
   cross-section by aspect, specular glint, gas, and terrain occlusion all
   reach the VIM-220; a hard SNR gate replaces the old envelope, because the
   seeker re-tests every frame and a probabilistic floor would eventually
   lock anything.
8. ~~**Scan-to-scan Doppler / MTI** (§9).~~ **Done.** Radial rate comes from
   the tracker's own fitted velocity; the notch rejects near-zero-radial-rate
   echoes inside significant clutter while movers lift out.
9. ~~**Chaff as a reflector** (§10) and **the jamming energy contest** (§11).~~
   **Done.** Chaff echoes with its own cross-section and forms false tracks
   under the same nearest-wins rule terrain runs; jamming must win J/S before
   it rewrites anything, burns through close in, and strobes on the victim's
   RWR.
10. ~~**Beam shape + amplitude-weighted centroid** (§12).~~ **Done.** A
    Gaussian main lobe floored at the sidelobe level prices every hit by its
    off-axis angle; the tracking computer's centroid is weighted by the
    amplitudes (poor man's monopulse) and the discrete α-trim is gone.
11. ~~**~√N integration + resolution-cell dwell grouping** (§13).~~ **Done.**
    The group's signal is divided by N^0.5, dwell grouping and contact
    resolution share the one anisotropic cell, scintillation is one draw per
    scan, and the jamming contest weighs S under the same law.

All thirteen items are done. Every one of them is a testable claim in the style
of `src/tests/radarTests.ts` — the suite grew from 7 tests through the
seeker-terrain, MTI, chaff and jamming entries to 12 across this work, plus
direct verification (outside the test harness, in the running game) of
`sameResolutionCell`'s merge/split behaviour, `CfarDetector`'s masking
multiplier, and `PhasedArrayAntenna`'s lag-free tracking and scan loss — each
cited inline in the section it belongs to above. `DEFAULT_TEST_SEED` in
`testHarness.ts` may need re-picking again if a future change adds another
random draw to the per-frame update loop and shifts the sequence enough to
land a borderline test on an unlucky roll (see §3's note on why that is
expected, not a sign
anything broke).
