---
name: radar-game-typescript
description: Use when working on this Phaser radar game repository, including gameplay changes, radar and missile guidance logic, ship or asteroid population, AI controllers, Matter physics collisions, HUD/radar rendering, TypeScript refactors, tests, builds, or project-structure questions.
---

# Radar Game TypeScript

## Project Shape

- Treat this as a TypeScript Phaser 3 game using Matter physics.
- Keep code class-oriented and compatible with the existing OOP style.
- Prefer focused edits in `src/`:
  - `src/main.ts`: scene setup, world population, update loop, renderer wiring.
  - `src/controller/`: player and AI input/behavior orchestration.
  - `src/entities/`: ships, missiles, asteroids, and factories.
  - `src/radar/systems/`: radar modes, detection, RWR, TWS, missile guidance.
  - `src/radar/renderer/`: radar/HUD drawing.
  - `src/physics/`: collision registration and physics debug rendering.
  - `src/settings.ts`: gameplay constants and loadouts.
  - `src/types/`: shared TypeScript data shapes.

## Engineering Defaults

- Read the nearby class and factory patterns before editing.
- Preserve existing behavior unless the user asks to change it.
- Keep SOLID and DRY practical: extract shared helpers when duplication affects behavior or future tuning, but avoid abstracting one-off game logic prematurely.
- Prefer typed config arrays for repeated scene population data over copy-pasted object creation.
- Keep gameplay constants in `settings.ts` when they are likely to be tuned; keep one-off scene placements near the scene code.
- Avoid global state. Store state on the owning scene, entity, controller, or system class.
- Respect existing missile turn-rate and timing semantics when changing guidance.
- Use `Vector2` from `src/types` for simple world positions unless Phaser vector methods are needed.

## Workflow

1. Inspect relevant files with `rg` and direct file reads before changing code.
2. Make narrowly scoped edits that fit current class boundaries.
3. Run `npm run build` after TypeScript changes.
4. If `git` reports dubious ownership, inspect with `git --git-dir=<repo>/.git --work-tree=<repo> ...` rather than changing global config.
5. Mention any build warnings separately from failures.

## Gameplay Guidance

- For radar or missile work, check `Radar`, `MissileGuidance`, `missiles.ts`, `settings.ts`, and the renderer/HUD path that exposes state to the player.
- For player controls, wire input in `PlayerController` and clean it up in `destroy`.
- For AI behavior, keep high-level intent in `AiUnitController` and avoid embedding radar implementation details there unless needed.
- For collisions, use `CollisionRegistrar` and existing Matter collision categories/groups.
- For visual radar marks, prefer the existing `Phaser.GameObjects.Graphics` render pass when marks should clear/redraw each frame.

## Validation

- Run `npm run build` as the default verification.
- If frontend behavior changed and time allows, run the dev server and inspect the game in the browser.
