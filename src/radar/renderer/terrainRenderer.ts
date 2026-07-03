import { TerrainSample } from '../systems/modules/terrainMapper';
import {
  TERRAIN_BLOB_RADIUS_PX,
  TERRAIN_SAMPLE_TTL_MS,
  TERRAIN_SHADOW_ALPHA,
  TERRAIN_SHADOW_WIDTH_PX,
} from '../data/radarGameSettings';

// Draws the ground-mapping picture: each raw terrain return becomes a soft
// green blob (stacked translucent circles blur into a coherent shape as the
// sweep paints neighbouring returns), and a dark radar shadow is cast from the
// return away from the antenna out to max range — the region the terrain
// masks, which is what gives the picture its depth.
export class TerrainRenderer {
  render(
    graphics: Phaser.GameObjects.Graphics,
    samples: TerrainSample[],
    radarPos: { x: number; y: number },
    range: number,
    now: number,
  ): void {
    if (samples.length === 0) return;

    // Shadows first, so the blobs render on top of them.
    for (const s of samples) {
      const fade = this.fade(s, now);
      const dx = s.x - radarPos.x;
      const dy = s.y - radarPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const shadowLen = range - dist;
      if (shadowLen <= 0) continue;

      // Darken everything behind the return along the beam direction.
      graphics.lineStyle(TERRAIN_SHADOW_WIDTH_PX, 0x000000, TERRAIN_SHADOW_ALPHA * fade);
      graphics.lineBetween(
        s.x, s.y,
        s.x + (dx / dist) * shadowLen,
        s.y + (dy / dist) * shadowLen,
      );
    }

    // Blobs: three concentric translucent layers per return read as a soft,
    // blurry green mass once neighbouring sweep returns overlap.
    for (const s of samples) {
      const fade = this.fade(s, now);
      graphics.fillStyle(0x00ff00, 0.08 * fade);
      graphics.fillCircle(s.x, s.y, TERRAIN_BLOB_RADIUS_PX);
      graphics.fillStyle(0x00ff00, 0.14 * fade);
      graphics.fillCircle(s.x, s.y, TERRAIN_BLOB_RADIUS_PX * 0.55);
      graphics.fillStyle(0x66ff66, 0.28 * fade);
      graphics.fillCircle(s.x, s.y, TERRAIN_BLOB_RADIUS_PX * 0.25);
    }
  }

  // Phosphor decay: fresh returns are bright, old ones fade to nothing.
  private fade(s: TerrainSample, now: number): number {
    return Phaser.Math.Clamp(1 - (now - s.at) / TERRAIN_SAMPLE_TTL_MS, 0, 1);
  }
}
