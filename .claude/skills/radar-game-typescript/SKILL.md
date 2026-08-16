---
name: radar-game-typescript
description: Use when working in this Phaser/TypeScript radar game repo — radar modes (RWS/TWS/STT/dome), tracking, missile guidance and fire control, RWR, jammer, chaff, terrain mapping, ships/asteroids/factories, AI unit behaviour, scenes and campaign levels, HUD and radar rendering, audio callouts, or refactors, builds and verification of any of these.
---

# Radar Game (Phaser 3 + TypeScript)

A space-set simulation of an airborne radar. The player flies a ship; the core
gameplay is a **high-fidelity radar, tracking and missile-control simulation**.
The user's stated goals for the project are learning software architecture,
radar technology and game-dev fundamentals — explain the radar reasoning behind
a change, not just the code.

## The one rule that overrides the others

**Structure mirrors real radar hardware, not textbook coding principles.**
When adding something, first ask *which real subsystem owns this?* — weapons go
to `fireControl.ts`, ground mapping to `terrainMapper.ts`, emission warning to
`rwr.ts`. Never create catch-all `helpers/`, `utils/` or `gameLogic` modules;
they rot into junk drawers. Classes stay sleek and readable — realism justifies
an extra module, never a bloated one.

Corollary: **the Matter body is the single source of truth for geometry.**
`Ray.getBodyPolygons()` reads `body.vertices`; never introduce a parallel
collision/detection shape next to it.

## Map

```
src/main.ts              Phaser config, scene list, matter debug, DEV window.game hook
src/scenes/game.ts       Base scene: world, factories, player, camera, colliders,
                         per-frame radar update loop, cold-start procedure. Levels
                         SUBCLASS it and override buildTerrain() / buildScenario() /
                         briefingMessage() / requiresColdStart()
src/scenes/level1.ts     Campaign Level 1: cold start (surface/launchpad) then
                         friendly dish radar + datalink, C = bearing call
src/scenes/startMenu.ts  Menu, ScenarioKey ('duel' | 'occluded' | 'skirmish')
src/controller/          playerController.ts (key bindings), aiUnitController.ts (intent)
src/entities/            Ship/PlayerShip/Target, missiles, asteroid, decoy, exhaust,
                         dishRadarStation + *Factory.ts registering scene.add.* factories
src/radar/systems/radar.ts        The centre. Owns mode state, sweep, STT lock, delegates
src/radar/systems/fireControl.ts  Weapons: launch, guidance ticks, waypoints, seeker cones
src/radar/systems/modules/        Signal path: antenna → emitter → receiver → trackingComputer
                                  plus rwr, jammer, missileRadar, missileGuidance,
                                  terrainMapper, loadoutManager
src/radar/data/                   track.ts, radarReturn.ts, types.ts (Entity, RadarHost, Mode),
                                  radarGameSettings.ts (all radar constants)
src/radar/renderer/               radarRenderer (scope marks), interfaceRenderer (HUD),
                                  terrainRenderer (ground map)
src/physics/                      ray.ts (raycast against Matter vertices), collisionRegistrar
src/math/, src/types/             Maths helpers, shared Vector2
src/settings.ts                   Non-radar gameplay constants (world, ship, camera, loadouts)
src/audio/                        audioPlayer, radarVoice (BRA callouts), startup, supportRadarComms
public/                           Sprites; audio in public/audio
docs/                             radar.md, player.md, GCI.md, gci-comms.md
TO_DO.md, decision_tree.md, cowork.md   Roadmap, AI behaviour spec, design intent
```

## Signal path — how a detection actually happens

`Radar.update()` runs per ship per frame, from `Game.update()`:

1. `Antenna.update(mode, shipDirection)` advances the beam and reports
   `sweepComplete`. Azimuth is per-mode (RWS 60°, TWS 45°, STT `STT_BEAM_DEG`,
   dome 360°).
2. `Emitter.sendPulse()` produces the pulse line for this frame.
3. Raycast: `nearestHit()` for ships and separately for terrain. **The nearer
   return wins** — terrain shadows ships and is handed to `TerrainMapper`;
   a nearer ship return masks terrain behind it.
