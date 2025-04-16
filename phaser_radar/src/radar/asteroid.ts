import { Math as PM } from 'phaser'

export class Asteroid extends Phaser.Geom.Circle {
    constructor(public position: PM.Vector2, public direction: PM.Vector2, public speed: number, public size: number) {
        super(position.x, position.y, size)
    }
    move() {
        this.position.add(this.direction.clone().scale(this.speed))
    }
}