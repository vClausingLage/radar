import { Vector2 } from "../../types";
import { Loadout } from "../../types";
import { LightRadar } from "../systems/lightRadar";
import { AiUnitController } from "../../controller/aiUnitController";

interface Ship {
    position: Vector2;
    direction: Vector2;
    speed: number;
    size: number;
}

export interface Player extends Ship {
    id: string;
    sprite: Phaser.Physics.Arcade.Image;
    loadout: Loadout;
    radar: LightRadar;
    isRadarTracked: boolean;
    isSttTracked: boolean;
}

export interface Target extends Ship {
    id: number;
    controller: AiUnitController;
}

abstract class Ship extends Phaser.Physics.Arcade.Sprite {
    constructor(scene: Phaser.Scene, x: number, y: number, speed: number, size: number) {
        super(scene, x, y, 'ship');
        this.speed = speed;
        this.size = size;
    }
}

export class PlayerShip extends Ship {
    constructor(scene: Phaser.Scene, x: number, y: number, speed: number, size: number) {
        super(scene, x, y, speed, size);
    }
    init() {
        
    }
}
