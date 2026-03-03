import { LightRadar } from "../radar/systems/lightRadar";
import { AiUnitController } from "../controller/aiUnitController";
import { Vector2 } from "../types";
import { PlayerController } from "../controller/playerController";

export abstract class Ship extends Phaser.Physics.Arcade.Sprite {
    private direction: number;
    private speed: number;
    private currentSpeed: number;
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
        this.currentSpeed = this.speed;
    }

    getCircle(): Phaser.Geom.Circle {
        return new Phaser.Geom.Circle(this.x, this.y, (this.body?.width || 0) / 2);
    }

    getSpeed(): number {
        return this.speed;
    }

    getCurrentSpeed(): number {
        return this.currentSpeed;
    }

    setCurrentSpeed(newSpeed: number): void {
        this.currentSpeed = newSpeed;
        if (!this.body) return;
        const angleRad = Phaser.Math.DegToRad(this.angle);
        this.body.velocity.set(
            Math.cos(angleRad) * this.currentSpeed,
            Math.sin(angleRad) * this.currentSpeed
        );
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
    public shipType: 'cruiser' | 'cargo';
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
        this.shipType = params.shipType;
        
        // Set sprite and physics body based on shipType
        if (params.shipType === 'cargo') {
            this.setTexture('cargo');
            // Cargo sprite is 70x160 px, set rectangle body
            this.setBodySize(70, 160);
        } else {
            this.setTexture('ship');
            // Cruiser sprite is circular
            this.setCircle((this.body?.width || 0) / 2);
        }
        
        this.setVisible(true);
        this.setScale(.7);
    }

    setController(controller: AiUnitController) {
        this.controller = controller;
    }
}
