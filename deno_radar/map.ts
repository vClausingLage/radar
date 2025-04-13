import { Vector2 } from "./vector2.ts"
import { Target } from "./target.ts"

export class WorldMap {
    constructor(private range: number, private targets: Target[]) {
    }

    getTargets(): Target[] {
        return this.targets
    }

    getRange(): number {
        return this.range
    }

    isWithinRange(v: Vector2): boolean {
        return Math.sqrt(v.x * v.x + v.y * v.y) <= this.range
    }

    addTargets(t: Target[]): void {
        for (const target of t) {
            if (this.isWithinRange(target.position)) this.targets.push(target)
        }
    }
}