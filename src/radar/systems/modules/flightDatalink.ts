// Flight datalink module.
//
// Real-world equivalent: the intra-flight net of a Link 16 / MADL-class
// terminal. Every member continuously broadcasts its PPLI - Precise
// Participant Location and Identification: who it is, where it is, how it is
// moving - from its own navigation, not from any radar. The datalink is the
// one thing that can answer the question a radar and an RWR cannot: a track is
// geometry, a warning is a bearing, and neither says whose side it is on.
// Correlating them against the PPLI is how a wingman stops being a "contact".
//
// It also carries each member's hostile surveillance tracks (the J3.x-style
// track reports of Link 16), so the flight shares one picture: a target only
// the lead's radar can see is still a track in the wingman's, with a position
// and a timestamp - enough to cue it, sort it, and (ring permitting) launch on.
// Nothing crosses the link but tracks and positions.
//
// One instance per flight, shared by every member's radar. It is passive data:
// members publish into it each frame and ask it questions; it never steers or
// fires anything.

import Phaser from 'phaser';
import { Vector2 } from '../../../types';
import { Track } from '../../data/track';
import {
    LINK_TRACK_CORRELATION_PX,
    LINK_TRACK_STALE_MS,
    PPLI_CORRELATION_PX,
    PPLI_SCAN_LAG_MS,
    PPLI_STALE_MS,
} from '../../data/radarGameSettings';

export type Ppli = {
    id: number;
    pos: Vector2;
    // px per second, differenced from successive reports (a real terminal
    // sends its inertial velocity; the effect is the same).
    vel: Vector2;
    timestamp: number;
};

// What a member says about itself over the link, besides where it is: the
// participant-status part of a Link 16 terminal (what it is doing, what it
// carries). Words and a count - the same coarse picture a pilot reads off a
// wingman's status page, not its coordinates.
export type MemberStatus = {
    stance: 'in formation' | 'engaged' | 'defending';
    missiles: number;
};

// One member's report of one track: a snapshot of the radar track (position,
// velocity, age, confidence) with the member that holds it and when it was
// sent. `track.id` is the source radar's own numbering, so it means nothing
// outside that source.
export type LinkTrack = {
    sourceId: number;
    timestamp: number;
    track: Track;
};

// Reports that correlate with each other - the same target, or several the
// tracker would have merged - fused into one entry of the flight's picture.
export type FusedGroup = {
    // Mean of the member reports.
    pos: Vector2;
    reports: LinkTrack[];
};

// Does a return at `pos` sit on any of these PPLI reports? The one correlation
// rule of the flight: a radar track uses it against the live net
// (FlightDatalink.correlatesWithMember), a missile's seeker against the copy it
// carries (MissileRadar.setFriendPicture). Geometry only - a report that is
// older than PPLI_STALE_MS is not trusted, so a copy nobody refreshes stops
// protecting anyone within half a second.
//
// The gate is the measurement allowance plus the distance the member covers
// in one sweep, because the track on it is up to a sweep old while the PPLI
// is current - a fast, turning wingman is further from its own track than
// a slow one.
export function correlatesWithPpli(pos: Vector2, members: Ppli[], now: number): boolean {
    return members.some(member => {
        if (now - member.timestamp > PPLI_STALE_MS) return false;
        const sweepLagPx = Math.hypot(member.vel.x, member.vel.y) * PPLI_SCAN_LAG_MS / 1000;
        const gatePx = PPLI_CORRELATION_PX + sweepLagPx;
        return Phaser.Math.Distance.Between(pos.x, pos.y, member.pos.x, member.pos.y) <= gatePx;
    });
}

export class FlightDatalink {
    private reports = new Map<number, Ppli>();
    private trackReports = new Map<number, LinkTrack[]>();
    private statuses = new Map<number, { status: MemberStatus; timestamp: number }>();
    // The fused picture is asked for several times a frame (every controller,
    // every radar); it is rebuilt only when a publish has changed the input or
    // the clock has moved on far enough for a report to go stale.
    private fusedCache: { now: number; groups: FusedGroup[] } | null = null;

    // A member's terminal broadcasting its position. Sent whatever the radar
    // is doing: the link is a separate low-probability-of-intercept
    // transmission, so a wingman in EMCON is still on the net.
    publish(id: number, pos: Vector2, now: number): void {
        const previous = this.reports.get(id);
        const dtSec = previous ? (now - previous.timestamp) / 1000 : 0;
        const vel = previous && dtSec > 0
            ? { x: (pos.x - previous.pos.x) / dtSec, y: (pos.y - previous.pos.y) / dtSec }
            : { x: 0, y: 0 };
        this.reports.set(id, { id, pos: { x: pos.x, y: pos.y }, vel, timestamp: now });
    }

    // A member's status page, refreshed with its PPLI.
    publishStatus(id: number, status: MemberStatus, now: number): void {
        this.statuses.set(id, { status, timestamp: now });
    }

