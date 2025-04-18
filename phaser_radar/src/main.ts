import Phaser, { Math as PM } from "phaser"
import { Radar } from "./radar/radar"
import { Target } from "./radar/target"

class Broomster extends Phaser.Scene
{
  private window = {
    height: window.innerHeight,
    width: window.innerWidth
  }
  private canvas: HTMLCanvasElement | null = null
  private targets: Target[] = []
  private radar: Radar | null = null
  private radarSettings = {
    range: 450,
    pulseDir: new PM.Vector2(0, -1)
  }

  constructor (private cursorKeys?: Phaser.Types.Input.Keyboard.CursorKeys, private ship?: Phaser.Physics.Arcade.Image)
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
    this.cursorKeys = this.input.keyboard?.createCursorKeys()
    this.ship = this.physics.add.image(this.window.width / 2, this.window.height, 'ship')
    this.ship.setVelocity(0, 0)
    this.ship.setBounce(.5, .5)
    this.ship.setCollideWorldBounds(true)
    console.log(`Ship rotation: ${this.ship?.rotation}`)
    this.add.image(60, 80, 'rwr')
    this.add.text(75 , 135, 'RWR', { font: '18px Courier', color: '#00ff00' })

    // create targets and asteroids and push them to radar
    this.targets.push(new Target(500, 600, new PM.Vector2(1, 0), 1, 1))
    this.targets.push(new Target(500, 700, new PM.Vector2(1, 0), 2, 10))

    this.radar = new Radar(this, this.time, [...this.targets])
    this.radar.setPosition(new PM.Vector2(0, 0))
    this.radar.setDirection(new PM.Vector2(0, -1))
    this.radar.setRange(this.radarSettings?.range || 0)
    this.radar.setSensitivity(5)
    this.radar.search()
   
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
    // make ship position radar position
    if (this.ship) {
      this.radar?.setPosition(this.ship.getWorldPoint())
    }
    // show targets for development
    // this.targets.forEach(target => {
    //   const circle = this.add.circle(target.x, target.y, target.size, 0xffffff)
    //   this.time.delayedCall(500, () => {
    //     circle.destroy()
    //   })
    // })
    // move targets
    if (this.time.now % 500 < 16.67) {
      this.targets.forEach(target => {
        target.x += target.direction.x * target.speed
        target.y += target.direction.y * target.speed
        if (target.x <= 0 || target.x >= Number(this?.canvas?.width)) {
          target.direction.x *= -1
        }
        if (target.y <= 0 || target.y >= Number(this.sys.game.config.height)) {
          target.direction.y *= -1
        }
      })
    }
  }
}

const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    scene: Broomster,
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { x: 0, y: 0 }
        }
    },
}

new Phaser.Game(config)