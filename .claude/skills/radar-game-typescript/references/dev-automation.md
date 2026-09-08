# Driving the game from the preview pane

The Claude preview tab is backgrounded, so `requestAnimationFrame` is throttled
and the game clock stalls; a backgrounded WebGL canvas also refuses to
composite, so `computer{screenshot}` times out. **Verify by reading state, not
by looking.**

## Start a scenario

`window.game` is exposed in DEV (`src/main.ts`).

```js
// free play scenarios
game.scene.getScene('StartMenu').scene.start('Game', { scenario: 'duel' })   // 'duel' | 'occluded' | 'skirmish'
// campaign
game.scene.getScene('StartMenu').scene.start('Level1')
```

After `scene.start(...)`, step a few frames before assets finish — wait for
`scene.settings.status` to go 3 → 5 and `scene.player` to exist.

## Advance the clock

`game.step(t, 16.7)` with `t` persisted across calls (e.g. `window.__t`).

- A synchronous `for` loop of `game.step` is **instant** and is the right tool
  for anything clock-driven (tracking, ageing, occlusion, physics — all keyed
  off `scene.time.now`, which is your `t`).
- Use `setInterval(..., 16)` only when real wall-clock time is required, e.g.
  audio `complete` events fired by the sound manager.
- The 30 s tool limit caps a sync loop at roughly ~1500 steps; heavy scenes
  (Level 1's 360° dome raycast every frame, once airborne) cap nearer ~1000.
  Split long runs across calls.
- Long ageing spans are expensive to observe in full (a dome track drop needs
  4 missed revolutions ≈ 24 s). Watch a proxy instead — e.g. a track's `age`
  freezes while its beam is occluded — over ~2 revolutions.

## What to read

TypeScript-private fields are reachable at runtime.

```js
const s = game.scene.getScene('Game');          // or 'Level1'
s.player, s.targets, s.terrain                   // terrain: [surface, launchpad, rock, dish] in Level1
s.station                                        // Level1 dish radar; s.station.getPosition() is the antenna
s.station.getTracks()                            // the datalink picture
s.player.radar.getTracks(), s.player.radar.getMode()
s.player.radar.terrainMapper.samples
s.player.radar.fireControl
s.player.radar.rwrReceiver, s.player.radar.jammer
game.sound.sounds.filter(x => x.isPlaying)       // audio verification
```

## Player keys (for reproducing a report by hand)

A/D turn · R RWS · E lock STT · ESC exit STT · Q cycle weapon · T chaff ·
J jammer · Space fire · Shift+click VIM-220 waypoint · C (Level 1, once
airborne) datalink bearing call. Throttle is mouse-only (1/3, 2/3, FULL, REV);
from script use `s.player.setCurrentSpeed(v)` — REV is `-landingSettings.REVERSE_SPEED`.

## Things that bite

- **Level 1 takes 60–70 s to load** in the backgrounded tab (audio decode).
  Poll `s.scene.settings.status` (3 → 5) or `s.load.progress`; `s.station`
  and `s.player` exist once it is 5.
- **Speeds are px per step.** Cruise is 0.1, REV 0.04 — a ship covers 16 px in
  400 steps. Start a contact probe a few px short of the surface, not 100.
- **Tweens run slow under `game.step`** (roughly 4–5x their nominal duration).
  Judge a tween by its progress, not by step count.
- **Landing / collision recipe** (Level 1, pad top edge is y = 2300):
  `p.setPosition(1600, 2265); p.setAngle(270); p.setCurrentSpeed(-0.04)` then
  step until `p.getCurrentSpeed() === 0` (landed, ~270 steps). Heading 90 at
  0.033 from the same spot is a nose-first crash (`s.player` gone). A crawl
  north from (1600, 1995) at 0.033 stops against the rock.
