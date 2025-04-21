import { Vector2 } from "../../types";
export interface Target {
    position: Vector2;
    direction: Vector2;
    speed: number;
    size: number;
}