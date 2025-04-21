import { RadarSettings, Vector2 } from '../../types/index'
import { Target } from '../entities/target'
import { ReturnSignal } from '../../types/index'

export class Radar {

    constructor(
        private scene: Phaser.Scene,
        private clock: Phaser.Time.Clock, 
        private radarOptions: RadarSettings,
        private targets: Target[],
        private radarBeam: Phaser.Geom.Line,
        private step: number = 0,
    ) {}

    setDirection(direction: Vector2) {
        this.radarOptions.pulseDir = direction
    }

    setPosition(pos: Vector2) {
        this.radarOptions.pos = pos
    }

    setRange(r: number) {
        this.radarOptions.range = r
    }

    setSensitivity(s: number) {
        this.radarOptions.sensitivity = s
    }

    addTarget(target: Target) {
        this.targets.push(target)
    }

    getTargets() {
        return this.targets
    }

    getSearchAperture() {
        return this.radarOptions.aperture
    }

    findTargetByCircle(d: Phaser.Geom.Line): ReturnSignal {
        let tgts: { point: Vector2; time: number }[] = []
        
        for (const t of this.targets) {
            const circle = new Phaser.Geom.Circle(t.position.x, t.position.y, t.size)
            if (Phaser.Geom.Intersects.LineToCircle(d, circle)) {
                const result = Phaser.Geom.Intersects.GetLineToCircle(d, circle);
                if (result) {
                    tgts.push({point: result[0], time: this.clock.now})
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

    generateTracks(tgts: any) {
        // if (tgts.length > 0) {
        //     if (!this.lastReturnSignal) {
        //         this.lastReturnSignal = tgts[0]
        //     }
        //     if (this.lastReturnSignal) {
        //         const distance = Phaser.Math.Distance.Between(
        //             this.lastReturnSignal.point.x!,
        //             this.lastReturnSignal.point.y!,
        //             tgts[0].point.x!,
        //             tgts[0].point.y!
        //         );
        //         // feed track with new data
        //         if (distance > this.radarTrackSensitivity) {
        //             console.log('problem')
        //             this.returnSignals = []
        //         }
        //         if (distance < this.radarTrackSensitivity) {
        //             this.returnSignals.push(tgts[0])
        //         }

        //         this.lastReturnSignal = tgts;
        //     }
        // }
        // if (!tgts) {
        //     if (this.lastReturnSignal) {
        //         // now is the time to calculate the track
        //         const averagePoint = this.returnSignals.reduce(
        //             (acc, signal) => {
        //                 acc.x += signal.point.x!;
        //                 acc.y += signal.point.y!;
        //                 return acc;
        //             },
        //             { x: 0, y: 0 }
        //         );

        //         averagePoint.x /= this.returnSignals.length;
        //         averagePoint.y /= this.returnSignals.length;

        //         renderTrack(this.scene, averagePoint)
        //         this.returnSignals = []
        //     }
        //     this.lastReturnSignal = null
        // }
        // return []
    }


    start() {
        this.radarOptions.isScanning = true
        this.radarBeam.setTo(
            this.radarOptions.pos?.x,
            this.radarOptions.pos?.y,
            this.radarOptions.pos?.x! + this.radarOptions.pulseDir?.x! * this.radarOptions.range!,
            this.radarOptions.pos?.y! + this.radarOptions.pulseDir?.y! * this.radarOptions.range!
        )
        console.log('radar started', this.radarBeam)
    }

    stop() {
        this.radarOptions.isScanning = false
    }

    rotate() {

    }

    render() {

    }

    update(delta: number, aperture: number) {
        if (!this.radarOptions.isScanning) {
            return
        }
        if (!this.radarBeam) {
            console.error('Radar beam not set')
        }
        if (!this.radarOptions.pos) {
            console.error('Radar position not set')
        }
        if (!this.radarOptions.range) {
            console.error('Radar range not set')
        }
        if (!this.radarOptions.pulseDir) {
            console.error('Radar direction not set')
        }
        const graphics = this.scene.add.graphics({ lineStyle: { width: 2, color: 0x00ff00, alpha: 1 } });
        graphics.clear();
        
        console.log('radar beam', this.radarOptions.pos?.x!, this.radarOptions.pos?.y!);

        console.log('radar beam', this.radarBeam.x1, this.radarBeam.y1, this.radarBeam.x2, this.radarBeam.y2);

        if (this.radarOptions.aperture === this.step) {
            this.step = 0
            this.scene.children.each((child) => {
                if (child.type === 'Graphics') {
                    child.destroy();
                }
            });
        }

        if (this.radarOptions.aperture) {
            this.step++
            const startAngle = Phaser.Math.DegToRad(this.step);
            const endAngle = Phaser.Math.DegToRad(this.step + 1);
            const startX = this.radarOptions.pos?.x! + Math.cos(startAngle) * this.radarOptions.range!;
            const startY = this.radarOptions.pos?.y! + Math.sin(startAngle) * this.radarOptions.range!;
            const endX = this.radarOptions.pos?.x! + Math.cos(endAngle) * this.radarOptions.range!;
            const endY = this.radarOptions.pos?.y! + Math.sin(endAngle) * this.radarOptions.range!; 
            this.radarBeam.setTo(
                this.radarOptions.pos?.x,
                this.radarOptions.pos?.y,
                startX,
                startY
            )
            graphics.fillStyle(0x00ff00, 0.5);
            graphics.fillPoint(startX, startY, 2);
            graphics.fillPoint(endX, endY, 2);
        }

        // const rotationSpeed = 1; // Adjust this value to control the rotation speed
        // const rotationAngle = rotationSpeed * delta;
        // Phaser.Geom.Line.RotateAroundXY(this.radarBeam, this.radarOptions.pos.x!, this.radarOptions.pos.y!, rotationAngle);
        // console.log('radar beam', this.radarOptions.pos?.x!, this.radarOptions.pos?.y!);
        // console.log('radar beam', this.radarBeam.x1, this.radarBeam.y1, this.radarBeam.x2, this.radarBeam.y2);
        
        // this.radarBeam.setTo(
        //     this.radarOptions.pos?.x,
        //     this.radarOptions.pos?.y,
        //     this.radarOptions.pos?.x! + this.radarOptions.pulseDir?.x! * this.radarOptions.range!,
        //     this.radarOptions.pos?.y! + this.radarOptions.pulseDir?.y! * this.radarOptions.range!
        // )

        // graphics.strokeLineShape(this.radarBeam);
    }

    /*
    * a full circle search is performed if no start and end direction is provided
    * @param startDirection: Vector2
    * @param endDirection: Vector2
    */
    async search(startDirection?: Vector2, endDirection?: Vector2): Promise<void> {
        if (!this.radarOptions.pos) {
            console.error('Radar position not set')
        }
        if (!this.radarOptions.range) {
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
            
            // this.clock.addEvent({
            //     delay: 3,
            //     callback: () => {
            //         radarBeam.setTo(
            //             this.pos?.x,
            //             this.pos?.y,
            //             this.pos?.x! + this.pulseDir?.x! * this.range!,
            //             this.pos?.y! + this.pulseDir?.y! * this.range!
            //         )
            //         // begin new serach circle when 360 degrees are reached
            //         if (step >= 360) {
            //             step = 0
            //         }
            //         step += .5
            //         Phaser.Geom.Line.RotateAroundXY(radarBeam, this.pos?.x!, this.pos?.y!, Phaser.Math.DegToRad(step))
            //         // watch for targets
            //         const rs = this.transceive(radarBeam)
            //         if (rs) {
            //             if (!this.lastReturnSignal) {
            //                 this.lastReturnSignal = rs
            //             }
            //             if (this.lastReturnSignal) {
            //                 const distance = Phaser.Math.Distance.Between(
            //                     this.lastReturnSignal.point.x!,
            //                     this.lastReturnSignal.point.y!,
            //                     rs.point.x!,
            //                     rs.point.y!
            //                 );
            //                 // feed track with new data
            //                 if (distance > this.radarTrackSensitivity) {
            //                     console.log('problem')
            //                     this.returnSignals = []
            //                 }
            //                 if (distance < this.radarTrackSensitivity) {
            //                     this.returnSignals.push(rs)
            //                 }

            //                 this.lastReturnSignal = rs;
            //             }
            //         }
            //         if (!rs) {
            //             if (this.lastReturnSignal) {
            //                 // now is the time to calculate the track
            //                 const averagePoint = this.returnSignals.reduce(
            //                     (acc, signal) => {
            //                         acc.x += signal.point.x!;
            //                         acc.y += signal.point.y!;
            //                         return acc;
            //                     },
            //                     { x: 0, y: 0 }
            //                 );

            //                 averagePoint.x /= this.returnSignals.length;
            //                 averagePoint.y /= this.returnSignals.length;

            //                 renderTrack(this.scene, averagePoint)
            //                 this.returnSignals = []
            //             }
            //             this.lastReturnSignal = null
            //         }
            //         // draw radar beam
            //         graphics.clear();
            //         graphics.strokeLineShape(radarBeam)
            //         graphics.fillStyle(0x00ff00, 0.5);
            //     },
            //     repeat: repetitions,
            //     callbackScope: this,
            //     loop: true
            // })
        }
    }
}