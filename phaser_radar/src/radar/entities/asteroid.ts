import { Vector2 } from "../../types"

export interface Asteroid {
    position: Vector2;
    direction: Vector2;
    speed: number;
    size: number;
    sprite?: Phaser.GameObjects.Image;
}