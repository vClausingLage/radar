import Phaser from 'phaser';
import type { PlayerShip, Target } from '../../../entities/ship';
import type { Entity } from '../../data/types';
import { jammerSignal } from '../../data/signalPath';
import {
  JAMMER_STT_DEGRADE_PROB,
  JAMMER_DURATION_MS,
  JAMMER_COOLDOWN_MS,
  JAMMER_CONE_DEG,
  JAMMER_ANGLE_ERROR_MIN_DEG,
  JAMMER_ANGLE_ERROR_MAX_DEG,
  JAMMER_DISTANCE_ERROR_MIN_PX,
  JAMMER_DISTANCE_ERROR_MAX_PX,
} from "../../data/radarGameSettings";

// A single bearing/range offset applied to every spoofed return in a sweep.
export type JammerError = { angle: number; distance: number };

// The energy contest a victim radar runs against a jammer covering it: the
// burst's power J at the receiver against the echo S of the contact it is
// hiding, both as ratios to the noise floor. `jammed` is the outcome — the
// jammer won and its false picture replaced the real one; otherwise the echo
// burned through. `spoofBearingDeg` is where a winning deception put the
// false contact, or null when nothing was spoofed (a lost contest, or STT,
// where a winning burst swallows returns rather than displacing them).
export type JammingContest = {
  bearingDeg: number;
  jammerSignal: number;
  echoSignal: number;
  jammed: boolean;
  spoofBearingDeg: number | null;
};

// A jammer our beam paints while we sit in its cone: its rolled error, its
// range from us and its bearing — the inputs the energy contest runs on.
export type JammerOnBeam = { error: JammerError; range: number; bearingDeg: number };

// HUD-ready status line for the radar cone readout.
export type JammerHudStatus = { label: string; color: string };

// Active radar deception. Owned by every ship's radar (like the RwrReceiver),
// though only the player triggers it. While active it projects a cone ahead of
// the ship; an enemy radar whose beam paints this ship *and* that sits inside
// the cone has its returns rewritten into a single false track (see
// Receiver.createFakeHits). One coherent error is rolled per activation.
export class Jammer {
  // Timestamp (scene.time.now) of the last activation, or null when fully ready.
  private activatedAt: number | null = null;
  // Cached active flag, refreshed each frame by tick() so isActive() is cheap.
  private active = false;
  private error: JammerError = { angle: 0, distance: 0 };

  // Begin a jamming burst. Ignored while already active or still on cooldown.
  activate(now: number): void {
    if (this.activatedAt !== null && now - this.activatedAt < JAMMER_COOLDOWN_MS) {
      return;
    }
    this.activatedAt = now;
    this.error = this.rollError();
  }

  // Advance the active/cooldown state. Must be called once per frame before any
  // isActive() check (the radar does this at the top of update()).
  tick(now: number): void {
    if (this.activatedAt === null) {
      this.active = false;
      return;
    }
    const elapsed = now - this.activatedAt;
    this.active = elapsed < JAMMER_DURATION_MS;
    // Once the full cooldown has elapsed the jammer reports ready again.
    if (elapsed >= JAMMER_COOLDOWN_MS) this.activatedAt = null;
  }

  isActive(): boolean {
    return this.active;
  }

  // True when a fresh burst would actually start — neither transmitting nor
  // sitting on cooldown. `now` is scene.time.now.
  isReady(now: number): boolean {
    return this.activatedAt === null || now - this.activatedAt >= JAMMER_COOLDOWN_MS;
  }

  getError(): JammerError {
    return this.error;
  }

  // Cone-readout status: active countdown (red), cooldown countdown (grey), or
  // ready (green). `now` is scene.time.now.
  getHudStatus(now: number): JammerHudStatus {
    if (this.activatedAt !== null) {
      const elapsed = now - this.activatedAt;
      if (elapsed < JAMMER_DURATION_MS) {
        return { label: `XMIT ${Math.ceil((JAMMER_DURATION_MS - elapsed) / 1000)}s`, color: '#ff3030' };
      }
      if (elapsed < JAMMER_COOLDOWN_MS) {
        return { label: `XMIT in ${Math.ceil((JAMMER_COOLDOWN_MS - elapsed) / 1000)}s`, color: '#888888' };
      }
    }
    return { label: 'JAMMER RDY', color: '#00ff00' };
  }

  // True when `point` (an enemy emitter) lies inside the jamming cone projected
  // ahead of the ship at `pos` facing `directionDeg`, and within `range`.
  covers(
    pos: { x: number; y: number },
    directionDeg: number,
    point: { x: number; y: number },
    range: number,
  ): boolean {
    const dx = point.x - pos.x;
    const dy = point.y - pos.y;
    if (Math.hypot(dx, dy) > range) return false;
    const bearing = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
    const offset = Phaser.Math.Angle.WrapDegrees(bearing - directionDeg);
    return Math.abs(offset) <= JAMMER_CONE_DEG / 2;
  }

