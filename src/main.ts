import Phaser from "phaser";
// import StartMenu from "./scenes/startMenu";
import { createPlayerShipFactory } from "./entities/shipFactory";
import { createAsteroidFactory } from "./entities/asteroidFactory";
import { Asteroid } from "./entities/asteroid";
import { PlayerShip, Target } from "./entities/ship";
import { CAMERA_ZOOM, playerShipSettings } from "./settings";
import { createMissileFactory } from "./entities/missileFactory";
import { CollisionRegistrar } from "./physics/collisionRegistrar";
import { PhysicsRenderer } from "./physics/renderer/physicsRenderer";

class Game extends Phaser.Scene
{
  private world = {
    width: 2500,
    height: 2500
  };
  private graphics?: Phaser.GameObjects.Graphics;
  private player?: PlayerShip;
  private targets: Target[] = [];
  private asteroids: Asteroid[] = [];
  // Matter physics uses collision categories instead of groups
  private physicsRenderer!: PhysicsRenderer;

  constructor()
  {
    super('Game');
  }
  
  preload()
  {
    this.load.image('universe', 'universe.png');
    this.load.image('ship', 'ship.png');
    this.load.image('rwr', 'rwr_screen.png');
    this.load.image('missile', 'missile.png');
    this.load.image('explosion', 'explosion.png');
    this.load.image('asteroid', 'asteroid.png');
    this.load.image('flares', 'flares.png');
    this.load.image('cargo', 'cargo.png');
  }

  create()
  {
    // Register factories
    createPlayerShipFactory();
    createAsteroidFactory();
    createMissileFactory();

    // WORLD
    this.matter.world.setBounds(0, 0, this.world.width, this.world.height);
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
    });

    // CAMERA
    this.cameras.main.setBounds(0, 0, this.world.width, this.world.height);
    this.cameras.main.startFollow(this.player);
    this.cameras.main.setZoom(CAMERA_ZOOM);
    
    // Colliders
    if (this.player) {
      const collisionRegistrar = new CollisionRegistrar({
        scene: this,
        player: this.player,
        physicsRenderer: this.physicsRenderer,
        destroyPlayer: () => this.destroyPlayer(),
      });
      collisionRegistrar.register();
    }

    // TARGETS using factory
    const target1 = this.add.target({
      x: 2000,
      y: 2000,
      direction: 180,
      speed: .1,
      type: 'cargo',
    });
    const target2 = this.add.target({
      x: 2200,
      y: 1800,
      direction: 180,
      speed: .1,
      type: 'cruiser',
    });
    const target3 = this.add.target({
      x: 1600,
      y: 2100,
      direction: 90,
      speed: .1,
      type: 'cruiser',
    });
    const target4 = this.add.target({
      x: 2300,
      y: 2300,
      direction: 270,
      speed: .1,
      type: 'cargo',
    });
    this.targets.push(target1, target2, target3, target4);

    // ASTEROIDS — scattered randomly, clear of the player's start position.
    const playerStart = playerShipSettings.START_POSITION;
    const ASTEROID_COUNT = 8;
    const SPAWN_MARGIN = 150;
    const CLEAR_RADIUS = 400;
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      let x = 0;
      let y = 0;
      do {
        x = Phaser.Math.Between(SPAWN_MARGIN, this.world.width - SPAWN_MARGIN);
        y = Phaser.Math.Between(SPAWN_MARGIN, this.world.height - SPAWN_MARGIN);
      } while (Phaser.Math.Distance.Between(x, y, playerStart.x, playerStart.y) < CLEAR_RADIUS);

      this.asteroids.push(this.add.asteroid({
        position: { x, y },
        direction: Phaser.Math.Between(0, 359),
        speed: Phaser.Math.FloatBetween(0.2, 1.2),
      }));
    }
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
      ship.radar.update(delta, ship.getDirection(), [...allShips, ...this.asteroids], this.graphics!);
    });

    // Update AI continuous (every frame)
    this.targets.forEach(t => {
      t.controller?.updateContinuous();
    });

    // Update interface with warnings
    if (player.radar) {
      this.player?.radar.getInterfaceRenderer()?.update();
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
    // this.interfaceRenderer?.destroy();
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

const debugConfig = import.meta.env.DEV ? {
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