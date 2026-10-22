import Phaser from "phaser";
import { ReceivedSignal } from "../data/radarReturn";
import { Vector2 } from "../../types";
import { JammingContest } from "../systems/modules/jammer";
import { beamPattern } from "../data/signalPath";
import {
  RADAR_BEAM_WIDTH_DEG,
  RADAR_INTEGRATION_GAIN_EXPONENT,
  RADAR_PFA,
  RECEIVER_VIDEO_BIN_DEG,
  RECEIVER_VIDEO_ECHO_GAIN_DB,
  RECEIVER_VIDEO_MAX_DB,
  RECEIVER_VIDEO_MIN_DB,
  RECEIVER_VIDEO_OFF_SECTOR_ALPHA,
  RECEIVER_VIDEO_PERSISTENCE,
  RECEIVER_VIDEO_PX_PER_DB,
  RECEIVER_VIDEO_RADIUS_PX,
} from "../data/radarGameSettings";

const BIN_COUNT = Math.round(360 / RECEIVER_VIDEO_BIN_DEG);

// The single-look signal at which detectionProbability (data/signalPath.ts)
// gives even odds: Pfa^(1 / (1 + s)) = 0.5. The detector really decides on
// a whole dwell's integrated signal, so this is a guide line, not a wall.
const EVEN_ODDS_SIGNAL = Math.log(RADAR_PFA) / Math.log(0.5) - 1;

