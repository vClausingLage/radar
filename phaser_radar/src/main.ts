import Phaser from "phaser"
import { LightRadar } from "./radar/systems/lightRadar"
import { LightRadarRenderer } from "./radar/renderer/lightRadarRenderer"
import { InterfaceRenderer } from "./radar/renderer/interfaceRenderer"
import { PlayerShip, Target } from "./radar/entities/ship"
import { Asteroid } from "./radar/entities/asteroid"
import { AiUnitController } from "./controller/aiUnitController"
import { shipSettings, radarDefaultSettings } from "./settings"

class Game extends Phaser.Scene
{
  private world = {
    width: 2500,
    height: 2500
  }
  private canvas?: HTMLCanvasElement
  private graphics?: Phaser.GameObjects.Graphics
  private missile?: Phaser.GameObjects.Image
  private player?: PlayerShip
  private interfaceRenderer?: InterfaceRenderer
  private turn = 0
  private aiUpdateTimer?: Phaser.Time.TimerEvent
  private enemies: Target[] = []
  private asteroids: Asteroid[] = []

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
    this.load.image('asteroid', 'asteroid.png')
  }

  create()
  {
    // WORLD
    this.physics.world.setBounds(0, 0, this.world.width, this.world.height);
    // ADD IMAGES
    this.add.image(0, 0, 'universe').setOrigin(0)
    this.missile = this.add.image(0, 0, 'missile').setVisible(false)
    // GRAPHICS
    this.graphics = this.add.graphics();
    // KEYS
    this.input.keyboard?.on('keydown-A', () => this.turn = -1);
    this.input.keyboard?.on('keyup-A',   () => this.turn = 0);
    this.input.keyboard?.on('keydown-D', () => this.turn = 1);
    this.input.keyboard?.on('keyup-D',   () => this.turn = 0);
    this.input.keyboard?.on('keydown-Q', () => {
      if (this.player) {
        this.player.radar.setLoadout()
      }
    });

    // PLAYER SHIP
    this.player = new PlayerShip(
      this,
      shipSettings.START_POSITION.x,
      shipSettings.START_POSITION.y,
      shipSettings.SPEED,
      shipSettings.SIZE,
      shipSettings.START_LOADOUT,
      new LightRadar(
        radarDefaultSettings,
        new LightRadarRenderer(this.missile!, this),
        'rws',
        shipSettings.START_LOADOUT
      )
    )
    // make ship position radar position
    if (this.player) {
      const shipPosition = this.player.getWorldPoint()
      this.player?.radar?.setPosition({ x: shipPosition.x, y: shipPosition.y - 50 })
    }

    // CAMERA
    // set camera bounds to world bounds
    this.cameras.main.setBounds(0, 0, this.world.width, this.world.height);
    this.cameras.main.startFollow(this.player);
    
    // INTERFACE
    this.interfaceRenderer = new InterfaceRenderer(this);
    this.interfaceRenderer.createInterface(this.player?.radar, this.player);

    // TARGETS (ENEMIES) & ASTEROIDS
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
    // this.enemies.push(enemy1)
    // this.enemies.push(enemy2)
    const asteroid1 = new Asteroid(
      this, 
      { x: 300, y: 250 }, 
      90,
      1,
      25)
    this.asteroids.push(asteroid1)

    console.log('asteroids', this.asteroids);
    
    this.player?.radar?.start()
  }

  // update time , delta
  update(_: number, delta: number)
  {
    this.graphics?.clear();
    this.player?.setAngularVelocity(this.turn * shipSettings.ROTATION_SPEED);
    // Move ship in the direction it's facing
    if (this.player) {
      const angleRad = Phaser.Math.DegToRad(this.player.angle - 90);
      const velocityX = Math.cos(angleRad) * shipSettings.SPEED;
      const velocityY = Math.sin(angleRad) * shipSettings.SPEED;
      this.player.setVelocity(velocityX, velocityY);
    }
    this.player?.radar?.setPosition(this.player?.getWorldPoint() || { x: 0, y: 0 });

    // move targets & asteroids
    this.moveEnemiesAndAsteroids(delta)

    // radar scan
    this.radar?.update(delta, this.player?.angle || 0, this.enemies, this.graphics!);

    // update enemies
    const destroyedEnemyId = this.player?.radar?.updateEnemiesInMain();
    if (destroyedEnemyId !== undefined) {
      // Find and remove the target with the specified id
      this.enemies = this.enemies.filter(enemy => enemy.id !== destroyedEnemyId);
    }
    const trackedEnemyId = this.player?.radar?.alertTargetBeingTracked();
    if (trackedEnemyId !== null) {
      this.enemies.forEach(enemy => {
        if (enemy.id === trackedEnemyId) {
          enemy.controller.setSttTracked(true);
        } else {
          enemy.controller.setSttTracked(false);
        }
      })
    }
    const rwrAlertIds = this.player?.radar?.alertRwr()
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
    if (this.player?.radar && this.interfaceRenderer) {
      this.interfaceRenderer.updateButtonColors(this.player.radar);
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
      // Check for collision between the ship and this asteroid
      if (this.player && Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), asteroid.getBounds())) {
        // Destroy the ship
        this.player.setVisible(false);
        this.player.setActive(false);
        this.player.disableBody(true, true);
        // When ship is destroyed, also stop the radar
        this.player?.radar?.stop()
        
        // Clean up asteroids
        this.asteroids.forEach(asteroid => {
          asteroid.destroy();
        });
        
        // Display "SHIP DESTROYED" message
        this.add.text(300, 0, 'SHIP DESTROYED', {
          font: '32px Courier',
          color: '#ff0000'
        }).setOrigin(0, 0);
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