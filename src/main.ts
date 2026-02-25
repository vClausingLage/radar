import Phaser from "phaser";
import StartMenu from "./scenes/startMenu";
import { LightRadar } from "./radar/systems/lightRadar";
import { LightRadarRenderer } from "./radar/renderer/lightRadarRenderer";
import { InterfaceRenderer } from "./radar/renderer/interfaceRenderer";
import { createPlayerShipFactory } from "./entities/shipFactory";
import { createAsteroidFactory } from "./entities/asteroidFactory";
import { PlayerShip, Target } from "./entities/ship";
import { CAMERA_ZOOM, playerShipSettings, radarDefaultSettings, targetShipSettings } from "./settings";
import { createMissileFactory } from "./entities/missileFactory";
import { CollisionRegistrar } from "./physics/collisionRegistrar";
import { PhysicsRenderer } from "./physics/renderer/physicsRenderer";

class Game extends Phaser.Scene
{
  private world = {
    width: 2500,
    height: 2500
  };
  private canvas?: HTMLCanvasElement = this.sys?.game?.canvas ?? undefined;
  private graphics?: Phaser.GameObjects.Graphics;
  private player?: PlayerShip;
  private interfaceRenderer?: InterfaceRenderer;
  private targets: Target[] = [];
  private asteroids: any[] = [];
  private shipGroup!: Phaser.Physics.Arcade.Group;
  private asteroidGroup!: Phaser.Physics.Arcade.Group;
  private missileGroup!: Phaser.Physics.Arcade.Group;
  private physicsRenderer!: PhysicsRenderer;

  constructor()
  {
    super('Game');
    // return undefined canvas initially
    console.info(this.canvas);
  }
  
  preload()
  {
    this.canvas = this.sys.game.canvas;
    this.load.image('universe', 'universe.png');
    this.load.image('ship', 'ship.png');
    this.load.image('rwr', 'screen.png');
    this.load.image('radar', 'screen.png');
    this.load.image('missile', 'missile.png');
    this.load.image('explosion', 'explosion.png');
    this.load.image('asteroid', 'asteroid.png');
    this.load.image('flares', 'flares.png');
  }

  create()
  {
    // Register factories
    // use this doumentation https://docs.phaser.io/phaser/concepts/gameobjects/factories
    // Phaser.GameObjects.GameObjectFactory.register('bla')

    createPlayerShipFactory(this);
    createAsteroidFactory(this);
    createMissileFactory(this);

    // WORLD
    this.physics.world.setBounds(0, 0, this.world.width, this.world.height);
    // Groups for collisions
    this.shipGroup = this.physics.add.group();
    this.asteroidGroup = this.physics.add.group();
    this.missileGroup = this.physics.add.group();
    this.physicsRenderer = new PhysicsRenderer(this);
    // ADD IMAGES
    this.add.image(0, 0, 'universe').setOrigin(0).setScale(2.5);
    // GRAPHICS
    this.graphics = this.add.graphics();

    // PLAYER SHIP using factory
    this.player = this.add.playerShip({
      x: playerShipSettings.START_POSITION.x,
      y: playerShipSettings.START_POSITION.y,
      direction: playerShipSettings.DIRECTION,
      speed: playerShipSettings.SPEED,
      radar: new LightRadar({
        scene: this,
        settings: radarDefaultSettings,
        renderer: new LightRadarRenderer(this),
        mode: 'rws',
        loadout: playerShipSettings.LOADOUT
      }),
    });
    // Attach radar to its owning ship
    // this.player.radar.attachTo(this.player);
    this.shipGroup.add(this.player);
    // PLAYER CONTROLLER
    // this.playerController = new PlayerController(this, this.player);

    // CAMERA
    this.cameras.main.setBounds(0, 0, this.world.width, this.world.height);
    this.cameras.main.startFollow(this.player);
    this.cameras.main.setZoom(CAMERA_ZOOM);
    
    // INTERFACE
    this.interfaceRenderer = new InterfaceRenderer(this, this.player.radar);
    this.interfaceRenderer.createInterface(this.player);

    // Colliders
    if (this.player) {
      new CollisionRegistrar({
        scene: this,
        player: this.player,
        shipGroup: this.shipGroup,
        asteroidGroup: this.asteroidGroup,
        missileGroup: this.missileGroup,
        physicsRenderer: this.physicsRenderer,
        destroyPlayer: () => this.destroyPlayer()
      }).register();
    }

    // TARGETS using factory
    const target1 = this.add.target({
      x: 2000,
      y: 2000,
      direction: 340,
      speed: 3,
      type: 'cargo',
      radar: new LightRadar({
        scene: this,
        settings: radarDefaultSettings,
        renderer: null,
        mode: 'rws',
        loadout: targetShipSettings.LOADOUT
      }),
      id: 1,
    });
    this.targets.push(target1);

    // ASTEROIDS using factory
    const asteroid1 = this.add.asteroid({
      position: { x: 1800, y: 2000 },
      direction: 120,
      speed: 1
    });
    this.asteroids.push(asteroid1);
    this.asteroidGroup.add(asteroid1);
  }