// Receiver video: the raw power out of the receiver, before the detector has
// decided anything, drawn as a ring around the ship. Bearing runs around the
// circle and received power swings the trace off it — the polar cousin of an
// A-scope. The base circle is the noise floor (0 dB). Receiver noise alone
// makes the trace jagged on both sides of it; an echo pushes a spike out at
// its bearing, and because the echo falls with the fourth power of range,
// the spike grows fast as the contact closes. What the scope's track marks
// show is the detector's verdict; this is the evidence it was judging.
//
// Power is drawn in dB because the echo spans orders of magnitude: a contact
// at half the rated range returns 16 times the energy it does at the ring.
//
// A jammer covering us shows as a second lobe at its own bearing, in red: its
// burst's power J, drawn on the same scale as the echo S it is trying to hide.
// The two fall with range at different rates — J one way (range²), S out and
// back (range⁴) — so far out J towers over S and the jammer wins; as the
// contact closes, S climbs twice as fast and overtakes it. That crossing is
// burn-through. While the jammer wins, a magenta tick marks the bearing it
// moved the contact to.
export class ReceiverVideoRenderer {
  // Echo power per bin from the latest sweep (ratio to the noise floor).
  private echo = new Float32Array(BIN_COUNT);
  // Pulses integrated into each bin's echo this sweep.
  private pulses = new Float32Array(BIN_COUNT);
  // Jammer burst power per bin from the latest contest, 0 where none.
  private jam = new Float32Array(BIN_COUNT);
  private contest: JammingContest | null = null;
  // Noise power per bin, carried frame to frame by the persistence factor.
  private noise = new Float32Array(BIN_COUNT).fill(1);
  private floorLabel: Phaser.GameObjects.Text;
  private evenOddsLabel: Phaser.GameObjects.Text;
  private contestLabel: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    const style = { font: '11px Courier', color: '#00ff00' };
    this.floorLabel = scene.add.text(0, 0, 'NOISE 0 dB', style).setAlpha(0.6);
    this.evenOddsLabel = scene.add.text(0, 0, '', { ...style, color: '#ffbf00' }).setAlpha(0.6);
    this.evenOddsLabel.setText(`Pd 50% ${ReceiverVideoRenderer.toDb(EVEN_ODDS_SIGNAL).toFixed(1)} dB`);
    this.contestLabel = scene.add.text(0, 0, '', { ...style, align: 'center' }).setOrigin(0.5).setVisible(false);
  }

  // Replace the picture with what the receiver measured this sweep (or this
  // frame, in STT), and the jamming contest if one was run.
  update(signals: ReceivedSignal[], contest: JammingContest | null = null): void {
    // A search sweep paints a contact with several pulses as the beam slides
    // across it, and the detector integrates them (sum / N^exponent — the √N
    // law in Receiver.processHits). Drawing that integrated power rather than
    // one pulse shows the evidence the detector actually weighed. STT puts
    // one pulse per frame on the target, so there N = 1 and nothing changes.
    // The echo gain on top is display-only — see RECEIVER_VIDEO_ECHO_GAIN_DB.
    this.echo.fill(0);
    this.pulses.fill(0);
    for (const s of signals) ReceiverVideoRenderer.integrate(this.echo, this.pulses, s.bearingDeg, s.signal);
    const gain = Math.pow(10, RECEIVER_VIDEO_ECHO_GAIN_DB / 10);
    for (let bin = 0; bin < BIN_COUNT; bin++) {
      if (this.pulses[bin] === 0) continue;
      this.echo[bin] *= gain / Math.pow(this.pulses[bin], RADAR_INTEGRATION_GAIN_EXPONENT);
    }
    this.jam.fill(0);
    this.contest = contest;
    if (contest) ReceiverVideoRenderer.spread(this.jam, contest.bearingDeg, contest.jammerSignal);
  }

  // Print one sweep's received energy to the console: every echo, its
  // bearing, range and power against the noise floor, and the jamming
  // contest if one was run.
  printSweep(signals: ReceivedSignal[], contest: JammingContest | null = null): void {
    if (contest) console.log(`[receiver] jammer: ${ReceiverVideoRenderer.describeContest(contest).join('  ')}`);
    if (signals.length === 0) {
      console.log('[receiver] sweep: no echoes — noise only');
      return;
    }
    const total = signals.reduce((sum, s) => sum + s.signal, 0);
    const lines = signals.map(s =>
      `  brg ${Phaser.Math.Angle.WrapDegrees(s.bearingDeg).toFixed(1).padStart(6)}°`
      + `  rng ${s.rangePx.toFixed(0).padStart(5)} px`
      + `  S/N ${s.signal.toFixed(3).padStart(9)}`
      + `  ${ReceiverVideoRenderer.toDb(s.signal).toFixed(1).padStart(6)} dB`,
    );
    console.log(
      `[receiver] sweep: ${signals.length} echoes, total S/N ${total.toFixed(3)}`
      + ` (${ReceiverVideoRenderer.toDb(total).toFixed(1)} dB)\n${lines.join('\n')}`,
    );
  }

  // `listening` is the sector the antenna can look into; null = nowhere.
  // Echoes can only arrive from inside it, so the trace is drawn bright
  // there and only as faint receiver noise round the rest of the ring.
  render(
    graphics: Phaser.GameObjects.Graphics,
    ownerPos: Vector2,
    listening: { centreDeg: number; widthDeg: number } | null = null,
  ): void {
    // Reference circles: the noise floor and the even-odds detection level.
    const evenOddsRadius = ReceiverVideoRenderer.radiusAt(ReceiverVideoRenderer.toDb(EVEN_ODDS_SIGNAL));
    graphics.lineStyle(1, 0x00ff00, 0.2);
    graphics.strokeCircle(ownerPos.x, ownerPos.y, RECEIVER_VIDEO_RADIUS_PX);
    graphics.lineStyle(1, 0xffbf00, 0.25);
    graphics.strokeCircle(ownerPos.x, ownerPos.y, evenOddsRadius);

    // The trace. Receiver noise power is exponentially distributed about the
    // floor (mean 1); the echo's power adds on top of it. The noise here is
    // display only, so it is drawn from Phaser's own generator rather than
    // Math.random: the detector's dice must not depend on whether a ring is
    // being drawn (the test harness seeds Math.random to replay them).
    const points: Phaser.Math.Vector2[] = [];
    for (let bin = 0; bin < BIN_COUNT; bin++) {
      const draw = -Math.log(Math.max(Number.EPSILON, Phaser.Math.RND.frac()));
      this.noise[bin] = RECEIVER_VIDEO_PERSISTENCE * this.noise[bin] + (1 - RECEIVER_VIDEO_PERSISTENCE) * draw;
      const r = ReceiverVideoRenderer.radiusAt(ReceiverVideoRenderer.toDb(this.noise[bin] + this.echo[bin]));
      points.push(ReceiverVideoRenderer.pointAt(ownerPos, ReceiverVideoRenderer.binBearing(bin), r));
    }
    graphics.lineStyle(1, 0x00ff00, RECEIVER_VIDEO_OFF_SECTOR_ALPHA);
    graphics.strokePoints(points, true, true);
    const live = ReceiverVideoRenderer.sectorPoints(points, listening);
    if (live.length > 1) {
      graphics.lineStyle(1.5, 0x00ff00, 0.7);
      const whole = live.length === BIN_COUNT;
      graphics.strokePoints(live, whole, whole);
    }

    this.renderContest(graphics, ownerPos);

    // Labels sit just off the circles' north-east points and ride with the ship.
    const labelRad = Phaser.Math.DegToRad(-45);
    this.floorLabel.setPosition(
      ownerPos.x + Math.cos(labelRad) * RECEIVER_VIDEO_RADIUS_PX + 4,
      ownerPos.y + Math.sin(labelRad) * RECEIVER_VIDEO_RADIUS_PX,
    );
    this.evenOddsLabel.setPosition(
      ownerPos.x + Math.cos(labelRad) * evenOddsRadius + 4,
      ownerPos.y + Math.sin(labelRad) * evenOddsRadius - 12,
    );
  }

  destroy(): void {
    this.floorLabel.destroy();
    this.evenOddsLabel.destroy();
    this.contestLabel.destroy();
  }

  // The jammer's lobe in red over the bins its burst covers (noise + J, on
  // the same scale as the echo), the J/S verdict just outside the ring, and —
  // while a deception is winning — a magenta tick where it put the contact.
  private renderContest(graphics: Phaser.GameObjects.Graphics, ownerPos: Vector2): void {
    const contest = this.contest;
    this.contestLabel.setVisible(contest !== null);
    if (!contest) return;

    // The lobe is a contiguous run of bins, but it may straddle the 0°/360°
    // seam: walk it from the bin after the last empty one so it is drawn as
    // one arc rather than two joined the long way round.
    const lit = (bin: number): boolean => this.jam[bin] > 0;
    let start = 0;
    while (start < BIN_COUNT && !(lit(start) && !lit((start - 1 + BIN_COUNT) % BIN_COUNT))) start++;
    const lobe: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < BIN_COUNT; i++) {
      const bin = (start + i) % BIN_COUNT;
      if (!lit(bin)) break;
      const r = ReceiverVideoRenderer.radiusAt(ReceiverVideoRenderer.toDb(this.noise[bin] + this.jam[bin]));
      lobe.push(ReceiverVideoRenderer.pointAt(ownerPos, ReceiverVideoRenderer.binBearing(bin), r));
    }
    graphics.lineStyle(2, 0xff3030, 0.8);
    graphics.strokePoints(lobe, false, false);

    if (contest.spoofBearingDeg !== null) {
      const inner = ReceiverVideoRenderer.pointAt(ownerPos, contest.spoofBearingDeg, RECEIVER_VIDEO_RADIUS_PX - 12);
      const outer = ReceiverVideoRenderer.pointAt(
        ownerPos, contest.spoofBearingDeg,
        ReceiverVideoRenderer.radiusAt(ReceiverVideoRenderer.toDb(contest.jammerSignal)),
      );
      graphics.lineStyle(2, 0xff00ff, 0.9);
      graphics.lineBetween(inner.x, inner.y, outer.x, outer.y);
    }

    const labelAt = ReceiverVideoRenderer.pointAt(
      ownerPos, contest.bearingDeg, ReceiverVideoRenderer.radiusAt(RECEIVER_VIDEO_MAX_DB) + 28,
    );
    this.contestLabel
      .setPosition(labelAt.x, labelAt.y)
      .setColor(contest.jammed ? '#ff3030' : '#00ff00')
      .setText(ReceiverVideoRenderer.describeContest(contest).join('\n'));
  }

  // J and S in dB, their ratio, and who won it.
  private static describeContest(contest: JammingContest): string[] {
    const toDb = ReceiverVideoRenderer.toDb;
    const verdict = contest.echoSignal <= 0
      ? 'NO ECHO'
      : contest.jammed ? 'JAMMED' : 'BURN-THROUGH';
    const ratio = contest.echoSignal > 0
      ? `J/S ${toDb(contest.jammerSignal / contest.echoSignal).toFixed(1)} dB`
      : 'J/S —';
    return [
      `J ${toDb(contest.jammerSignal).toFixed(1)} dB  S ${toDb(contest.echoSignal).toFixed(1)} dB`,
      ratio,
      verdict,
    ];
  }

  // The run of trace points inside the listening sector, in bearing order. A
  // sector may straddle the 0°/360° seam, so it is walked from its start bin
  // rather than filtered, keeping it one unbroken arc.
  private static sectorPoints(
    points: Phaser.Math.Vector2[],
    listening: { centreDeg: number; widthDeg: number } | null,
  ): Phaser.Math.Vector2[] {
    if (!listening) return [];
    if (listening.widthDeg >= 360) return points;
    const startDeg = listening.centreDeg - listening.widthDeg / 2;
    const first = Math.floor((((startDeg % 360) + 360) % 360) / RECEIVER_VIDEO_BIN_DEG);
    const count = Math.ceil(listening.widthDeg / RECEIVER_VIDEO_BIN_DEG) + 1;
    const run: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < count; i++) run.push(points[(first + i) % BIN_COUNT]);
    return run;
  }

  // Add one pulse's power into the bins around its bearing, shaped by the
  // beam pattern, counting the pulses each bin collects so update() can
  // apply the integration law. The echo is summed, unlike the jammer burst.
  private static integrate(sums: Float32Array, counts: Float32Array, bearingDeg: number, power: number): void {
    const spreadBins = Math.ceil(2 * RADAR_BEAM_WIDTH_DEG / RECEIVER_VIDEO_BIN_DEG);
    const centre = Math.floor((((bearingDeg % 360) + 360) % 360) / RECEIVER_VIDEO_BIN_DEG) % BIN_COUNT;
    for (let k = -spreadBins; k <= spreadBins; k++) {
      const bin = (centre + k + BIN_COUNT) % BIN_COUNT;
      const offAxis = Phaser.Math.Angle.WrapDegrees(ReceiverVideoRenderer.binBearing(bin) - bearingDeg);
      sums[bin] += power * beamPattern(offAxis, RADAR_BEAM_WIDTH_DEG);
      counts[bin]++;
    }
  }

  // Lay one source's power onto the bins around its bearing, shaped by the
  // beam pattern — the beam is a few degrees wide, so a point source shows
  // as a lobe, not a needle. Overlapping looks keep the loudest, not the sum:
  // each bin shows a single pulse's power.
  private static spread(bins: Float32Array, bearingDeg: number, power: number): void {
    const spreadBins = Math.ceil(2 * RADAR_BEAM_WIDTH_DEG / RECEIVER_VIDEO_BIN_DEG);
    const centre = Math.floor((((bearingDeg % 360) + 360) % 360) / RECEIVER_VIDEO_BIN_DEG) % BIN_COUNT;
    for (let k = -spreadBins; k <= spreadBins; k++) {
      const bin = (centre + k + BIN_COUNT) % BIN_COUNT;
      const offAxis = Phaser.Math.Angle.WrapDegrees(ReceiverVideoRenderer.binBearing(bin) - bearingDeg);
      const p = power * beamPattern(offAxis, RADAR_BEAM_WIDTH_DEG);
      if (p > bins[bin]) bins[bin] = p;
    }
  }

  // How far out a power level sits on the ring.
  private static radiusAt(db: number): number {
    return RECEIVER_VIDEO_RADIUS_PX
      + Phaser.Math.Clamp(db, RECEIVER_VIDEO_MIN_DB, RECEIVER_VIDEO_MAX_DB) * RECEIVER_VIDEO_PX_PER_DB;
  }

  private static pointAt(ownerPos: Vector2, bearingDeg: number, r: number): Phaser.Math.Vector2 {
    const rad = Phaser.Math.DegToRad(bearingDeg);
    return new Phaser.Math.Vector2(ownerPos.x + Math.cos(rad) * r, ownerPos.y + Math.sin(rad) * r);
  }

  // Centre bearing of a bin, degrees clockwise from east (Phaser's frame).
  private static binBearing(bin: number): number {
    return bin * RECEIVER_VIDEO_BIN_DEG + RECEIVER_VIDEO_BIN_DEG / 2;
  }

  private static toDb(ratio: number): number {
    return 10 * Math.log10(Math.max(ratio, Number.EPSILON));
  }
}
