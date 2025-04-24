import { RadarSettings, Vector2 } from '../../types/index'
import { Target } from '../entities/target'
import { ReturnSignal } from '../../types/index'
import { distanceBetweenPoints } from '../../math'
import { Memory } from './memory'

export class Radar {

    constructor(
        private scene: Phaser.Scene,
        private clock: Phaser.Time.Clock, 
        private radarOptions: RadarSettings,
        private targets: Target[],
        private radarBeam: Phaser.Geom.Line,
        private step: number = 0,
        private memory: Memory = {} as Memory,
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
        let tgts: ReturnSignal[] = []
        
        for (const t of this.targets) {
            const circle = new Phaser.Geom.Circle(t.position.x, t.position.y, t.size)
            if (Phaser.Geom.Intersects.LineToCircle(d, circle)) {
                const result = Phaser.Geom.Intersects.GetLineToCircle(d, circle);
                if (result) {
                    tgts.push({point: result[0], time: this.clock.now, step: this.step})
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

    generateTracks(rs: ReturnSignal) {
        // if (!this.lastReturnSignal) {
        //     this.lastReturnSignal = rs
        //     return
        // }
        // const d = distanceBetweenPoints(rs.point, this.lastReturnSignal.point)
        // if (d < this.radarOptions.sensitivity) {
            
        // }
            // if d is under sensitivity
            // d = sqrt(((x2 - x1) ** 2) + ((y2 - y1) ** 2))
            // if no previous signal
            // if yes previous signal
        

        // if d is under sensitivity
        // d = sqrt(((x2 - x1) ** 2) + ((y2 - y1) ** 2))
        // if no previous signal
        // if yes previous signal


        if (!rs) {
            this.memory[this.step] = null
            return
        }

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

    update() {
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
            const rs = this.transceive(this.radarBeam)
            if (rs) {
                this.generateTracks(rs)
                graphics.fillStyle(0xff0000, 1);
                graphics.fillPoint(rs.point.x!, rs.point.y!, 2);
            } else {
                graphics.fillStyle(0x00ff00, 0.5);
            }
            graphics.fillStyle(0x00ff00, 0.5);
            graphics.fillPoint(startX, startY, 2);
            graphics.fillPoint(endX, endY, 2);
        }
    }
}