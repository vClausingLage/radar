// IFF interrogator module.
//
// Real-world equivalent: the interrogator half of a Mode 4 / Mode 5 system
// that rides on a fighter radar's antenna. Radar cannot tell a friend from an
// enemy - a track is geometry - so the set asks: it sends a coded
// interrogation along the bearing of a track, and a friendly transponder that
// hears it answers with a coded reply. A valid reply means "friendly". Silence
// means only that nothing answered: the other side's transponder is on a
// different code and says nothing, but so is a friend whose transponder is out
// of range, shadowed by gas or switched off. Silence is therefore *unknown*,
// to be treated as hostile, never proof of it.
//
// The transponder is not here. It belongs to the host ship (Ship.iffCode, from
// its Side); this module only asks the question and files the answers.
//
// Both legs are one-way physics (data/signalPath.ts emissionSignal, range
// squared): the transponder has only to hear the question, and the interrogator
// only to hear the reply, so IFF works well past the ring the scope draws and
// past the range at which a hull's echo is any use. Gas on the path costs each
// leg its energy like any other emission.
//
// A reply is attached to a track by geometry alone - a range/bearing gate
// around the track - never by entity id, because a real interrogator has no
// idea which hull it spoke to. The classic consequence is kept on purpose: a
// friend and a foe inside one gate are one track and one answer, and the
// friend's reply makes the foe read friendly too.

import Phaser from 'phaser';
import { Vector2 } from '../../../types';
import { IffCode } from '../../../entities/ship';
import { GasVolume } from '../../data/types';
import { Track, stampIff, clearIff } from '../../data/track';
import { emissionSignal, gasTransmission, measurementJitterPx } from '../../data/signalPath';
import {
    IFF_AUTO_INTERVAL_MS,
    IFF_AUTO_MIN_AGE_SCANS,
    IFF_BEAM_WIDTH_DEG,
    IFF_COOLDOWN_MS,
    IFF_DECODE_SIGNAL,
    IFF_GATE_CROSS_RANGE_PX,
    IFF_GATE_RANGE_PX,
    IFF_INTERROGATION_POWER,
    IFF_REPLY_POWER,
    IFF_STATE_VALID_MS,
} from '../../data/radarGameSettings';

// A ship's transponder as the interrogator can learn of it: where it is (the
// signal path needs the geometry) and the code it answers to. The module never
// touches the ship itself.
export type Transponder = {
    pos: Vector2;
    code: IffCode;
};

export type InterrogationParams = {
    ownerPos: Vector2;
    // The code this interrogator asks with: the host ship's own side.
    ownerCode: IffCode;
    // The host radar's rated range, which the one-way budget is quoted at.
    ratedRangePx: number;
    tracks: Track[];
    transponders: Transponder[];
    gasVolumes: GasVolume[];
    now: number;
};

// One decoded reply as the interrogator measured it: range and bearing from
// the interrogator, with the measurement noise its own signal buys.
type Reply = { range: number; bearingDeg: number };

export class IffInterrogator {
    private lastInterrogationAt = -Infinity;
    private nextAutoAt = 0;

    // Off cooldown: the interrogator has finished its last transmit/listen
    // cycle and may ask again.
    isReady(now: number): boolean {
        return now - this.lastInterrogationAt >= IFF_COOLDOWN_MS;
    }

    // Is an automatic interrogation due? An AI radar asks on a cadence.
    autoDue(now: number): boolean {
        return now >= this.nextAutoAt;
    }

    // Tracks worth an automatic question: matured ones, not a one-scan blip.
    static autoCandidates(tracks: Track[]): Track[] {
        return tracks.filter(track => track.age >= IFF_AUTO_MIN_AGE_SCANS);
    }

    noteAutoInterrogation(now: number): void {
        this.nextAutoAt = now + IFF_AUTO_INTERVAL_MS;
    }

    // Results do not last: a track whose answer is older than the validity
    // window reverts to 'not interrogated'. Run every frame by the host radar.
    ageOut(tracks: Track[], now: number): void {
        for (const track of tracks) {
            if (track.iff && now - track.iff.at > IFF_STATE_VALID_MS) clearIff(track);
        }
    }

