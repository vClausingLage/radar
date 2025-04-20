import { Math as PM } from 'phaser'

import { Target } from '../entities/target'
import { renderTrack } from '../radarRenderHelper'
import { ReturnSignal } from '../../types/index'

export class Radar {
    private targets: Target[]
    private time: Phaser.Time.Clock
    private scene: Phaser.Scene
    private returnSignals: {point: Phaser.Math.Vector2, time: number}[] = []
    private lastReturnSignal: ReturnSignal | null = null
    private radarTrackSensitivity: number = 5

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

    setSensitivity(s: number) {
        this.radarTrackSensitivity = s
    }

    addTarget(target: Target) {
        this.targets.push(target)
    }

    findTargetByCircle(d: Phaser.Geom.Line): ReturnSignal {
        let tgts: { point: Phaser.Math.Vector2; time: number }[] = []
        
        for (const t of this.targets) {
            // const angleToTarget = Phaser.Math.Angle.Between(this.pos!.x, this.pos!.y, t.x, t.y)
            // const dist = Phaser.Math.Distance.BetweenPoints(d.getPointA(), t)
            const circle = new Phaser.Geom.Circle(t.position.x, t.position.y, t.size)
            if (Phaser.Geom.Intersects.LineToCircle(d, circle)) {
                const result = Phaser.Geom.Intersects.GetLineToCircle(d, circle);
                if (result) {
                    tgts.push({point: result[0], time: new Date().getTime()})
                    const graphics = this.scene.add.graphics();
                    graphics.fillStyle(0xff0000, 1);
                    graphics.fillPoint(result[0].x, result[0].y, 2);
                    this.scene.time.addEvent({
                        delay: 9000,
                        callback: () => {
                            graphics.clear();
                        },
                        callbackScope: this
                    });
                }
            }
        }

        return tgts[0] || null
    }

    transceive(d: Phaser.Geom.Line): ReturnSignal {
        return this.findTargetByCircle(d)
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
            const radarBeam = new Phaser.Geom.Line(
                this.pos?.x,
                this.pos?.y,
                this.pos?.x! + this.pulseDir?.x! * this.range!,
                this.pos?.y! + this.pulseDir?.y! * this.range!
            )
            const graphics = this.scene.add.graphics({
                lineStyle: { width: 0.3, color: 0x00ff00, alpha: 0.5 }
            });
            this.time.addEvent({
                delay: 3,
                callback: () => {
                    // const radarBeam = new Phaser.Geom.Line(
                    //     this.pos?.x,
                    //     this.pos?.y,
                    //     this.pos?.x! + this.pulseDir?.x! * this.range!,
                    //     this.pos?.y! + this.pulseDir?.y! * this.range!
                    // )
                    radarBeam.setTo(
                        this.pos?.x,
                        this.pos?.y,
                        this.pos?.x! + this.pulseDir?.x! * this.range!,
                        this.pos?.y! + this.pulseDir?.y! * this.range!
                    )
                    // begin new serach circle when 360 degrees are reached
                    if (step >= 360) {
                        step = 0
                    }
                    step += .5
                    Phaser.Geom.Line.RotateAroundXY(radarBeam, this.pos?.x!, this.pos?.y!, Phaser.Math.DegToRad(step))
                    // watch for targets
                    const rs = this.transceive(radarBeam)
                    if (rs) {
                        if (!this.lastReturnSignal) {
                            this.lastReturnSignal = rs
                        }
                        if (this.lastReturnSignal) {
                            const distance = Phaser.Math.Distance.Between(
                                this.lastReturnSignal.point.x,
                                this.lastReturnSignal.point.y,
                                rs.point.x,
                                rs.point.y
                            );
                            // feed track with new data
                            if (distance > this.radarTrackSensitivity) {
                                console.log('problem')
                                this.returnSignals = []
                            }
                            if (distance < this.radarTrackSensitivity) {
                                this.returnSignals.push(rs)
                            }

                            this.lastReturnSignal = rs;
                        }
                    }
                    if (!rs) {
                        if (this.lastReturnSignal) {
                            // now is the time to calculate the track
                            const averagePoint = this.returnSignals.reduce(
                                (acc, signal) => {
                                    acc.x += signal.point.x;
                                    acc.y += signal.point.y;
                                    return acc;
                                },
                                { x: 0, y: 0 }
                            );

                            averagePoint.x /= this.returnSignals.length;
                            averagePoint.y /= this.returnSignals.length;

                            renderTrack(this.scene, averagePoint)
                            this.returnSignals = []
                        }
                        this.lastReturnSignal = null
                    }
                    // draw radar beam
                    graphics.clear();
                    graphics.strokeLineShape(radarBeam)
                    graphics.fillStyle(0x00ff00, 0.5);
                },
                repeat: repetitions,
                callbackScope: this,
                loop: true
            })
        }
    }
}