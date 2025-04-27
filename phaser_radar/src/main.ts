import Phaser from "phaser"
import { Radar } from "./radar/systems/radar"
import { radarSettings } from "./constants/index"

class Game extends Phaser.Scene
{
  private window = {
    height: window.innerHeight,
    width: window.innerWidth
  }
  
  constructor (private canvas?: HTMLCanvasElement, private cursorKeys?: Phaser.Types.Input.Keyboard.CursorKeys,  private ship?: Phaser.Physics.Arcade.Image, private radar?: Radar)
  {
    super()
  }
  
  preload ()
  {
    this.canvas = this.sys.game.canvas
    this.load.image('ship', 'ship.png')
    this.load.image('rwr', 'screen.png')
    this.load.image('radar', 'screen.png')
    this.load.image('track', 'track.png')
    this.load.image('target', 'target.png')
    this.load.image('missile', 'missile.png')
  }

  create ()
  {
    // KEYS
    this.cursorKeys = this.input.keyboard?.createCursorKeys()
    // SHIP
    this.ship = this.physics.add.image(this.window.width / 2, this.window.height, 'ship')
    this.ship.setVelocity(0, 0)
    this.ship.setBounce(.5, .5)
    this.ship.setCollideWorldBounds(true)
    console.log('position of ship',this.ship.getWorldPoint())
    // RADAR
    const radarOptions = {
      range: radarSettings?.range,
      sensitivity: radarSettings?.sensitivity,
      pulseDir: radarSettings?.pulseDir,
      pos: radarSettings?.pos,
      isScanning: radarSettings?.isScanning,
      aperture: radarSettings?.aperture,
    }
    this.radar = new Radar(this, this.time, radarOptions, [], new Phaser.Geom.Line())
        // make ship position radar position
    if (this.ship) {
      const worldPoint = this.ship.getWorldPoint()
      this.radar?.setPosition({ x: worldPoint.x, y: worldPoint.y - 50 })
    }
    // RWR
    this.add.image(60, 80, 'rwr')
    this.add.text(75 , 135, 'RWR', { font: '18px Courier', color: '#00ff00' })

    // create targets and asteroids and push them to radar
    this.radar.addTarget({ 
      position: { x: 300, y: 300 }, 
      direction: { x: 1, y: 0}, 
      speed: 2, 
      size: 10 
    })
    // this.radar.addTarget({ 
    //   position: {x: 400, y: 300 }, 
    //   direction: {x: -1, y: 0}, 
    //   speed: 2, 
    //   size: 10 
    // })
    this.radar.start()
  }

  update ()
  {
    if (this.cursorKeys?.left.isDown) {
      this.ship?.setAngularVelocity(-50)
    }
    if (this.cursorKeys?.left.isUp) {
      this.ship?.setAngularVelocity(0)
    }
    if (this.cursorKeys?.right.isDown) {
      this.ship?.setAngularVelocity(50)
    }
    if (this.cursorKeys?.right.isUp) {
      this.ship?.setAngularVelocity(0)
    }
    if (this.cursorKeys?.up.isUp && this.cursorKeys?.down.isUp) {
      this.ship?.setVelocity(0)
    }
    if (this.cursorKeys?.up.isDown) {
      this.ship?.setVelocity(-3)
    }
    if (this.cursorKeys?.down.isDown) {
      this.ship?.setVelocity(3)
    }
    if (this.cursorKeys?.space.isDown) {
      if (this.physics.world.isPaused) {
        this.physics.world.resume()
        this.scene.resume()
      } else {
        this.physics.world.pause()
        this.scene.pause()
      }
    }
    
    // move targets
    const delta = this.game.loop.delta / 1000
    this.radar?.getTargets().forEach(target => {
      target.position.x! += target.direction.x! * target.speed * delta;
      target.position.y! += target.direction.y! * target.speed * delta;
      if (target.position.x! <= 0 || target.position.x! >= Number(this?.canvas?.width)) {
        target.direction.x! *= -1;
      }
      if (target.position.y! <= 0 || target.position.y! >= Number(this.sys.game.config.height)) {
        target.direction.y! *= -1;
      }
    });
    // radar scan
    this.radar?.update()

    // console log radar.getMemory() every second
    
  }
}

const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    scene: Game,
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { x: 0, y: 0 }
        }
    },
}

new Phaser.Game(config)