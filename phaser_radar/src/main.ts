import Phaser from "phaser"
import { LightRadar } from "./radar/systems/lightRadar"
import { radarSettings } from "./constants/index"

class Game extends Phaser.Scene
{
  private window = {
    height: window.innerHeight,
    width: window.innerWidth
  }
  private turn = 0
  private graphics?: Phaser.GameObjects.Graphics
  
  constructor (private canvas?: HTMLCanvasElement, private ship?: Phaser.Physics.Arcade.Image, private radar?: LightRadar)
  {
    super()
  }
  
  preload()
  {
    this.canvas = this.sys.game.canvas
    this.load.image('ship', 'ship.png')
    this.load.image('rwr', 'screen.png')
    this.load.image('radar', 'screen.png')
    this.load.image('track', 'track.png')
    this.load.image('target', 'target.png')
    this.load.image('missile', 'missile.png')
  }

  create()
  {
    // GRAPHICS
    this.graphics = this.add.graphics();
    // KEYS
    this.input.keyboard?.on('keydown-LEFT', () => this.turn = -1);
    this.input.keyboard?.on('keyup-LEFT',   () => this.turn = 0);
    this.input.keyboard?.on('keydown-RIGHT', () => this.turn = 1);
    this.input.keyboard?.on('keyup-RIGHT',   () => this.turn = 0);
    this.input.keyboard?.on('keydown-UP', () => {
      this.ship?.setVelocityY(-3)
      this.ship?.setVelocityX(0)
    });
    this.input.keyboard?.on('keyup-UP', () => {
      this.ship?.setVelocityY(0)
      this.ship?.setVelocityX(0)
    });
    this.input.keyboard?.on('keydown-DOWN', () => {
      this.ship?.setVelocityY(3)
      this.ship?.setVelocityX(0)
    });
    this.input.keyboard?.on('keyup-DOWN', () => {
      this.ship?.setVelocityY(0)
      this.ship?.setVelocityX(0)
    });
    // SHIP
    this.ship = this.physics.add.image(this.window.width / 2, this.window.height, 'ship')
    this.ship.setVelocity(0, 0)
    this.ship.setAngle(0)
    this.ship.setBounce(.5, .5)
    this.ship.setCollideWorldBounds(true)
    // RADAR
    const radarOptions = {
      range: radarSettings?.range,
      sensitivity: radarSettings?.sensitivity,
      pulseDir: radarSettings?.pulseDir,
      position: radarSettings?.position,
      isScanning: radarSettings?.isScanning,
      azimuth: radarSettings?.azimuth,
      radarAzimuthStartAngle: radarSettings?.radarAzimuthStartAngle,
    }
    // RADAR & DEFAULT SETTINGS
    this.radar = new LightRadar(radarOptions)
    this.radar?.setMode('rws')
    // make ship position radar position
    if (this.ship) {
      const shipPosition = this.ship.getWorldPoint()
      this.radar?.setPosition({ x: shipPosition.x, y: shipPosition.y - 50 })
    }
    // RWR
    this.add.image(60, 80, 'rwr')
    this.add.text(75 , 135, 'RWR', { font: '18px Courier', color: '#00ff00' })

    // INTERFACE
    this.add.text(20, this.window.height - 50, 'STT', { 
      font: '22px Courier', 
      color: '#000', 
      backgroundColor: this.radar?.getMode() === 'stt' ? '#00ff00' : '#ffdb4d',
      padding: { x: 10, y: 5 } 
    })
    .setInteractive()
    .setOrigin(0)
    .on('pointerdown', () => {
      if (this.radar?.getTracks().length === 0) return
      this.radar?.setMode('stt')
    });
    this.add.text(100, this.window.height - 50, 'RWS', { 
      font: '22px Courier', 
      color: '#000', 
      backgroundColor: this.radar?.getMode() === 'rws' ? '#00ff00' : '#ffdb4d',
      padding: { x: 10, y: 5 } 
    })
    .setInteractive()
    .setOrigin(0)
    .on('pointerdown', () => {
      this.radar?.setTracks([])
      this.radar?.setMode('rws')
    });
    this.add.text(200, this.window.height - 50, 'TWS', { 
      font: '22px Courier', 
      color: '#000', 
      backgroundColor: this.radar?.getMode() === 'tws' ? '#00ff00' : '#ffdb4d', 
      padding: { x: 10, y: 5 }
    })
    .setInteractive()
    .setOrigin(0)
    .on('pointerdown', () => {
      this.radar?.setMode('tws')
    });
    this.add.text(300, this.window.height - 50, 'EMCON', {
      font: '22px Courier',
      color: '#000',
      backgroundColor: this.radar?.getMode() === 'emcon' ? '#00ff00' : '#ffdb4d',
      padding: { x: 10, y: 5 }
    })
    .setInteractive()
    .setOrigin(0)
    .on('pointerdown', () => {
      this.radar?.setMode('emcon')
    });

    // create targets and asteroids and push them to radar
    this.radar.addTarget({ 
      position: { x: 300, y: 300 },
      direction: { x: 1, y: 0},
      speed: 2,
      size: 10
    })
    this.radar.addTarget({ 
      position: {x: 400, y: 400 },
      direction: {x: -1, y: 1},
      speed: 2,
      size: 15
    })
    this.radar.start()
  }

  // update time , delta
  update(_: number, delta: number)
  {
    this.ship?.setAngularVelocity(this.turn * 50);
    
    // move targets
    this.radar?.getTargets().forEach(target => {
      target.position.x! += target.direction.x! * target.speed * delta / 1000;
      target.position.y! += target.direction.y! * target.speed * delta / 1000;
      if (target.position.x! <= 0 || target.position.x! >= Number(this?.canvas?.width)) {
        target.direction.x! *= -1;
      }
      if (target.position.y! <= 0 || target.position.y! >= Number(this.sys.game.config.height)) {
        target.direction.y! *= -1;
      }
      const graphics = this.add.graphics({ fillStyle: { color: 0xffffff } });
      graphics.fillCircle(target.position.x!, target.position.y!, 2);
      this.time.delayedCall(1500, () => graphics.destroy());
    });
    // radar scan
    this.radar?.update(delta, this.ship?.angle || 0, this.graphics) //! Phaser has no angle of 0
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