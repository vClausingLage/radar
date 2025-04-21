import { Radar } from '../radar/systems/radar'

export class RadarScanController {
    constructor(private scene: Phaser.Scene, private radar?: Radar) {
      this.scene = scene
      this.radar = radar
    }
    private beam = new Phaser.Geom.Line();
    update(dt: number) {  } // advance angle by scanSpeed*dt, call radar.rotateAndDetect
  }