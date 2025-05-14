import { Vector2 } from "../../types";
export interface Track {
    // id: number
    pos: Vector2
    dist: number
    dir: Vector2
    speed: number
    age: number
    lastUpdate: number
    // confidence: number
}