import { PlayerShip } from "../entities/ship";
import { playerShipSettings } from "../settings";

export class PlayerController {
  private turn = 0;

  // ── Movement ──────────────────────────────────────────────────────────
  private onKeyDownA = () => { this.turn = -playerShipSettings.TURN_SPEED; };
  private onKeyUpA   = () => { this.turn = 0; };
  private onKeyDownD = () => { this.turn = playerShipSettings.TURN_SPEED; };
  private onKeyUpD   = () => { this.turn = 0; };

  // ── Radar mode ────────────────────────────────────────────────────────
  // E → enter STT (lock best track)
  private onKeyDownE = () => {
    if (!this.ship.active || !this.ship.scene) return;
    this.ship.radar.enterStt();
  };
  // R → RWS search
  private onKeyDownR = () => {
    if (!this.ship.active || !this.ship.scene) return;
    this.ship.radar.enterRws();
  };
  // T → deploy a decoy (chaff). TWS remains available via its on-screen button.
  private onKeyDownT = () => {
    if (!this.ship.active || !this.ship.scene) return;
    this.ship.deployDecoy();
  };
  // Escape → exit STT, return to RWS
  private onKeyDownEsc = () => {
    if (!this.ship.active || !this.ship.scene) return;
    if (this.ship.radar.getMode() === 'stt') this.ship.radar.exitStt();
  };
  // Q → cycle active weapon
  private onKeyDownQ = () => {
    if (!this.ship.active || !this.ship.scene) return;
    this.ship.radar.cycleLoadout();
  };

  // ── Weapons ───────────────────────────────────────────────────────────
  // Space → fire (VIM-177 requires STT lock)
  private onKeyDownSpace = () => {
    if (!this.ship.active || !this.ship.scene) return;
    this.ship.radar.shoot(this.ship.getDirection());
  };

  // ── VIM-220 waypoint ──────────────────────────────────────────────────
  // Shift+click places a mid-course waypoint (only while VIM-220 is selected).
  private onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (!this.ship.active || !this.ship.scene) return;
    const shiftHeld = (pointer.event as MouseEvent | undefined)?.shiftKey;
    if (!shiftHeld) return;
    this.ship.radar.addVim220Waypoint({ x: pointer.worldX, y: pointer.worldY });
  };

  constructor(
    private scene: Phaser.Scene,
    private ship: PlayerShip,
  ) {
    this.setupControls();
  }

  private setupControls(): void {
    const kb = this.scene.input.keyboard;
    kb?.on('keydown-A', this.onKeyDownA);
    kb?.on('keyup-A',   this.onKeyUpA);
    kb?.on('keydown-D', this.onKeyDownD);
    kb?.on('keyup-D',   this.onKeyUpD);
    kb?.on('keydown-E', this.onKeyDownE);
    kb?.on('keydown-R', this.onKeyDownR);
    kb?.on('keydown-T', this.onKeyDownT);
    kb?.on('keydown-ESC', this.onKeyDownEsc);
    kb?.on('keydown-Q', this.onKeyDownQ);
    kb?.on('keydown-SPACE', this.onKeyDownSpace);
    this.scene.input.on('pointerdown', this.onPointerDown);
  }

  destroy(): void {
    const kb = this.scene.input.keyboard;
    kb?.off('keydown-A', this.onKeyDownA);
    kb?.off('keyup-A',   this.onKeyUpA);
    kb?.off('keydown-D', this.onKeyDownD);
    kb?.off('keyup-D',   this.onKeyUpD);
    kb?.off('keydown-E', this.onKeyDownE);
    kb?.off('keydown-R', this.onKeyDownR);
    kb?.off('keydown-T', this.onKeyDownT);
    kb?.off('keydown-ESC', this.onKeyDownEsc);
    kb?.off('keydown-Q', this.onKeyDownQ);
    kb?.off('keydown-SPACE', this.onKeyDownSpace);
    this.scene.input.off('pointerdown', this.onPointerDown);
  }

  update(speed: number): void {
    if (!this.ship.active || !this.ship.body) return;

    this.ship.setAngularVelocity(this.turn * speed);
    const angleRad = Phaser.Math.DegToRad(this.ship.angle);
    this.ship.setVelocity(
      Math.cos(angleRad) * speed,
      Math.sin(angleRad) * speed,
    );
  }
}
