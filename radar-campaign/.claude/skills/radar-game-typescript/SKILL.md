---
name: radar-game-typescript
description: Use when working in this Phaser/TypeScript radar game repo — radar modes (RWS/TWS/STT/dome), tracking, missile guidance and fire control, RWR, jammer, chaff, terrain mapping, ships/asteroids/factories, AI unit behaviour, scenes and campaign levels, HUD and radar rendering, audio callouts, or refactors, builds and verification of any of these.
---

# Radar Game (Phaser 4 + TypeScript)

A space-set simulation of an airborne radar. The player flies a ship; the core
gameplay is a **high-fidelity radar, tracking and missile-control simulation**.
The user's stated goals for the project are learning software architecture,
radar technology and game-dev fundamentals — explain the radar reasoning behind
a change, not just the code.

## Never commit or push

**The user commits their own work — they want to read the diff first.** Leave
every change in the working tree and tell them what you touched. `git add`,
`git commit`, `git push`, and anything that rewrites history or moves a branch
are theirs to run: not when the work is finished, not when it is verified, not
when asked to "wrap up" or "finish the job". Reading the tree — `git status`,
`git diff`, `git log`, `git show` — is always fine, and is usually how a summary
should be assembled.

The deploy workflow builds on push to `main`, so a push is a release. One more
reason it is not yours to make.

## The one rule that overrides the others

**Structure mirrors real radar hardware, not textbook coding principles.**
When adding something, first ask *which real subsystem owns this?* — weapons go
to `fireControl.ts`, ground mapping to `terrainMapper.ts`, emission warning to
`rwr.ts`. Never create catch-all `helpers/`, `utils/` or `gameLogic` modules;
they rot into junk drawers. Classes stay sleek and readable — realism justifies
an extra module, never a bloated one.

Corollary: **the Matter body is the single source of truth for geometry.**
`Ray.nearestPartHit()` walks the body's convex parts (`Ray.getBodyPolygons()`
is only the hull); never introduce a parallel collision/detection shape next
to it.

## Map

```
src/main.ts              Phaser config, scene list, matter debug, DEV window.game hook
src/scenes/game.ts       Base scene: world, factories, player, camera, colliders,
                         per-frame radar update loop, cold-start procedure. Levels
                         SUBCLASS it and override buildTerrain() / buildScenario() /
                         briefingMessage() / requiresColdStart()
src/scenes/campaignLevel.ts  Campaign base: the shared theatre (surface/pad, dish
                         "Disco" + datalink, gas band, pickets), cold start, VID,
                         RadioNet story traffic, verdicts, ENTER next/retry
src/scenes/level1..3.ts  Mule Train (VID traffic) / Shepherd (tow a derelict,
                         raider) / Backdoor (raid through the gas). Story lines
                         live in src/audio/radioScript.json
src/scenes/startMenu.ts  Menu, ScenarioKey ('duel' | 'occluded' | 'skirmish')
src/controller/          playerController.ts (key bindings), aiUnitController.ts (intent)
src/entities/            Ship/PlayerShip/Target, missiles, asteroid, decoy, exhaust,
                         dishRadarStation, structure (static solid scenery: surface,
                         launchpad) + *Factory.ts registering scene.add.* factories;
                         spriteOutlines.ts = sprite silhouettes as Matter polygons,
                         traced with tools/traceOutline.js (no shape editor in Phaser).
                         Terrain = Asteroid | Structure; Game.registerTerrain() feeds the
                         one list every radar (the dish's too) is occluded by
src/radar/systems/radar.ts        The centre. Owns mode state, sweep, STT lock, delegates
src/radar/systems/fireControl.ts  Weapons: launch, guidance ticks, waypoints, seeker cones
src/radar/systems/modules/        Signal path: antenna → emitter → receiver → trackingComputer
                                  plus rwr, jammer, missileRadar, missileGuidance,
                                  terrainMapper, loadoutManager
src/radar/data/                   track.ts, radarReturn.ts, types.ts (Entity, RadarHost, Mode),
                                  signalPath.ts (the energy budget every sensor asks),
                                  radarGameSettings.ts (all radar constants)
src/radar/renderer/               radarRenderer (scope marks), interfaceRenderer (HUD),
                                  terrainRenderer (ground map)
src/physics/                      ray.ts (raycast against Matter vertices), bodyShape.ts (fit a
                                  body to a traced outline), landing.ts (touchdown rules:
                                  slow + tail-first on ground = landed, else crash), collisionRegistrar
src/math/, src/types/             Maths helpers, shared Vector2
src/settings.ts                   Non-radar gameplay constants (world, ship, camera, loadouts)
src/audio/                        audioPlayer, radarVoice (BRA callouts), startup, supportRadarComms,
                                  radioNet + radioScript.json (campaign story traffic, subtitled)
public/                           Sprites; audio in public/audio
docs/                             radar.md, player.md, GCI.md, gci-comms.md
TO_DO.md, decision_tree.md, cowork.md   Roadmap, AI behaviour spec, design intent
```

## Signal path — how a detection actually happens

`Radar.update()` runs per ship per frame, from `Game.update()`:

1. `Antenna.update(mode, shipDirection)` advances the beam and reports
   `sweepComplete`. Azimuth is per-mode (RWS 60°, TWS 45°, STT `STT_BEAM_DEG`,
   dome 360°).
2. `Emitter.sendPulse()` produces the pulse line for this frame. It is traced
   to `illuminationRangePx()` (~1.7x the rated range), **not** to the rated
   range — see the range note below.
