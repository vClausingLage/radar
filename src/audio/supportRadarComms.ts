import { PlayerShip } from '../entities/ship';
import { Track } from '../radar/data/track';
import { AudioPlayer } from './audioPlayer';

// Spoken digits 0–9 (files zero.mp3 … nine.mp3), shared with the radar voice.
const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

// Range is read from the available bucket clips (100.mp3 … 1000.mp3); contacts
// farther than the top bucket get bearing only, since there is no clip for them.
const RANGE_STEP_PX = 100;
const RANGE_MIN_PX = 100;
const RANGE_MAX_PX = 1000;

export type SupportBearingCall = {
    // Bearing to the contact relative to the player's nose (0 = dead ahead).
    bearing: number;
    // Straight-line range to the contact in world px.
    rangePx: number;
};

// Off-board comms for the support dish radar. On request it finds the nearest
// shared contact and calls its bearing (and range, when within the spoken
// buckets) over the radio: "bra <bearing> for <range>". This is the audio half
// of the datalink; the visual half is the cyan contacts the radar itself draws.
export class SupportRadarComms {
    constructor(private readonly audio: AudioPlayer) {}

    // Announce the bearing to the nearest shared track. Returns the computed call
    // so the caller can mirror it on the HUD, or null if there are no contacts.
    requestNearest(player: PlayerShip, tracks: Track[]): SupportBearingCall | null {
        if (tracks.length === 0) return null;

        const pos = player.getPosition();
        const nearest = tracks.reduce((a, b) =>
            this.rangeSq(pos, b.pos) < this.rangeSq(pos, a.pos) ? b : a,
        );

        const worldBearing = Phaser.Math.RadToDeg(
            Math.atan2(nearest.pos.y - pos.y, nearest.pos.x - pos.x),
        );
        const bearing = Math.round(this.wrap360(worldBearing - player.getDirection())) % 360;
        const rangePx = Math.sqrt(this.rangeSq(pos, nearest.pos));

        this.audio.playMessage(this.buildCall(bearing, rangePx));
        return { bearing, rangePx };
    }

    private buildCall(bearing: number, rangePx: number): string[] {
        const call = ['bra', ...this.spokenDigits(bearing, 3)];
        // Only speak range when it lands within the available bucket clips.
        if (rangePx <= RANGE_MAX_PX) {
            const bucket = Phaser.Math.Clamp(
                Math.round(rangePx / RANGE_STEP_PX) * RANGE_STEP_PX,
                RANGE_MIN_PX,
                RANGE_MAX_PX,
            );
            call.push('for', String(bucket));
        }
        return call;
    }

    private spokenDigits(value: number, width: number): string[] {
        return [...String(Math.max(0, value)).padStart(width, '0')].map(d => DIGIT_WORDS[Number(d)]);
    }

    private rangeSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
        return Phaser.Math.Distance.Squared(a.x, a.y, b.x, b.y);
    }

    private wrap360(deg: number): number {
        return ((deg % 360) + 360) % 360;
    }
}
