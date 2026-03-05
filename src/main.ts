import Phaser from "phaser";
// import StartMenu from "./scenes/startMenu";
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
  // Matter physics uses collision categories instead of groups
  private shipCategory!: number;
  private asteroidCategory!: number;
  private missileCategory!: number;
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
    this.load.image('cargo', 'cargo.png');
  }

  create()
  {
    // Register factories
    createPlayerShipFactory(this);
    createAsteroidFactory(this);
    createMissileFactory(this);

    // WORLD
    this.matter.world.setBounds(0, 0, this.world.width, this.world.height);
    // Collision categories for Matter physics
    this.shipCategory = this.matter.world.nextCategory();
    this.asteroidCategory = this.matter.world.nextCategory();
    this.missileCategory = this.matter.world.nextCategory();
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
        settings: { ...radarDefaultSettings, position: { x: 0, y: 0 } },
        renderer: new LightRadarRenderer(this),
        mode: 'rws',
        loadout: playerShipSettings.LOADOUT
      }),
    });

    // CAMERA
    this.cameras.main.setBounds(0, 0, this.world.width, this.world.height);
    this.cameras.main.startFollow(this.player);
    this.cameras.main.setZoom(CAMERA_ZOOM);
    
    // INTERFACE
    this.interfaceRenderer = new InterfaceRenderer(this, this.player.radar);
    this.interfaceRenderer.createInterface(this.player);
    // Connect interface renderer to radar so it can display warnings
    this.player.radar.setInterfaceRenderer(this.interfaceRenderer);

    // Colliders
    if (this.player) {
      const collisionRegistrar = new CollisionRegistrar({
        scene: this,
        player: this.player,
        shipCategory: this.shipCategory,
        asteroidCategory: this.asteroidCategory,
        missileCategory: this.missileCategory,
        physicsRenderer: this.physicsRenderer,
        destroyPlayer: () => this.destroyPlayer(),
      });
      collisionRegistrar.register();
    }

    // TARGETS using factory
    const target1 = this.add.target({
      x: 2000,
      y: 1800,
      direction: 180,
      speed: .1,
      type: 'cargo',
      radar: new LightRadar({
        scene: this,
        settings: { ...radarDefaultSettings, position: { x: 0, y: 0 } },
        renderer: null,
        mode: 'rws',
        loadout: targetShipSettings.LOADOUT
      }),
      id: 1,
    });
    const target2 = this.add.target({
      x: 2100,
      y: 1700,
      direction: 90,
      speed: .1,
      type: 'cruiser',
      radar: new LightRadar({
        scene: this,
        settings: { ...radarDefaultSettings, position: { x: 0, y: 0 } },
        renderer: null,
        mode: 'rws',
        loadout: targetShipSettings.LOADOUT
      }),
      id: 2,
    });
    this.targets.push(target1, target2);

    // ASTEROIDS using factory
    const asteroid1 = this.add.asteroid({
      position: { x: 1800, y: 2300 },
      direction: 120,
      speed: 1
    });
    this.asteroids.push(asteroid1);
  }

  update(_: number, delta: number)
  {
    this.graphics?.clear();

    const player = this.player;
    if (!player || !player.active || !player.body) {
      return;
    }
    
    // Remove destroyed targets from the array
    this.targets = this.targets.filter(t => t.active);
        
    // Update player controller
    const playerSpeed = player.getCurrentSpeed?.() ?? playerShipSettings.SPEED;
    player.controller?.update(playerSpeed);

    // Radar scan (pass all ships; radar excludes its owner internally)
    const allShips = [player, ...this.targets];
    allShips.forEach(ship => {
      ship.radar.update(delta, ship.getDirection(), allShips, this.asteroids, this.graphics!);
    });

    // Update AI continuous (every frame)
    this.targets.forEach(t => {
      t.controller?.updateContinuous();
    });

    // Update interface with warnings
    if (player.radar && this.interfaceRenderer) {
      this.interfaceRenderer.update(player);
    }
  }

  private destroyPlayer(): void {
    if (!this.player) return;

    const player = this.player;

    this.cameras.main.stopFollow();
    player.controller?.destroy();
    player.radar?.stop();
    player.setVisible(false);
    player.setActive(false);
    player.destroy();
    this.player = undefined;
    
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
}

const debugConfig = process.env.NODE_ENV === 'development' ? {
        showBody: true,
        showStaticBody: true,
        showVelocity: true,
        velocityColor: 0x00aeef,
        showCollisions: true,
        collisionColor: 0xf5950c,
        renderFill: false,
        renderLine: true,
        lineColor: 0x28de19,
        lineOpacity: 1,
        lineThickness: 1
      } : false;

const config = {
  type: Phaser.AUTO,
  scene: Game,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight
  },
  physics: {
    default: 'matter',
    matter: {
      gravity: { x: 0, y: 0 },
      debug: debugConfig
    }
  },
};

new Phaser.Game(config);