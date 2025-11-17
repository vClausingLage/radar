import { Vector2 } from "../../types"

// export interface Asteroid {
//     position: Vector2;
//     direction: Vector2;
//     speed: number;
//     size: number;
//     sprite?: Phaser.GameObjects.Image;
// }

export class Asteroid extends Phaser.GameObjects.GameObject {
    constructor(scene: Phaser.Scene, position: Vector2, direction: Vector2, speed: number, size: number) {
        super(scene, 'Asteroid');
        this.position = position;
        this.direction = direction;
        this.speed = speed;
        this.size = size;
    }
    position: Vector2;
    direction: Vector2;
    speed: number;
    size: number;
}