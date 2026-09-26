## PHASER JS RADAR

# To Fix

flanking beaming etc RIGHT? -> test!
  (partly done: a hull's cross-section is now measured as the width it presents
  across the line of sight, so beaming a search radar really does shrink the
  range it is seen from — `crossSection` in `radar/data/signalPath.ts`, covered
  by the "Aspect decides how far a hull is seen" test. Still open: the *ships*
  don't know it, so no AI beams deliberately, and nothing on the HUD tells the
  player which aspect they are presenting)


# To Dos

- ADD Clutter -> https://de.wikipedia.org/wiki/Clutter_%28Radar%29
  (done: `systems/modules/cfarDetector.ts`. Ground clutter off terrain and
  volume clutter off gas raise the noise floor in the world-space cells they
  occupy instead of blocking anything, and `Receiver.processHits` folds that
  into the signal budget as a real cell-averaging CFAR test — a contact
  against a rock is genuinely harder to pull out than one against empty
  space, verified directly: 2.5x the signal needed at a rock's centre, 1.875x
  at its edge, no effect somewhere clean. Scoped to RWS/TWS, not STT.
  The MTI follow-on is done too, as the scan-to-scan stand-in (see the
  realism roadmap §9): the tracking computer's fitted radial rate rejects
  near-zero-radial-rate echoes inside significant clutter — a parked hull in
  clutter never holds a stable track while the same hull under way lifts out.
  Phase Doppler remains genuinely out of reach: the engine has no carrier.)
- move visibility material etc and other atributes to group instead of the objects themselves
- gas clouds that reduce radar effectiveness   (done: `entities/gasCloud.ts`.
  Absorption is now a cost in the energy budget rather than a coin flip
  (`gasTransmission` in `data/signalPath.ts`), so gas shortens detection range
  instead of hiding a contact outright, and the missile seeker and the RWR pay
  it too. Still open: the cloud returns no volume clutter of its own, so it
  never paints on the scope — see the clutter item)
- IRST -> exhaust detection -> IR missiles

# RADAR

The signal path lives in `radar/data/signalPath.ts`. The rated range
(`RADAR_DEFAULT_RANGE_PX`, 700) is what the interface draws and the range the
energy budget is quoted at — it is not a wall. The pulse is traced to
`illuminationRangePx()` (~1.7x rated), and what happens out there is decided by
energy: one-way for anything that only has to *hear* the pulse, two-way for
anything that has to echo back.

The ring is still a hard limit on one thing: weapons. The radar may hold a
contact beyond it, but fire control is handed only the picture the scope draws
(`Radar.displayedTracks`), so an undisplayed track cannot be locked, shot at, or
guided onto — for the AI as much as for the player.

- noise                (done, as the thing everything is measured against: a
                        signal ratio of 1 is the receiver's noise floor, and
                        `detectionProbability` fades in above it. A real noise
                        *floor that moves* — clutter — is the item above)
- distance -> exponential falloff   (done: `returnSignal` falls with the fourth
                        power of range, `emissionSignal` with the square)
- target size          (done: measured off the hull polygon, in px of presented
                        width, against `RADAR_REFERENCE_CROSS_SECTION_PX`)
- cross section -> side / front     (done: the same measurement is taken across
                        the line of sight, so aspect falls straight out of it)
- seeker on the shared signal path   (done, see the realism roadmap's §8:
                        `MissileRadar` now detects on the same energy budget as
                        the ship radar — aspect, specular glint, gas, and
                        terrain shadowing all reach the seeker; its detection
                        is a hard SNR gate at the noise floor rather than a
                        probabilistic roll, because it re-tests every frame)
- integration gain + dwell grouping  (done, see the realism roadmap's §13:
                        non-coherent integration now buys ~√N not N, dwell
                        grouping uses the same anisotropic resolution cell as
                        contact resolution, and scintillation is one draw per
                        scan shared by every cell the dwell lit)
- beam shape / monopulse             (done, see the realism roadmap's §12:
                        a Gaussian main lobe floored at the sidelobe level
                        prices every hit by its off-axis angle, the receiver's
                        amplitude rides the return, and the tracking
                        computer's centroid is amplitude-weighted — the poor
                        man's monopulse replacing the discrete α-trim)

# Testing

Tests live in `src/tests/` and run inside the real game (see `src/tests/radarTests.ts`).
A test restarts `TestScene` (an empty `Game`), places drones by bearing/range from
the player, lets the actual loop run for a number of frames, and asserts on what
the radar systems ended up believing. Run them from the start menu's RUN RADAR
TESTS button (DEV only), from `window.runRadarTests()`, or by loading `?tests`.

Under browser automation the tests need frames supplied by hand
(`window.stepGame(n)`) — a backgrounded tab throttles requestAnimationFrame to a
crawl, and a run that falls back on it reports failures that are the frame
supply's fault and not the radar's. Give the suite plenty (~16000 frames for the
current seven tests, the first scene start alone costing a few hundred while
assets load), and read the returned report rather than the on-screen one.

- radar effectiveness tests
  - target size / cross section  (done: aspect decides how far a hull is seen)
  - target distance              (done: covered by the two RWR range tests, which
                                  bracket the return and the emission separately)
  - jamming                      (done: jamming ship shows as a displaced false track)
  - gas / medium                 (done: gas costs the radar range, not sight)
  - weapons stop at the ring     (done: fire control will not shoot at what the
                                  scope does not show)
  - countermeasures (chaff)   (done: chaff is now a reflector, not a coin flip
                            — the cloud echoes with its own cross-section,
                            forms a false track, and hides what is behind it
                            under the same nearest-wins rule terrain runs;
                            see the realism roadmap §10)
  - clutter, once it exists
- RWR
  - warned outside the emitting radar's own range   (done: illumination is now
    traced past the rated range and judged on one-way energy, so a ship at 1.15x
    is warned while returning nothing)
  - silent far outside the sweep                    (done)
  - missile seeker warning                          (done, and it now arrives as
    a search contact first and goes to a lock as the seeker closes)
