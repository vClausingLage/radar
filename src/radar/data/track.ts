import { Vector2 } from "../../types";
export interface Track {
    id: number
    pos: Vector2
    dist: number
    dir: number
    speed: number
    age: number
    lastUpdate: number
    confidence: number
    // Recent past positions, oldest first, for the rendered dot trail. Capped to
    // RADAR_TRACK_HISTORY_LENGTH; updated once per scan in TrackingComputer.
    history: Vector2[]
    // Set by a radar that shares a flight datalink when this track lies on a
    // flight member's PPLI position: the echo is real (it still masks what is
    // behind it) but it is a wingman, so nothing may be fired at, locked or
    // hunted on it. Absent = no identification, i.e. treated as hostile.
    friendly?: boolean
    // What the last interrogation of this track found, and when (scene ms).
    // Absent = 'not interrogated' (never asked, or the answer has aged out).
    iff?: { state: 'friendly' | 'unknown'; at: number }
}

// The IFF state of a track, in words. 'unknown' means asked and unanswered -
// not a declaration of hostility: a transponder that is out of range, gassed
// out or on another code reads the same.
export type IffState = 'friendly' | 'unknown' | 'not interrogated';

export function iffStateOf(track: Track): IffState {
    return track.iff?.state ?? 'not interrogated';
}