  // Roll a random offset with a random sign on each axis.
  private rollError(): JammerError {
    const angleSign = Math.random() < 0.5 ? -1 : 1;
    const distSign = Math.random() < 0.5 ? -1 : 1;
    return {
      angle: angleSign * Phaser.Math.FloatBetween(JAMMER_ANGLE_ERROR_MIN_DEG, JAMMER_ANGLE_ERROR_MAX_DEG),
      distance: distSign * Phaser.Math.FloatBetween(JAMMER_DISTANCE_ERROR_MIN_PX, JAMMER_DISTANCE_ERROR_MAX_PX),
    };
  }
}

// ── Victim side ───────────────────────────────────────────────────────────
// What a jammer does to the radar it covers. The jammer module owns both
// ends of the contest: the burst it puts out above, and how that burst fares
// against a victim's echo below.

// The jammer affecting a radar this frame, or null. A jammer affects us only
// when our beam actually paints the jamming ship *and* we (the emitter) sit
// inside its jamming cone.
export function jammerOnBeam(
  ships: Entity[],
  beamLines: Phaser.Geom.Line[],
  victimPos: { x: number; y: number },
  ratedRange: number,
  polygonOf: (entity: Entity) => Phaser.Geom.Polygon,
): JammerOnBeam | null {
  for (const entity of ships) {
    if (!isJamming(entity)) continue;

    const polygon = polygonOf(entity);
    if (!beamLines.some(line => Phaser.Geom.Intersects.GetLineToPolygon(line, polygon))) continue;

    const pos = entity.getPosition();
    if (entity.radar.jammer.covers(pos, entity.getDirection(), victimPos, ratedRange)) {
      return {
        error: entity.radar.jammer.getError(),
        range: Phaser.Math.Distance.Between(victimPos.x, victimPos.y, pos.x, pos.y),
        bearingDeg: Phaser.Math.RadToDeg(Math.atan2(pos.y - victimPos.y, pos.x - victimPos.x)),
      };
    }
  }
  return null;
}

// A jamming burst is itself an emission, and a loud one: any ship inside
// the cone hears it regardless of whose beam is where — hearing is
// one-way, and it does not depend on the energy contest (a jammer that
// cannot fool the radar is still being heard by it). These are the jammers
// covering `victimPos`, by ship id and bearing, for the victim's RWR to mark
// as strobes.
export function coveringJammers(
  ships: Entity[],
  victimPos: { x: number; y: number },
  ratedRange: number,
): { id: number; bearingDeg: number }[] {
  const strobes: { id: number; bearingDeg: number }[] = [];
  for (const entity of ships) {
    if (!isJamming(entity)) continue;
    if (!entity.radar.jammer.covers(entity.getPosition(), entity.getDirection(), victimPos, ratedRange)) continue;
    strobes.push({
      id: entity.id,
      bearingDeg: Phaser.Math.RadToDeg(Math.atan2(entity.y - victimPos.y, entity.x - victimPos.x)),
    });
  }
  return strobes;
}

// The search-sweep contest. The jammer must first win the energy contest:
// its burst is judged against the signal the sweep's real echoes actually
// carry (nominal — scintillation and CFAR ride on top). Only a burst that
// out-shouts them rewrites the sweep into one coherent false track; a weaker
// one loses and the real returns process normally — burn-through is the
// fourth-power range law doing its work.
export function sweepContest(
  jamming: JammerOnBeam,
  echoSignal: number,
  ratedRange: number,
): JammingContest {
  const jam = jammerSignal(jamming.range, ratedRange);
  const jammed = echoSignal > 0 && jam >= echoSignal;
  return {
    bearingDeg: jamming.bearingDeg,
    jammerSignal: jam,
    echoSignal,
    jammed,
    spoofBearingDeg: jammed ? jamming.bearingDeg + jamming.error.angle : null,
  };
}

// The STT contest. STT energy overpowers the jammer, so returns are not
// spoofed — but a burst that still out-shouts the lock's echo has a chance to
// swallow them, scaling with how badly the echo loses the same J/S contest
// the sweep runs. A concentrated beam's echo grows as the fourth power of
// closing range, so the burst wins only far out or against a small hull:
// burn-through protects a lock the old flat chance degraded regardless of
// geometry. `jammed` is set when this frame's echoes were swallowed.
export function sttContest(
  jamming: JammerOnBeam,
  echoSignal: number,
  ratedRange: number,
  hasEcho: boolean,
): JammingContest {
  const jam = jammerSignal(jamming.range, ratedRange);
  const swallow = JAMMER_STT_DEGRADE_PROB * (echoSignal > 0 ? Math.min(jam / echoSignal, 1) : 1);
  const swallowed = Math.random() < swallow;
  return {
    bearingDeg: jamming.bearingDeg,
    jammerSignal: jam,
    echoSignal,
    jammed: swallowed && hasEcho,
    spoofBearingDeg: null,
  };
}

// A ship with its jammer transmitting; terrain carries none.
function isJamming(entity: Entity): entity is PlayerShip | Target {
  return 'radar' in entity && entity.radar.jammer.isActive();
}
