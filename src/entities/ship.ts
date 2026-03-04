import { LightRadar } from "../radar/systems/lightRadar";
import { AiUnitController } from "../controller/aiUnitController";
import { Vector2 } from "../types";
import { PlayerController } from "../controller/playerController";

export abstract class Ship extends Phaser.Physics.Matter.Sprite {
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
        texture?: string;
    }) {
        super(params.scene.matter.world, params.x, params.y, params.texture || 'ship');
        this.scene = params.scene;
        this.x = params.x;
        this.y = params.y;
        this.direction = params.direction;
        this.speed = params.speed;
        this.radar = params.radar;
        this.scene.add.existing(this);
        if (!this.body) {
            throw new Error('Body of Ship is undefined');
        }
        // Remove air friction for space physics
        this.setFrictionAir(0);
        // Set velocity using Matter physics
        const velocityX = Math.cos(Phaser.Math.DegToRad(this.direction)) * this.speed;
        const velocityY = Math.sin(Phaser.Math.DegToRad(this.direction)) * this.speed;
        this.setVelocity(velocityX, velocityY);
        this.radar.setMode('rws');
        this.angle = this.direction;
        this.currentSpeed = this.speed;
    }

    getCircle(): Phaser.Geom.Circle {
        const radius = Math.max(this.width, this.height) / 2;
        return new Phaser.Geom.Circle(this.x, this.y, radius);
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
        this.setVelocity(
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
        // Pass correct texture to parent constructor
        super({
            ...params,
            texture: params.shipType === 'cargo' ? 'cargo' : 'ship'
        });
        this.id = params.id;
        this.shipType = params.shipType;
        
        this.setVisible(true);
        this.setScale(.7);
    }

    setController(controller: AiUnitController) {
        this.controller = controller;
    }
}
