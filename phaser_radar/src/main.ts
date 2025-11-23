import Phaser from "phaser"
import { LightRadar } from "./radar/systems/lightRadar"
import { LightRadarRenderer } from "./radar/renderer/lightRadarRenderer"
import { InterfaceRenderer } from "./radar/renderer/interfaceRenderer"
import { PlayerShip, Target } from "./radar/entities/ship"
import { Asteroid } from "./radar/entities/asteroid"
import { AiUnitController } from "./controller/aiUnitController"
import { shipSettings, radarDefaultSettings, targetSettings } from "./settings"

class Game extends Phaser.Scene
{
  private world = {
    width: 2500,
    height: 2500
  }
  private canvas?: HTMLCanvasElement = this.sys?.game?.canvas ?? undefined
  private graphics?: Phaser.GameObjects.Graphics
  private missile?: Phaser.GameObjects.Image
  private player?: PlayerShip
  private interfaceRenderer?: InterfaceRenderer
  private turn = 0
  private aiUpdateTimer?: Phaser.Time.TimerEvent
  private targets: Target[] = []
  private asteroids: Asteroid[] = []

  constructor()
  {
    super()
    console.info(this.canvas)
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
      shipSettings.DIRECTION,
      shipSettings.SPEED,
      new LightRadar(
        radarDefaultSettings,
        new LightRadarRenderer(this.missile!, this),
        'rws',
        shipSettings.LOADOUT
      ),
      shipSettings.LOADOUT
    )
    // make ship position radar position
    if (this.player) {
      const shipPosition = this.player.getWorldPoint()
      this.player?.radar?.setPosition({ x: shipPosition.x, y: shipPosition.y})
      // this.player.setScale(IMAGE_SCALE);
    }

    // CAMERA
    // set camera bounds to world bounds
    this.cameras.main.setBounds(0, 0, this.world.width, this.world.height);
    this.cameras.main.startFollow(this.player);
    
    // INTERFACE
    this.interfaceRenderer = new InterfaceRenderer(this);
    this.interfaceRenderer.createInterface(this.player?.radar, this.player);

    // TARGETS (ENEMIES) & ASTEROIDS
    const target1 = new Target(
      this, 
      350,
      400,
      90,
      1,
      new LightRadar(
        radarDefaultSettings,
        new LightRadarRenderer(this.missile!, this),
        'rws',
        targetSettings.LOADOUT
      ),
      targetSettings.LOADOUT,
      1,
      new AiUnitController(),
    )
    this.targets.push(target1)
    const asteroid1 = new Asteroid(
      this, 
      { 
        x: 350,
        y: 450 
      }, 
      120,
      1
    )
    this.asteroids.push(asteroid1)

    console.log('asteroids', this.asteroids);
    
