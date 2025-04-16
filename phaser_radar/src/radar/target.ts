import { Math as PM } from 'phaser'

export class Target extends Phaser.Geom.Circle {
    constructor(x: number, y: number, public direction: PM.Vector2, public speed: number, public size: number) {
        super(x, y, size)
    }
}