import { Target } from "./target.ts"
import { Vector2 } from "./vector2.ts"
import { WorldMap } from "./map.ts"

export class Radar {
    private range: number
    private targets: Target[]

    constructor(m: WorldMap, private pos: Vector2 = new Vector2(0, 0), private pulseDir?: Vector2) {
        this.range = m.getRange()
        this.targets = m.getTargets()
    }

    setDirection(direction: Vector2) {
        this.pulseDir = direction
    }

    setPosition(pos: Vector2) {
        this.pos = pos
    }

    transceive(d: Vector2): Target | null {
        // create a target if vector equals vector to target from radar
        // add left and right tolerance
        // use sin / cos for tolerance
        for (const t of this.targets) {
            
        }

        return null
    }

    async search(socket: WebSocket, startDirection?: Vector2, endDirection?: Vector2): Promise<void> {
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
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
            for (let angle = 0; angle < 360; angle++) {
                await delay(70);
                const radian = (angle * Math.PI) / 180
                const direction = new Vector2(Math.cos(radian), Math.sin(radian))
                this.setDirection(direction)
                socket.send(JSON.stringify({ x: direction.x, y: direction.y }));
                const target = this.transceive(direction)
            }
        }
    }
}