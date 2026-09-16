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

**Now.** RCS is the hull's projected width across the line of sight, relative
to `RADAR_REFERENCE_CROSS_SECTION_PX` and clamped to `RADAR_MAX_CROSS_SECTION`.
Deterministic, linear in width, smooth in aspect.

**Real.** RCS is how much energy a body scatters *back*, not how big it is.
It is spiky in aspect (flat facets glint at normal incidence), it fluctuates
scan to scan (many scatterers adding with random phase), and it depends on
material.

**Changes.**

- **Specular glint.** `Radar.nearestHit()` already computes
  `surfaceNormalAt()` for the hit and uses it for the ground map only. Weight
  the ship hit by `max(0, normal · −LOS)^k` on top of the width term: a
  broadside hull glints, an angled facet dims. This is what makes beaming and
  stealth shaping physically real rather than a width effect.
- **Scintillation (Swerling I).** Per sweep, multiply σ by an exponentially
  distributed random with mean 1. Edge contacts then fade in bursts, not as
  independent coin flips, and `confidence` and the α-β filter get realistic
  work.
- **Material factor.** A per-hull `rcsFactor` on the ship definition
  (`settings.ts`), read in `nearestHit()`. One multiplier buys a stealthy hull
  for a later campaign level.
- Already tracked in `TO_DO.md`: the missile seeker (`MissileRadar`) treats
  every target as the reference hull.

## 2. Radar equation — `signalPath.ts returnSignal()/emissionSignal()`

**Now.** `σ · T² · (R0/R)^4`, with the rated range standing in for
`Pt·G²·λ² / noise`. A legitimate normalisation of the real equation.

**Missing terms.**

- **Antenna gain per mode.** A 6° STT beam puts roughly ten times the energy
  density on target of a 60° search beam. Add `beamGain(beamWidthDeg)`
  (∝ 1/beamwidth in 2-D) to `returnSignal`. STT then locks further than
  search detects, and the missile's 10° seeker and the dish's wide aperture get
  realistic relative reach for free.
- **Sidelobes.** `illuminateRwr()` only warns a ship whose hull the main-beam
  ray intersects. Real radars leak −20 to −30 dB through sidelobes, so a nearby
  RWR hears you even when the beam points elsewhere. One constant
  (`ANTENNA_SIDELOBE_LEVEL`) and an `emissionSignal × sidelobe` test for ships
  *not* in the beam. This changes EMCON gameplay: a radar that is on is not
  silent to a ship 200 px off its beam.
- **Dwell / integration.** STT samples a fan of rays per frame and RWS
  accumulates a sweep, but each hit is thresholded on its own. Summing the
  hits' signal within a resolution cell before the test (non-coherent
  integration, ~√N gain) is the honest form of "a big hull gets more chances".

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

**Now.** One ray per frame, `ANTENNA_SWEEP_STEP_DEG = 1` at 60 fps. Range is a
continuous float.

**Changes.**

- **Range bins.** Quantise `range` to a `RADAR_RANGE_BIN_PX` — reuse
  `TERRAIN_PULSE_LENGTH_PX`, it is the same pulse — and angle to the beam step.
  Returns become cells, the prerequisite for clutter and CFAR.
- **Sweep period is the track sample rate.** RWS updates a track once a
  second, TWS at 45° faster. That is Nyquist for manoeuvres: a target turning
  hard between sweeps aliases and the gate loses it. Already emergent; make
  `TRACK_GATE_RADIUS_PX` a function of sweep period × maximum expected
  acceleration so RWS and TWS gate differently, as they should.
- **Servo consistency.** Search sweeps at 60°/s while the STT servo slews at
  `ANTENNA_SLEW_RATE_DEG_PER_SEC = 20`. A mechanical dish scans at its slew
  rate: either search should be slower (a 3 s sweep, which also gives TWS a
  reason to exist) or the servo faster. A phased array (§6) is the clean way
  out.

## 5. Resolution — `trackingComputer.ts cluster()`, `radarGameSettings.ts`

