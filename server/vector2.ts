export class Vector2 {
    constructor(public x: number, public y: number) {}

    add(v: Vector2): Vector2 {
        return new Vector2(this.x + v.x, this.y + v.y)
    }

    subtract(v: Vector2): Vector2 {
        return new Vector2(this.x - v.x, this.y - v.y)
    }

    multiply(scalar: number): Vector2 {
        return new Vector2(this.x * scalar, this.y * scalar)
    }

    divide(scalar: number): Vector2 {
        return new Vector2(this.x / scalar, this.y / scalar)
    }

    magnitude(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y)
    }

    normalize(): Vector2 {
        return this.divide(this.magnitude())
    }
}