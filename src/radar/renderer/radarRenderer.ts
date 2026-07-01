import { Track } from "../../radar/data/track";
import { Asteroid } from "../../entities/asteroid";
import { Missile } from "../../entities/missiles";
import { Loadout } from "../data/types";

import { Pulse } from "../systems/modules/emitter";
import { Vector2 } from "../../types";
import {
  JAMMER_CONE_DEG,
  MISSILE_RANGE_CAP_LENGTH_PX,
  RADAR_CONTACT_MARKER_SIZE_PX,
  RADAR_TRACK_HISTORY_DOT_RADIUS_PX,
  RADAR_TRACK_VECTOR_LENGTH_PX,
  VIM220_WAYPOINT_MARKER_RADIUS_PX,
  VIM220_WAYPOINT_MARKER_SIDES,
} from "../data/radarGameSettings";
import { JammerHudStatus } from "../systems/modules/jammer";

export class RadarRenderer {

  private rangeText: Phaser.GameObjects.Text | undefined;
  private activeLoadout: Phaser.GameObjects.Text | undefined;
  // Jammer status readout, pinned to the left (start-angle) edge of the cone.
  private jammerText: Phaser.GameObjects.Text | undefined;
  private scene: Phaser.Scene | null = null;

  setScene(scene: Phaser.Scene) {
    this.scene = scene;
  }

  private renderPulse(graphics: Phaser.GameObjects.Graphics, pulse: Pulse, sttMode = false): void {
    graphics.lineStyle(1, sttMode ? 0xff0000 : 0x00ff00, 0.5);
    graphics.strokeLineShape(pulse.line);
  }

  renderRadarScanInterface(graphics: Phaser.GameObjects.Graphics, radarPosition: Vector2, radarRange: number, startAngle: number, endAngle: number, activeMissiles: Missile[], loadout: Loadout, vim220Waypoints: Vector2[] = [], vim220TimeToActive: number | null = null, jammerStatus: JammerHudStatus | null = null, vim220WaypointAlpha = 1): void {
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

    // Jammer status on the left (start-angle) cone edge, mirroring the loadout
    // readout on the right edge.
    if (jammerStatus) {
      if (!this.jammerText && this.scene) {
        // Right-aligned origin (1, 0) so the label grows outward — to the left
        // of the start edge — instead of back into the cone interior.
        this.jammerText = this.scene.add.text(startX, startY, '', { color: jammerStatus.color }).setOrigin(1, 0);
      }
      if (this.jammerText) {
        this.jammerText.setText(`\n ${jammerStatus.label} `);
        this.jammerText.setColor(jammerStatus.color);
        // Anchor to the start-edge tip and rotate tangent to the arc, mirroring
        // the loadout readout on the end edge. This tracks the cone at any
        // orientation, unlike a fixed pixel offset.
        this.jammerText.setPosition(startX, startY);
        this.jammerText.setRotation(Phaser.Math.DegToRad(startAngle + 90));
      }
    }

    this.renderVim220Waypoints(graphics, vim220Waypoints, vim220WaypointAlpha);
  }


  private renderVim220Waypoints(graphics: Phaser.GameObjects.Graphics, waypoints: Vector2[], alpha = 1): void {
    if (waypoints.length === 0 || alpha <= 0) return;

    // Direction leg between WP1 (steer-to) and WP2 (direction point).
    if (waypoints.length >= 2) {
      graphics.lineStyle(1, 0xffff00, 0.6 * alpha);
      graphics.lineBetween(waypoints[0].x, waypoints[0].y, waypoints[1].x, waypoints[1].y);
    }

    graphics.fillStyle(0xffff00, alpha);
    waypoints.forEach((point) => {
      this.fillPentagon(graphics, point.x, point.y, VIM220_WAYPOINT_MARKER_RADIUS_PX);
    });
  }

