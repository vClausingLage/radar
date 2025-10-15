import Phaser from "phaser"
import { LightRadar } from "./radar/systems/lightRadar"
import { LightRadarRenderer } from "./radar/renderer/lightRadarRenderer"
import { InterfaceRenderer } from "./radar/renderer/interfaceRenderer"
import { Vector2 } from "./types"
import { Target } from "./radar/entities/ship"
import { Asteroid } from "./radar/entities/asteroid"
import { AiUnitController } from "./controller/aiUnitController"

class Game extends Phaser.Scene
{
  private world = {
    width: 2500,
    height: 2500
  }
  private canvas?: HTMLCanvasElement
  private graphics?: Phaser.GameObjects.Graphics
  private missile?: Phaser.GameObjects.Image
  private ship?: Phaser.Physics.Arcade.Image
  private radar?: LightRadar
  private interfaceRenderer?: InterfaceRenderer
  private turn = 0
  private aiUpdateTimer?: Phaser.Time.TimerEvent
  private enemies: Target[] = []
  private asteroids: Asteroid[] = []
  private SHIP_SPEED = 20
  private SHIP_ROTATION_SPEED = 20 //8
  private RADAR_RANGE= 400
  private SCAN_SPEED = .04

  constructor()
  {
    super()
  }
  
  preload()
  {
    this.canvas = this.sys.game.canvas
    this.load.image('universe', 'universe.png')
    this.load.image('ship', 'ship.png')
    this.load.image('rwr', 'screen.png')
    this.load.image('radar', 'screen.png')
    this.load.image('missile', 'missile.png')
    this.load.image('explosion', 'explosion.png')
  }

  create()
  {
    // WORLD
    this.physics.world.setBounds(0, 0, this.world.width, this.world.height);
    this.add.image(this.world.width, this.world.height, 'universe');
    
    // GRAPHICS
    this.graphics = this.add.graphics();
    // KEYS
    this.input.keyboard?.on('keydown-A', () => this.turn = -1);
    this.input.keyboard?.on('keyup-A',   () => this.turn = 0);
    this.input.keyboard?.on('keydown-D', () => this.turn = 1);
    this.input.keyboard?.on('keyup-D',   () => this.turn = 0);
    this.input.keyboard?.on('keydown-Q', () => {
      if (this.radar) {
        this.radar.setLoadout()
      }
    });
    // SHIP
    this.ship = this.physics.add.image(500, 500, 'ship')
    this.ship.setVelocity(0, 0)
    this.ship.setAngle(0)
    this.ship.setBounce(.5, .5)
    this.ship.setCollideWorldBounds(true)
    this.ship.scale = 0.7

    // CAMERA
    console.log('camera', this.cameras.main);
    // this.cameras.main.originX = this.ship.x;
    // this.cameras.main.originY = this.ship.y;
    this.cameras.main.setLerp(0.1, 0.1);
    // set camera bounds to world bounds
    this.cameras.main.setBounds(0, 0, this.world.width, this.world.height);
    this.cameras.main.startFollow(this.ship);
    
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

    // INTERFACE
    this.interfaceRenderer = new InterfaceRenderer(this);
    this.interfaceRenderer.createInterface(this.radar, this.ship);

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
    this.ship?.setAngularVelocity(this.turn * this.SHIP_ROTATION_SPEED);
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

    // Update interface
    if (this.radar && this.interfaceRenderer) {
      this.interfaceRenderer.updateButtonColors(this.radar);
    }
  }

  private moveEnemiesAndAsteroids(delta: number) {
    this.enemies.forEach(enemy => {
      //! use the controller to getPosition() and setPosition()
      enemy.position.x! += enemy.direction.x! * enemy.speed * delta / 1000;
      enemy.position.y! += enemy.direction.y! * enemy.speed * delta / 1000;
      if (enemy.position.x! <= 0 || enemy.position.x! >= this.world.width) {
        enemy.direction.x! *= -1;
      }
      if (enemy.position.y! <= 0 || enemy.position.y! >= this.world.height) {
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
      if (asteroid.position.x! <= 0 || asteroid.position.x! >= this.world.width) {
        asteroid.direction.x! *= -1;
      }
      if (asteroid.position.y! <= 0 || asteroid.position.y! >= this.world.height) {
        asteroid.direction.y! *= -1;
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
        this.add.text(this.world.width/2, this.world.height/2, 'SHIP DESTROYED', {
          font: '32px Courier',
          color: '#ff0000'
        }).setOrigin(0.5);
      }
    })
  }
}

const config = {
    type: Phaser.AUTO,
    scene: Game,
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { x: 0, y: 0 }
        }
    },
}

new Phaser.Game(config)