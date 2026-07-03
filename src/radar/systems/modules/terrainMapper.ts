import { TerrainRenderer } from '../../renderer/terrainRenderer';
import { TERRAIN_MAX_SAMPLES, TERRAIN_SAMPLE_TTL_MS } from '../../data/radarGameSettings';

// One raw beam return off terrain: where the pulse hit, and when (for fading).
export type TerrainSample = {
  x: number;
  y: number;
  at: number;
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

  setRenderer(renderer: TerrainRenderer): void {
    this.renderer = renderer;
  }

  // Record a beam return off terrain. Without a renderer (AI radars) the
  // sample is discarded — nothing consumes it.
  addSample(point: { x: number; y: number }, now: number): void {
    if (!this.renderer) return;
    this.samples.push({ x: point.x, y: point.y, at: now });
    if (this.samples.length > TERRAIN_MAX_SAMPLES) this.samples.shift();
  }

  // Prune decayed returns and draw the survivors. Called once per frame.
  render(graphics: Phaser.GameObjects.Graphics, radarPos: { x: number; y: number }, range: number, now: number): void {
    if (!this.renderer) return;
    this.samples = this.samples.filter(s => now - s.at < TERRAIN_SAMPLE_TTL_MS);
    this.renderer.render(graphics, this.samples, radarPos, range, now);
  }
}