  // Draw a small filled pentagon centred on (cx, cy), pointing up.
  private fillPentagon(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, radius: number): void {
    const points: Phaser.Types.Math.Vector2Like[] = [];
    for (let i = 0; i < VIM220_WAYPOINT_MARKER_SIDES; i++) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / VIM220_WAYPOINT_MARKER_SIDES;
      points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    }
    graphics.fillPoints(points, true);
  }

  // Jamming cone projected ahead of the ship while its jammer is active. Drawn
  // as a translucent red wedge so the player can see the spoofing coverage.
  renderJammerCone(
    graphics: Phaser.GameObjects.Graphics,
    position: Vector2,
    facingDeg: number,
    range: number,
  ): void {
    const half = JAMMER_CONE_DEG / 2;
    const startRad = Phaser.Math.DegToRad(facingDeg - half);
    const endRad = Phaser.Math.DegToRad(facingDeg + half);

    graphics.fillStyle(0xff0000, 0.12);
    graphics.beginPath();
    graphics.moveTo(position.x, position.y);
    graphics.lineTo(position.x + Math.cos(startRad) * range, position.y + Math.sin(startRad) * range);
    graphics.arc(position.x, position.y, range, startRad, endRad, false);
    graphics.closePath();
    graphics.fillPath();
  }

  // Onboard-seeker cone for a VIM-220 whose active radar has gone live. Drawn
  // like the ship's radar cone (two edge lines + a bounding arc) but stripped
  // of every readout — purely a visual reference for what the missile can
  // currently "see".
  renderMissileSeekerCone(
    graphics: Phaser.GameObjects.Graphics,
    position: Vector2,
    headingDeg: number,
    range: number,
    halfAngleDeg: number,
  ): void {
    const startRad = Phaser.Math.DegToRad(headingDeg - halfAngleDeg);
    const endRad = Phaser.Math.DegToRad(headingDeg + halfAngleDeg);

    graphics.lineStyle(1, 0x000080, 0.4);
    graphics.lineBetween(position.x, position.y, position.x + Math.cos(startRad) * range, position.y + Math.sin(startRad) * range);
    graphics.lineBetween(position.x, position.y, position.x + Math.cos(endRad) * range, position.y + Math.sin(endRad) * range);
    graphics.beginPath();
    graphics.arc(position.x, position.y, range, startRad, endRad, false);
    graphics.strokePath();
  }

  // Past track positions as a trail of small dots that fade with age — oldest
  // (history[0]) dimmest, most recent brightest. Drawn in the track's colour.
  private renderTrackHistory(graphics: Phaser.GameObjects.Graphics, track: Track, color: number): void {
    const { history } = track;
    if (!history || history.length === 0) return;

    for (let i = 0; i < history.length; i++) {
      const alpha = 0.12 + 0.4 * ((i + 1) / history.length);
      graphics.fillStyle(color, alpha);
      graphics.fillCircle(history[i].x, history[i].y, RADAR_TRACK_HISTORY_DOT_RADIUS_PX);
    }
  }

  renderRwsContacts(graphics: Phaser.GameObjects.Graphics, track: Track): void {
    const { x, y } = track.pos;
    const halfMarker = RADAR_CONTACT_MARKER_SIZE_PX / 2;

    // Fading dot trail of past positions, behind the current marker.
    this.renderTrackHistory(graphics, track, 0x00ff00);

    // Green box at track position
    graphics.fillStyle(0x00ff00, 0.7);
    graphics.fillRect(x - halfMarker, y - halfMarker, RADAR_CONTACT_MARKER_SIZE_PX, RADAR_CONTACT_MARKER_SIZE_PX);

    // Velocity vector line
    if (track.dir && track.speed > 0) {
      const rad = Phaser.Math.DegToRad(track.dir);
      graphics.lineStyle(2, 0x00ff00, 1);
      graphics.lineBetween(x, y, x + Math.cos(rad) * RADAR_TRACK_VECTOR_LENGTH_PX, y + Math.sin(rad) * RADAR_TRACK_VECTOR_LENGTH_PX);
    }
  }

  renderStt(track: Track, graphics: Phaser.GameObjects.Graphics): void {
    const { x, y } = track.pos;
    const halfMarker = RADAR_CONTACT_MARKER_SIZE_PX / 2;

    // Fading dot trail of past positions, behind the current marker.
    this.renderTrackHistory(graphics, track, 0xff0000);

    // Box at track position
    graphics.fillStyle(0xff0000, 0.7);
    graphics.fillRect(x - halfMarker, y - halfMarker, RADAR_CONTACT_MARKER_SIZE_PX, RADAR_CONTACT_MARKER_SIZE_PX);

    // Velocity vector line
    if (track.dir && track.speed > 0) {
      const rad = Phaser.Math.DegToRad(track.dir);
      graphics.lineStyle(2, 0xff0000, 1);
      graphics.lineBetween(x, y, x + Math.cos(rad) * RADAR_TRACK_VECTOR_LENGTH_PX, y + Math.sin(rad) * RADAR_TRACK_VECTOR_LENGTH_PX);
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
    this.jammerText?.destroy();
    this.rangeText = undefined;
    this.activeLoadout = undefined;
    this.jammerText = undefined;
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
    missileRange: number | null = null,
    jammerStatus: JammerHudStatus | null = null,
    vim220WaypointAlpha = 1,
  ): void {
    if (pulse) {
      this.renderPulse(graphics, pulse, sttMode);
    }

    if (missileRange !== null) {
      // Direction the ship is facing = midpoint of the scan cone.
      const facing = (scanStartAngle + scanEndAngle) / 2;
      this.renderMissileRange(graphics, radarPosition, facing, missileRange);
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
      jammerStatus,
      vim220WaypointAlpha,
    );
  }

  // Green line straight ahead of the ship marking the selected missile's max
  // range, with perpendicular "T" caps at both ends.
  private renderMissileRange(
    graphics: Phaser.GameObjects.Graphics,
    position: Vector2,
    facingDeg: number,
    range: number,
  ): void {
    const rad = Phaser.Math.DegToRad(facingDeg);
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    const endX = position.x + dx * range;
    const endY = position.y + dy * range;

    // Perpendicular unit vector for the end caps.
    const px = -dy;
    const py = dx;
    const cap = MISSILE_RANGE_CAP_LENGTH_PX;

    graphics.lineStyle(1, 0x00ff00, 0.3);
    graphics.lineBetween(position.x, position.y, endX, endY);
    graphics.lineBetween(position.x - px * cap, position.y - py * cap, position.x + px * cap, position.y + py * cap);
    graphics.lineBetween(endX - px * cap, endY - py * cap, endX + px * cap, endY + py * cap);
  }
}
