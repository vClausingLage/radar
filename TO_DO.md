## PHASER JS RADAR

# To Fix

flanking beaming etc RIGHT? -> test!


# To Dos

- ADD Clutter -> https://de.wikipedia.org/wiki/Clutter_%28Radar%29
- move visibility material etc and other atributes to group instead of the objects themselves
- gas clouds that reduce radar effectiveness   (done: `entities/gasCloud.ts`,
  absorbed via `Receiver.isAbsorbedByGas`. Still open: gas is invisible to the
  seeker head — `MissileRadar` and the RWR ignore it — and the cloud returns no
  volume clutter of its own, so it never paints on the scope)
- IRST -> exhaust detection -> IR missiles

# RADAR

- noise
- distance -> exponential falloff
- target size
- cross section -> side / front

# Testing

Tests live in `src/tests/` and run inside the real game (see `src/tests/radarTests.ts`).
A test restarts `TestScene` (an empty `Game`), places drones by bearing/range from
the player, lets the actual loop run for a number of frames, and asserts on what
the radar systems ended up believing. Run them from the start menu's RUN RADAR
TESTS button (DEV only), from `window.runRadarTests()`, or by loading `?tests`.

- radar effectiveness tests
  - target size
  - cross section
  - target distance
  - jamming            (done: jamming ship shows as a displaced false track)
  - countermeasures
- RWR
  - warned outside the emitting radar's own range   FAILING: illumination stops
    at the radar's range, so an RWR only ever hears a radar that can already see
    it. One-way reception should reach further — `RWR_RANGE_MULTIPLICATOR` in
    settings.ts (1.7, currently unused) looks like the intended factor. --> NO USE RADAR ENERGY!!
  - silent far outside the sweep                    (done)
  - missile seeker warning                          (done)
- 
