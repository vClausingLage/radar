import Phaser from "phaser";
import { starfieldSettings, world } from "../settings";

// The sky behind the theatre. Pure scenery: no Matter body, so no ray can hit it
// and no radar, RWR or fire-control path ever knows it exists.
//
// Two jobs. The nebula is softened and dimmed, because the radar's thin phosphor
// lines are drawn straight on top of it and must stay the brightest thing on
// screen. The stars move at less than the camera's rate (parallax), which gives
// the eye the sense of motion a real pilot gets from distant references — in
// empty space that is the only cue to the ship's own speed.
const NEBULA_TEXTURE_KEY = 'starfield-nebula';
const starLayerKey = (index: number) => `starfield-stars-${index}`;

// One square of a star layer, repeated edge to edge across the sky.
const STAR_TILE_PX = 1024;

// The tiled layers overhang the world: at a camera zoom below 1 the view reaches
// past the camera's scroll position on every side.
const OVERHANG_PX = 1200;

export class Starfield {
    constructor(scene: Phaser.Scene) {
        Starfield.ensureNebulaTexture(scene);
        scene.add.image(0, 0, NEBULA_TEXTURE_KEY)
            .setOrigin(0)
            .setScale(starfieldSettings.NEBULA_SCALE);

        starfieldSettings.LAYERS.forEach((layer, index) => {
            Starfield.ensureStarTexture(scene, index, layer);
            // A blitter, not a TileSprite: a TileSprite draws 31 Math.random values
            // for its texture's UUID on every scene start, which would shift the
            // dice of the radar's seeded test runs (see DEFAULT_TEST_SEED).
            const tiles = scene.add.blitter(0, 0, starLayerKey(index))
                .setScrollFactor(layer.scrollFactor);
            for (let y = -OVERHANG_PX; y < world.HEIGHT + OVERHANG_PX; y += STAR_TILE_PX) {
                for (let x = -OVERHANG_PX; x < world.WIDTH + OVERHANG_PX; x += STAR_TILE_PX) {
                    tiles.create(x, y);
                }
            }
        });
    }

    // Textures live in the game-wide manager and outlast a scene restart, so
    // each is painted once.
    private static ensureNebulaTexture(scene: Phaser.Scene): void {
        if (scene.textures.exists(NEBULA_TEXTURE_KEY)) return;
        const source = scene.textures.get('universe').getSourceImage() as HTMLImageElement;
        const canvas = scene.textures.createCanvas(NEBULA_TEXTURE_KEY, source.width, source.height);
        if (!canvas) return;
        const ctx = canvas.getContext();
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, source.width, source.height);
        // Drawn slightly oversize so the blur has no dark rim at the image edge.
        // Blurring also dissolves the blocky stars baked into the source picture.
        ctx.filter = starfieldSettings.NEBULA_CANVAS_FILTER;
        const bleed = starfieldSettings.NEBULA_EDGE_BLEED_PX;
        ctx.drawImage(source, -bleed, -bleed, source.width + 2 * bleed, source.height + 2 * bleed);
        ctx.filter = 'none';
        canvas.refresh();
    }

    private static ensureStarTexture(
        scene: Phaser.Scene,
        index: number,
        layer: (typeof starfieldSettings.LAYERS)[number],
    ): void {
        const key = starLayerKey(index);
        if (scene.textures.exists(key)) return;
        const canvas = scene.textures.createCanvas(key, STAR_TILE_PX, STAR_TILE_PX);
        if (!canvas) return;
        const ctx = canvas.getContext();
        // A private generator: the global Phaser.Math.RND also drives the
        // simulation, and scenery must not shift a seeded test run.
        const rng = new Phaser.Math.RandomDataGenerator([`starfield-${index}`]);
        for (let i = 0; i < layer.count; i++) {
            const x = rng.between(0, STAR_TILE_PX - 1);
            const y = rng.between(0, STAR_TILE_PX - 1);
            const radius = rng.realInRange(layer.minRadiusPx, layer.maxRadiusPx);
            const alpha = rng.realInRange(0.35, 1);
            // Stellar colour: mostly white, some hot blue, some cool orange.
            const hue = rng.pick(['255,255,255', '255,255,255', '190,215,255', '255,225,190']);
            ctx.fillStyle = `rgba(${hue},${alpha})`;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        canvas.refresh();
    }
}
