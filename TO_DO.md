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

- Clutter: no carrier phase yet - Doppler is read off the Matter body, not
  measured from a pulse train. (CFAR, MTI and the Doppler notch are done.)
- move visibility material etc and other atributes to group instead of the objects themselves
- gas clouds: the cloud returns no volume clutter of its own, so it never paints
  on the scope (the absorption half is done, `entities/gasCloud.ts`)
- DRAFT: explanatory layer -> "a struggle of formulas"
  (idea only, not scoped yet. The project is neither a game nor a real
  simulation, so an explanatory, visually appealing layer is a valid path:
  show the numbers behind what happens on the scope, dynamically, as data and
  formulas 'fighting' each other.
  - tracked contact -> how the signal-response formula works, how a track is
    generated, how tracking holds it
  - intercept -> how a missile / radar calculates its intercept path
  - jamming -> jammer vs. radar signal, and burn-through as the two energy
    budgets crossing
  Challenging, but worth it.)

# Performance Profiling

A performance profiling infrastructure has been added to measure system overhead
for IRST and missile guidance systems. The profiler is configured by the
`DEBUG_PERFORMANCE` flag in `src/performance/profiler.ts` and logs metrics to
the console every 60 frames when enabled.

## Usage

```typescript
import { profiler, profileStart, profileStop } from '../performance/profiler';

// Wrap code sections to profile
profileStart('system_name');
// ... code to profile ...
profileStop('system_name');

// Or use the measure helper
const result = measure('expensive_operation', () => myFunction());
```

## Instrumented Systems

- `IRST_update`: Full IRST update cycle (detect, resolve, associate, track)
- `IRST_track`: Tracking mode update
- `IRST_detect`: Detection in field of regard
- `IRST_resolve`: Bearing resolution and merging
- `IRST_associate`: Scan-to-scan association
- `missileGuidance_update`: Missile guidance update loop
- `missileGuidance_age`: Missile aging logic
- `missileGuidance_infrared`: VIM-90 seeker guidance
- `missileGuidance_missileType`: ARH/SARH guidance
- `irSeeker_acquire`: Initial seeker acquisition
- `irSeeker_update`: Seeker update during flight

For more information, see `src/performance/profiler.ts`.

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
current sixty-odd tests, the first scene start alone costing a few hundred while
assets load), and read the returned report rather than the on-screen one.

- radar effectiveness tests
  - clutter (the item above is built now, so this test is open)
