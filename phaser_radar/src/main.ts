import Phaser from "phaser"
import { LightRadar } from "./radar/systems/lightRadar"
import { LightRadarRenderer } from "./radar/renderer/lightRadarRenderer"
import { Vector2 } from "./types"
import { Target } from "./radar/entities/ship"
import { Asteroid } from "./radar/entities/asteroid"
import { AiUnitController } from "./controller/aiUnitController"

class Game extends Phaser.Scene
{
  private window = {
    height: window.innerHeight,
    width: window.innerWidth
  }
  private canvas?: HTMLCanvasElement
  private graphics?: Phaser.GameObjects.Graphics
  private missile?: Phaser.GameObjects.Image
  private ship?: Phaser.Physics.Arcade.Image
  private sttBtn?: Phaser.GameObjects.Text
  private rwsBtn?: Phaser.GameObjects.Text
  private twsBtn?: Phaser.GameObjects.Text
  private emconBtn?: Phaser.GameObjects.Text
  private ShootBtn?: Phaser.GameObjects.Text
  private radar?: LightRadar
  private turn = 0
  private aiUpdateTimer?: Phaser.Time.TimerEvent
  private enemies: Target[] = []
  private asteroids: Asteroid[] = []
  private SHIP_SPEED = 0.1
  private SHIP_RATATION_SPEED = 8
  private RADAR_RANGE= 400
  private SCAN_SPEED = .04

  constructor()
  {
    super()
  }
  