    // What member `id` last said about itself, or null once it has gone quiet
    // for PPLI_STALE_MS - destroyed, or its terminal down: the flight cannot
    // tell which, and the lead is told 'lost' either way.
    statusOf(id: number, now: number): MemberStatus | null {
        const report = this.statuses.get(id);
        return report && now - report.timestamp <= PPLI_STALE_MS ? report.status : null;
    }

    // Every member other than `selfId` with a fresh PPLI. A member that has
    // gone quiet (destroyed) drops off the net rather than lingering as a
    // ghost friend where it died.
    wingmen(selfId: number, now: number): Ppli[] {
        const out: Ppli[] = [];
        for (const report of this.reports.values()) {
            if (report.id === selfId) continue;
            if (now - report.timestamp > PPLI_STALE_MS) continue;
            out.push(report);
        }
        return out;
    }

    // Does a radar track at `pos` sit on a wingman? A radar never correlates
    // against its own host: it does not see itself, and its own PPLI would
    // otherwise tag every close echo as friend.
    // (The gate is correlatesWithPpli's.)
    correlatesWithMember(pos: Vector2, selfId: number, now: number): boolean {
        return correlatesWithPpli(pos, this.wingmen(selfId, now), now);
    }

    // Could an emitter heard on `bearingDeg` (from `selfPos`) be a wingman's
    // radar? True when a member's PPLI lies inside the RWR's bearing cone.
    // An RWR gives no range, so this is all the correlation there is - and it
    // means a real enemy sitting exactly behind the wingman is masked too.
    matchesMemberBearing(
        selfPos: Vector2, selfId: number, bearingDeg: number, toleranceDeg: number, now: number,
    ): boolean {
        return this.wingmen(selfId, now).some(member => {
            const toMemberDeg = Phaser.Math.RadToDeg(
                Math.atan2(member.pos.y - selfPos.y, member.pos.x - selfPos.x),
            );
            return Math.abs(Phaser.Math.Angle.WrapDegrees(toMemberDeg - bearingDeg)) <= toleranceDeg;
        });
    }

    // ── Shared track picture ────────────────────────────────────────────────

    // A member's current hostile tracks, replacing whatever it sent before: the
    // link carries the picture as it is now, not a history, so a track the
    // member has dropped (or never held, in EMCON) is simply absent. Snapshots,
    // not the radar's live objects - a report must not change under a reader.
    publishTracks(sourceId: number, tracks: Track[], now: number): void {
        this.trackReports.set(sourceId, tracks.map(track => ({
            sourceId,
            timestamp: now,
            track: { ...track, pos: { x: track.pos.x, y: track.pos.y }, history: [] },
        })));
        this.fusedCache = null;
    }

    private freshTracks(now: number): LinkTrack[] {
        const out: LinkTrack[] = [];
        for (const reports of this.trackReports.values()) {
            for (const report of reports) {
                if (now - report.timestamp <= LINK_TRACK_STALE_MS) out.push(report);
            }
        }
        return out;
    }

    // What the other members are reporting, fresh only: the tracks `selfId`
    // does not hold itself and may be cued onto.
    remoteTracks(selfId: number, now: number): LinkTrack[] {
        return this.freshTracks(now).filter(report => report.sourceId !== selfId);
    }

    // The flight's one picture: every member's fresh tracks, with reports of
    // the same target (within LINK_TRACK_CORRELATION_PX of each other)
    // collapsed into one group. Built only from what is on the link and in a
    // fixed order (source, then track id), so every member that asks gets the
    // same answer - which is what lets two pilots divide the targets without
    // talking about it.
    groups(now: number): FusedGroup[] {
        if (this.fusedCache && this.fusedCache.now === now) return this.fusedCache.groups;

        const reports = this.freshTracks(now)
            .sort((a, b) => a.sourceId - b.sourceId || a.track.id - b.track.id);
        const groups: FusedGroup[] = [];
        for (const report of reports) {
            let best: FusedGroup | null = null;
            let bestPx = LINK_TRACK_CORRELATION_PX;
            for (const group of groups) {
                const px = Phaser.Math.Distance.Between(report.track.pos.x, report.track.pos.y, group.pos.x, group.pos.y);
                if (px <= bestPx) { best = group; bestPx = px; }
            }
            if (best) {
                best.reports.push(report);
                best.pos = {
                    x: best.reports.reduce((sum, r) => sum + r.track.pos.x, 0) / best.reports.length,
                    y: best.reports.reduce((sum, r) => sum + r.track.pos.y, 0) / best.reports.length,
                };
            } else {
                groups.push({ pos: { x: report.track.pos.x, y: report.track.pos.y }, reports: [report] });
            }
        }
        this.fusedCache = { now, groups };
        return groups;
    }
}
