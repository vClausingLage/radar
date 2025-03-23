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
                        
                        const radarBeam = new Phaser.Geom.Line(
                            this.pos.x,
                            this.pos.y,
                            this.pos.x + this.pulseDir?.x! * this.range,
                            this.pos.y + this.pulseDir?.y! * this.range
                        )
                        Phaser.Geom.Line.RotateAroundXY(radarBeam, this.pos.x, this.pos.y, Phaser.Math.DegToRad(i))
                        const graphics = this.scene.add.graphics({
                            lineStyle: { width: .3, color: 0x00ff00, alpha: 0.5 }
                        });
                        graphics.strokeLineShape(radarBeam);
                        this.time.addEvent({
                            delay: 600,
                            callback: () => {
                                this.scene.tweens.add({
                                    targets: graphics,
                                    alpha: 0,
                                    duration: 1000,
                                    onComplete: () => {
                                        graphics.clear();
                                    }
                                });
                            },
                            callbackScope: this
                        });
                        graphics.strokeLineShape(radarBeam);
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