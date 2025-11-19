import { Loadout } from "../../types";
import { LightRadar } from "../systems/lightRadar";
import { AiUnitController } from "../../controller/aiUnitController";

abstract class Ship extends Phaser.Physics.Arcade.Sprite {
    constructor(
        public scene: Phaser.Scene, 
        x: number, 
        y: number, 
        speed: number, 
        size: number, 
        loadout: Loadout, 
        radar: LightRadar
    ) {
        super(scene, x, y, 'ship');
        this.loadout = loadout;
        this.radar = radar;
        this.setScale(size);
        this.scene.add.existing(this);
        this.scene.physics.add.existing(this);
        this.body?.setSize(size, size);
        this.setVelocity(speed);
        this.radar.setMode('rws');
    }
    isRadarTracked: boolean = false;
    isSttTracked: boolean = false;
    loadout: Loadout;
    radar: LightRadar;
}

export class PlayerShip extends Ship {
    constructor(scene: Phaser.Scene, x: number, y: number, speed: number, size: number, loadout: Loadout, radar: LightRadar) {
        super(scene, x, y, speed, size, loadout, radar);
    }
}

export class Target extends Ship {
    constructor(scene: Phaser.Scene, x: number, y: number, speed: number, size: number, loadout: Loadout, radar: LightRadar, id: number, controller: AiUnitController) {
        super(scene, x, y, speed, size, loadout, radar);
        this.id = id;
        this.controller = controller;
    }
    id: number;
    controller: AiUnitController;
}
