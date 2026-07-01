import Phaser from 'phaser';

// Engine-exhaust particle plume for ships and missiles. One emitter per nozzle,
// pinned to the nozzle's world position each frame and aimed straight out the
// back of the host. The emitters are independent scene objects (not children of
// the host) so they keep streaming particles in world space as the host moves.

const EXHAUST_TEXTURE_KEY = 'exhaustParticle';

// Local nozzle offsets from each texture's centre, in unscaled texture pixels.
// Every sprite faces right (+x = nose), so exhaust exits toward -x (the rear).
//   ship.png   69×68  nozzles (5,5) & (5,62)   → centre (34.5, 34)
//   cargo.png 166×70  nozzles (15,17) & (15,55) → centre (83, 35)
//   missile.png 30×14 nozzle  (2,7)            → centre (15, 7)
export const EXHAUST_NOZZLES: Record<string, { x: number; y: number }[]> = {
  ship: [{ x: -29.5, y: -29 }, { x: -29.5, y: 28 }],
  cargo: [{ x: -68, y: -18 }, { x: -68, y: 20 }],
  missile: [{ x: -13, y: 0 }],
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

  constructor(
    scene: Phaser.Scene,
    private readonly host: Phaser.GameObjects.Sprite,
    private readonly nozzles: { x: number; y: number }[],
    style: ExhaustStyle,
  ) {
    ensureExhaustTexture(scene);
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

  // Reposition each emitter onto its nozzle. Called from the host's preUpdate so
  // it tracks the moving sprite (emission aim is handled per particle, above).
  // Exhaust only runs while the host is visible — invisible target ships stay
  // dark on the radar.
  update(): void {
    const live = this.host.active && this.host.visible;
    const rad = Phaser.Math.DegToRad(this.host.angle);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    for (let i = 0; i < this.emitters.length; i++) {
      const emitter = this.emitters[i];
      const nozzle = this.nozzles[i];
      // Rotate the (scaled) local nozzle offset into world space.
      const lx = nozzle.x * this.host.scaleX;
      const ly = nozzle.y * this.host.scaleY;
      emitter.setPosition(
        this.host.x + lx * cos - ly * sin,
        this.host.y + lx * sin + ly * cos,
      );
      emitter.emitting = live;
      emitter.setVisible(live);
    }
  }

  destroy(): void {
    this.emitters.forEach(e => e.destroy());
  }
}
