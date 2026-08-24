import Phaser from 'phaser';
import { Vector2 } from '../types';
import { createEntityId } from './entityId';
import { gasCloudSettings } from '../radar/data/radarGameSettings';
import { GasVolume } from '../radar/data/types';

// Shared soft-falloff sprite, generated once per texture manager.
const PUFF_TEXTURE = 'gas_puff';

// One blob of the visual cloud. Every puff keeps its own place on the spine and
// its own drift phase — a cloud whose puffs move together reads as one big
// sprite, not as gas.
type Puff = {
    image: Phaser.GameObjects.Image;
    // Where along the spine this puff sits: 0 at the start point, 1 at the end.
    // Also decides when the spreading cloud reaches it.
    t: number;
    // Offset from that point, along and across the spine (px).
    along: number;
    lateral: number;
    baseAlpha: number;
    // Slow circular drift, so neighbouring puffs churn past each other.
    swirlSpeed: number;
    phase: number;
};

export type GasCloudParams = {
    scene: Phaser.Scene;
    // The cloud spreads from `from` towards `to`; the capsule around that spine
    // is both what you see and what the radar has to shoot through.
    from: Vector2;
    to: Vector2;
    radius?: number;
    density?: number;
    // Time (ms) for the cloud to reach `to`. 0 spawns it fully formed.
    spreadMs?: number;
    color?: number;
};

// A cloud of radar-absorbing gas stretched between two points.
//
// It is a medium, not an object: no Matter body, nothing to collide with, and
// it never occludes the beam the way terrain does. What it does is soak up
// energy — the receiver measures how much of the path from antenna to target
// runs inside the capsule and drops the detection probability accordingly
// (Receiver.isAbsorbedByGas). So a cloud does not hide a contact, it makes it
// unreliable, and a long look through the gas is worse than a glancing one.
export class GasCloud extends Phaser.GameObjects.Container {
    public readonly id: number;
    // Spine as an offset from the container origin, which sits on `from`.
    private readonly spine: Vector2;
    private readonly spineLength: number;
    private readonly radius: number;
    private readonly density: number;
    private readonly spreadMs: number;
    private readonly createdAt: number;
    private readonly puffs: Puff[] = [];
    // 0..1 — how far the gas has spread from `from` towards `to`.
    private progress = 0;

    constructor(params: GasCloudParams) {
        super(params.scene, params.from.x, params.from.y);
        this.id = createEntityId();
        this.radius = params.radius ?? gasCloudSettings.RADIUS;
        this.density = params.density ?? gasCloudSettings.DENSITY;
        this.spreadMs = params.spreadMs ?? gasCloudSettings.SPREAD_MS;
        this.createdAt = params.scene.time.now;
        this.spine = { x: params.to.x - params.from.x, y: params.to.y - params.from.y };
        this.spineLength = Math.hypot(this.spine.x, this.spine.y);
        this.progress = this.spreadMs > 0 ? 0 : 1;

        GasCloud.ensureTexture(params.scene);
        this.buildPuffs(params.color ?? gasCloudSettings.COLOR);
        this.setDepth(gasCloudSettings.DEPTH);
        this.layoutPuffs(this.createdAt);
    }

    // What the radar is handed each frame: the capsule in world space, truncated
    // at the head of the spread. Gas that has not arrived yet absorbs nothing.
    getVolume(): GasVolume {
        return {
            line: new Phaser.Geom.Line(
                this.x, this.y,
                this.x + this.spine.x * this.progress,
                this.y + this.spine.y * this.progress,
            ),
            radius: this.radius,
            density: this.density,
        };
    }

    // Advance the spread and churn the puffs. Driven from the scene's update
    // loop, like the chaff clouds, rather than from a Phaser update list.
    update(now: number): void {
        if (this.spreadMs > 0) {
            this.progress = Phaser.Math.Clamp((now - this.createdAt) / this.spreadMs, 0, 1);
        }
        this.layoutPuffs(now);
    }

    // A soft radial falloff — a hard-edged circle reads as a bubble no matter
    // how many you stack; the feathered edge is what turns overlap into density.
    private static ensureTexture(scene: Phaser.Scene): void {
        if (scene.textures.exists(PUFF_TEXTURE)) return;

        const size = gasCloudSettings.PUFF_TEXTURE_PX;
        const texture = scene.textures.createCanvas(PUFF_TEXTURE, size, size);
        if (!texture) return;

        const ctx = texture.getContext();
        const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        // A broad opaque core with the falloff pushed out to the rim: most of
        // each puff is solid, so overlapping them builds mass instead of just
        // building haze.
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.35, 'rgba(255,255,255,0.78)');
        gradient.addColorStop(0.65, 'rgba(255,255,255,0.30)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        texture.refresh();
    }

