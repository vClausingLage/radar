import { PlayerShip } from "../entities/ship";
import { playerShipSettings } from "../settings";

export class PlayerController {
  private turn = 0;
  private onKeyDownA = () => { this.turn = -playerShipSettings.TURN_SPEED; };
  private onKeyUpA = () => { this.turn = 0; };
  private onKeyDownD = () => { this.turn = playerShipSettings.TURN_SPEED; };
  private onKeyUpD = () => { this.turn = 0; };
  private onKeyDownQ = () => {
    if (!this.ship.active || !this.ship.scene) return;
    this.ship.radar.cycleLoadout();
  };
  
  constructor(
    private scene: Phaser.Scene,
    private ship: PlayerShip
  ) {
    this.setupControls();
  }
  
  private setupControls(): void {
    const keyboard = this.scene.input.keyboard;
    keyboard?.on('keydown-A', this.onKeyDownA);
    keyboard?.on('keyup-A', this.onKeyUpA);
    keyboard?.on('keydown-D', this.onKeyDownD);
    keyboard?.on('keyup-D', this.onKeyUpD);
    keyboard?.on('keydown-Q', this.onKeyDownQ);
  }

  destroy(): void {
    const keyboard = this.scene.input.keyboard;
    keyboard?.off('keydown-A', this.onKeyDownA);
    keyboard?.off('keyup-A', this.onKeyUpA);
    keyboard?.off('keydown-D', this.onKeyDownD);
    keyboard?.off('keyup-D', this.onKeyUpD);
    keyboard?.off('keydown-Q', this.onKeyDownQ);
  }
  
  update(speed: number): void {
    if (!this.ship.active || !this.ship.body) {
      return;
    }

    this.ship.setAngularVelocity(this.turn * speed);
    const angleRad = Phaser.Math.DegToRad(this.ship.angle);
    this.ship.setVelocity(
      Math.cos(angleRad) * speed,
      Math.sin(angleRad) * speed
    );
  }
}