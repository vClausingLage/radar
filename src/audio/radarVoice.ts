import { PlayerShip } from '../entities/ship';
import { Track } from '../radar/data/track';
import { AudioPlayer } from './audioPlayer';

// Clip keys for the spoken digits 0–9 (files zero.mp3 … nine.mp3).
const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

// Range is spoken as one rounded clip (files 100.mp3 … 1000.mp3): the measured
// px range is snapped to the nearest step and clamped to the available buckets.
const RANGE_STEP_PX = 100;
const RANGE_MIN_PX = 100;
const RANGE_MAX_PX = 1000;

// Aspect thresholds (deg) between the target's flight heading and its line of
// sight to the player: nose-on → hot, tail-on → cold, otherwise beam → flanking.
const ASPECT_HOT_MAX_DEG = 45;
const ASPECT_COLD_MIN_DEG = 135;

// Only announce once a track has matured past this many scans, so it has gained
// confidence (and a stable velocity for the aspect call) before being read out.
const CONTACT_MIN_AGE = 2;

// Builds and fires "new radar contact" radio calls for the PLAYER ship's radar.
// Each newly-formed track is announced once — "new radar contact, bra <bearing>
// <range> <aspect>" — stitched from the clips in public/audio. The AudioPlayer's
// lock + cooldown keep it from spamming when several contacts appear at once.
export class RadarVoice {
  private announced = new Set<number>();

  constructor(private readonly audio: AudioPlayer) {}

  // Call once per frame with the player ship. Announces at most one new contact
  // per call; if the cooldown/lock blocks it, the contact stays pending and is
  // retried on a later frame.
  update(player: PlayerShip): void {
    const tracks = player.radar.getTracks();
    const liveIds = new Set<number>();
    let pending: Track | null = null;

    for (const track of tracks) {
      liveIds.add(track.id);
      // Wait until the track has matured (age > 2) before reading it out.
      if (!pending && track.age > CONTACT_MIN_AGE && !this.announced.has(track.id)) {
        pending = track;
      }
    }

    if (pending && this.audio.playMessage(this.buildContactCall(player, pending))) {
      this.announced.add(pending.id);
    }

    // Forget ids no longer tracked (track ids are never reused) to bound memory.
    for (const id of this.announced) {
      if (!liveIds.has(id)) this.announced.delete(id);
    }
  }

  private buildContactCall(player: PlayerShip, track: Track): string[] {
    const pos = player.getPosition();

    // Bearing relative to the player's nose, so a contact dead ahead reads 0.
    const worldBearing = Phaser.Math.RadToDeg(Math.atan2(track.pos.y - pos.y, track.pos.x - pos.x));
    const bearing = Math.round(this.wrap360(worldBearing - player.getDirection())) % 360;
    const rangePx = Phaser.Math.Distance.Between(pos.x, pos.y, track.pos.x, track.pos.y);
    // Snap to the nearest available range bucket (100…1000) and clamp.
    const rangeBucket = Phaser.Math.Clamp(
      Math.round(rangePx / RANGE_STEP_PX) * RANGE_STEP_PX,
      RANGE_MIN_PX,
      RANGE_MAX_PX,
    );

    return [
      'new-radar-contact',
      'bra',
      ...this.spokenDigits(bearing, 3),
      'for',
      String(rangeBucket),
      this.aspect(player, track),
    ];
  }

  // Target aspect relative to the player: the angle between the target's flight
  // heading and the direction from the target toward the player.
  private aspect(player: PlayerShip, track: Track): string {
    const pos = player.getPosition();
    const losToPlayer = Phaser.Math.RadToDeg(Math.atan2(pos.y - track.pos.y, pos.x - track.pos.x));
    const off = Math.abs(Phaser.Math.Angle.WrapDegrees(track.dir - losToPlayer));
    if (off <= ASPECT_HOT_MAX_DEG) return 'hot';
    if (off >= ASPECT_COLD_MIN_DEG) return 'cold';
    return 'flanking';
  }

  // Split a non-negative integer into spoken-digit clip keys, optionally
  // zero-padded to a fixed width (bearing → 3 digits, e.g. 90 → zero nine zero).
  private spokenDigits(value: number, width = 0): string[] {
    return [...String(Math.max(0, value)).padStart(width, '0')].map(d => DIGIT_WORDS[Number(d)]);
  }

  private wrap360(deg: number): number {
    return ((deg % 360) + 360) % 360;
  }
}
