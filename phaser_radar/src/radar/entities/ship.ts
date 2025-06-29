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