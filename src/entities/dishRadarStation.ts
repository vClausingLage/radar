import Phaser from "phaser";
import { Asteroid } from "./asteroid";
import { Structure } from "./structure";
import { ASTEROID_2_OUTLINE, DISH_RADAR_OUTLINE } from "./spriteOutlines";
import { createEntityId } from "./entityId";
import { Ray } from "../physics/ray";
import { Radar } from "../radar/systems/radar";
import { RadarRenderer } from "../radar/renderer/radarRenderer";
import { Track } from "../radar/data/track";
import { Entity, GasVolume, RadarHost, Terrain } from "../radar/data/types";
import { Vector2 } from "../types";
import { SURVEILLANCE_RANGE_PX } from "../radar/data/radarGameSettings";

// Where the dish stands on the rock. Its pedestal's foot is at this fraction
// of the dish texture — the base is not centred under the reflector, the
// building sits left of it (read off dish_radar.png) — and the mount is on the
// rock's north-eastern flank: this far out from the centre towards the edge on
// that bearing. The bearing is taken in the rock's own proportions (see
// mountPoint), so "north-east" lands on the corner of a wide, flat rock rather
// than a step north of its centre.
const DISH_FOOT_ORIGIN: Vector2 = { x: 0.39, y: 0.90 };
const MOUNT_BEARING_DEG = -45; // screen north-east: +x, -y
const MOUNT_EDGE_FRACTION = 0.55;
// The reflector's centre as a fraction of the dish texture: where the radar
// actually is. Up on the pedestal it clears the rock's body, so the rock
// shadows the dish the way it shadows anyone else.
const DISH_REFLECTOR_ORIGIN: Vector2 = { x: 0.52, y: 0.36 };
// Height of the dish picture relative to the rock's radius.
const DISH_HEIGHT_FACTOR = 1.3;

// A friendly early-warning emplacement: a dish bolted to a stationary asteroid.
// Both are ordinary terrain — the rock an asteroid, the dish a structure, each
// one Matter body shaped to its drawn silhouette — that the scene registers
// like any other terrain (getTerrain()), so they occlude every radar in the
// world, this dish's included. The station drives the standard ship Radar in
// 'dome' mode (full 360° search) and datalinks its tracks to the player,
// rather than duplicating the sweep/detect/track pipeline.
//
// The station is the radar's host: the antenna sits at the reflector of the
// dish sprite, on the pedestal on the rock's flank, and the coverage ring and
// sweep are drawn from there. The sprite does not turn with the beam: it is a
// side-on picture of the antenna, and the sweep is drawn as the datalink's own
// bearing line instead.
export class DishRadarStation implements RadarHost {
    readonly id = createEntityId();

