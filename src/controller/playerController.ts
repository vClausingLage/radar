import Phaser from "phaser";
import { PlayerShip } from "../entities/ship";
import { gamepadSettings, landingSettings, playerShipSettings } from "../settings";

// The browser's standard gamepad layout, which the Steam Deck's controls report.
const PAD = Phaser.Input.Gamepad.Configs.XBOX_360;

export class PlayerController {
  private turn = 0;
  // Set while the ship is cold: no engines, no throttle to step.
  private throttleLocked = false;
  // Set while the ship is cold: no power for the radar, weapons, chaff or
  // jammer either. A key for any of them does nothing until the crew is done.
  private systemsLocked = false;

  // The ship is there to be commanded, and has the power to do it.
  private canOperate(): boolean {
    return this.ship.active && Boolean(this.ship.scene) && !this.systemsLocked;
  }

  // ── Movement ──────────────────────────────────────────────────────────
  private onKeyDownA = () => { this.turn = -playerShipSettings.TURN_SPEED; };
  private onKeyUpA   = () => { this.turn = 0; };
  private onKeyDownD = () => { this.turn = playerShipSettings.TURN_SPEED; };
  private onKeyUpD   = () => { this.turn = 0; };

  // ── Radar mode ────────────────────────────────────────────────────────
  // E → lock: in a radar mode, STT on the best track; in IRST mode, the IRST
  // onto the heat source nearest the nose. One lock key, whichever sensor the
  // mode has given the scope to.
  private onKeyDownE = () => {
    if (!this.canOperate()) return;
    const radar = this.ship.radar;
    if (radar.getMode() === 'irst') radar.lockIrst();
    else radar.enterStt();
  };
  // R → RWS search
  private onKeyDownR = () => {
    if (!this.canOperate()) return;
    this.ship.radar.enterRws();
  };
  // T → deploy a decoy (chaff). TWS remains available via its on-screen button.
  private onKeyDownT = () => {
    if (!this.canOperate()) return;
    this.ship.deployDecoy();
  };
  // Escape → break the lock: STT back to RWS; in IRST mode the IRST lets go
  // and searches again, the transmitter staying silent.
  private onKeyDownEsc = () => {
    if (!this.ship.active || !this.ship.scene) return;
    const radar = this.ship.radar;
    if (radar.getMode() === 'stt') radar.exitStt();
    else if (radar.getMode() === 'irst') radar.unlockIrst();
  };
  // Q → cycle active weapon
  private onKeyDownQ = () => {
    if (!this.ship.active || !this.ship.scene) return;
    this.ship.radar.cycleLoadout();
  };
  // J → activate the jammer (10 s burst, 20 s cooldown from activation)
  private onKeyDownJ = () => {
    if (!this.canOperate()) return;
    this.ship.radar.activateJammer();
  };

  // F → designate: step the pick to the next track outward. A lock (E) and a
  // TWS shot go to the pick before the radar's own choice.
  private onKeyDownF = () => {
    if (!this.canOperate()) return;
    this.ship.radar.cycleDesignation();
  };

  // I → interrogate (IFF) every track on the scope. Does nothing without a
  // track to point at, or while the interrogator is still cycling.
  private onKeyDownI = () => {
    if (!this.canOperate()) return;
    this.ship.radar.interrogate();
  };

  // ── Weapons ───────────────────────────────────────────────────────────
  // Space → fire (VIM-177 requires STT lock)
  private onKeyDownSpace = () => {
    if (!this.canOperate()) return;
    this.ship.radar.shoot();
  };

