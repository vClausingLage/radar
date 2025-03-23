import Phaser, { Math as PM } from "phaser"
import { Asteroid, Radar, Target } from "./radar"

class Broomster extends Phaser.Scene
{
  private canvas: HTMLCanvasElement | null = null
  private targets: Target[] = []
  private asteroids: Asteroid[] = []
  private radar: Radar | null = null

  constructor ()
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
  }

  create ()
  {
    const ship = this.physics.add.image(500, 500, 'ship')
    ship.setVelocity(0, 0)
    ship.setBounce(1, 1)
    ship.setCollideWorldBounds(true)
    this.add.image(50, 450, 'rwr')
    this.add.text(3, 380, 'RWR', { font: '16px Courier', color: '#00ff00' })
    this.add.image(950, 450, 'radar')
    this.add.text(903, 380, 'RADAR', { font: '16px Courier', color: '#00ff00' })

    // create targets and aasteroids and push them to radar
    this.targets.push(new Target(0, new PM.Vector2(100, 100), new PM.Vector2(1, 0), 1))
    this.targets.push(new Target(1, new PM.Vector2(200, 200), new PM.Vector2(1, 0), 2))
    this.asteroids.push(new Asteroid(0, new PM.Vector2(300, 300), new PM.Vector2(1, 0), 1, 10))
    this.asteroids.push(new Asteroid(1, new PM.Vector2(400, 400), new PM.Vector2(1, 0), 2, 20))

    this.radar = new Radar(this, this.time, this.targets, 450, new PM.Vector2(500, 500))
    this.radar.setDirection(new PM.Vector2(1, 0))
    this.radar.search()
  }

  update ()
  {
    // show targets for development
    this.targets.forEach(target => {
      const circle = this.add.circle(target.position.x, target.position.y, 2, 0xffffff)
      this.time.delayedCall(1500, () => {
        circle.destroy()
      })
    })
    // show asteroids for development
    this.asteroids.forEach(asteroid => {
      const circle = this.add.circle(asteroid.position.x, asteroid.position.y, 2, 0xff0000)
      this.time.delayedCall(1500, () => {
        circle.destroy()
      }
    )})
    // move targets
    if (this.time.now % 500 < 16.67) {
      this.targets.forEach(target => {
        target.position.add(target.direction.clone().scale(target.speed))
        if (target.position.x <= 0 || target.position.x >= Number(this?.canvas?.width || 1000)) {
          target.direction.x *= -1
        }
        if (target.position.y <= 0 || target.position.y >= Number(this.sys.game.config.height)) {
          target.direction.y *= -1
        }
      })
    }
    // move asteroids
    if (this.time.now % 500 < 16.67) {
      this.asteroids.forEach(asteroid => {
        asteroid.position.add(asteroid.direction.clone().scale(asteroid.speed))
      })
    }
  }
}

const config = {
    type: Phaser.AUTO,
    width: 1000,
    height: 500,
    scene: Broomster,
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { x: 0, y: 0 }
        }
    },
}

new Phaser.Game(config)