    // The rock is a normal Asteroid and the dish a normal Structure, so every
    // radar occludes and ground-maps them for free once the scene has taken
    // them as terrain (getTerrain()).
    readonly rock: Asteroid;
    private readonly dish: Structure;
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
            outline: ASTEROID_2_OUTLINE,
            bodyRadius,
            spin: false,
            // Fixed heading: the mount below is picked on the rock as drawn.
            angle: 0,
        });

        // Dish standing on the rock's north-eastern flank: its pedestal foot is
        // set on the mount point, above the rock in the draw order, and it
        // stays put — the rock neither spins nor drifts, so the mount never
        // moves out from under it. Its body follows the picture (reflector,
        // struts, building), so a beam from elsewhere echoes off the dish.
        const dishHeight = bodyRadius * DISH_HEIGHT_FACTOR;
        const dishScale = dishHeight / scene.textures.get('dish_radar').getSourceImage().height;
        this.dish = scene.add.structure({
            position: this.mountPoint(),
            anchor: DISH_FOOT_ORIGIN,
            texture: 'dish_radar',
            scale: dishScale,
            outline: DISH_RADAR_OUTLINE,
            // A tower at flight level: ships fly into it, not over it.
            obstacle: true,
        });
        this.dish.setDepth(this.rock.depth + 1);

        // A standard radar in full-circle mode. No radar/terrain renderer and no
        // loadout: it builds tracks silently, exactly like the AI ship radars.
        this.radar = new Radar({ scene, range: this.range });
        this.radar.attachTo(this);
        this.radar.setMode('dome');
    }

    // The mount: a ray from the rock's centre along the mount bearing, cut where
    // it leaves the rock's body polygon — the body is the shape, so the mount
    // follows the rock as drawn rather than an assumed circle — with the dish
    // standing part-way along it. The bearing is stretched by the rock's
    // extents (a 45° ray on a rock twice as wide as it is tall would leave
    // through the top edge barely east of centre).
    private mountPoint(): Vector2 {
        const centre = { x: this.rock.x, y: this.rock.y };
        const rad = Phaser.Math.DegToRad(MOUNT_BEARING_DEG);
        const reach = 2 * Math.max(this.rock.displayWidth, this.rock.displayHeight);
        const dx = Math.cos(rad) * this.rock.displayWidth;
        const dy = Math.sin(rad) * this.rock.displayHeight;
        const len = Math.hypot(dx, dy) || 1;
        const ray = new Phaser.Geom.Line(
            centre.x, centre.y,
            centre.x + (dx / len) * reach, centre.y + (dy / len) * reach,
        );
        const edge = Phaser.Geom.Intersects.GetLineToPolygon(ray, new Ray().getBodyPolygons(this.rock));
        const end = edge ? { x: edge.x, y: edge.y } : { x: ray.x2, y: ray.y2 };
        return {
            x: centre.x + (end.x - centre.x) * MOUNT_EDGE_FRACTION,
            y: centre.y + (end.y - centre.y) * MOUNT_EDGE_FRACTION,
        };
    }

    // ── RadarHost ──────────────────────────────────────────────────────────
    // The antenna: the reflector's centre, worked out from the point the dish
    // sprite is drawn about. It is outside the rock's body, which is what lets
    // the rock shadow the dish; it is inside the dish's own body, which is why
    // the dish does not shadow itself (a radar standing inside a body is not
    // shadowed by it — see Radar.nearestHit).
    getPosition(): Vector2 {
        return {
            x: this.dish.x + (DISH_REFLECTOR_ORIGIN.x - this.dish.originX) * this.dish.displayWidth,
            y: this.dish.y + (DISH_REFLECTOR_ORIGIN.y - this.dish.originY) * this.dish.displayHeight,
        };
    }

    // Fixed emplacement: boresight is arbitrary since the dome sweeps all round.
    getDirection(): number {
        return 0;
    }

    getRange(): number {
        return this.range;
    }

    // The station's solid bodies, for the scene to register as terrain and to
    // fade as one: rock and dish show and hide together.
    getTerrain(): Terrain[] {
        return [this.rock, this.dish];
    }

    getTracks(): Track[] {
        return this.radar.getTracks();
    }

    // Sweep the dish and paint the shared picture. `ships` are the targets to
    // detect; `terrain` are the occluders — the whole scene list, the rock
    // under the dish included, so what is behind the rock stays dark to the
    // datalink. `graphics` carries only the datalink overlay; the dome radar
    // draws nothing on its own.
    update(
        delta: number,
        ships: Entity[],
        terrain: Terrain[],
        graphics: Phaser.GameObjects.Graphics,
        gasVolumes: GasVolume[] = [],
    ): void {
        // Gas absorbs the dish's energy like anyone else's, so the shared
        // picture thins out over a cloud too — the datalink is a better sensor
        // than the player's, not an omniscient one.
        this.radar.update(delta, this.getDirection(), ships, graphics, [], terrain, gasVolumes);

        const origin = this.getPosition();
        const bearing = this.radar.getBeamDirection();
        this.datalink.renderDatalinkCoverage(graphics, origin, this.range);
        this.datalink.renderDatalinkSweep(graphics, origin, bearing, this.range);
        for (const track of this.radar.getTracks()) {
            this.datalink.renderDatalinkContact(graphics, track);
        }
    }

    destroy(): void {
        // Both live in the scene's terrain list and may already have been torn
        // down there (e.g. on game-over); guard against a double destroy.
        if (this.dish.active) this.dish.destroy();
        if (this.rock.active) this.rock.destroy();
    }
}
