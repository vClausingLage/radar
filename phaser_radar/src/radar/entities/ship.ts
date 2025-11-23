import { Loadout } from "../../types";
import { LightRadar } from "../systems/lightRadar";
import { AiUnitController } from "../../controller/aiUnitController";
import { PhysicsController } from "../../controller/physicsController";

abstract class Ship extends Phaser.Physics.Arcade.Sprite {
    constructor(
        public scene: Phaser.Scene, 
        public x: number, 
        public y: number, 
        private direction: number,
        private speed: number, 
        public radar: LightRadar,
        private loadout: Loadout, 
        private isRadarTracked: boolean = false,
        private isSttTracked: boolean = false,
        private physicsController?: PhysicsController,
    ) {
        super(scene, x, y, 'ship');
        
        this.loadout = loadout;
        this.radar = radar;
        this.scene.add.existing(this);
        this.scene.physics.add.existing(this);
        this.body?.velocity.set(
            Math.cos(Phaser.Math.DegToRad(direction)) * speed, 
            Math.sin(Phaser.Math.DegToRad(direction)) * speed
        );
        this.radar.setMode('rws');
        this.angle = this.direction;
        this.physicsController = new PhysicsController();
    }

    getCircle() {
        return new Phaser.Geom.Circle(this.x, this.y, ((this.body?.width || 0) / 2) - 10);
    }

    getSpeed(): number {
        if (!this.body || !this.body.velocity) {
            throw new Error('Velocity of Target is undefined');
        }
        return this.body.velocity.length()
    }
    getDirection(): number {
        if (this.angle === undefined) {
            throw new Error('Direction of Target is undefined');
        }
        return this.angle
    }
}

export class PlayerShip extends Ship {
    constructor(
        scene: Phaser.Scene, 
        x: number, 
        y: number, 
        direction: number, 
        speed: number, 
        radar: LightRadar, 
        loadout: Loadout
    ) {
        super(scene, x, y, direction, speed, radar, loadout);
    }
}

export class Target extends Ship {
    constructor(
        scene: Phaser.Scene, 
        x: number, 
        y: number, 
        direction: number,
        speed: number, 
        radar: LightRadar, 
        loadout: Loadout, 
        public id: number, 
        public controller: AiUnitController, 
    ) {
        super(scene, x, y, direction, speed, radar, loadout);
        this.setVisible(false);
    }
}
