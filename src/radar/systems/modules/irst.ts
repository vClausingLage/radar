import Phaser from 'phaser';
import type { Vector2 } from '../../../types';
import type { GasVolume, Terrain } from '../../data/types';
import { Ray } from '../../../physics/ray';
import { irSignal, irTransmission, type IrSource } from '../../data/infraredPath';
import {
  IRST_BEARING_GATE_DEG,
  IRST_FIELD_OF_REGARD_DEG,
  IRST_LOCK_BREAK_FRAMES,
  IRST_MAX_MISSED_SCANS,
  IRST_MIN_SIGNAL,
  IRST_RATED_RANGE_PX,
  IRST_RESOLUTION_DEG,
  IRST_SCAN_FRAMES,
  IRST_TRACK_FOV_DEG,
  TRACK_FILTER_ALPHA,
  TRACK_FILTER_BETA,
} from '../../data/radarGameSettings';

// A search contact: a hot thing at a bearing. No range - a passive sensor
// measures where in angle the heat comes from and how bright it is, and a
// bright near hull and a hotter far one look alike.
export type IrstContact = {
  id: number;
  bearingDeg: number;
  // Received signal, as a ratio to the detection threshold.
  signal: number;
  missedScans: number;
};

// The lock: the tracking head staring at one source, measured every tick.
// Its bearing rate is what lets it stay on a crossing target.
export type IrstLock = {
  bearingDeg: number;
  rateDegPerTick: number;
  signal: number;
  missedFrames: number;
};

// One detection on one scan: a bearing and the heat that came from it.
type Detection = { bearingDeg: number; signal: number };

// Infrared search and track: a passive sensor head beside the radar, owned by
// the ship's mission system the way the RWR is. It is one of the radar's modes
// ('irst'): selecting it shuts the transmitter down as EMCON does and hands
// the scope to the heat picture, and leaving it clears the IRST's contacts
// and lock - the head and the antenna share one display and one pilot, not a
// fused picture. It emits nothing, so nobody it looks at is ever warned.
// What it pays for that is range, width and weather: it looks across a narrow
// window off the nose only (IRST_FIELD_OF_REGARD_DEG), and it sees by the
// target's heat alone (data/infraredPath.ts) - a tail-on hull at full throttle
// far out, a nose-on one much closer, a stopped one barely at all - and gas eats
// infrared far harder than it eats the radar's band. Terrain blocks it as it
// blocks everything.
//
// Two jobs, as on a real set. Search: the head scans its field of regard every
// IRST_SCAN_FRAMES ticks and keeps a list of bearing-only contacts. Track: on
// lock() (E, the lock key, in IRST mode) it stares at the contact nearest the
// nose with a narrow window that follows the source each tick, and that line
// of sight is a cue fire control can hand an IR seeker - with the transmitter
// silent the whole time.
export class Irst {
  private contacts: IrstContact[] = [];
  private nextContactId = 1;
  private lockState: IrstLock | null = null;
  private ticksToScan = 0;
  private readonly raycaster = new Ray();

  getContacts(): IrstContact[] {
    return this.contacts;
  }

  getLock(): IrstLock | null {
    return this.lockState;
  }

  isLocked(): boolean {
    return this.lockState !== null;
  }

  // Lock the search contact nearest the nose, inside the field of regard.
  // Returns whether there was one.
  lock(headingDeg: number): boolean {
    let best: IrstContact | null = null;
    let bestOff = IRST_FIELD_OF_REGARD_DEG / 2;
    for (const c of this.contacts) {
      if (c.missedScans > 0) continue;
      const off = Math.abs(Phaser.Math.Angle.WrapDegrees(c.bearingDeg - headingDeg));
      if (off <= bestOff) { best = c; bestOff = off; }
    }
    if (!best) return false;
    this.lockState = { bearingDeg: best.bearingDeg, rateDegPerTick: 0, signal: best.signal, missedFrames: 0 };
    return true;
  }

  unlock(): void {
    this.lockState = null;
  }

  // The head is switched off (the radar left IRST mode): the search picture
  // and the lock go with it, and the next start scans at once.
  reset(): void {
    this.contacts = [];
    this.lockState = null;
    this.ticksToScan = 0;
  }

  // One simulation tick. `sources` is every hot thing in the world but the
  // owner itself.
  update(
    ownerPos: Vector2,
    headingDeg: number,
    sources: IrSource[],
    gasVolumes: GasVolume[],
    terrain: Terrain[],
  ): void {
    if (this.lockState) this.track(ownerPos, headingDeg, sources, gasVolumes, terrain);

    if (--this.ticksToScan > 0) return;
    this.ticksToScan = IRST_SCAN_FRAMES;
    const detections = this.resolve(
      this.detect(ownerPos, headingDeg, IRST_FIELD_OF_REGARD_DEG / 2, sources, gasVolumes, terrain),
      headingDeg,
    );
    this.associate(detections);
  }

