import { Math as PM } from 'phaser'

export class Target {
    constructor(public position: PM.Vector2, public direction: PM.Vector2, public speed: number, public size: number) {}
}

export class TargetInformation {
    constructor(private direction: number, private distance: number, private speed: number) {}

    getDirection() {
        return this.direction
    }

    getDistance() {
        return this.distance
    }

    getSpeed() {
        return this.speed
    }
}

export class Track {
    constructor(public position: PM.Vector2, public direction: PM.Vector2, public speed: number) {}
}

export class Asteroid extends Target {
    constructor(public position: PM.Vector2, public direction: PM.Vector2, public speed: number, public size: number) {
        super(position, direction, speed, size)
    }
}

export class Radar {
    private targets: Target[]
    private time: Phaser.Time.Clock
    private scene: Phaser.Scene
    private returnSignal: TargetInformation[] = []
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

    findTargetByLine(d: Phaser.Geom.Line, targets: Target[]): TargetInformation[] {
        let tgts: TargetInformation[] = []

        for (const t of this.targets) {
            // console.log('TARGET',t)
            const distance = Phaser.Math.Distance.Between(this.pos!.x, this.pos!.y, t.position.x, t.position.y)
            if (distance <= this.range!) {
                const angleToTarget = Phaser.Math.Angle.Between(this.pos!.x, this.pos!.y, t.position.x, t.position.y)
                const angleOfLine = Phaser.Math.Angle.Between(d.x1, d.y1, d.x2, d.y2)
                // tolerance in degrees
                const tolerance = Phaser.Math.DegToRad(.5)

                if (Math.abs(angleToTarget - angleOfLine) <= tolerance) {
                    const dist = Phaser.Math.Distance.BetweenPoints(d.getPointA(), t.position)

                    const ti = new TargetInformation(PM.RadToDeg(angleToTarget), dist, t.speed)
                    tgts.push(ti)
                }
            }
        }

        return tgts.length > 0 ? tgts : []
    }

    findTargetByCircle(d: Phaser.Geom.Line): TargetInformation[] {
        let tgts: TargetInformation[] = []

        for (const t of this.targets) {
            const distance = Phaser.Math.Distance.Between(this.pos!.x, this.pos!.y, t.position.x, t.position.y)
            const angleToTarget = Phaser.Math.Angle.Between(this.pos!.x, this.pos!.y, t.position.x, t.position.y)
            const dist = Phaser.Math.Distance.BetweenPoints(d.getPointA(), t.position)
            const targetCircle = new Phaser.Geom.Circle(t.position.x, t.position.y, 10);
            if (Phaser.Geom.Intersects.LineToCircle(d, targetCircle)) {
                tgts.push(new TargetInformation(PM.RadToDeg(angleToTarget), dist, t.speed));
            }
        }

        return tgts.length > 0 ? tgts : []
    }

    transceive(d: Phaser.Geom.Line): TargetInformation[] {
        // create a target if vector equals vector to target from radar
        // add left and right tolerance
        // use sin / cos for tolerance
        //! add error

        // find tgts by line
        // const t = this.findTargetByLine(d, this.targets)
        // find tgts by circle
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
                delay: 10,
                callback: () => {
                    // begin new serach circle when 360 degrees are reached
                    if (step >= 360) {
                        step = 0
                    }
                    step += 1
                    const radarBeam = new Phaser.Geom.Line(
                        this.pos?.x,
                        this.pos?.y,
                        this.pos?.x! + this.pulseDir?.x! * this.range!,
                        this.pos?.y! + this.pulseDir?.y! * this.range!
                    )
                    // console.log('radar beam', Phaser.Math.DegToRad(step), step)
                    Phaser.Geom.Line.RotateAroundXY(radarBeam, this.pos?.x!, this.pos?.y!, Phaser.Math.DegToRad(step))
                    // watch for targets
                    const ti = this.transceive(radarBeam)
                    if (ti.length > 0) {
                        for (const t of ti) {
                            console.log('direction', Math.abs(Math.round(t.getDirection() - 180)), 'distance', Math.round(t.getDistance()), 'speed', t.getSpeed(), step)

                            this.tracks.push(
                                new Track(
                                    new PM.Vector2(
                                        this.pos?.x! + Math.cos(Phaser.Math.DegToRad(t.getDirection())) * t.getDistance(),
                                        this.pos?.y! + Math.sin(Phaser.Math.DegToRad(t.getDirection())) * t.getDistance()
                                    ),
                                    new PM.Vector2(
                                        Math.cos(Phaser.Math.DegToRad(t.getDirection())),
                                        Math.sin(Phaser.Math.DegToRad(t.getDirection()))
                                    ),
                                    t.getSpeed()
                                )
                            );
                            if (this.tracks.length > 12) {
                                this.tracks.shift();
                            }
                            // this.scene.add.circle(
                            //     this.pos?.x! + Math.cos(Phaser.Math.DegToRad(t.getDirection())) * t.getDistance(),
                            //     this.pos?.y! + Math.sin(Phaser.Math.DegToRad(t.getDirection())) * t.getDistance(),
                            //     2,
                            //     0x00ff00
                            // )
                        }
                    }
                    // draw radar beam
                    const graphics = this.scene.add.graphics({
                        lineStyle: { width: .3, color: 0x00ff00, alpha: 0.5 }
                    });
                    graphics.strokeLineShape(radarBeam)
                    // manipulate radar beam
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
                repeat: repetitions,
                callbackScope: this,
                loop: true
            })
        }
    }
}