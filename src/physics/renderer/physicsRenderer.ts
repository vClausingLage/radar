import Phaser from "phaser";
import { explosionSettings } from "../../settings";

// A hull breaking up in vacuum: no air to carry a fireball or a blast wave, so
// the picture is a short flash, hot fragments flying out on straight lines and
// an expanding shell of debris gas. Scenery only — no Matter body, so a
// detonation never echoes on a radar. Like the sprite it replaces it ignores
// visual-range fade: it is bright enough to be seen from anywhere on the map.
export class PhysicsRenderer {
	constructor(private readonly scene: Phaser.Scene, private readonly effects = true) {}

	spawnExplosion(x: number, y: number): void {
		if (!this.effects) return;
		const settings = explosionSettings;

		const flash = this.scene.add.image(x, y, "flares")
			.setDepth(settings.DEPTH)
			.setBlendMode(Phaser.BlendModes.ADD);
		this.scene.tweens.add({
			targets: flash,
			scale: { from: 0.4, to: settings.FLASH_SCALE },
			alpha: { from: 1, to: 0 },
			duration: settings.FLASH_MS,
			ease: "Quad.easeOut",
			onComplete: () => flash.destroy()
		});

		const shell = this.scene.add.circle(x, y, settings.SHELL_RADIUS_PX)
			.setStrokeStyle(2, settings.SHELL_COLOR)
			.setDepth(settings.DEPTH);
		this.scene.tweens.add({
			targets: shell,
			scale: { from: 0.2, to: 1 },
			alpha: { from: 0.9, to: 0 },
			duration: settings.SHELL_MS,
			ease: "Cubic.easeOut",
			onComplete: () => shell.destroy()
		});

		const fragments = this.scene.add.particles(x, y, "flares", {
			lifespan: { min: settings.FRAGMENT_MS * 0.4, max: settings.FRAGMENT_MS },
			speed: { min: settings.FRAGMENT_SPEED * 0.25, max: settings.FRAGMENT_SPEED },
			angle: { min: 0, max: 360 },
			scale: { start: 0.4, end: 0.05 },
			alpha: { start: 1, end: 0 },
			// White-hot metal cooling through orange to dull red as it flies.
			color: [0xffffff, 0xffc14d, 0xff5a1f, 0x5a1408],
			blendMode: Phaser.BlendModes.ADD,
			emitting: false,
		}).setDepth(settings.DEPTH);
		fragments.explode(settings.FRAGMENT_COUNT);
		this.scene.time.delayedCall(settings.FRAGMENT_MS, () => fragments.destroy());

		this.shakeIfNear(x, y);
	}

	// The shake stands for what reaches the pilot's eye nearby: only a blast close
	// to the view jolts it, so a distant kill never disturbs the scope.
	private shakeIfNear(x: number, y: number): void {
		const camera = this.scene.cameras.main;
		const distance = Phaser.Math.Distance.Between(x, y, camera.midPoint.x, camera.midPoint.y);
		if (distance > explosionSettings.SHAKE_RANGE_PX) return;
		const closeness = 1 - distance / explosionSettings.SHAKE_RANGE_PX;
		camera.shake(explosionSettings.SHAKE_MS, explosionSettings.SHAKE_INTENSITY * closeness);
	}
}