    // Lay puffs out in slices along the spine, several to a slice so they
    // overlap. Slice spacing scales with the radius, so a wide cloud is not
    // sampled more finely than it needs and a long one still comes out unbroken.
    //
    // The whole body layer is built before the whole glow layer, so the sheen
    // sits on top of the mass everywhere along the cloud rather than only where
    // the two happen to interleave.
    private buildPuffs(color: number): void {
        const spacing = this.radius * gasCloudSettings.PUFF_SLICE_FACTOR;
        const perSlice = gasCloudSettings.BODY_PUFFS_PER_SLICE + gasCloudSettings.GLOW_PUFFS_PER_SLICE;
        const slices = Math.min(
            Math.max(gasCloudSettings.MIN_SLICES, Math.ceil(this.spineLength / spacing) + 1),
            Math.floor(gasCloudSettings.MAX_PUFFS / perSlice),
        );

        this.addLayer(slices, spacing, color, 'body');
        this.addLayer(slices, spacing, color, 'glow');
    }

    private addLayer(slices: number, spacing: number, color: number, layer: 'body' | 'glow'): void {
        const isBody = layer === 'body';
        const count = isBody ? gasCloudSettings.BODY_PUFFS_PER_SLICE : gasCloudSettings.GLOW_PUFFS_PER_SLICE;
        const alpha = isBody ? gasCloudSettings.BODY_ALPHA : gasCloudSettings.GLOW_ALPHA;
        const sizeFactor = isBody ? gasCloudSettings.BODY_SIZE_FACTOR : gasCloudSettings.GLOW_SIZE_FACTOR;

        for (let slice = 0; slice < slices; slice++) {
            const t = slices > 1 ? slice / (slices - 1) : 0;
            for (let i = 0; i < count; i++) {
                const image = new Phaser.GameObjects.Image(this.scene, 0, 0, PUFF_TEXTURE);
                const size = this.radius * Phaser.Math.FloatBetween(sizeFactor.min, sizeFactor.max);
                image.setDisplaySize(size, size);
                image.setTint(color);
                // NORMAL for the body: layers build real opacity, so the cloud
                // hides what is behind it. SCREEN only for the thin glow pass.
                image.setBlendMode(isBody ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.SCREEN);
                this.add(image);

                this.puffs.push({
                    image,
                    t,
                    along: Phaser.Math.FloatBetween(-spacing, spacing) / 2,
                    // Two rolls averaged: a triangular spread instead of a flat
                    // one, so puffs pile up along the spine and thin out towards
                    // the edge — a cloud is densest through its middle.
                    lateral: (Phaser.Math.FloatBetween(-1, 1) + Phaser.Math.FloatBetween(-1, 1)) / 2
                        * this.radius * gasCloudSettings.PUFF_LATERAL_SPREAD,
                    baseAlpha: Phaser.Math.FloatBetween(alpha.min, alpha.max),
                    swirlSpeed: Phaser.Math.FloatBetween(
                        gasCloudSettings.SWIRL_SPEED.min,
                        gasCloudSettings.SWIRL_SPEED.max,
                    ),
                    phase: Phaser.Math.FloatBetween(0, Math.PI * 2),
                });
            }
        }
    }

    // Place every puff for the current spread and time. Puffs past the head of
    // the spread stay hidden; the ones just behind it fade in, so the cloud
    // grows a diffuse leading edge rather than a hard front.
    private layoutPuffs(now: number): void {
        const dirX = this.spineLength > 0 ? this.spine.x / this.spineLength : 1;
        const dirY = this.spineLength > 0 ? this.spine.y / this.spineLength : 0;

        for (const puff of this.puffs) {
            if (puff.t > this.progress) {
                puff.image.setVisible(false);
                continue;
            }
            const arrival = Phaser.Math.Clamp(
                (this.progress - puff.t) / gasCloudSettings.EDGE_FADE, 0, 1,
            );
            const swirl = now * puff.swirlSpeed + puff.phase;
            const alongPx = puff.t * this.spineLength + puff.along + Math.sin(swirl) * gasCloudSettings.SWIRL_PX;
            const lateralPx = puff.lateral + Math.cos(swirl * 0.8) * gasCloudSettings.SWIRL_PX;

            puff.image
                .setVisible(true)
                .setPosition(
                    dirX * alongPx - dirY * lateralPx,
                    dirY * alongPx + dirX * lateralPx,
                )
                .setAlpha(puff.baseAlpha * arrival)
                .setRotation(swirl);
        }
    }
}
