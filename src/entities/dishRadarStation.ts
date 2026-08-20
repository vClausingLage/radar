import Phaser from "phaser";
import { Asteroid } from "./asteroid";
import { createEntityId } from "./entityId";
import { Radar } from "../radar/systems/radar";
import { RadarRenderer } from "../radar/renderer/radarRenderer";
import { Track } from "../radar/data/track";
import { Entity, GasVolume, RadarHost } from "../radar/data/types";
import { Vector2 } from "../types";
import { SURVEILLANCE_RANGE_PX } from "../radar/data/radarGameSettings";

// A friendly early-warning emplacement: a rotating dish bolted to a stationary
// asteroid. The asteroid IS the body — one circular Matter body that both blocks
// the player's radar (terrain) and anchors the dish. It drives the standard
// ship Radar in 'dome' mode (full 360° search) and datalinks its tracks to the
// player, rather than duplicating the sweep/detect/track pipeline.
//
// The station is the radar's host (position + boresight); the dish sprite is a
// visual overlay on the single rock body — the raycaster reads one body's
// vertices, so the rock's circle is the detection constraint.
export class DishRadarStation implements RadarHost {
    readonly id = createEntityId();

    // The rock is a normal Asteroid so the player's radar occludes and ground-maps
    // it for free. The scene owns it as terrain; exposed so the caller can add it
    // to the asteroid list.
    readonly rock: Asteroid;
    private readonly dish: Phaser.GameObjects.Image;
    private readonly radar: Radar;
    // Draws the shared (cyan) datalink picture. The dome Radar itself has no
    // renderer, so it sweeps silently — this paints its tracks off-board.
    private readonly datalink = new RadarRenderer();
    private readonly range = SURVEILLANCE_RANGE_PX;

    constructor(scene: Phaser.Scene, position: Vector2, bodyRadius = 130) {
        this.rock = scene.add.asteroid({
            position,
            direction: 0,
            speed: 0,
            texture: 'asteroid_2',
            bodyRadius,
            spin: false,
        });

        // Dish centred on the rock, sitting above it in the draw order.
        this.dish = scene.add.image(position.x, position.y, 'dish_radar')
            .setDisplaySize(bodyRadius * 1.6, bodyRadius * 1.6)
            .setDepth(this.rock.depth + 1);

        // A standard radar in full-circle mode. No radar/terrain renderer and no
        // loadout: it builds tracks silently, exactly like the AI ship radars.
        this.radar = new Radar({ scene, range: this.range });
        this.radar.attachTo(this);
        this.radar.setMode('dome');
    }

    // ── RadarHost ──────────────────────────────────────────────────────────
    getPosition(): Vector2 {
        return { x: this.rock.x, y: this.rock.y };
    }

    // Fixed emplacement: boresight is arbitrary since the dome sweeps all round.
    getDirection(): number {
        return 0;
    }

    getRange(): number {
        return this.range;
    }

    // The rotating overlay sprite — exposed so the scene can opt it into the
    // same distance-based visual fade as the rock it's mounted on.
    getDishSprite(): Phaser.GameObjects.Image {
        return this.dish;
    }

    getTracks(): Track[] {
        return this.radar.getTracks();
    }

    // Sweep the dish and paint the shared picture. `ships` are the targets to
    // detect; `terrain` are occluders — the station's own rock is filtered out
    // so the dish (mounted on top) never shadows itself. `graphics` carries only
    // the datalink overlay; the dome radar draws nothing on its own.
    update(
        delta: number,
        ships: Entity[],
        terrain: Entity[],
        graphics: Phaser.GameObjects.Graphics,
        gasVolumes: GasVolume[] = [],
    ): void {
        const occluders = terrain.filter(t => t !== this.rock);
        // Gas absorbs the dish's energy like anyone else's, so the shared
        // picture thins out over a cloud too — the datalink is a better sensor
        // than the player's, not an omniscient one.
        this.radar.update(delta, this.getDirection(), ships, graphics, [], occluders, gasVolumes);

        const origin = this.getPosition();
        const bearing = this.radar.getBeamDirection();
        this.datalink.renderDatalinkCoverage(graphics, origin, this.range);
        this.datalink.renderDatalinkSweep(graphics, origin, bearing, this.range);
        for (const track of this.radar.getTracks()) {
            this.datalink.renderDatalinkContact(graphics, track);
        }

        // Spin the dish to the live beam bearing so the sweep reads visually.
        this.dish.setRotation(Phaser.Math.DegToRad(bearing));
    }

    destroy(): void {
        this.dish.destroy();
        // The rock lives in the scene's asteroid list and may already have been
        // torn down there (e.g. on game-over); guard against a double destroy.
        if (this.rock.active) this.rock.destroy();
    }
}
