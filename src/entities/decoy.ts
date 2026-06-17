import { decoySettings } from '../radar/data/radarGameSettings';

// A deployed chaff cloud. Represented visually as a sprite and geometrically as
// a circle: when a
// radar beam (raycast line) passes through it, the receiver may fail to return
// the signal (see Receiver.isBlockedByDecoy). It drifts nowhere — it lingers in
// place and fades over its lifetime, so the player can manoeuvre to put it
// between their ship and a threat radar.
export class Decoy {
  private readonly visual: Phaser.GameObjects.Image;
  private readonly createdAt: number;
  private readonly radius: number;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.radius = decoySettings.RADIUS;
    this.createdAt = scene.time.now;
    this.visual = scene.add.image(x, y, 'chaff').setAlpha(0.75);
    this.visual.setDisplaySize(this.radius * 2, this.radius * 2);
  }

  // Geometry used for beam-intersection tests.
  getCircle(): Phaser.Geom.Circle {
    return new Phaser.Geom.Circle(this.visual.x, this.visual.y, this.radius);
  }

  isExpired(now: number): boolean {
    return now - this.createdAt >= decoySettings.LIFETIME_MS;
  }

  // Fade the cloud out across its lifetime.
  update(now: number): void {
    const t = (now - this.createdAt) / decoySettings.LIFETIME_MS;
    this.visual.setAlpha(Math.max(0, 0.75 * (1 - t)));
  }

  destroy(): void {
    this.visual.destroy();
  }
}