  preload()
  {
    this.canvas = this.sys.game.canvas
    this.load.image('ship', 'ship.png')
    this.load.image('rwr', 'screen.png')
    this.load.image('radar', 'screen.png')
    this.load.image('missile', 'missile.png')
    this.load.image('explosion', 'explosion.png')

    // this.load.setBaseURL('https://cdn.phaserfiles.com/v385');
    // this.load.atlas('flares', 'assets/particles/flares.png', 'assets/particles/flares.json');
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
    this.input.keyboard?.on('keydown-D', () => {
      if (this.radar) {
        this.radar.setLoadout()
      }
    });
    // SHIP
    this.ship = this.physics.add.image(this.window.width / 2, this.window.height, 'ship')
    this.ship.setVelocity(0, 0)
    this.ship.setAngle(0)
    this.ship.setBounce(.5, .5)
    this.ship.setCollideWorldBounds(true)
    this.ship.scale = 0.7

    // const wisp = this.add.particles(400, 550, 'flares',
    // {
    //     frame: 'white',
    //     color: [ 0x96e0da, 0x937ef3 ],
    //     colorEase: 'quart.out',
    //     lifespan: 1500,
    //     angle: { min: -100, max: -80 },
    //     scale: { start: 1, end: 0, ease: 'sine.in' },
    //     speed: { min: 250, max: 350 },
    //     advance: 2000,
    //     blendMode: 'ADD'
    // });

    // MISSILE
    this.missile = this.add.image(0, 0, 'missile').setVisible(false)
    // RADAR
    const radarOptions = {
      range: this.RADAR_RANGE,
      position: { x: 0, y: 0 } as Vector2,
      isScanning: true,
      azimuth: 20,
      scanSpeed: this.SCAN_SPEED,
    }
    // RADAR & DEFAULT SETTINGS
    this.radar = new LightRadar(
        radarOptions,
        new LightRadarRenderer(this.missile!, this),
        'rws',
        {
          'AIM-177': {
            load: 4,
            active: true
          },
          'AIM-220': {
            load: 2,
            active: false
          },
        },
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
    this. emconBtn = this.add.text(300, this.window.height - 50, 'EMCON', {
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
    this.ShootBtn = this.add.text(400, this.window.height - 50, 'SHOOT', {
      font: '22px Courier',
      color: '#000',
      backgroundColor: '#ffdb4d',
      padding: { x: 10, y: 5 }
    })
    .setInteractive()
    .setOrigin(0)
    .on('pointerdown', () => {
      this.radar?.shoot((this.ship?.angle || 0) - 90)
    });

    // create targets and asteroids and push them to radar
    const enemy1 = {
      id: 1,
      position: { x: 300, y: 300 },
      direction: { x: 1, y: 0},
      speed: 2,
      size: 10,
      isSttTracked: false,
      isRadarTracked: false,
      controller: new AiUnitController()
    }
    enemy1.controller.setPosition(enemy1.position)
    enemy1.controller.setDirection(enemy1.direction)
    const enemy2 = {
      id: 2,
      position: {x: 400, y: 400 },
      direction: {x: -1, y: 1},
      speed: 2,
      size: 15,
      isSttTracked: false,
      isRadarTracked: false,
      controller: new AiUnitController()
    }
    enemy2.controller.setPosition(enemy2.position)
    enemy2.controller.setDirection(enemy2.direction)
    this.enemies.push(enemy1)
    this.enemies.push(enemy2)
    this.asteroids.push({
      position: { x: 200, y: 300 },
      direction: { x: 1, y: -1 },
      speed: .9,
      size: 20
    })

    this.radar.start()
  }

  // update time , delta
  update(_: number, delta: number)
  {
    this.graphics?.clear();
    this.ship?.setAngularVelocity(this.turn * this.SHIP_RATATION_SPEED);
    // Move ship in the direction it's facing
    if (this.ship) {
      const angleRad = Phaser.Math.DegToRad(this.ship.angle - 90);
      const velocityX = Math.cos(angleRad) * this.SHIP_SPEED;
      const velocityY = Math.sin(angleRad) * this.SHIP_SPEED;
      this.ship.setVelocity(velocityX, velocityY);
    }
    this.radar?.setPosition(this.ship?.getWorldPoint() || { x: 0, y: 0 });
    // move targets & asteroids
    this.moveEnemiesAndAsteroids(delta)

    // radar scan
    this.radar?.update(delta, this.ship?.angle || 0, this.enemies, this.graphics!);

    // update enemies
    const destroyedEnemyId = this.radar?.updateEnemiesInMain();
    if (destroyedEnemyId !== undefined) {
      // Find and remove the target with the specified id
      this.enemies = this.enemies.filter(enemy => enemy.id !== destroyedEnemyId);
    }
    const trackedEnemyId = this.radar?.alertTargetBeingTracked();
    if (trackedEnemyId !== null) {
      this.enemies.forEach(enemy => {
        if (enemy.id === trackedEnemyId) {
          enemy.controller.setSttTracked(true);
        } else {
          enemy.controller.setSttTracked(false);
        }
      })
    }
    const rwrAlertIds = this.radar?.alertRwr()
    if (rwrAlertIds !== null && rwrAlertIds !== undefined && rwrAlertIds.length > 0) {
      this.enemies.forEach(enemy => {
        if (rwrAlertIds?.includes(enemy.id)) {
          enemy.controller.setRadarTracked(true);
        } else {
          enemy.controller.setRadarTracked(false);
        }
      })
    }

    // Update enemy AI controllers once per second
    if (!this.aiUpdateTimer) {
      this.aiUpdateTimer = this.time.addEvent({
      delay: 1000,
      callback: () => {
        this.enemies.forEach(enemy => {
        enemy.controller.update();
        });
      },
      loop: true
      });
    }

    this.updateButtonColors();
  }

  private moveEnemiesAndAsteroids(delta: number) {
    this.enemies.forEach(enemy => {
      //! use the controller to getPosition() and setPosition()
      enemy.position.x! += enemy.direction.x! * enemy.speed * delta / 1000;
      enemy.position.y! += enemy.direction.y! * enemy.speed * delta / 1000;
      if (enemy.position.x! <= 0 || enemy.position.x! >= Number(this?.canvas?.width)) {
        enemy.direction.x! *= -1;
      }
      if (enemy.position.y! <= 0 || enemy.position.y! >= Number(this.sys.game.config.height)) {
        enemy.direction.y! *= -1;
      }
      if (this.graphics) {
        this.graphics.fillStyle(0xff0000);
        this.graphics.fillCircle(enemy.position.x!, enemy.position.y!, enemy.size!/10);
      }
    })
    this.asteroids.forEach(asteroid => {
      asteroid.position.x! += asteroid.direction.x! * asteroid.speed * delta / 1000;
      asteroid.position.y! += asteroid.direction.y! * asteroid.speed * delta / 1000;
      if (asteroid.position.x! <= 0 || asteroid.position.x! >= Number(this?.canvas?.width)) {
        asteroid.direction.x! *= -1;
      }
      if (asteroid.position.y! <= 0 || asteroid.position.y! >= Number(this.sys.game.config.height)) {
        asteroid.direction.y! *= -1;
      }
      if (this.graphics) {
        this.graphics.fillStyle(0x888888);
        this.graphics.fillCircle(asteroid.position.x!, asteroid.position.y!, asteroid.size!);
      }
      // Check for collision between the ship and this asteroid
      if (this.ship && Phaser.Geom.Intersects.CircleToRectangle(
        new Phaser.Geom.Circle(asteroid.position.x!, asteroid.position.y!, asteroid.size!),
        new Phaser.Geom.Rectangle(this.ship.x - this.ship.displayWidth/2, this.ship.y - this.ship.displayHeight/2,
        this.ship.displayWidth * .7, this.ship.displayHeight * .7)
      )) {
        // Destroy the ship
        this.ship.setVisible(false);
        this.ship.setActive(false);
        this.ship.disableBody(true, true);
        // When ship is destroyed, also stop the radar
        this.radar?.stop()
        
        // Optional: display explosion effect or game over text
        this.add.text(this.window.width/2, this.window.height/2, 'SHIP DESTROYED', {
          font: '32px Courier',
          color: '#ff0000'
        }).setOrigin(0.5);
      }
    })
  }

  private updateButtonColors() {
    const mode = this.radar?.getMode();
    const defaultColor = '#ffdb4d';
    const buttonConfigs = [
      { btn: this.sttBtn, mode: 'stt', active: '#ff0000' },
      { btn: this.rwsBtn, mode: 'rws', active: '#00ff00' },
      { btn: this.twsBtn, mode: 'tws', active: '#00ff00' },
      { btn: this.emconBtn, mode: 'emcon', active: '#00ff00' },
      { btn: this.ShootBtn, mode: 'stt', active: '#ffdb4d', onlyActive: true },
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