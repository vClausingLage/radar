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

// Unprompted contact calls: a track is passed once it has matured this many
// scans (so its velocity, and therefore the aspect, means something), and the
// controller leaves at least this gap between calls so the picture is passed
// one contact at a time rather than as a burst.
const NEW_CONTACT_MIN_AGE = 2;
const NEW_CONTACT_GAP_MS = 12000;

// "<to>, <from>, <message>" per docs/gci-comms.md §1. Each speaker says both
// callsigns in their own voice.
const PLAYER_TO_GCI = ['plr-disco', 'plr-flatspin', 'one', 'one'];
const GCI_TO_PLAYER = ['gci-flatspin', 'gci-one', 'gci-one', 'gci-disco'];

// What the controller declares a contact to be. Radar gives geometry, not
// identity: a contact is a bogey until something else settles it — the
// player's own eyes, or a datalink declaration — so the scene, which knows what
// has been identified, supplies the answer per track.
export type ContactIdentity = 'bogey' | 'friendly' | 'hostile';
export type IdentifyContact = (track: Track) => ContactIdentity;

export type ContactCall = {
    // Bearing to the contact relative to the player's nose (0 = ahead).
    bearing: number;
    // Straight-line range to the contact in world px.
    rangePx: number;
    aspect: Aspect;
    speedOrder: SpeedOrder;
    identity: ContactIdentity;
};

// Off-board comms for the support dish radar/GCI station ("Disco"). Two kinds
// of traffic: on request the player transmits a "bogey dope" call (GPT voice)
// and the station replies with the nearest shared contact's BRAA picture plus a
// speed order (ElevenLabs voice), or "clean" if the datalink has nothing; and
// unprompted, the station passes each new contact its dish forms as soon as the
// track has matured. This is the audio half of the datalink; the visual half is
// the cyan contacts the radar itself draws.
export class SupportRadarComms {
    // Dish track ids already passed to the player, so a contact is called once.
    private announced = new Set<number>();
    private lastContactCallAt = -Infinity;

    constructor(private readonly audio: AudioPlayer) {}

    // Fires the two-part exchange (player request, then GCI response chained on
    // its completion) and returns the computed picture so the caller can mirror
    // it on the HUD immediately — null if the datalink is clean.
    requestBogeyDope(player: PlayerShip, tracks: Track[], identify: IdentifyContact): ContactCall | null {
        const nearest = this.nearestTrack(player, tracks);
        const call = nearest ? this.buildContactCall(player, nearest, identify) : null;

        this.audio.playMessage([...PLAYER_TO_GCI, 'plr-bogey-dope'], () => {
            this.audio.playMessage(this.buildGciResponse(call));
        });

        return call;
    }

    // Call once per frame with the dish's tracks. Passes at most one newly
    // matured contact, throttled so calls do not pile up; returns the picture
    // passed so the caller can echo it on the HUD, or null if nothing went out.
    announceNewContact(player: PlayerShip, tracks: Track[], identify: IdentifyContact, now: number): ContactCall | null {
        // Forget ids no longer tracked (track ids are never reused) to bound memory.
        const liveIds = new Set(tracks.map(t => t.id));
        for (const id of this.announced) {
            if (!liveIds.has(id)) this.announced.delete(id);
        }

        if (this.audio.isPlaying() || now - this.lastContactCallAt < NEW_CONTACT_GAP_MS) return null;
        const fresh = tracks.find(t => t.age >= NEW_CONTACT_MIN_AGE && !this.announced.has(t.id));
        if (!fresh) return null;

        const call = this.buildContactCall(player, fresh, identify);
        if (!this.audio.playMessage(this.buildGciResponse(call))) return null;
        this.announced.add(fresh.id);
        this.lastContactCallAt = now;
        return call;
    }

    private nearestTrack(player: PlayerShip, tracks: Track[]): Track | null {
        if (tracks.length === 0) return null;
        const pos = player.getPosition();
        return tracks.reduce((a, b) =>
            this.rangeSq(pos, b.pos) < this.rangeSq(pos, a.pos) ? b : a,
        );
    }

    private buildContactCall(player: PlayerShip, track: Track, identify: IdentifyContact): ContactCall {
        const pos = player.getPosition();
        const worldBearing = Phaser.Math.RadToDeg(
            Math.atan2(track.pos.y - pos.y, track.pos.x - pos.x),
        );
        const bearing = Math.round(this.wrap360(worldBearing - player.getDirection())) % 360;
        const rangePx = Math.sqrt(this.rangeSq(pos, track.pos));

        return {
            bearing,
            rangePx,
            aspect: GameMath.getAspect(track.dir, track.pos, pos),
            speedOrder: this.speedOrder(rangePx),
            identity: identify(track),
        };
    }

    private buildGciResponse(call: ContactCall | null): string[] {
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
        // Identity is declared last, before the speed order. Only 'gci-hostile'
        // is recorded so far; 'gci-bogey' and 'gci-friendly' are in the clip
        // backlog (docs/gci-comms.md) and the AudioPlayer skips a clip it does
        // not have, so those declarations reach the player on the HUD only
        // until they are recorded.
        message.push(`gci-${call.aspect}`, `gci-${call.identity}`, `gci-${call.speedOrder}`);
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
