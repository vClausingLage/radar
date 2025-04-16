import { Math as PM } from 'phaser'

export class Track {
    constructor(public position: PM.Vector2, public direction: PM.Vector2, public speed: number) {}
}