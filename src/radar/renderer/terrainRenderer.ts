import Phaser from 'phaser';
import { TerrainSample } from '../systems/modules/terrainMapper';
import {
  TERRAIN_BEAM_WIDTH_DEG,
  TERRAIN_SAMPLE_TTL_MS,
  TERRAIN_SHADOW_ALPHA,
  TERRAIN_SHADOW_BIN_DEG,
} from '../data/radarGameSettings';

const SHADOW_BINS = Math.ceil(360 / TERRAIN_SHADOW_BIN_DEG);
// A return casts shadow across the whole beamwidth it was heard through, so
// it darkens the bins on either side of its own as well.
const SHADOW_SPREAD_BINS = Math.floor(TERRAIN_BEAM_WIDTH_DEG / 2 / TERRAIN_SHADOW_BIN_DEG);

// Draws the ground-mapping picture: each terrain return is a speckled
// resolution cell (grainy dashes lying across the beam, so neighbouring sweep
// returns merge into a textured band), and a dark radar shadow covers the
// region the terrain masks from the antenna out to max range — which is what
// gives the picture its depth.
export class TerrainRenderer {
  // Per-bearing occlusion, rebuilt every frame: nearest return in each bin
  // and how strongly it still shows.
  private shadowNearest = new Float32Array(SHADOW_BINS);
  private shadowStrength = new Float32Array(SHADOW_BINS);
  // Scratch wedge, reused for every bin.
  private wedge = [new Phaser.Math.Vector2(), new Phaser.Math.Vector2(), new Phaser.Math.Vector2(), new Phaser.Math.Vector2()];

  render(
    graphics: Phaser.GameObjects.Graphics,
    samples: TerrainSample[],
    radarPos: { x: number; y: number },
    range: number,
    now: number,
  ): void {
    if (samples.length === 0) return;

    // Shadow first, so the returns render on top of it.
    this.renderShadow(graphics, samples, radarPos, range, now);

    for (const s of samples) {
      const fade = this.fade(s, now);
      for (const k of s.speckles) {
        // The hottest scatterers bloom towards white on a phosphor scope.
        graphics.lineStyle(2, k.intensity > 0.8 ? 0xaaffaa : 0x33ff33, k.intensity * fade);
        graphics.lineBetween(
          k.x - s.tangent.x * k.halfLength, k.y - s.tangent.y * k.halfLength,
          k.x + s.tangent.x * k.halfLength, k.y + s.tangent.y * k.halfLength,
        );
      }
    }
  }

  // Everything behind a return, as seen from the antenna, is in shadow. One
  // stroke per return would stack where strokes overlap near the surface and
  // thin out into gaps as they fan apart with range; so instead the returns
  // are binned by bearing and each bin is filled exactly once, as a wedge
  // from its nearest return to the display range. Adjacent wedges share
  // their edge vertices, so the tone is flat everywhere.
  private renderShadow(
    graphics: Phaser.GameObjects.Graphics,
    samples: TerrainSample[],
    radarPos: { x: number; y: number },
    range: number,
    now: number,
  ): void {
    this.shadowNearest.fill(Infinity);
    this.shadowStrength.fill(0);

    for (const s of samples) {
      const dx = s.x - radarPos.x;
      const dy = s.y - radarPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= range) continue;
      const fade = this.fade(s, now);
      const bearing = Phaser.Math.Wrap(Phaser.Math.RadToDeg(Math.atan2(dy, dx)), 0, 360);
      const centre = Math.floor(bearing / TERRAIN_SHADOW_BIN_DEG);
      for (let b = centre - SHADOW_SPREAD_BINS; b <= centre + SHADOW_SPREAD_BINS; b++) {
        const i = (b + SHADOW_BINS) % SHADOW_BINS;
        if (dist < this.shadowNearest[i]) this.shadowNearest[i] = dist;
        if (fade > this.shadowStrength[i]) this.shadowStrength[i] = fade;
      }
    }

    for (let i = 0; i < SHADOW_BINS; i++) {
      const strength = this.shadowStrength[i];
      if (strength <= 0) continue;
      const near = this.shadowNearest[i];
      const a0 = Phaser.Math.DegToRad(i * TERRAIN_SHADOW_BIN_DEG);
      const a1 = Phaser.Math.DegToRad((i + 1) * TERRAIN_SHADOW_BIN_DEG);
      graphics.fillStyle(0x000000, TERRAIN_SHADOW_ALPHA * strength);
      this.wedge[0].set(radarPos.x + Math.cos(a0) * near, radarPos.y + Math.sin(a0) * near);
      this.wedge[1].set(radarPos.x + Math.cos(a1) * near, radarPos.y + Math.sin(a1) * near);
      this.wedge[2].set(radarPos.x + Math.cos(a1) * range, radarPos.y + Math.sin(a1) * range);
      this.wedge[3].set(radarPos.x + Math.cos(a0) * range, radarPos.y + Math.sin(a0) * range);
      graphics.fillPoints(this.wedge, true);
    }
  }

  // Phosphor decay: fresh returns are bright, old ones fade to nothing.
  private fade(s: TerrainSample, now: number): number {
    return Phaser.Math.Clamp(1 - (now - s.at) / TERRAIN_SAMPLE_TTL_MS, 0, 1);
  }
}
