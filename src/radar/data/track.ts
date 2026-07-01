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
}