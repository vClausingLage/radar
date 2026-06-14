import { Track } from "../../radar/data/track";
import { Asteroid } from "../../entities/asteroid";
import { Missile } from "../../entities/missiles";
import { Loadout } from "../../types";

import { Pulse } from "../systems/modules/emitter";
import { Vector2 } from "../../types";

interface IRadarRenderer {
  update(
    graphics: Phaser.GameObjects.Graphics,
    radarPosition: Vector2,
    radarRange: number,
    scanStartAngle: number,
    scanEndAngle: number,
    activeMissiles: Missile[],
    loadout: Loadout,
    vim220Waypoints: Vector2[],
    pulse?: Pulse,
    sttMode?: boolean,
    vim220TimeToActive?: number | null,
  ): void;
}

export class RadarRenderer implements IRadarRenderer {

  private rangeText: Phaser.GameObjects.Text | undefined;
  private activeLoadout: Phaser.GameObjects.Text | undefined;
  private scene: Phaser.Scene | null = null;

  setScene(scene: Phaser.Scene) {
    this.scene = scene;
  }

  private renderPulse(graphics: Phaser.GameObjects.Graphics, pulse: Pulse, sttMode = false): void {
    graphics.lineStyle(1, sttMode ? 0xff0000 : 0x00ff00, 0.5);
    graphics.strokeLineShape(pulse.line);
  }

  renderRadarScanInterface(graphics: Phaser.GameObjects.Graphics, radarPosition: Vector2, radarRange: number, startAngle: number, endAngle: number, activeMissiles: Missile[], loadout: Loadout, vim220Waypoints: Vector2[] = [], vim220TimeToActive: number | null = null): void {
    const endX = radarPosition.x + radarRange * Math.cos(Phaser.Math.DegToRad(endAngle));
    const endY = radarPosition.y + radarRange * Math.sin(Phaser.Math.DegToRad(endAngle));
    
    if (!this.activeLoadout && this.scene) {
        this.activeLoadout = this.scene.add.text(endX, endY, "\n\n\n No Active Missile", { color: '#00ff00' }).setRotation(Phaser.Math.DegToRad(endAngle + 90));
    }
    if (!this.rangeText && this.scene) {
        this.rangeText = this.scene.add.text(endX, endY, `\n ${radarRange}\n ${activeMissiles?.length && activeMissiles[0].missileAge > 0 ? activeMissiles[0].missileAge : ''}`, { color: '#00ff00' }).setRotation(Phaser.Math.DegToRad(endAngle + 90));
    }

    graphics.lineStyle(1, 0x00ff00, 0.5);
    const startX = radarPosition.x + radarRange * Math.cos(Phaser.Math.DegToRad(startAngle));
    const startY = radarPosition.y + radarRange * Math.sin(Phaser.Math.DegToRad(startAngle));
    graphics.lineBetween(radarPosition.x, radarPosition.y, startX, startY);
    
    graphics.lineBetween(radarPosition.x, radarPosition.y, endX, endY);
    // Draw arc
    graphics.beginPath();
    graphics.arc(radarPosition.x, radarPosition.y, radarRange, Phaser.Math.DegToRad(startAngle), Phaser.Math.DegToRad(endAngle), false);
    graphics.strokePath();

    if (this.rangeText) {
      this.rangeText.setPosition(endX, endY);
      this.rangeText.setRotation(Phaser.Math.DegToRad(endAngle + 90));
    }
    if (this.activeLoadout) {
      this.activeLoadout.setPosition(endX, endY);
      this.activeLoadout.setRotation(Phaser.Math.DegToRad(endAngle + 90));
    }
    if (loadout) {
      let loadoutText = '';
      for (const missileType in loadout) {
        const missileData = loadout[missileType as keyof Loadout];
        if (missileData.active) {
          loadoutText += `${missileType}\n ${missileData.load} `;
        }
      }
      // Time-to-active readout for the last-fired VIM-220, beneath the loadout.
      if (vim220TimeToActive !== null) {
        loadoutText += vim220TimeToActive > 0
          ? `\n TTA ${vim220TimeToActive}s`
          : `\n RADAR ACTIVE`;
      }
      if (this.activeLoadout) {
        this.activeLoadout.setText(`\n\n\n ${loadoutText}`);
      }
    } else {
      if (this.activeLoadout) {
        this.activeLoadout.setText(`\n\n\n No Active Missile`);
      }
    }

    this.renderVim220Waypoints(graphics, vim220Waypoints);
  }


  private renderVim220Waypoints(graphics: Phaser.GameObjects.Graphics, waypoints: Vector2[]): void {
    if (waypoints.length === 0) return;

    graphics.fillStyle(0xffff00, 1);
    waypoints.forEach((point) => {
      graphics.fillCircle(point.x, point.y, 5);
    });
  }

  renderRwsContacts(graphics: Phaser.GameObjects.Graphics, track: Track): void {
    const { x, y } = track.pos;

    // Green box at track position
    graphics.fillStyle(0x00ff00, 0.7);
    graphics.fillRect(x - 5, y - 5, 10, 10);

    // Velocity vector line
    if (track.dir && track.speed > 0) {
      const rad = Phaser.Math.DegToRad(track.dir);
      const lineLength = 20;
      graphics.lineStyle(2, 0x00ff00, 1);
      graphics.lineBetween(x, y, x + Math.cos(rad) * lineLength, y + Math.sin(rad) * lineLength);
    }
  }

  renderStt(track: Track, graphics: Phaser.GameObjects.Graphics): void {
    const { x, y } = track.pos;

    // Box at track position
    graphics.fillStyle(0xff0000, 0.7);
    graphics.fillRect(x - 5, y - 5, 10, 10);

    // Velocity vector line
    if (track.dir && track.speed > 0) {
      const rad = Phaser.Math.DegToRad(track.dir);
      const lineLength = 20;
      graphics.lineStyle(2, 0xff0000, 1);
      graphics.lineBetween(x, y, x + Math.cos(rad) * lineLength, y + Math.sin(rad) * lineLength);
    }
  }

  renderMissiles(missiles: Missile[]): void {
    // Physics updates position; keep rotation consistent if needed
    missiles.forEach(m => {
      m.setAngle(Phaser.Math.RadToDeg(Math.atan2(m.direction.y, m.direction.x)));
    });
  }

  renderAsteroids(asteroids: Asteroid[]): void {
    // Currently unused: reserved for terrain-like rendering pass
    void asteroids;
  }

  destroy(): void {
    this.rangeText?.destroy();
    this.activeLoadout?.destroy();
    this.rangeText = undefined;
    this.activeLoadout = undefined;
  }

  update(
    graphics: Phaser.GameObjects.Graphics,
    radarPosition: Vector2,
    radarRange: number,
    scanStartAngle: number,
    scanEndAngle: number,
    activeMissiles: Missile[],
    loadout: Loadout,
    vim220Waypoints: Vector2[],
    pulse?: Pulse,
    sttMode = false,
    vim220TimeToActive: number | null = null,
  ): void {
    if (pulse) {
      this.renderPulse(graphics, pulse, sttMode);
    }

    this.renderRadarScanInterface(
      graphics,
      radarPosition,
      radarRange,
      scanStartAngle,
      scanEndAngle,
      activeMissiles,
      loadout,
      vim220Waypoints,
      vim220TimeToActive,
    );
  }
}