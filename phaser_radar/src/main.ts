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
  private sttBtn?: Phaser.GameObjects.Text
  private rwsBtn?: Phaser.GameObjects.Text
  private twsBtn?: Phaser.GameObjects.Text
  private emconBtn?: Phaser.GameObjects.Text
  private SARHBtn?: Phaser.GameObjects.Text
  
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
      position: radarSettings?.position,
      isScanning: radarSettings?.isScanning,
      azimuth: radarSettings?.azimuth,
    }
    // RADAR & DEFAULT SETTINGS
    this.radar = new LightRadar(
        radarOptions,
        'rws',
        {
          'AIM-177': 4
        }
    )
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
    this.sttBtn = this.add.text(20, this.window.height - 50, 'STT', { 
      font: '22px Courier', 
      color: '#000', 
      backgroundColor: '#ffdb4d',
      padding: { x: 10, y: 5 } 
    })
    .setInteractive()
    .setOrigin(0)
    .on('pointerdown', () => {
      if (this.radar?.getTracks().length === 0) return
      this.radar?.setMode('stt')
    });
    this.rwsBtn = this.add.text(100, this.window.height - 50, 'RWS', { 
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
    // this.twsBtn = this.add.text(200, this.window.height - 50, 'TWS', { 
    //   font: '22px Courier', 
    //   color: '#000', 
    //   backgroundColor: this.radar?.getMode() === 'tws' ? '#00ff00' : '#ffdb4d', 
    //   padding: { x: 10, y: 5 }
    // })
    // .setInteractive()
    // .setOrigin(0)
    // .on('pointerdown', () => {
    //   this.radar?.setMode('tws')
    // });
    // this. emconBtn = this.add.text(300, this.window.height - 50, 'EMCON', {
    //   font: '22px Courier',
    //   color: '#000',
    //   backgroundColor: this.radar?.getMode() === 'emcon' ? '#00ff00' : '#ffdb4d',
    //   padding: { x: 10, y: 5 }
    // })
    // .setInteractive()
    // .setOrigin(0)
    // .on('pointerdown', () => {
    //   this.radar?.setMode('emcon')
    // });
    this.SARHBtn = this.add.text(400, this.window.height - 50, 'SARH', {
      font: '22px Courier',
      color: '#000',
      backgroundColor: '#ffdb4d',
      padding: { x: 10, y: 5 }
    })
    .setInteractive()
    .setOrigin(0)
    .on('pointerdown', () => {
      this.radar?.shootSARH()
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
    this.radar.addAsteroid({
      position: { x: 500, y: 500 },
      direction: { x: 1, y: -1 },
      speed: 1,
      size: 20
    })
    this.radar.start()
  }

  // update time , delta
  update(_: number, delta: number)
  {
    this.graphics?.clear();
    this.ship?.setAngularVelocity(this.turn * 50);
    this.radar?.setPosition(this.ship?.getWorldPoint() || { x: 0, y: 0 });
    // move targets & asteroids
    this.radar?.getTargets().forEach(target => {
      target.position.x! += target.direction.x! * target.speed * delta / 1000;
      target.position.y! += target.direction.y! * target.speed * delta / 1000;
      if (target.position.x! <= 0 || target.position.x! >= Number(this?.canvas?.width)) {
        target.direction.x! *= -1;
      }
      if (target.position.y! <= 0 || target.position.y! >= Number(this.sys.game.config.height)) {
        target.direction.y! *= -1;
      }
      // if (this.graphics) {
      //   this.graphics.fillStyle(0xff0000);
      //   this.graphics.fillCircle(target.position.x!, target.position.y!, target.size!);
      // }
    })
    this.radar?.getAsteroids().forEach(asteroid => {
      asteroid.position.x! += asteroid.direction.x! * asteroid.speed * delta / 1000;
      asteroid.position.y! += asteroid.direction.y! * asteroid.speed * delta / 1000;
      if (asteroid.position.x! <= 0 || asteroid.position.x! >= Number(this?.canvas?.width)) {
        asteroid.direction.x! *= -1;
      }
      if (asteroid.position.y! <= 0 || asteroid.position.y! >= Number(this.sys.game.config.height)) {
        asteroid.direction.y! *= -1;
      }
      // if (this.graphics) {
      //   this.graphics.fillStyle(0x888888);
      //   this.graphics.fillCircle(asteroid.position.x!, asteroid.position.y!, asteroid.size!);
      // }
    })
    // radar scan
    this.radar?.update(delta, this.ship?.angle || 0, this.graphics!);

    this.updateButtonColors();
  }

  private updateButtonColors() {
    const mode = this.radar?.getMode();
    const defaultColor = '#ffdb4d';
    const buttonConfigs = [
      { btn: this.sttBtn, mode: 'stt', active: '#ff0000' },
      { btn: this.rwsBtn, mode: 'rws', active: '#00ff00' },
      { btn: this.twsBtn, mode: 'tws', active: '#00ff00' },
      { btn: this.emconBtn, mode: 'emcon', active: '#00ff00' },
      { btn: this.SARHBtn, mode: 'stt', active: '#ffdb4d', onlyActive: true }, // SARH only active in STT
    ];

    buttonConfigs.forEach(cfg => {
      if (!cfg.btn) return;
      if (cfg.onlyActive) {
        cfg.btn.setBackgroundColor(mode === cfg.mode ? cfg.active : defaultColor);
      } else {
        cfg.btn.setBackgroundColor(mode === cfg.mode ? cfg.active : defaultColor);
      }
    });
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