3. Raycast: `nearestHit()` for ships and separately for terrain, returning the
   hit point and the hull's cross-section. Rays test the body's true polygon
   (`Ray.nearestPartHit`), and a body the antenna stands inside is skipped —
   the player parked on the pad, the dish inside its own tower. **The nearer
   return wins** — terrain shadows ships and is handed to `TerrainMapper`; a
   nearer ship return masks terrain behind it.
4. Interference: chaff (`Receiver.isBlockedByDecoy`) swallows a return outright;
   gas does not — it is priced into the hit's energy instead
   (`Receiver.gasRoundTrip`). An enemy `Jammer` covering us rewrites the whole
   sweep into a coherent false track at `sweepComplete`
   (`Receiver.createFakeHits`).
5. `Receiver.processHits()` weighs each hit's signal against the receiver's
   noise floor and yields the returns that cleared it.
6. `TrackingComputer.update(returns, ownerPos, maxMissedScans, maxTracks)`
   forms/ages tracks. RWS is uncapped; TWS caps at `MAX_TWS_TRACKS`.
7. Anything the beam touches *and can hear it* gets an RWR contact via
   `illuminateRwr()` — green for search, red + lock event for STT. Hearing is
   one-way, so it reaches much further than a return does.
8. Renderers draw; `FireControl.update()` runs missiles every frame regardless
   of mode.

Modes: RWS and TWS share the pipeline (azimuth + track cap + VIM-220 firing
differ) and preserve tracks when switching. Entering STT keeps only the highest
confidence track; leaving STT clears everything and re-acquires. STT breaks on
`STT_LOCK_BREAK_FRAMES` starved frames or when the target leaves the RWS cone.

`Radar` is host-agnostic: anything satisfying `RadarHost` (id + getPosition +
getDirection) drives it — ships and the fixed `DishRadarStation` (dome mode).
Only the player's radar gets renderers; AI and dome radars track silently.

### Range is two different things — don't conflate them

`RADAR_DEFAULT_RANGE_PX` (700) is the **display** range: the cone, ring and
contacts the interface draws, and the range the energy budget is quoted at. It
is not where the pulse stops. What the radar can actually do is settled by
energy in `radar/data/signalPath.ts`: `returnSignal` falls with range⁴ and
scales with the hull's presented cross-section; `emissionSignal` falls with
range² because a listener only has to hear the pulse. A signal ratio of 1 is the
noise floor, and `detectionProbability` fades in above it. So a big hull is
tracked past the ring, a small one fades before it, and an RWR is warned from
well beyond either.

The ring **is** a hard limit on weapons: fire control is handed only
`Radar.displayedTracks()` / `displayedSttTrack()`, so an undisplayed track
cannot be locked, shot at or guided onto — by the AI as much as by the player.
When touching detection, put the physics in `signalPath.ts` and keep the ring a
display-and-weapons concern.

## Conventions

- OOP, class-per-subsystem, constructor takes a params object. Ship-like
  entities extend `Phaser.Physics.Matter.Sprite`.
- Entities are created through registered factories (`scene.add.playerShip(...)`,
  `.target(...)`, `.asteroid(...)`, `.structure(...)`, missiles), registered in
  `Game.create()`. Wiring (radar attach, renderers, controller, no-collide
  group) belongs in the factory, not the entity constructor.
- **Terrain and contact.** Everything solid goes through `Game.registerTerrain()`
  (occlusion, ground map, fade); `registerFadeGroup()` ties pieces that show
  and hide together (pad + surface, rock + dish). A `Structure` is an
  `obstacle` (tower: ships and missiles crash into it) or ground (sensor body:
  reports contact, never pushes). What a contact means is decided by
  `physics/landing.ts` from `landingSettings` in `settings.ts`: fast = crash
  on anything; slow on an obstacle = stop; slow **and tail-first** on ground =
  landed (`Game.onPlayerLanded()`), else crash. Only the player lands by hand —
  AI cargo sets down by `CampaignLevel.landShip()`. A sprite-shaped body comes
  from `tools/traceOutline.js` → `spriteOutlines.ts` → `fitBodyToOutline()`.
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

Package manager is **pnpm**; the deploy workflow builds
on push to `main`, so a broken build ships. A test scene is in `src/scenes/testScene.ts` and a test suite in `src/tests/radarTests.ts`.

```bash
npx tsc --noEmit
pnpm lint          # eslint ., flat config in eslint.config.js
pnpm build         # when TypeScript or the bundle changed
```

The build's chunk-size warning is pre-existing. Lint is clean as of
2026-09-09 — treat any eslint error as a regression. A lint-only cleanup that
drops a parameter can still break `tsc` at the callers, so run both.

**Do not bump `typescript` past 6.x.** Every `@typescript-eslint` package
hard-throws on TypeScript 7 (upstream issue #10940), so a bump silently costs
the project all TypeScript linting — the build works either way, which is what
makes it easy to miss. `eslint.config.js` wires the parser and plugin up
directly rather than through the `typescript-eslint` wrapper.

For behavioural changes, drive the running game rather than asking the user to
click: the preview server is pinned to port **5199** in `.claude/launch.json`
(the user runs their own on 5173). See
[references/dev-automation.md](references/dev-automation.md) for the
`window.game` stepping recipes — the preview tab is backgrounded, so the clock
must be advanced manually and verification is by state, not screenshot.
