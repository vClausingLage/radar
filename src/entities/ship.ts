import { LightRadar } from "../radar/systems/lightRadar";
import { AiUnitController } from "../controller/aiUnitController";
import { Vector2 } from "../types";
import { PlayerController } from "../controller/playerController";

export abstract class Ship extends Phaser.Physics.Arcade.Sprite {
    private direction: number;
    private speed: number;
    public radar: LightRadar;

    constructor(params: {
        scene: Phaser.Scene;
        x: number;
        y: number;
        direction: number;
        speed: number;
        radar: LightRadar;
    }) {
        super(params.scene, params.x, params.y, 'ship');
        this.scene = params.scene;
        this.x = params.x;
        this.y = params.y;
        this.direction = params.direction;
        this.speed = params.speed;
        this.radar = params.radar;
        this.scene.add.existing(this);
        this.scene.physics.add.existing(this);
        if (!this.body) {
            throw new Error('Body of Ship is undefined');
        }
        this.body.velocity.set(
            Math.cos(Phaser.Math.DegToRad(this.direction)) * this.speed, 
            Math.sin(Phaser.Math.DegToRad(this.direction)) * this.speed
        );
        this.radar.setMode('rws');
        this.angle = this.direction;
    }

    getCircle(): Phaser.Geom.Circle {
        return new Phaser.Geom.Circle(this.x, this.y, ((this.body?.width || 0) / 2) - 10);
    }

    getSpeed(): number {
        return this.speed;
    }
    
    getDirection(): number {
        if (this.angle === undefined) {
            throw new Error('Direction of Target is undefined');
        }
        return this.angle
    }
    getPosition(): Vector2 {
        return { x: this.x, y: this.y };
    }
}

export class PlayerShip extends Ship {
    public controller?: PlayerController;

    constructor(params: {
        scene: Phaser.Scene;
        x: number;
        y: number;
        direction: number;
        speed: number;
        radar: LightRadar;
    }) {
        super(params);
    }
}

export class Target extends Ship {
    public id: number;
    public controller?: AiUnitController;

    constructor(params: {
        scene: Phaser.Scene;
        x: number;
        y: number;
        direction: number;
        speed: number;
        radar: LightRadar;
        shipType: 'cruiser' | 'cargo';
        id: number;
    }) {
        super(params);
        this.id = params.id;
        this.setVisible(false);
        this.setScale(.5);
    }

    setController(controller: AiUnitController) {
        this.controller = controller;
    }
}
