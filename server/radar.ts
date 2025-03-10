import { Target } from "./target.ts"
import { Vector2 } from "./vector2.ts"
import { WorldMap } from "./map.ts"

export class Radar {
    private range: number
    private targets: Target[]

    constructor(m: WorldMap, private pos: Vector2 = new Vector2(0, 0), private pulseDir?: Vector2) {
        this.range = m.getRange()
        this.targets = m.getTartgets()
    }

    setDirection(direction: Vector2) {
        this.pulseDir = direction
    }

    transceive(): Target | null {
        const target = null
        return target
    }

    search(startDirection?: Vector2, endDirection?: Vector2) {
        if (startDirection && endDirection) {
            console.log('searchging from', startDirection, 'to', endDirection)
        }
        if (startDirection && !endDirection) {
            console.log('searching from', startDirection)
        }
        if (!startDirection && endDirection) {
            console.log('searching to', endDirection)
        }
        if (!startDirection && !endDirection) {
            console.log('searching full circle')
            this.setDirection(new Vector2(1, 0))
            this.transceive()
        }
    }
}