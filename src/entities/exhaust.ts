import Phaser from 'phaser';

// Engine-exhaust particle plume for ships and missiles. One emitter per nozzle,
// pinned to the nozzle's world position each frame and aimed straight out the
// back of the host. The emitters are independent scene objects (not children of
// the host) so they keep streaming particles in world space as the host moves.

const EXHAUST_TEXTURE_KEY = 'exhaustParticle';

// Nozzle positions in each texture's own pixel space (origin top-left,
// unscaled) — the same frame the sprite outlines are traced in. Every sprite
// faces right (+x = nose), so exhaust exits toward -x (the rear). The host's
// origin is subtracted at runtime, so the plume stays on the nozzle whether
// the sprite pivots on the texture centre or on its hull's centroid.
//   ship.png    69×68
//   cargo.png  166×70
//   missile.png 30×14
export const EXHAUST_NOZZLES: Record<string, { x: number; y: number }[]> = {
  ship: [{ x: 5, y: 5 }, { x: 5, y: 62 }],
  cargo: [{ x: 15, y: 17 }, { x: 15, y: 55 }],
  missile: [{ x: 2, y: 7 }],
};

export type ExhaustStyle = {
  // A single colour or a palette the emitter picks from per particle.
  tint: number | number[];
  scaleStart: number;
  lifespan: number;
  speed: number;
  quantity: number;
  // Half-angle (deg) of the random spread around the dead-aft direction.
  spreadDeg: number;
};

// Orange/yellow flame for ship engines.
export const SHIP_EXHAUST: ExhaustStyle = {
  tint: [0xffe066, 0xffae34, 0xff7a18],
  scaleStart: 0.55,
  lifespan: 380,
  speed: 60,
  quantity: 2,
  spreadDeg: 18,
};

// White-hot plume for missiles.
export const MISSILE_EXHAUST: ExhaustStyle = {
  tint: 0xffffff,
  scaleStart: 0.35,
  lifespan: 260,
  speed: 50,
  quantity: 2,
  spreadDeg: 10,
};

// Generate the soft round particle once per scene (radial white falloff so the
// ADD blend reads as a glow rather than a hard disc).
function ensureExhaustTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(EXHAUST_TEXTURE_KEY)) return;
  const size = 16;
  const canvas = scene.textures.createCanvas(EXHAUST_TEXTURE_KEY, size, size);
  if (!canvas) return;
  const ctx = canvas.getContext();
  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  canvas.refresh();
}

export class Exhaust {
  private readonly emitters: Phaser.GameObjects.Particles.ParticleEmitter[];
  // Per-nozzle running state. Ships start with every engine lit; the campaign's
  // cold start shuts them down and brings them back one at a time.
  private readonly running: boolean[];

  constructor(
    scene: Phaser.Scene,
    private readonly host: Phaser.GameObjects.Sprite,
    private readonly nozzles: { x: number; y: number }[],
    style: ExhaustStyle,
  ) {
    ensureExhaustTexture(scene);
    this.running = nozzles.map(() => true);
    const { spreadDeg, speed } = style;
    this.emitters = nozzles.map(() =>
      scene.add.particles(host.x, host.y, EXHAUST_TEXTURE_KEY, {
        lifespan: style.lifespan,
        // Velocity range fans the plume out into a fountain rather than a jet.
        speed: { min: speed * 0.5, max: speed },
        // Aim each particle dead aft of the host's *current* heading, with a
        // narrow random spread. Evaluated per particle (onEmit), so the cone
        // follows the ship/missile as it turns instead of spraying radially.
        angle: () => host.angle + 180 + Phaser.Math.FloatBetween(-spreadDeg, spreadDeg),
        scale: { start: style.scaleStart, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: style.tint,
        blendMode: Phaser.BlendModes.ADD,
        quantity: style.quantity,
      }).setDepth(host.depth),
    );
  }

  // Number of independently controllable nozzles (one per engine).
  get nozzleCount(): number {
    return this.emitters.length;
  }

  // Light or shut down a single nozzle's plume. Out-of-range indices are ignored.
  setNozzleRunning(index: number, running: boolean): void {
    if (index < 0 || index >= this.running.length) return;
    this.running[index] = running;
  }

  // Reposition each emitter onto its nozzle. Called from the host's preUpdate so
  // it tracks the moving sprite (emission aim is handled per particle, above).
  // Exhaust only runs while the host is visible and while that nozzle's engine
  // is running; its alpha tracks the host's so a ship fading out at the edge
  // of visual range doesn't leave a fully bright plume behind to give it away.
  update(): void {
    const hostAlpha = this.host.alpha;
    const hostLive = this.host.active && this.host.visible && hostAlpha > 0;
    const rad = Phaser.Math.DegToRad(this.host.angle);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    for (let i = 0; i < this.emitters.length; i++) {
      const emitter = this.emitters[i];
      const nozzle = this.nozzles[i];
      // Offset from the host's pivot (its origin, in unscaled texture
      // pixels), scaled and rotated into world space.
      const lx = (nozzle.x - this.host.displayOriginX) * this.host.scaleX;
      const ly = (nozzle.y - this.host.displayOriginY) * this.host.scaleY;
      emitter.setPosition(
        this.host.x + lx * cos - ly * sin,
        this.host.y + lx * sin + ly * cos,
      );
      const live = hostLive && this.running[i];
      emitter.emitting = live;
      emitter.setVisible(live);
      emitter.setAlpha(hostAlpha);
    }
  }

  destroy(): void {
    this.emitters.forEach(e => e.destroy());
  }
}