**Now.** Ships cluster within an isotropic `TRACK_CLUSTER_RADIUS_PX = 80` at
any range. Terrain has proper range (`TERRAIN_PULSE_LENGTH_PX`) and azimuth
(`TERRAIN_BEAM_WIDTH_DEG`) resolution. The two paths disagree about one radar.

**Changes.**

- **Anisotropic resolution cell.** Range resolution is constant with range;
  cross-range resolution is beamwidth × range and grows with distance. Replace
  the px radius with "same cell": `|Δrange| < pulseLength && |Δbearing| <
  beamwidth`, defined once in `signalPath.ts`. Two ships in formation at 600 px
  merge into one fat contact and split as they close; an escort hugging a
  cruiser is unresolvable until short range.
- **Resolution vs accuracy** become distinct in code: cell size in
  `signalPath.ts`, measurement jitter (§3) in `receiver.ts`.

## 6. Phased array — `antenna.ts`

**Now.** `Antenna` is purely mechanical: fixed step, servo lag, one beam.

**Changes.**

- **`MechanicalAntenna` and `PhasedArrayAntenna`** behind the existing
  interface. AESA steers near-instantly (no `trackTo` lag) but gain falls as
  cos θ and the beam broadens as 1/cos θ off boresight: a lock at the 30°
  gimbal edge is genuinely weaker. Player gets the dish; the enemy cruiser or
  the support station gets the array. A mechanical lock can be out-turned; an
  AESA has to be out-ranged at the edge of its scan.
- **Interleaved modes.** An AESA searches while dwelling on a priority track a
  few frames per sweep — search-while-track, which is what modern TWS is. The
  mode machine already separates sweep and stare; interleaving is a scheduler
  above it.
- **Beam shape instead of a line.** Weight each hit's signal by a main-lobe
  pattern (sinc² or Gaussian in off-axis angle). Edge-of-beam hits weaken —
  that is why `trimmedCentroid()` exists — and amplitude-weighted centroiding
  can replace trimming: a poor man's monopulse.

## 7. CFAR — new detector module beside `receiver.ts`

**Now.** Fixed threshold. No clutter, so CFAR has nothing to do yet. Depends on
the clutter item in `TO_DO.md` and the cell-based receiver (§4, §5).

**Sequence.**

1. **Clutter.** Terrain returns leak a spread of weak echoes around the hit;
   gas volumes return a diffuse floor in the cells they occupy.
2. **Cell grid.** The receiver works on a range × bearing grid per sweep.
3. **`CfarDetector`** (cell-averaging): threshold per cell = α × mean of the N
   neighbouring cells, excluding guard cells. Textbook effects fall out: a ship
   skimming an asteroid is masked because the clutter around it raises its
   threshold; two close ships mask each other; clutter edges throw false
   alarms.
4. **MTI / Doppler** is the module after that, because CFAR alone cannot pull a
   slow target out of clutter — and it gives beaming its real, Doppler meaning
   on top of the RCS one.

---

## Suggested order

1. ~~**Detection curve + false alarms + SNR-scaled measurement noise** (§3).~~
   **Done.** Small, in `signalPath.ts`/`receiver.ts`; makes the tracker's
   existing machinery earn its keep.
2. **Per-mode beam gain + sidelobe RWR** (§2). Two constants, large realism
   gain for STT and EMCON.
3. **Specular + Swerling RCS** (§1). Reuses the normal already computed.
4. **Cell-based receiver: range bins + anisotropic resolution** (§4, §5). The
   structural change the rest depends on; unifies ship and terrain resolution.
5. **Clutter → CFAR → Doppler/MTI** (§7). The long arc; matches `TO_DO.md`.
6. **`PhasedArrayAntenna`** (§6). Independent of the rest; a natural campaign
   upgrade.

Every item is a testable claim in the style of `src/tests/radarTests.ts`
("two drones 40 px apart at 600 px form one track, two tracks at 200 px").