    // Interrogate every given track: an interrogation beam is steered at each
    // one, every transponder inside any of those beams hears the question (or
    // does not, by the energy budget), the ones on our code answer (or are not
    // heard, by the budget again), and each decoded reply is attached to the
    // track whose gate it falls in. Every track asked ends up 'friendly' (a
    // reply landed in its gate) or 'unknown' (none did). Writes the result
    // into the tracks in place, the way the radar's friend tags are.
    interrogate(params: InterrogationParams): void {
        const { ownerPos, ownerCode, ratedRangePx, tracks, transponders, gasVolumes, now } = params;
        this.lastInterrogationAt = now;
        if (tracks.length === 0) return;

        // One beam per track: centred on the track's bearing and wide enough
        // to cover the whole gate a reply is accepted in at that range, or the
        // question would miss a transponder the answer could still be matched
        // to.
        const beams = tracks.map(track => ({
            centreDeg: bearingDegrees(ownerPos, track.pos),
            halfWidthDeg: Math.max(
                IFF_BEAM_WIDTH_DEG / 2,
                Phaser.Math.RadToDeg(Math.atan2(IFF_GATE_CROSS_RANGE_PX, Phaser.Math.Distance.Between(ownerPos.x, ownerPos.y, track.pos.x, track.pos.y))),
            ),
        }));
        const replies: Reply[] = [];

        for (const transponder of transponders) {
            const range = Phaser.Math.Distance.Between(ownerPos.x, ownerPos.y, transponder.pos.x, transponder.pos.y);
            const bearingDeg = bearingDegrees(ownerPos, transponder.pos);
            // Only a transponder inside one of the steered beams is asked.
            if (!beams.some(beam => Math.abs(Phaser.Math.Angle.WrapDegrees(bearingDeg - beam.centreDeg)) <= beam.halfWidthDeg)) {
                continue;
            }

            // Out to the transponder and back, each leg crossing the same gas.
            const transmission = gasTransmission(ownerPos, transponder.pos, gasVolumes);
            if (emissionSignal(range, ratedRangePx, transmission, IFF_INTERROGATION_POWER) < IFF_DECODE_SIGNAL) continue;
            // Heard, but only answered if it is our code.
            if (transponder.code !== ownerCode) continue;
            const replySignal = emissionSignal(range, ratedRangePx, transmission, IFF_REPLY_POWER);
            if (replySignal < IFF_DECODE_SIGNAL) continue;

            // The reply is measured like any other signal: the stronger it is
            // the closer the range and bearing sit to the truth.
            const jitterPx = measurementJitterPx(replySignal);
            replies.push({
                range: Math.max(0, range + gaussian() * jitterPx),
                bearingDeg: bearingDeg + Phaser.Math.RadToDeg(Math.atan2(gaussian() * jitterPx, Math.max(range, 1))),
            });
        }

        const answered = new Set<Track>();
        for (const reply of replies) {
            const track = this.trackInGate(ownerPos, tracks, reply);
            if (track) answered.add(track);
        }
        for (const track of tracks) {
            stampIff(track, answered.has(track) ? 'friendly' : 'unknown', now);
        }
    }

    // The track a reply belongs to: the nearest one, in gate-normalised
    // distance, that it falls inside the range and cross-range gate of. Geometry
    // only - there is no id on a reply to match against.
    private trackInGate(ownerPos: Vector2, tracks: Track[], reply: Reply): Track | null {
        let best: Track | null = null;
        let bestScore = Infinity;
        for (const track of tracks) {
            const trackRange = Phaser.Math.Distance.Between(ownerPos.x, ownerPos.y, track.pos.x, track.pos.y);
            const dRange = Math.abs(reply.range - trackRange);
            // Bearing error as the ground it spans at the track's range.
            const dBearingRad = Phaser.Math.DegToRad(Math.abs(
                Phaser.Math.Angle.WrapDegrees(reply.bearingDeg - bearingDegrees(ownerPos, track.pos))));
            const dCross = trackRange * Math.sin(Math.min(dBearingRad, Math.PI / 2));
            if (dRange > IFF_GATE_RANGE_PX || dCross > IFF_GATE_CROSS_RANGE_PX) continue;
            const score = Math.hypot(dRange / IFF_GATE_RANGE_PX, dCross / IFF_GATE_CROSS_RANGE_PX);
            if (score < bestScore) {
                bestScore = score;
                best = track;
            }
        }
        return best;
    }
}

function bearingDegrees(from: Vector2, to: Vector2): number {
    return Phaser.Math.RadToDeg(Math.atan2(to.y - from.y, to.x - from.x));
}

// Standard normal deviate (Box-Muller), drawn from Math.random so a seeded
// test run stays reproducible.
function gaussian(): number {
    const u = Math.max(Math.random(), Number.EPSILON);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
