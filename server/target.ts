import { Vector2 } from './vector2.ts'

export class Target {
    constructor(public position: Vector2, public direction: Vector2, public speed: number) {}
}