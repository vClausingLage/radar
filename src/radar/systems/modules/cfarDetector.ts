import Phaser from 'phaser';
import type { GasVolume } from '../../data/types';
import type { RadarReturn } from '../../data/radarReturn';
import {
  CLUTTER_GAS_DENSITY,
  RADAR_FALSE_ALARM_RATE,
  CFAR_REFERENCE_CELLS,
  CFAR_THRESHOLD_FACTOR,
  CLUTTER_CELL_PX,
  CLUTTER_SAMPLE_TTL_MS,
} from '../../data/radarGameSettings';

type ClutterCell = { density: number; at: number };

// Ground and volume clutter, and the adaptive (CFAR — constant false alarm
// rate) threshold it forces. Real clutter is not a flat noise floor: it is
// unwanted energy bouncing off terrain and gas, concentrated wherever those
// actually are, so a target sitting against a rock or inside a cloud has to
// be pulled out against a floor raised right there, not the one everywhere
// else. Apart from the receiver noise's own false alarms (rollFalseAlarm),
// this module detects nothing — it answers "how loud is it around here",
// which Receiver.processHits folds into the signal budget as a reduction in
// effective SNR ahead of the usual Pfa-based test.
//
// Clutter is logged in world-space cells rather than range/bearing-from-radar
// ones: a rock is a property of that patch of space, not of the antenna's
// momentary view of it, and this radar's own position moves. A fixed cell
// size is a simplification against the anisotropic resolution cell ship
// returns otherwise use (data/signalPath.ts sameResolutionCell) — clutter
// does not need to track exactly how far the beam that logged it could
// resolve, only roughly where it is.
export class CfarDetector {
  private cells: Map<string, ClutterCell> = new Map();

  private key(x: number, y: number): string {
    return `${Math.floor(x / CLUTTER_CELL_PX)},${Math.floor(y / CLUTTER_CELL_PX)}`;
  }

  // Log (or refresh) a clutter return at a world point — a terrain hit, or a
  // sample along a gas volume's spine. Not additive across sweeps: a rock is
  // the same rock every pass, not louder for being swept again, so a fresh
  // sample only raises what is logged there if it is actually stronger, and
  // otherwise just keeps the existing one from ageing out.
  addClutter(point: { x: number; y: number }, density: number, now: number): void {
    const k = this.key(point.x, point.y);
    const existing = this.cells.get(k);
    if (!existing || now - existing.at > CLUTTER_SAMPLE_TTL_MS) {
      this.cells.set(k, { density, at: now });
    } else {
      existing.density = Math.max(existing.density, density);
      existing.at = now;
    }
  }

  // Volume clutter: gas returns a diffuse floor across the cells it
  // occupies, logged along its spine rather than gated by this frame's
  // beam direction — a simplification (a real set only logs clutter
  // where it has actually looked), reasonable for a medium diffuse
  // enough that a single ray's worth of sampling would not represent it
  // fairly either way.
  addVolumeClutter(gasVolumes: GasVolume[], now: number): void {
    for (const gas of gasVolumes) {
      const density = CLUTTER_GAS_DENSITY * gas.density;
      this.addClutter({ x: gas.line.x1, y: gas.line.y1 }, density, now);
      this.addClutter({ x: gas.line.x2, y: gas.line.y2 }, density, now);
      this.addClutter(
        { x: (gas.line.x1 + gas.line.x2) / 2, y: (gas.line.y1 + gas.line.y2) / 2 },
        density,
        now,
      );
    }
  }

  // Thermal false alarm on one pulse: the receiver's own noise can cross the
  // detection threshold with nothing in the cell at all (see
  // detectionProbability in data/signalPath.ts — its floor is exactly
  // this chance, RADAR_PFA). This roll *is* the Pfa event, so the
  // fabricated return does not go through the signal budget a second
  // time — the radar keeps it apart from the echoes still waiting on it.
  // Its range is drawn uniformly along the full traced reach rather than
  // weighted toward the near end the way a real echo is: that is the tell
  // that separates a noise spike from a reflection, a genuine return thins
  // out with distance and receiver noise does not.
  //
  // The same CFAR threshold applies to noise as to echoes: the raised
  // floor near clutter suppresses noise spikes there exactly as it
  // suppresses weak target returns, so the roll is divided by the same
  // floor multiplier the real hits are judged against. Without this the
  // threshold would be higher only for echoes — and noise would be
  // *most* believable exactly where a real set declares nothing, which
  // is backwards: clutter residue is the reason a real CFAR detector
  // raises its threshold in the first place.
  rollFalseAlarm(
    origin: { x: number; y: number },
    directionDeg: number,
    reach: number,
    now: number,
  ): RadarReturn | null {
    const range = Math.random() * reach;
    const rad = Phaser.Math.DegToRad(directionDeg);
    const point = new Phaser.Math.Vector2(
      origin.x + Math.cos(rad) * range,
      origin.y + Math.sin(rad) * range,
    );
    if (Math.random() >= RADAR_FALSE_ALARM_RATE / this.noiseFloorMultiplier(point, now)) return null;
    return {
      point,
      range,
      angle: directionDeg,
      // A noise spike that cleared the threshold carries exactly the
      // floor it cleared — no amplitude structure for the tracking
      // computer's weighted centroid to read anything into.
      signal: 1,
    };
  }

  // Drop clutter whose source has moved on — gas drifting off, terrain the
  // beam has not swept in a while.
  tick(now: number): void {
    for (const [k, cell] of this.cells) {
      if (now - cell.at > CLUTTER_SAMPLE_TTL_MS) this.cells.delete(k);
    }
  }

  // CFAR cell-averaging: the mean density across a square reference window
  // of CFAR_REFERENCE_CELLS cells on a side around `point`, excluding the
  // cell under test itself — the guard cell, so a target's own return cannot
  // inflate the very threshold it is about to be measured against, the way a
  // real CFAR detector's guard cells keep the target's own energy out of its
  // own noise estimate.
  private localDensity(point: { x: number; y: number }, now: number): number {
    const cx = Math.floor(point.x / CLUTTER_CELL_PX);
    const cy = Math.floor(point.y / CLUTTER_CELL_PX);
    const half = Math.floor(CFAR_REFERENCE_CELLS / 2);
    let sum = 0;
    let count = 0;

    for (let dx = -half; dx <= half; dx++) {
      for (let dy = -half; dy <= half; dy++) {
        if (dx === 0 && dy === 0) continue;
        count++;
        const cell = this.cells.get(`${cx + dx},${cy + dy}`);
        if (cell && now - cell.at <= CLUTTER_SAMPLE_TTL_MS) sum += cell.density;
      }
    }

    return count > 0 ? sum / count : 0;
  }

  // Multiplier on the noise floor a return at `point` is tested against — 1
  // with nothing nearby, growing with the clutter logged around it. Receiver
  // divides a hit's signal by this before the normal detection test.
  noiseFloorMultiplier(point: { x: number; y: number }, now: number): number {
    return 1 + CFAR_THRESHOLD_FACTOR * this.localDensity(point, now);
  }

  // The raw mean clutter density around `point`, without the threshold
  // factor — the detector's own answer to "is there clutter here at all".
  // The tracking computer's MTI gate asks this in density units, not as a
  // floor multiplier: the notch cares whether the echo sits in significant
  // clutter, not how many times the amplitude test would raise the bar.
  clutterDensity(point: { x: number; y: number }, now: number): number {
    return this.localDensity(point, now);
  }
}
