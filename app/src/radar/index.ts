import Phaser from 'phaser'

export class Target {
    constructor(public position: Phaser.Math.Vector2, public direction: Phaser.Math.Vector2, public speed: number) {}
}

export class Radar {
    private range: number
    private targets: Target[]

    constructor(m: WorldMap, private pos: Phaser.Math.Vector2 = new Phaser.Math.Vector2(), private pulseDir?: Phaser.Math.Vector2) {
        this.range = m.getRange()
        this.targets = m.getTargets()
    }

    setDirection(direction: Phaser.Math.Vector2) {
        this.pulseDir = direction
    }

    setPosition(pos: Phaser.Math.Vector2) {
        this.pos = pos
    }

    transceive(d: Phaser.Math.Vector2): Target | null {
        // create a target if vector equals vector to target from radar
        // add left and right tolerance
        // use sin / cos for tolerance
        for (const t of this.targets) {
            
        }

        return null
    }

    async search(socket: WebSocket, startDirection?: Phaser.Math.Vector2, endDirection?: Phaser.Math.Vector2): Promise<void> {
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
                const direction = new Phaser.Math.Vector2()
                this.setDirection(direction)
                socket.send(JSON.stringify({ x: direction.x, y: direction.y }));
                const target = this.transceive(direction)
            }
        }
    }
}