    this.player?.radar?.start()
  }

  // update time , delta
  update(_: number, delta: number)
  {
    this.graphics?.clear();
    this.debugRenderer();
    this.player?.setAngularVelocity(this.turn * shipSettings.ROTATION_SPEED);
    // Move ship in the direction it's facing
    if (this.player) {
      const angleRad = Phaser.Math.DegToRad(this.player.angle);
      const velocityX = Math.cos(angleRad) * shipSettings.SPEED;
      const velocityY = Math.sin(angleRad) * shipSettings.SPEED;
      this.player.setVelocity(velocityX, velocityY);
    }
    this.player?.radar?.setPosition(this.player?.getWorldPoint() || { x: 0, y: 0 });

    // move targets & asteroids
    this.checkCollisions()

    // radar scan
    this.player?.radar?.update(delta, this.player?.angle || 0, this.targets, this.asteroids, this.graphics!);

    // update targets
    const destroyedEnemyId = this.player?.radar?.updateEnemiesInMain();
    if (destroyedEnemyId !== undefined) {
      // Find and remove the target with the specified id
      this.targets = this.targets.filter(target => target.id !== destroyedEnemyId);
    }
    const trackedEnemyId = this.player?.radar?.alertTargetBeingTracked();
    if (trackedEnemyId !== null) {
      this.targets.forEach(t => {
        if (t.id === trackedEnemyId) {
          t.controller.setSttTracked(true);
        } else {
          t.controller.setSttTracked(false);
        }
      })
    }
    const rwrAlertIds = this.player?.radar?.alertRwr()
    if (rwrAlertIds !== null && rwrAlertIds !== undefined && rwrAlertIds.length > 0) {
      this.targets.forEach(t => {
        if (rwrAlertIds?.includes(t.id)) {
          t.controller.setRadarTracked(true);
        } else {
          t.controller.setRadarTracked(false);
        }
      })
    }

    // Update target AI controllers once per second
    if (!this.aiUpdateTimer) {
      this.aiUpdateTimer = this.time.addEvent({
      delay: 1000,
      callback: () => {
        this.targets.forEach(t => {
        t.controller.update();
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

  // TO DO 
  // this method must be moved to a controller
  // collision checks could be done in a extra physics controller
  private checkCollisions() {
    // targets
    this.targets.forEach(t => {
      const playerCircle = this.player?.getCircle();
      const targetCircle = t.getCircle();
      if (!playerCircle || !targetCircle) return;
      playerCircle.radius = Math.max(0, playerCircle.radius);
      targetCircle.radius = Math.max(0, targetCircle.radius);
      const collider = Phaser.Geom.Intersects.CircleToCircle(playerCircle, targetCircle);
      if (collider && this.player) {
        console.warn('Collision detected between player and target ID:', t.id);
        this.player.setVisible(false);
        this.player.setActive(false);
        this.player.disableBody(true, true);
        this.player?.radar?.stop();
        this.targets.forEach(target => target.destroy());
        this.asteroids.forEach(asteroid => asteroid.destroy());
        const cam = this.cameras.main;
        this.add.text(cam.centerX, cam.centerY, 'SHIP DESTROYED', {
          font: '32px Courier',
          color: '#ff0000'
        }).setOrigin(0.5, 0.5).setScrollFactor(0);
      }
    });

    // asteroids
    this.asteroids.forEach(a => {
      const playerCircle = this.player?.getCircle();
      const asteroidCircle = a.getCircle();
      if (!playerCircle || !asteroidCircle) return;
      playerCircle.radius = Math.max(0, playerCircle.radius);
      asteroidCircle.radius = Math.max(0, asteroidCircle.radius);
      const collider = Phaser.Geom.Intersects.CircleToCircle(playerCircle, asteroidCircle);
      if (collider && this.player) {
        console.warn('Collision detected between player and asteroid');
        this.player.setVisible(false);
        this.player.setActive(false);
        this.player.disableBody(true, true);
        this.player?.radar?.stop();
        this.targets.forEach(target => target.destroy());
        this.asteroids.forEach(asteroid => asteroid.destroy());
        const cam = this.cameras.main;
        this.add.text(cam.centerX, cam.centerY, 'SHIP DESTROYED', {
          font: '32px Courier',
          color: '#ff0000'
        }).setOrigin(0.5, 0.5).setScrollFactor(0);
      }
    });
  }

  debugRenderer() {
    if (!this.graphics) return;

      // Draw player ship bounds
      if (this.player) {
        const c = this.player.getCircle();
        this.graphics.lineStyle(2, 0x00ff00, 1);
        this.graphics.strokeCircle(
        c!.x,
        c!.y,
        c!.radius
        );
      }

      // Draw target bounds
      this.targets.forEach(t => {
        const c = t.getCircle();
        this.graphics!.lineStyle(2, 0xff0000, 1);
        this.graphics!.strokeCircle(
        c!.x,
        c!.y,
        c!.radius
        );
      });

      // Draw asteroid bounds
      this.asteroids.forEach(a => {
        const c = a.getCircle();
        this.graphics!.lineStyle(2, 0xffff00, 1);
        this.graphics!.strokeCircle(
        c!.x,
        c!.y,
        c!.radius
        );
      });
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