  update(_: number, delta: number)
  {
    this.graphics?.clear();
    this.debugRenderer();
    
    // Update player controller
    this?.player?.controller?.update(playerShipSettings.SPEED);

    // Radar scan (pass all ships; radar excludes its owner internally)
    const allShips = [this.player!, ...this.targets];
    allShips.forEach(ship => {
      ship.radar.update(delta, ship.getDirection(), allShips, this.asteroids, this.graphics!);
    });

    // Update AI continuous (every frame)
    this.targets.forEach(t => {
      t.controller?.updateContinuous();

      // Update AI radar scan; radar self-syncs to owner
      // if (t.radar) {
      //   t.radar.update(delta, newDirection, allShips, this.asteroids, this.graphics!);
      // }
    });

    // // Update target AI strategic decisions once per second
    // if (!this.aiUpdateTimer) {
    //   this.aiUpdateTimer = this.time.addEvent({
    //     delay: 1000,
    //     callback: () => {
    //       this.targets.forEach(t => {
    //         t.controller.updateStrategic();
    //       });
    //     },
    //     loop: true
    //   });
    // }

    // // Check if player is being tracked
    // const playerTrackedByRadar = this.targets.some(t => 
    //   t.radar?.getTracks().length > 0
    // );
    // const playerLockedByStt = this.targets.some(t => 
    //   t.radar?.getMode() === 'stt'
    // );

    // // update targets
    // const destroyedEnemyId = this.player?.radar?.updateEnemiesInMain();
    // if (destroyedEnemyId !== undefined) {
    //   this.targets = this.targets.filter(target => target.id !== destroyedEnemyId);
    // }

    // Update interface with warnings
    if (this.player?.radar && this.interfaceRenderer && this.player) {
      this.interfaceRenderer.update(this.player);
    }
  }

  private destroyPlayer(): void {
    if (!this.player) return;

    this.player.setVisible(false);
    this.player.setActive(false);
    this.player.disableBody(true, true);
    this.player?.radar?.stop();
    
    // Clean up renderers
    this.interfaceRenderer?.destroy();
    this.graphics?.destroy();
    
    // Destroy targets and asteroids
    this.targets.forEach(target => target.destroy());
    this.asteroids.forEach(asteroid => asteroid.destroy());
    
    // Show game over message
    const cam = this.cameras.main;
    this.add.text(cam.centerX, cam.centerY, 'SHIP DESTROYED', {
      font: '32px Courier',
      color: '#ff0000'
    }).setOrigin(0.5, 0.5).setScrollFactor(0);
  }

  debugRenderer(): void {
    if (!this.graphics) return;

    // Particle effects test
        // const wisp = this.add.particles(2400, 2400, 'flares',
        // {
        //     color: [ 0x96e0da, 0x937ef3 ],
        //     colorEase: 'quart.out',
        //     lifespan: 120,
        //     angle: { min: -100, max: -80 },
        //     scale: { start: .08, end: 0, ease: 'sine.in' },
        //     speed: { min: 250, max: 350 },
        //     advance: 400,
        //     blendMode: 'ADD'
        // });
        

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

      // Draw missile bounds
      this.missileGroup.getChildren().forEach(missileObj => {
        const missile = missileObj as Phaser.Physics.Arcade.Sprite;
        const c = new Phaser.Geom.Circle(missile.x, missile.y, (missile.body?.width || 0) / 2);
        this.graphics!.lineStyle(2, 0x0000ff, 1);
        this.graphics!.strokeCircle(
        c!.x,
        c!.y,
        c!.radius
        );
      });

      // Draw asteroid bounds
      // this.asteroids.forEach(a => {
      //   const c = a.getCircle();
      //   this.graphics!.lineStyle(2, 0xffff00, 1);
      //   this.graphics!.strokeCircle(
      //   c!.x,
      //   c!.y,
      //   c!.radius
      //   );
      // });
  }
}

const config = {
  type: Phaser.AUTO,
  scene: [StartMenu, Game],
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 }
    }
  },
};

new Phaser.Game(config);