  // ── VIM-220 waypoint ──────────────────────────────────────────────────
  // Shift+left-click places a mid-course waypoint (only while VIM-220 is
  // selected); Shift+right-click clears the whole route.
  private onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (!this.ship.active || !this.ship.scene) return;
    const shiftHeld = (pointer.event as MouseEvent | undefined)?.shiftKey;
    if (!shiftHeld) return;
    if (pointer.rightButtonDown()) {
      this.ship.radar.clearVim220Waypoints();
      return;
    }
    this.ship.radar.addVim220Waypoint({ x: pointer.worldX, y: pointer.worldY });
  };

  // ── Gamepad (and the keys that share its steps) ───────────────────────
  // R1 / X → step the search loop RWS → TWS → IRST → EMCON → RWS (IRST only on
  // a ship that carries one). A lock is not a stop on the loop: from STT the
  // button breaks it and drops back to RWS, like Esc.
  private onPadCycleRadarMode = () => {
    if (!this.canOperate()) return;
    const radar = this.ship.radar;
    const mode = radar.getMode();
    if (mode === 'rws') radar.enterTws();
    else if (mode === 'tws' && radar.getIrst()) radar.enterIrst();
    else if (mode === 'tws' || mode === 'irst') radar.enterEmcon();
    else radar.enterRws();
  };

  // L1 / L2 / W / S → one throttle setting up / down, the same settings the
  // on-screen buttons offer. There is no stop among them: below 1/3 is astern, and that
  // is the landing approach (see landingSettings).
  private stepThrottle(direction: 1 | -1): void {
    if (this.throttleLocked || !this.ship.active || !this.ship.scene) return;
    const full = this.ship.getSpeed();
    const settings = [-landingSettings.REVERSE_SPEED, full / 3, (full * 2) / 3, full];
    const current = this.ship.getCurrentSpeed();
    const next = direction > 0
      ? settings.find(setting => setting > current)
      : settings.reverse().find(setting => setting < current);
    if (next !== undefined) this.ship.setCurrentSpeed(next);
  }
  private onPadThrottleUp = () => { this.stepThrottle(1); };
  private onPadThrottleDown = () => { this.stepThrottle(-1); };

  private padBindings: Record<number, () => void> = {
    [PAD.A]: this.onKeyDownSpace,
    [PAD.B]: this.onKeyDownE,
    [PAD.X]: this.onKeyDownT,
    [PAD.Y]: this.onKeyDownJ,
    [PAD.RB]: this.onPadCycleRadarMode,
    [PAD.LB]: this.onPadThrottleUp,
    [PAD.LT]: this.onPadThrottleDown,
    [PAD.LEFT]: this.onKeyDownQ,
    [PAD.UP]: this.onKeyDownI,
    [PAD.RIGHT]: this.onKeyDownF,
  };

  private onPadButtonDown = (_pad: Phaser.Input.Gamepad.Gamepad, button: Phaser.Input.Gamepad.Button) => {
    this.padBindings[button.index]?.();
  };

  constructor(
    private scene: Phaser.Scene,
    private ship: PlayerShip,
  ) {
    this.setupControls();
  }

  setThrottleLocked(locked: boolean): void {
    this.throttleLocked = locked;
  }

  setSystemsLocked(locked: boolean): void {
    this.systemsLocked = locked;
  }

  // L2 is an analog trigger and Phaser only counts a button as down at full
  // travel. Pads come and go between frames, so each one is set as it is seen.
  private softenThrottleTrigger(): void {
    for (const pad of this.scene.input.gamepad?.getAll() ?? []) {
      const trigger = pad.buttons[PAD.LT];
      if (trigger) trigger.threshold = gamepadSettings.TRIGGER_PRESS_THRESHOLD;
    }
  }

  // Left stick's horizontal deflection, -1..1, or 0 inside the deadzone. Taken
  // from whichever connected pad is pushed furthest, as a machine can list more
  // than one (a Deck's built-in controls and a paired controller).
  private stickTurn(): number {
    let deflection = 0;
    for (const pad of this.scene.input.gamepad?.getAll() ?? []) {
      if (Math.abs(pad.leftStick.x) > Math.abs(deflection)) deflection = pad.leftStick.x;
    }
    return Math.abs(deflection) < gamepadSettings.STICK_DEADZONE ? 0 : deflection;
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
    kb?.on('keydown-J', this.onKeyDownJ);
    kb?.on('keydown-I', this.onKeyDownI);
    kb?.on('keydown-F', this.onKeyDownF);
    kb?.on('keydown-X', this.onPadCycleRadarMode);
    kb?.on('keydown-W', this.onPadThrottleUp);
    kb?.on('keydown-S', this.onPadThrottleDown);
    kb?.on('keydown-SPACE', this.onKeyDownSpace);
    this.scene.input.gamepad?.on('down', this.onPadButtonDown);
    this.scene.input.on('pointerdown', this.onPointerDown);
    // Right-click clears the VIM-220 route (see onPointerDown) — don't let the
    // browser's context menu swallow it first.
    this.scene.input.mouse?.disableContextMenu();
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
    kb?.off('keydown-J', this.onKeyDownJ);
    kb?.off('keydown-I', this.onKeyDownI);
    kb?.off('keydown-F', this.onKeyDownF);
    kb?.off('keydown-X', this.onPadCycleRadarMode);
    kb?.off('keydown-W', this.onPadThrottleUp);
    kb?.off('keydown-S', this.onPadThrottleDown);
    kb?.off('keydown-SPACE', this.onKeyDownSpace);
    this.scene.input.gamepad?.off('down', this.onPadButtonDown);
    this.scene.input.off('pointerdown', this.onPointerDown);
  }

  update(speed: number): void {
    if (!this.ship.active || !this.ship.body) return;

    this.softenThrottleTrigger();

    // The stick scales the same full rate the keys command, for fine pointing
    // of the radar cone; a centred stick leaves the keys in charge.
    const stick = this.stickTurn();
    const turn = stick !== 0 ? stick * playerShipSettings.TURN_SPEED : this.turn;
    this.ship.setAngularVelocity(turn * speed);
    const angleRad = Phaser.Math.DegToRad(this.ship.angle);
    this.ship.setVelocity(
      Math.cos(angleRad) * speed,
      Math.sin(angleRad) * speed,
    );
  }
}
