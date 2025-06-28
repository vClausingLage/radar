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
    loadout: Loadout;
    radar: LightRadar;
}

export interface Target extends Ship {
    id: number;
    controller: AiUnitController;
    isTracked: boolean;
}