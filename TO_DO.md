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
  Still open: an MTI/Doppler gate to reject clutter by radial velocity rather
  than amplitude — CFAR only changes the threshold a return is judged by, and
  Doppler is a genuinely different physical quantity (a carrier phase/
  frequency shift) that nothing in this raycasting engine represents anywhere;
  see the realism roadmap's CFAR item for why that is its own undertaking,
  not a small extension of this one.)
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
- still open: a missile seeker has no hull geometry to measure, so it treats
  every target as the reference size (`MissileRadar`) — a cargo hauler is no
  easier for a seeker to find than a cruiser.

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
  - countermeasures (chaff)
  - clutter, once it exists
- RWR
  - warned outside the emitting radar's own range   (done: illumination is now
    traced past the rated range and judged on one-way energy, so a ship at 1.15x
    is warned while returning nothing)
  - silent far outside the sweep                    (done)
  - missile seeker warning                          (done, and it now arrives as
    a search contact first and goes to a lock as the seeker closes)
