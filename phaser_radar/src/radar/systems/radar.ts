import { RadarSettings, Vector2 } from '../../types/index'
import { Target } from '../entities/target'
import { ReturnSignal } from '../../types/index'
import { fitTrack } from '../../math/index'

export class Radar {

    constructor(
        private scene: Phaser.Scene,
        private clock: Phaser.Time.Clock, 
        private radarOptions: RadarSettings,
        private targets: Target[],
        private radarBeam: Phaser.Geom.Line,
        private step: number = 0,
        private memory: (ReturnSignal | null)[] = [],
        private tracks: (Vector2)[] = [],
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
        const origin = this.radarOptions.pos!;          // we already validated it exists
        let closest: ReturnSignal | null = null;
        let closestDist2 = Infinity;                    // squared distance – no sqrt in loop
      
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
                };
              }
            }
          }
        }
        return closest;   // null if nothing was intersected
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
            //! handle if step = 0 || 1
            //! must be azimuth
            if (this.memory[this.step - 1] !== null) {
                const recentMemory = [];
                for (let i = this.step - 1; i >= 0; i--) {
                    if (this.memory[i] !== null) {
                        recentMemory.push(this.memory[i]);
                    } else {
                        this.saveTrack(recentMemory);
                        break;
                    }
                }
            }
        }
    }

    saveTrack(recentSignals: (ReturnSignal | null)[]) {
        const clean = recentSignals.filter(Boolean) as ReturnSignal[];
        const track = fitTrack(clean);
        if (!track) return;
      
        const marker = this.scene.add.image(track.pos.x, track.pos.y, 'track');
        marker.setOrigin(0.5);
        this.scene.tweens.add({
          targets: marker,
          alpha: 0,
          duration: 10000,
          onComplete: () => marker.destroy()
        });
      
        // (Optional) keep a data structure of active tracks
        this.tracks.push(track.pos);                   // or store full Track object
    
        console.log(this.tracks)
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

        if (this.radarOptions.azimuth === this.step) {
            this.step = 0
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