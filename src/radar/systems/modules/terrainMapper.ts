import Phaser from 'phaser';
import { TerrainRenderer } from '../../renderer/terrainRenderer';
import {
  TERRAIN_BEAM_WIDTH_DEG,
  TERRAIN_BLOOM_DEPTH_PX,
  TERRAIN_BLOOM_ROUGHNESS,
  TERRAIN_MAX_SAMPLES,
  TERRAIN_PULSE_LENGTH_PX,
  TERRAIN_SAMPLE_TTL_MS,
  TERRAIN_SPECKLES_PER_PULSE_LENGTH,
  TERRAIN_SPECKLE_DROPOUT_PROB,
  TERRAIN_SPECKLE_LENGTH_PX,
} from '../../data/radarGameSettings';

// One scatterer inside a return's resolution cell: where it lit up, how long
// a dash it makes across the beam, and how brightly (0..1).
export type TerrainSpeckle = {
  x: number;
  y: number;
  halfLength: number;
  intensity: number;
};

// One raw beam return off terrain: the surface point the pulse's leading edge
// hit, when (for fading), the across-beam direction the echo smears along,
// and the speckle pattern fixed at the moment of the echo — a real scope
// paints the cell once per sweep, it does not re-roll the noise every frame.
export type TerrainSample = {
  x: number;
  y: number;
  at: number;
  tangent: { x: number; y: number };
  speckles: TerrainSpeckle[];
};

// Ground-mapping half of the radar. Unlike ships, terrain never enters the
// receiver/tracking pipeline — there is nothing to track. This module just
// collects the raw hit points the beam paints off terrain as the sweep passes
// and hands them to the TerrainRenderer, which draws them like a mapping
// radar's display: persistent, slowly-decaying returns with a radar shadow.
export class TerrainMapper {
  private samples: TerrainSample[] = [];
  // Player-only, like the RadarRenderer; AI radars map nothing.
  private renderer: TerrainRenderer | null = null;
  // Slow random walk (0..1) scaling the bloom from one return to the next, so
  // the depth of the paint wanders organically along a surface instead of
  // tracing the hull's outline exactly.
  private bloomLump = 0.7;

  setRenderer(renderer: TerrainRenderer): void {
    this.renderer = renderer;
  }

  // Record a beam return off terrain. Without a renderer (AI radars) the
  // sample is discarded — nothing consumes it.
  addSample(
    point: { x: number; y: number },
    surfaceNormal: { x: number; y: number },
    radarPos: { x: number; y: number },
    now: number,
  ): void {
    if (!this.renderer) return;
    this.samples.push(this.resolveCell(point, surfaceNormal, radarPos, now));
    if (this.samples.length > TERRAIN_MAX_SAMPLES) this.samples.shift();
  }

  // The echo is not a point. The beam is TERRAIN_BEAM_WIDTH_DEG wide, so the
  // radar cannot tell where across it the energy came back from — the return
  // spreads over the whole beamwidth at that range. And it has depth: the
  // pulse's tail is still arriving after the leading edge struck
  // (TERRAIN_PULSE_LENGTH_PX), and a surface facing the antenna square-on
  // echoes so hard that the receiver saturates and the paint blooms further
  // still, while a limb caught at a grazing angle barely registers. Inside
  // that cell a rough surface returns speckle — scatterers of random
  // brightness, some too faint to register, dimming towards the tail — which
  // is what gives a map its grain.
  private resolveCell(
    point: { x: number; y: number },
    surfaceNormal: { x: number; y: number },
    radarPos: { x: number; y: number },
    now: number,
  ): TerrainSample {
    const dx = point.x - radarPos.x;
    const dy = point.y - radarPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    // Along the beam, away from the antenna; and across it.
    const ux = dx / dist;
    const uy = dy / dist;
    const tangent = { x: -uy, y: ux };
    const halfWidth = dist * Math.tan(Phaser.Math.DegToRad(TERRAIN_BEAM_WIDTH_DEG / 2));

    // Cosine of the incidence angle: 1 face-on, 0 at a grazing limb. The
    // normal's orientation is not guaranteed, so take it either way round.
    const facing = Math.abs(ux * surfaceNormal.x + uy * surfaceNormal.y);
    this.bloomLump = Phaser.Math.Clamp(
      this.bloomLump + (Math.random() - 0.5) * TERRAIN_BLOOM_ROUGHNESS, 0.25, 1);
    // Echo power goes with the square of the facing cosine, and so does the
    // bloom that power drives.
    const depth = TERRAIN_PULSE_LENGTH_PX + TERRAIN_BLOOM_DEPTH_PX * facing * facing * this.bloomLump;

    const speckles: TerrainSpeckle[] = [];
    const count = Math.round(TERRAIN_SPECKLES_PER_PULSE_LENGTH * depth / TERRAIN_PULSE_LENGTH_PX);
    for (let i = 0; i < count; i++) {
      if (Math.random() < TERRAIN_SPECKLE_DROPOUT_PROB) continue;
      const across = (Math.random() * 2 - 1) * halfWidth;
      // Mostly behind the leading edge, a little in front (range jitter of
      // the leading edge itself).
      const along = (Math.random() * 1.15 - 0.15) * depth;
      // The saturated tail decays: brightest at the surface, fading into the
      // shadow.
      const tail = Phaser.Math.Clamp(along / depth, 0, 1);
      speckles.push({
        x: point.x + ux * along + tangent.x * across,
        y: point.y + uy * along + tangent.y * across,
        halfLength: (0.3 + Math.random() * 0.7) * TERRAIN_SPECKLE_LENGTH_PX / 2,
        intensity: (0.35 + Math.random() * 0.65) * (1 - 0.7 * tail),
      });
    }

    return { x: point.x, y: point.y, at: now, tangent, speckles };
  }

  // Prune decayed returns and draw the survivors. Called once per frame.
  render(graphics: Phaser.GameObjects.Graphics, radarPos: { x: number; y: number }, range: number, now: number): void {
    if (!this.renderer) return;
    this.samples = this.samples.filter(s => now - s.at < TERRAIN_SAMPLE_TTL_MS);
    this.renderer.render(graphics, this.samples, radarPos, range, now);
  }
}
