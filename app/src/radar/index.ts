import { Math as PM } from 'phaser'

export class Target {
    constructor(public id: number, public position: PM.Vector2, public direction: PM.Vector2, public speed: number) {}
}

export class Asteroid extends Target {
    constructor(public id: number, public position: PM.Vector2, public direction: PM.Vector2, public speed: number, public size: number) {
        super(id, position, direction, speed)
    }
}

export class Radar {
    private range: number
    private targets: Target[]

    constructor(t: Target[], r: number, private pos: PM.Vector2 = new PM.Vector2(), private pulseDir?: PM.Vector2) {
        this.range = r
        this.targets = t
    }

    setDirection(direction: PM.Vector2) {
        this.pulseDir = direction
    }

    setPosition(pos: PM.Vector2) {
        this.pos = pos
    }

    addTarget(target: Target) {
        this.targets.push(target)
    }

    updateTarget(target: Target) {
        for (const t of this.targets) {
            if (t.id === target.id) {
                t.position = target.position
                t.direction = target.direction
                t.speed = target.speed
            }
        }
    }

    transceive(d: PM.Vector2): Target | null {
        // create a target if vector equals vector to target from radar
        // add left and right tolerance
        // use sin / cos for tolerance
        for (const t of this.targets) {
            
        }

        return null
    }

    /*
    * a full circle search is performed if no start and end direction is provided
    * @param startDirection: PM.Vector2
    * @param endDirection: PM.Vector2
    */
    async search(startDirection?: PM.Vector2, endDirection?: PM.Vector2): Promise<void> {
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
                await delay(1000);
                const direction = new PM.Vector2()
                this.setDirection(direction)
                const target = this.transceive(direction)
                console.log('searching', this.pulseDir)
            }
        }
    }
}