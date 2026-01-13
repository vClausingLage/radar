import Phaser from "phaser";

export class PhysicsRenderer {
	constructor(private readonly scene: Phaser.Scene) {}

	spawnExplosion(x: number, y: number): void {
		const sprite = this.scene.add.sprite(x, y, "explosion");
		sprite.setDepth(1000);

		this.scene.tweens.add({
			targets: sprite,
			scale: { from: 1, to: 1.8 },
			alpha: { from: 1, to: 0 },
			duration: 400,
			ease: "Sine.easeOut",
			onComplete: () => sprite.destroy()
		});
	}
}