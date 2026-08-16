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
s.player, s.targets, s.asteroids
s.station                                        // Level1 dish radar (after cold start)
s.player.radar.getTracks(), s.player.radar.getMode()
s.player.radar.terrainMapper.samples
s.player.radar.fireControl
s.player.radar.rwrReceiver, s.player.radar.jammer
game.sound.sounds.filter(x => x.isPlaying)       // audio verification
```

## Player keys (for reproducing a report by hand)

A/D turn · R RWS · E lock STT · ESC exit STT · Q cycle weapon · T chaff ·
J jammer · Space fire · Shift+click VIM-220 waypoint · C (Level 1, once
airborne) datalink bearing call.
