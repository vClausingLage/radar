# Sprite prompts

Prompts for generating the game's art by hand in **Sprixen** or **ArtCraft**, the
same way `methane_sea/docs/ENVIRONMENT_SPRITE_PROMPTS.md` does it. Neither tool is
called from this repo: generate, review by eye, then import.

## Which tool for what

- **Sprixen**: the small sprites that must read as one family (ships, missile,
  chaff). Set style, palette and resolution once in one Sprixen project, so every
  hull comes out alike.
- **ArtCraft**: the big painted pieces (rock, pad, dish, ground, nebula).

## Shared style line

Append to every prompt:

> 2D top-down space game sprite seen from directly above, hand-painted hard-surface
> look, worn industrial metal, muted cold grey-blue palette with small warm accents,
> single soft key light from the upper left, crisp silhouette, transparent
> background, no text, no border, no drop shadow, single object centred, game-ready
> asset.

Ship and weapon sprites also need: **"nose pointing right"**. Angle 0 in the game
points along +x, and `ship.png`, `cargo.png` and `missile.png` are all drawn that way.

Keep the backdrop darker than the sprites and free of green: the radar scope draws
green on top of it and has to stay the brightest thing on screen.

## Replacing a hull changes the radar

The Matter body is the single source of truth for geometry, and the radar's return
scales with the cross-section it presents. So a new silhouette is a simulation
change, not only a picture change:

1. Export with a clean alpha edge. Stray semi-transparent pixels become hull.
2. Re-trace: `node tools/traceOutline.js public/<sprite>.png 6 0.5`, and paste the
   result into `src/entities/spriteOutlines.ts`.
3. Check the exhaust nozzle positions (`EXHAUST_NOZZLES`, same file).
4. Keep the proportions and pixel size close to the old sprite, or expect detection
   ranges to move. Run the signal path tests (`window.runRadarTests`).

Scenery with a box body (`surface.png`) must keep its exact size and stay opaque.
Scenery with no body (nebula, effects) is free.

## Ships (Sprixen)

Current sizes are in brackets; generate larger only if the factory scale is adjusted
to match.

1. **Player interceptor** (`ship.png`, 69x68): "compact round-hulled space
   interceptor, single large forward sensor eye glowing blue, two small engine pods
   at the rear".
2. **Hostile fighter** (new, about 70x70): "angular aggressive space fighter, narrow
   dart hull, swept fins, red sensor glow, clearly different silhouette from a round
   ship". Today friend and foe share one picture.
3. **Cargo hauler** (`cargo.png`, 166x70): "long modular freighter, rows of cargo
   containers on a central spine, twin rear engines, blue forward sensor".
4. **Missile, short range** (`missile.png`, 30x14): "slim space missile, grey body,
   red seeker nose, small rear fins".
5. **Missile, long range** (new, about 40x14): same style, "longer two-stage body,
   a white band at mid-body".

## Terrain and stations (ArtCraft)

Change only as far as the rules above allow.

6. **Small asteroid** (`asteroid.png`, 75x75, 3 variants): "cratered dark grey space
   rock, irregular outline". The current one is sandy pixel art and stands out next
   to the painted dish rock.
7. **Ground strip** (`surface.png`, exactly 2500x120, opaque, tileable horizontally):
   "cold grey moon regolith seen at a low angle, craters and scattered rocks, straight
   flat top edge". Today painted by `tools/paintSurface.js`.
8. **Nebula backdrop** (`universe.png`, at least 2048x2048): "deep space nebula, soft
   gas clouds in dark violet and deep blue, low contrast, mostly near-black, no bright
   core, no large stars". The current source is low resolution and blocky, which is
   why `Starfield` has to blur it.

## Effects (either tool, optional)

Most effects are procedural and need no art. Worth generating only if wanted:

9. **Explosion sheet** (8 frames, 128x128 each): "spherical explosion in vacuum,
   white-hot core cooling to orange, flying sparks, on black, animation frames".
10. **Chaff cloud** (`chaff.png`, 84x84): "cloud of tiny metallic foil strips glinting
    in light, radially scattered".

## HUD (Sprixen)

11. **Button frame** (nine-slice, 48x48): "dark cockpit panel button, thin bevelled
    metal edge, flat dark centre, no text".
12. **RWR bezel** (`rwr_screen.png`, keep size and the scope's centre point): "round
    aviation instrument bezel, worn dark metal, small screws, empty black glass".
