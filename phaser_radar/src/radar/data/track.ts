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
}