4. Interference: chaff (`Receiver.isBlockedByDecoy`) can swallow a return; an
   enemy `Jammer` covering us rewrites the whole sweep into a coherent false
   track at `sweepComplete` (`Receiver.createFakeHits`).
5. `Receiver.processHits()` applies the range falloff
   (`RADAR_DETECTION_RANGE_POWER`) and yields returns.
6. `TrackingComputer.update(returns, ownerPos, maxMissedScans, maxTracks)`
   forms/ages tracks. RWS is uncapped; TWS caps at `MAX_TWS_TRACKS`.
7. Anything the beam touches gets an RWR contact via `illuminateRwr()` —
   green for search, red + lock event for STT.
8. Renderers draw; `FireControl.update()` runs missiles every frame regardless
   of mode.

Modes: RWS and TWS share the pipeline (azimuth + track cap + VIM-220 firing
differ) and preserve tracks when switching. Entering STT keeps only the highest
confidence track; leaving STT clears everything and re-acquires. STT breaks on
`STT_LOCK_BREAK_FRAMES` starved frames or when the target leaves the RWS cone.

`Radar` is host-agnostic: anything satisfying `RadarHost` (id + getPosition +
getDirection) drives it — ships and the fixed `DishRadarStation` (dome mode).
Only the player's radar gets renderers; AI and dome radars track silently.

## Conventions

- OOP, class-per-subsystem, constructor takes a params object. Ship-like
  entities extend `Phaser.Physics.Matter.Sprite`.
- Entities are created through registered factories (`scene.add.playerShip(...)`,
  `.target(...)`, `.asteroid(...)`, missiles), registered in `Game.create()`.
  Wiring (radar attach, renderers, controller, no-collide group) belongs in the
  factory, not the entity constructor.
- **Constants**: radar/weapon/simulation values go in
  `src/radar/data/radarGameSettings.ts`, grouped under a `// ── section ──`
  header naming the owning module, with a comment explaining the physical
  meaning and unit (`_PX`, `_DEG`, `_MS`, `_FRAMES`, `_PROB`). Non-radar
  gameplay values go in `src/settings.ts`. One-off scene placements stay in the
  scene.
- Angles in **degrees** in game/entity code; use `Phaser.Math.DegToRad` /
  `RadToDeg` / `Angle.WrapDegrees` at the boundaries. Distances in world px;
  prefer `Distance.Squared` for comparisons.
- No global state — state lives on the owning scene, entity, controller or
  radar module. `window.game` is the only exception and is DEV-only.
- Per-frame vector marks are drawn into the shared
  `Phaser.GameObjects.Graphics` cleared each frame in `Game.update()`; persistent
  sprites/text are separate objects with explicit `destroy()`.
- Guard destroyed entities: check `entity.active && entity.body` before reading
  position — a destroyed Matter sprite loses `body`.
- Controllers own their input: register in the constructor, mirror every
  handler in `destroy()`/`shutdown`. Keep AI *intent* in `AiUnitController`
  (see `decision_tree.md` for patrol/crank/skate semantics), radar detail in
  the radar modules.
- Comments explain the radar/physics reasoning ("chaff between the antenna and
  the target can swallow the return"), not the syntax. Match that density.
- Existing `HACK:`/`TODO:` markers (e.g. the STT direct-entity reference) are
  tracked in `TO_DO.md` — don't silently rewrite them as drive-bys.

## Verification

No test suite exists. Package manager is **pnpm**; the deploy workflow builds
on push to `main`, so a broken build ships.

```bash
npx tsc --noEmit
```

Then eslint on the changed files only, then `npm run build` when TypeScript or
the bundle changed. The chunk-size warning is pre-existing. So are these lint
errors — part of the open LINTING item, not regressions: `_angle` unused in
`radar.ts shoot()`, `no-useless-assignment` on `let x/y` in the asteroid loop,
`let t` in `missileGuidance.ts interceptVector()`.

For behavioural changes, drive the running game rather than asking the user to
click: the preview server is pinned to port **5199** in `.claude/launch.json`
(the user runs their own on 5173). See
[references/dev-automation.md](references/dev-automation.md) for the
`window.game` stepping recipes — the preview tab is backgrounded, so the clock
must be advanced manually and verification is by state, not screenshot.