  // Everything hot enough to clear the threshold inside a window of half-width
  // `halfWidthDeg` around `centreDeg`, in clear line of sight.
  private detect(
    ownerPos: Vector2,
    centreDeg: number,
    halfWidthDeg: number,
    sources: IrSource[],
    gasVolumes: GasVolume[],
    terrain: Terrain[],
  ): Detection[] {
    const found: Detection[] = [];
    for (const s of sources) {
      if (!s.active) continue;
      const bearingDeg = Phaser.Math.RadToDeg(Math.atan2(s.y - ownerPos.y, s.x - ownerPos.x));
      if (Math.abs(Phaser.Math.Angle.WrapDegrees(bearingDeg - centreDeg)) > halfWidthDeg) continue;
      const range = Phaser.Math.Distance.Between(ownerPos.x, ownerPos.y, s.x, s.y);
      const signal = irSignal(
        s.irIntensityToward(ownerPos), range, IRST_RATED_RANGE_PX, irTransmission(ownerPos, s, gasVolumes),
      );
      if (signal < IRST_MIN_SIGNAL) continue;
      if (this.raycaster.isOccluded(ownerPos, s, terrain)) continue;
      found.push({ bearingDeg, signal });
    }
    return found;
  }

  // Sources closer in bearing than the detector's resolution land on one
  // element: one detection, at the heat-weighted bearing, carrying the sum.
  // Worked in angles off the nose, so a field of regard straddling the ±180°
  // seam sorts and averages as the sensor head sees it.
  private resolve(detections: Detection[], headingDeg: number): Detection[] {
    const sorted = detections
      .map(d => ({ off: Phaser.Math.Angle.WrapDegrees(d.bearingDeg - headingDeg), signal: d.signal }))
      .sort((a, b) => a.off - b.off);
    const merged: { off: number; signal: number }[] = [];
    for (const d of sorted) {
      const last = merged[merged.length - 1];
      if (last && d.off - last.off <= IRST_RESOLUTION_DEG) {
        const total = last.signal + d.signal;
        last.off = (last.off * last.signal + d.off * d.signal) / total;
        last.signal = total;
      } else {
        merged.push({ ...d });
      }
    }
    return merged.map(m => ({ bearingDeg: Phaser.Math.Angle.WrapDegrees(headingDeg + m.off), signal: m.signal }));
  }

  // Scan-to-scan association by bearing, one detection to one contact
  // (nearest pairs first), the same rule the radar's tracker follows: a second
  // source inside a contact's gate starts a contact of its own.
  private associate(detections: Detection[]): void {
    const pairs: { d: number; c: number; off: number }[] = [];
    detections.forEach((det, d) => this.contacts.forEach((con, c) => {
      const off = Math.abs(Phaser.Math.Angle.WrapDegrees(det.bearingDeg - con.bearingDeg));
      if (off <= IRST_BEARING_GATE_DEG) pairs.push({ d, c, off });
    }));
    pairs.sort((a, b) => a.off - b.off);

    const usedD = new Set<number>();
    const usedC = new Set<number>();
    for (const { d, c } of pairs) {
      if (usedD.has(d) || usedC.has(c)) continue;
      usedD.add(d);
      usedC.add(c);
      this.contacts[c].bearingDeg = detections[d].bearingDeg;
      this.contacts[c].signal = detections[d].signal;
      this.contacts[c].missedScans = 0;
    }
    this.contacts.forEach((con, c) => { if (!usedC.has(c)) con.missedScans++; });
    this.contacts = this.contacts.filter(c => c.missedScans <= IRST_MAX_MISSED_SCANS);
    detections.forEach((det, d) => {
      if (!usedD.has(d)) {
        this.contacts.push({ id: this.nextContactId++, bearingDeg: det.bearingDeg, signal: det.signal, missedScans: 0 });
      }
    });
  }

  // The tracking head: a narrow window on where the source should be now,
  // following the strongest heat inside it. Held by geometry, not identity -
  // a hotter source that crosses the window takes the lock. Breaks when the
  // source stays out of the window too long, or the head runs into the edge
  // of its field of regard.
  private track(
    ownerPos: Vector2,
    headingDeg: number,
    sources: IrSource[],
    gasVolumes: GasVolume[],
    terrain: Terrain[],
  ): void {
    const lock = this.lockState;
    if (!lock) return;
    const predicted = Phaser.Math.Angle.WrapDegrees(lock.bearingDeg + lock.rateDegPerTick);
    if (Math.abs(Phaser.Math.Angle.WrapDegrees(predicted - headingDeg)) > IRST_FIELD_OF_REGARD_DEG / 2) {
      this.unlock();
      return;
    }

    const seen = this.detect(ownerPos, predicted, IRST_TRACK_FOV_DEG / 2, sources, gasVolumes, terrain)
      .sort((a, b) => b.signal - a.signal)[0];
    if (!seen) {
      lock.bearingDeg = predicted;
      if (++lock.missedFrames > IRST_LOCK_BREAK_FRAMES) this.unlock();
      return;
    }
    // Alpha-beta on the bearing: the rate is what the head leads a crosser by.
    const innovation = Phaser.Math.Angle.WrapDegrees(seen.bearingDeg - predicted);
    lock.bearingDeg = Phaser.Math.Angle.WrapDegrees(predicted + TRACK_FILTER_ALPHA * innovation);
    lock.rateDegPerTick += TRACK_FILTER_BETA * innovation;
    lock.signal = seen.signal;
    lock.missedFrames = 0;
  }
}
