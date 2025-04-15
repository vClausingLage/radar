import { Math as PM } from 'phaser'

type ReturnSignal = {
    point: Phaser.Math.Vector2
    time: number
}

export class Target extends Phaser.Geom.Circle {
    constructor(x: number, y: number, public direction: PM.Vector2, public speed: number, public size: number) {
        super(x, y, size)
    }
}

export class Track {
    constructor(public position: PM.Vector2, public direction: PM.Vector2, public speed: number) {}
}

export class Asteroid extends Phaser.Geom.Circle {
    constructor(public position: PM.Vector2, public direction: PM.Vector2, public speed: number, public size: number) {
        super(position.x, position.y, size)
    }
    move() {
        this.position.add(this.direction.clone().scale(this.speed))
    }
}

export class Radar {
    private targets: Target[]
    private time: Phaser.Time.Clock
    private scene: Phaser.Scene
    private returnSignals: {point: Phaser.Math.Vector2, time: number}[] = []
    private tracks: Track[] = []

    constructor(scene: Phaser.Scene, time: Phaser.Time.Clock, t: Target[], private pos?: PM.Vector2, private range?: number, private pulseDir?: PM.Vector2) {
        this.scene = scene
        this.time = time
        this.targets = t
    }

    setDirection(direction: PM.Vector2) {
        this.pulseDir = direction
    }

    setPosition(pos: PM.Vector2) {
        this.pos = pos
    }

    setRange(r: number) {
        this.range = r
    }

    addTarget(target: Target) {
        this.targets.push(target)
    }

    findTargetByCircle(d: Phaser.Geom.Line): ReturnSignal[] {
        let tgts: { point: Phaser.Math.Vector2; time: number }[] = []
        
        for (const t of this.targets) {
            // const angleToTarget = Phaser.Math.Angle.Between(this.pos!.x, this.pos!.y, t.x, t.y)
            // const dist = Phaser.Math.Distance.BetweenPoints(d.getPointA(), t)
            if (Phaser.Geom.Intersects.LineToCircle(d, t)) {
                const result = Phaser.Geom.Intersects.GetLineToCircle(d, t);
                if (result) {
                    tgts.push({point: result[0], time: new Date().getTime()})
                    const graphics = this.scene.add.graphics();
                    graphics.fillStyle(0xff0000, 1);
                    graphics.fillPoint(result[0].x, result[0].y, 2);
                    this.scene.time.addEvent({
                        delay: 20000,
                        callback: () => {
                            graphics.clear();
                        },
                        callbackScope: this
                    });
                }
            }
        }

        return tgts.length > 0 ? tgts : []
    }

    transceive(d: Phaser.Geom.Line): ReturnSignal[] {
        const t = this.findTargetByCircle(d)
        return t.length > 0 ? t : []
    }

    /*
    * a full circle search is performed if no start and end direction is provided
    * @param startDirection: PM.Vector2
    * @param endDirection: PM.Vector2
    */
    async search(startDirection?: PM.Vector2, endDirection?: PM.Vector2): Promise<void> {
        if (!this.pos) {
            console.error('Radar position not set')
        }
        if (!this.range) {
            console.error('Radar range not set')
        }
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
            let repetitions = 360
            let step = 0
            this.time.addEvent({
                delay: 3,
                callback: () => {
                    // begin new serach circle when 360 degrees are reached
                    if (step >= 360) {
                        step = 0
                    }
                    step += .5
                    const radarBeam = new Phaser.Geom.Line(
                        this.pos?.x,
                        this.pos?.y,
                        this.pos?.x! + this.pulseDir?.x! * this.range!,
                        this.pos?.y! + this.pulseDir?.y! * this.range!
                    )
                    Phaser.Geom.Line.RotateAroundXY(radarBeam, this.pos?.x!, this.pos?.y!, Phaser.Math.DegToRad(step))
                    // watch for targets
                    const rs = this.transceive(radarBeam)
                    if (rs.length > 0) {
                        for (const t of rs) {
                            //! target computer logic
                        }
                    }
                    // draw radar beam
                    const graphics = this.scene.add.graphics({
                        lineStyle: { width: .3, color: 0x00ff00, alpha: 0.5 }
                    });
                    graphics.strokeLineShape(radarBeam)
                    // manipulate radar beam
                    this.time.addEvent({
                        delay: 300,
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
                repeat: repetitions,
                callbackScope: this,
                loop: true
            })
        }
    }
}