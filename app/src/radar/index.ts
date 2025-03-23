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
    private time: Phaser.Time.Clock
    private scene: Phaser.Scene

    constructor(scene: Phaser.Scene, time: Phaser.Time.Clock, t: Target[], r: number, private pos: PM.Vector2 = new PM.Vector2(), private pulseDir?: PM.Vector2) {
        this.scene = scene
        this.time = time
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
            console.log('TARGET',t)
            // console.log(this.range)
            // console.log(this.pos)
            // console.log(d)
        }

        return null
    }

    /*
    * a full circle search is performed if no start and end direction is provided
    * @param startDirection: PM.Vector2
    * @param endDirection: PM.Vector2
    */
    async search(startDirection?: PM.Vector2, endDirection?: PM.Vector2): Promise<void> {
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
            let i = 360
            if (i > 0) {
                this.time.addEvent({
                    delay: 20,
                    callback: () => {
                        console.log('searching full circle', i)
                        i--
                        
                        // const radarBeam = new Phaser.GameObjects.Line(this.scene, this.pos.x, this.pos.y - 20, 0, 0, this.range, 0, 0x801d)
                        var line = new Phaser.GameObjects.Line(
                            this.scene,
                            this.pos.x,
                            this.pos.y,
                            this.pos.x,
                            this.pos.y,
                            this.pos.x + this.pulseDir?.x! * 200,
                            this.pos.y + this.pulseDir?.y! * 200,
                            0x801d,
                            0.5
                        )
                        // var line = this.scene.add.line(this.pos.x, this.pos.y, this.pos.x, this.pos.y, this.pulseDir?.x! * 100, this.pulseDir?.y! *100, 0x801d)
                        line.setRotation(Phaser.Math.DegToRad(i))
                        // this.scene.tweens.add({
                        //     targets: line,
                        //     alpha: 0,
                        //     duration: 2000,
                        //     onComplete: () => line.destroy()
                        // })

                    },
                    repeat: i
                })
            }
                // const direction = new PM.Vector2()
                // this.setDirection(direction)
                // const target = this.transceive(direction)
                // console.log('searching', this.pulseDir, target)
            
        }
    }
}