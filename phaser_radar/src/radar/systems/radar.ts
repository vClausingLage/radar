import { RadarSettings, Vector2 } from '../../types/index'
import { Target } from '../entities/target'
import { Track } from '../data/track'
import { ReturnSignal } from '../../types/index'

export class Radar {

    constructor(
        private scene: Phaser.Scene,
        private clock: Phaser.Time.Clock, 
        private radarOptions: RadarSettings,
        private targets: Target[],
        private radarBeam: Phaser.Geom.Line,
        private step: number = 0,
        private memory: (ReturnSignal | null)[] = [],
        private tracks: Track[] = [],
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

    getSearchazimuth() {
        return this.radarOptions.azimuth
    }

    getMemory() {
        return this.memory
    }

    findTargetByCircle(d: Phaser.Geom.Line): ReturnSignal | null {
        const origin = this.radarOptions.pos;
        let closest: ReturnSignal | null = null;
        let closestDist2 = Infinity;
      
        for (const t of this.targets) {
          const circle = new Phaser.Geom.Circle(t.position.x, t.position.y, t.size);
      
          // This gives you **up to two** intersection points
          const hits = Phaser.Geom.Intersects.GetLineToCircle(d, circle);
      
          if (hits) {
            for (const hit of hits) {
              const dist2 = Phaser.Math.Distance.Squared(origin.x, origin.y, hit.x, hit.y);
      
              if (dist2 < closestDist2) {
                closestDist2 = dist2;
                closest = {
                  point: hit,
                  time: this.clock.now,
                  step: this.step,
                  direction: t.direction,
                  speed: t.speed,
                  distance: dist2,
                };
              }
            }
          }
        }

        // if (closest) {
        //     const marker = this.scene.add.circle(closest.point.x, closest.point.y, 2, 0xff0000);
        //     marker.setOrigin(0.5);
        //     this.scene.tweens.add({
        //         targets: marker,
        //         alpha: 0,
        //         duration: 3500,
        //         onComplete: () => marker.destroy()
        //     });
        // }

        return closest;
      }
      

    transceive(d: Phaser.Geom.Line): ReturnSignal | null {
        return this.findTargetByCircle(d)
    }

    processReturnSignal(rs: ReturnSignal | null) {
        // collect returns and remove old ones
        if (rs) {
            this.memory[this.step] = rs
        }
        if (!rs) {
            this.memory[this.step] = null
        }
    }

    generateTracks() {

        // loop all return signals and cluster them

        let buffer = []

        let tracksBuffer: Track[] = []

        for (let i = 0; i < this.memory.length; i++) {
            const rs = this.memory[i]
            const rsMinusOne = this.memory[i - 1]
            if (!rs && !rsMinusOne) continue
            const distanceToLastIndex = Phaser.Math.Distance.Squared(rs?.point?.x!, rs?.point.y!, rsMinusOne?.point.x!, rsMinusOne?.point.y!)
            
            if (!rsMinusOne && rs) {
                buffer.push(rs)
            }
            if (rs && rsMinusOne) {
                if (distanceToLastIndex < this.radarOptions.sensitivity) {
                    buffer.push(rs)
                } else {
                    const b = buffer.reduce((acc, curr) => {
                        acc.x += curr.point.x
                        acc.y += curr.point.y
                        return acc
                    }, {x: 0, y: 0})
                    tracksBuffer.push({ 
                        pos: { x: b.x / buffer.length, y: b.y / buffer.length}, 
                        dist: rs.distance , 
                        dir: rs.direction, 
                        speed: rs.speed
                    })
                    buffer = []
                }
            }
            if (!rs && rsMinusOne) {
                const b = buffer.reduce((acc, curr) => {
                    acc.x += curr.point.x
                    acc.y += curr.point.y
                    return acc
                }, {x: 0, y: 0})
                tracksBuffer.push({ 
                    pos: { x: b.x / buffer.length, y: b.y / buffer.length}, 
                    dist: rsMinusOne.distance, 
                    dir: rsMinusOne.direction,
                    speed: rsMinusOne.speed
                })
                buffer = []
            }
        }

        // calculate tracks

        this.tracks = tracksBuffer

        this.tracks.sort((a, b) => {
            if (a.dist < b.dist) {
                return -1
            }
            if (a.dist > b.dist) {
                return 1
            }
            return 0
        })

        for (const tb of this.tracks) {
            const marker = this.scene.add.circle(tb.pos.x, tb.pos.y, 3, 0x00ff00);
            const indexText = this.scene.add.text(tb.pos.x, tb.pos.y + 15, `${this.tracks.indexOf(tb) === 0 ? '*' : this.tracks.indexOf(tb) + 1}`, {
                fontSize: '15px',
                color: '#00ff00',
            });
            indexText.setOrigin(0.5);
            marker.setOrigin(0.5);
            this.scene.tweens.add({
            targets: [marker, indexText],
            alpha: 0,
            duration: 1500,
            onComplete: () => marker.destroy()
            });
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
    }

    stop() {
        this.radarOptions.isScanning = false
    }

    render() {}

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

        if (this.step === this.radarOptions.azimuth / 2) {
            this.generateTracks()
        }

        if (this.radarOptions.azimuth === this.step) {
            this.step = 0
            this.generateTracks()
        }

        if (this.radarOptions.azimuth) {
            this.step++
            const startAngle = Phaser.Math.DegToRad(this.step - this.radarOptions.radarAzimuthStartAngle);
            const startX = this.radarOptions.pos?.x! + Math.cos(startAngle) * this.radarOptions.range!;
            const startY = this.radarOptions.pos?.y! + Math.sin(startAngle) * this.radarOptions.range!;
            this.radarBeam.setTo(
                this.radarOptions.pos?.x,
                this.radarOptions.pos?.y,
                startX,
                startY
            )
            const rs = this.transceive(this.radarBeam)
            this.processReturnSignal(rs)
        }        
    }
}