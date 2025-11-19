import { Vector2 } from "../../types";
import { Loadout } from "../../types";
import { LightRadar } from "../systems/lightRadar";
import { AiUnitController } from "../../controller/aiUnitController";

// interface Ship {
//     position: Vector2;
//     direction: Vector2;
//     speed: number;
//     size: number;
// }

// export interface Player extends Ship {
//     id: string;
//     sprite: Phaser.Physics.Arcade.Image;
//     loadout: Loadout;
//     radar: LightRadar;
//     isRadarTracked: boolean;
//     isSttTracked: boolean;
// }

// export interface Target extends Ship {
//     id: number;
//     controller: AiUnitController;
// }

abstract class Ship extends Phaser.Physics.Arcade.Sprite {
    constructor(scene: Phaser.Scene, x: number, y: number, speed: number, size: number) {
        super(scene, x, y, 'ship');
        this.setScale(size);
        this.scene.add.existing(this);
        this.scene.physics.add.existing(this);
        this.body?.setSize(size, size);
        this.setVelocity(speed);
    }
}

export class PlayerShip extends Ship {
    constructor(scene: Phaser.Scene, x: number, y: number, speed: number, size: number) {
        super(scene, x, y, speed, size);
    }
}

export interface Target extends Ship {
    id: number;
    controller: AiUnitController;
}
