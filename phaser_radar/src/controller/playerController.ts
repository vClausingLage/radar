import { PlayerShip } from "../entities/ship";

// controller/playerController.ts
export class PlayerController {
  private turn = 0;
  
  constructor(
    private scene: Phaser.Scene,
    private ship: PlayerShip
  ) {
    this.setupControls();
  }
  
  private setupControls(): void {
    this.scene.input.keyboard?.on('keydown-A', () => this.turn = -1);
    this.scene.input.keyboard?.on('keyup-A', () => this.turn = 0);
    this.scene.input.keyboard?.on('keydown-D', () => this.turn = 1);
    this.scene.input.keyboard?.on('keyup-D', () => this.turn = 0);
    this.scene.input.keyboard?.on('keydown-Q', () => {
      this.ship.radar.setLoadout();
    });
  }
  
  update(speed: number): void {
    this.ship.setAngularVelocity(this.turn * speed);
    const angleRad = Phaser.Math.DegToRad(this.ship.angle);
    this.ship.setVelocity(
      Math.cos(angleRad) * speed,
      Math.sin(angleRad) * speed
    );
  }
}