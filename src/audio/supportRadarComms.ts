import Phaser from 'phaser';
import { PlayerShip } from '../entities/ship';
import { Track } from '../radar/data/track';
import { AudioPlayer } from './audioPlayer';
import { GameMath, Aspect } from '../math';

// Spoken digits 0–9, one clip set per speaker: the GCI voice (ElevenLabs) and
// the player's own radio voice (GPT) are separate recordings, so shared words
// need separate clip keys — 'gci-' for the station, unprefixed for the player
// (reusing RadarVoice's existing GPT digit/number clips).
const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const GCI_DIGIT_WORDS = DIGIT_WORDS.map(w => `gci-${w}`);

// Range is read from the available bucket clips (100.mp3 … 1000.mp3); contacts
// farther than the top bucket get bearing only, since there is no clip for them.
const RANGE_STEP_PX = 100;
const RANGE_MIN_PX = 100;
const RANGE_MAX_PX = 1000;

// Speed-order thresholds (world px), keyed to range-to-contact: inside GATE_MAX
// the GCI wants max-afterburner closure, inside BUSTER_MAX max continuous speed,
// beyond that SAUNTER (conserve). See docs/gci-comms.md "Routing / vectoring /
// speed" — Buster/Gate/Saunter.
const SPEED_GATE_MAX_PX = 300;
const SPEED_BUSTER_MAX_PX = 700;
type SpeedOrder = 'gate' | 'buster' | 'saunter';

// "<to>, <from>, <message>" per docs/gci-comms.md §1. Each speaker says both
// callsigns in their own voice.
const PLAYER_TO_GCI = ['plr-disco', 'plr-flatspin', 'one', 'one'];
const GCI_TO_PLAYER = ['gci-flatspin', 'gci-one', 'gci-one', 'gci-disco'];

export type BogeyDopeCall = {
    // Bearing to the nearest contact relative to the player's nose (0 = ahead).
    bearing: number;
    // Straight-line range to the contact in world px.
    rangePx: number;
    aspect: Aspect;
    speedOrder: SpeedOrder;
};

// Off-board comms for the support dish radar/GCI station ("Disco"). On request
// the player transmits a "bogey dope" call (GPT voice) and the station replies
// with the nearest shared contact's BRAA picture plus a speed order (ElevenLabs
// voice), or "clean" if the datalink has nothing. This is the audio half of the
// datalink; the visual half is the cyan contacts the radar itself draws.
export class SupportRadarComms {
    constructor(private readonly audio: AudioPlayer) {}

    // Fires the two-part exchange (player request, then GCI response chained on
    // its completion) and returns the computed picture so the caller can mirror
    // it on the HUD immediately — null if the datalink is clean.
    requestBogeyDope(player: PlayerShip, tracks: Track[]): BogeyDopeCall | null {
        const call = this.buildBogeyDopeCall(player, tracks);

        this.audio.playMessage([...PLAYER_TO_GCI, 'plr-bogey-dope'], () => {
            this.audio.playMessage(this.buildGciResponse(call));
        });

        return call;
    }

    private buildBogeyDopeCall(player: PlayerShip, tracks: Track[]): BogeyDopeCall | null {
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

        return {
            bearing,
            rangePx,
            aspect: GameMath.getAspect(nearest.dir, nearest.pos, pos),
            speedOrder: this.speedOrder(rangePx),
        };
    }

    private buildGciResponse(call: BogeyDopeCall | null): string[] {
        if (!call) return [...GCI_TO_PLAYER, 'gci-clean'];

        const message = [...GCI_TO_PLAYER, 'gci-bra', ...this.gciDigits(call.bearing, 3)];
        // Only speak range when it lands within the available bucket clips.
        if (call.rangePx <= RANGE_MAX_PX) {
            const bucket = Phaser.Math.Clamp(
                Math.round(call.rangePx / RANGE_STEP_PX) * RANGE_STEP_PX,
                RANGE_MIN_PX,
                RANGE_MAX_PX,
            );
            message.push('gci-for', `gci-${bucket}`);
        }
        message.push(`gci-${call.aspect}`, 'gci-hostile', `gci-${call.speedOrder}`);
        return message;
    }

    private speedOrder(rangePx: number): SpeedOrder {
        if (rangePx <= SPEED_GATE_MAX_PX) return 'gate';
        if (rangePx <= SPEED_BUSTER_MAX_PX) return 'buster';
        return 'saunter';
    }

    private gciDigits(value: number, width: number): string[] {
        return [...String(Math.max(0, value)).padStart(width, '0')].map(d => GCI_DIGIT_WORDS[Number(d)]);
    }

    private rangeSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
        return Phaser.Math.Distance.Squared(a.x, a.y, b.x, b.y);
    }

    private wrap360(deg: number): number {
        return ((deg % 360) + 360) % 360;
    }
}
