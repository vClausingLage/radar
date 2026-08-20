import Phaser from "phaser";
import { ScenarioKey } from "./startMenu";
import { createPlayerShipFactory } from "../entities/shipFactory";
import { createAsteroidFactory } from "../entities/asteroidFactory";
import { createGasCloudFactory } from "../entities/gasCloudFactory";
import { Asteroid } from "../entities/asteroid";
import { GasCloud } from "../entities/gasCloud";
import { PlayerShip, Target } from "../entities/ship";
import { CAMERA_ZOOM, playerShipSettings, VISIBILITY_FADE_BAND_PX, VISIBILITY_RANGE_PX, world } from "../settings";
import { createMissileFactory } from "../entities/missileFactory";
import { CollisionRegistrar } from "../physics/collisionRegistrar";
import { PhysicsRenderer } from "../physics/renderer/physicsRenderer";
import { AudioPlayer } from "../audio/audioPlayer";
import { RadarVoice } from "../audio/radarVoice";
import { ShipStartup } from "../audio/startup";
import { MissileCallout } from "../audio/missileCallout";

// Anything in the world whose visibility fades with distance from the player:
// ships and asteroids (tracked below) plus one-off scenery a level registers
// via registerFadeAsset() (terrain images, the dish station's rotating overlay).
export type FadeableAsset = {
  setAlpha(value: number): unknown;
  getBounds(): Phaser.Geom.Rectangle;
};

// The free-play scene: a world, a player ship and one of the practice scenarios.
// The campaign levels subclass this and override the terrain/scenario hooks
// rather than rebuilding the world wiring (see scenes/level1.ts).
export default class Game extends Phaser.Scene
{
  protected world = {
    width: world.WIDTH,
    height: world.HEIGHT
  };
  protected graphics?: Phaser.GameObjects.Graphics;
  protected player?: PlayerShip;
  protected targets: Target[] = [];
  protected asteroids: Asteroid[] = [];
  // Absorbing gas volumes. Not obstacles and not trackable entities: they never
  // block a beam, they eat the energy crossing them (see Receiver.isAbsorbedByGas).
  protected gasClouds: GasCloud[] = [];
  // Matter physics uses collision categories instead of groups
  protected physicsRenderer!: PhysicsRenderer;
  protected scenario: ScenarioKey = 'skirmish';
  // Player-only radio callouts (new-contact BRA calls). Created in create().
  protected radarVoice?: RadarVoice;
  // Player's "Fox" call on missile launch. Created in create().
  protected missileCallout?: MissileCallout;
  // Cold-start procedure — only run when requiresColdStart() opts in.
  private startup?: ShipStartup;
  // Scenery/overlays that aren't ships or asteroids but still fade with
  // distance (see registerFadeAsset()).
  private extraFadeAssets: FadeableAsset[] = [];

  constructor(key = 'Game')
  {
    super(key);
  }

  init(data: { scenario?: ScenarioKey })
  {
    this.scenario = data?.scenario ?? 'skirmish';
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
    this.load.image('chaff', 'chaff.png');
    this.load.image('cargo', 'cargo.png');
    this.load.image('dish_radar', 'dish_radar.png');
    this.load.image('asteroid_2', 'asteroid_2.png');

    // Voice-callout clips (stitched into radio calls by RadarVoice).
    const audioClips = [
      'new-radar-contact', 'bra', 'for', 'hot', 'cold', 'flanking', 'beaming',
      'zero', 'one', 'two', 'three', 'four',
      'five', 'six', 'seven', 'eight', 'nine',
      '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000',
    ];
    audioClips.forEach(key => this.load.audio(key, `audio/${key}.mp3`));

    // Player's "Fox" call on missile launch. Loaded globally (not just in the
    // campaign) since any scene lets the player fire; the callsign clip is
    // shared with Level 1's GCI comms.
    const missileCalloutClips = ['plr-flatspin', 'plr-fox'];
    missileCalloutClips.forEach(key => this.load.audio(key, `audio/${key}.mp3`));

    if (this.requiresColdStart()) {
      this.preloadColdStartAudio();
    }
  }

  // Crew callbacks for the cold-start procedure (see beginColdStart()).
  private preloadColdStartAudio(): void {
    const startupClips = [
      'power_is_up',
      'starting_number_one', 'number_one_is_running',
      'starting_number_two', 'number_two_is_running',
      'ready_departure',
    ];
    startupClips.forEach(key => this.load.audio(key, `audio/${key}.mp3`));
  }

  // Scenes that open with the ship powered down on the pad (campaign levels)
  // override this to run the cold-start procedure as their first step, before
  // flight controls are handed over. Free-play scenarios start ready to fly.
  protected requiresColdStart(): boolean {
    return false;
  }

  create()
  {
    // Register factories
    createPlayerShipFactory();
    createAsteroidFactory();
    createGasCloudFactory();
    createMissileFactory();

    // WORLD
    this.matter.world.setBounds(0, 0, this.world.width, this.world.height);
    this.physicsRenderer = new PhysicsRenderer(this);
    // ADD IMAGES
    this.add.image(0, 0, 'universe').setOrigin(0).setScale(2.5);
    // GRAPHICS
    this.graphics = this.add.graphics();

    // Scene-specific terrain (the campaign's surface and launchpad).
    this.buildTerrain();

    // PLAYER SHIP using factory
    this.player = this.add.playerShip({
      x: playerShipSettings.START_POSITION.x,
      y: playerShipSettings.START_POSITION.y,
      direction: playerShipSettings.DIRECTION,
      speed: playerShipSettings.SPEED,
    });

    // Player-only voice callouts driven off the player's radar tracks.
    this.radarVoice = new RadarVoice(new AudioPlayer(this));

    // "Fox" call on missile launch — no cooldown, it's a deliberate one-off
    // event, not ambient chatter to throttle. Only the player's own radar
    // emits 'missile-fired' with a listener attached, so AI shots stay silent.
    this.missileCallout = new MissileCallout(new AudioPlayer(this, 0));
    this.player.radar.eventEmitter.on('missile-fired', (weaponType) => {
      this.missileCallout?.announceFired(weaponType as string);
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

    this.buildScenario();
    this.showBriefing();

    if (this.requiresColdStart()) {
      this.beginColdStart();
    }
  }

  // Static scenery under the ships. Free play is set in open space.
  protected buildTerrain(): void {}

  // Opt a one-off visual (terrain image, station overlay, ...) into the same
  // distance-based fade that ships and asteroids already get for free by
  // virtue of being tracked in this.targets/this.asteroids.
  protected registerFadeAsset(asset: FadeableAsset): void {
    this.extraFadeAssets.push(asset);
  }

  // Populate the world for the chosen scenario.
  protected buildScenario(): void {
    switch (this.scenario) {
      case 'duel':
        this.buildDuel();
        break;
      case 'occluded':
        this.buildOccluded();
        break;
      case 'skirmish':
      default:
        this.buildSkirmish();
        break;
    }
  }

  protected briefingMessage(): string {
    const messages: Record<ScenarioKey, string> = {
      duel: 'There is an inactive drone in front of you. Use it to practise different radar modes and weapons.',
      occluded: 'There is an inactive drone behind the asteroid. Use your VIM-220 with waypoints to destroy it.',
      skirmish: 'Free scenario.',
    };
    return messages[this.scenario];
  }

  // Short scenario briefing, pinned to the camera and removed after 10 s.
  protected showBriefing(): void {
    const cam = this.cameras.main;
    const briefing = this.add.text(cam.width / 2, 60, this.briefingMessage(), {
      font: '20px Courier',
      color: '#00ff00',
      align: 'center',
      backgroundColor: '#000000aa',
      padding: { x: 16, y: 10 },
      wordWrap: { width: Math.min(cam.width - 80, 700) },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000);

    this.tweens.add({
      targets: briefing,
      alpha: 0,
      delay: 9000,
      duration: 1000,
      onComplete: () => briefing.destroy(),
    });
  }

  // Park the ship cold and put the startup switches where the flight controls
  // normally sit. Each switch drives the ShipStartup sequence, which calls back
  // to light the engine plumes and to hand the ship over when it is done.
  private beginColdStart(): void {
    const player = this.player;
    if (!player) return;

    // On the pad: no way on and both engines out.
    player.setCurrentSpeed(0);
    player.shutDownEngines();

    const ui = player.radar.getInterfaceRenderer();
    ui?.setFlightControlsVisible(false);

    // No cooldown — the crew callbacks are a scripted sequence, not the
    // throttled radio chatter the default cooldown exists for.
    this.startup = new ShipStartup(this, new AudioPlayer(this, 0), {
      onStepBusy: step => ui?.setStartupStepState(step, 'busy'),
      onStepDone: step => ui?.setStartupStepState(step, 'done'),
      onEngineStart: engineIndex => player.setEngineRunning(engineIndex, true),
      onComplete: () => {
        ui?.destroyStartupPanel();
        ui?.setFlightControlsVisible(true);
      },
    });

    ui?.createStartupPanel(step => this.startup?.press(step));
  }

  // Scenario 1 — a single idle ship, within radar range, for the player to engage.
  private buildDuel(): void {
    this.targets.push(this.add.target({
      x: 1370,
      y: 1750,
      direction: 270,
      speed: 0,
      type: 'cruiser',
      activity: 'inactive',
    }));
  }

  // Scenario 2 — an idle ship in range but hidden behind a stationary asteroid.
  private buildOccluded(): void {
    this.targets.push(this.add.target({
      x: 1500,
      y: 1800,
      direction: 270,
      speed: 0,
      type: 'cruiser',
      activity: 'inactive',
    }));
    // Asteroid sits between the player's start and the target, blocking line of sight.
    this.asteroids.push(this.add.asteroid({
      position: { x: 1500, y: 1950 },
      direction: 0,
      speed: 0,
    }));
  }

  // Scenario 3 — the original mixed scene: several ships and scattered asteroids.
  private buildSkirmish(): void {
    const target1 = this.add.target({
      x: 1200,
      y: 700,
      direction: 180,
      speed: .1,
      type: 'cargo',
    });
    const target2 = this.add.target({
      x: 2000,
      y: 1200,
      direction: 180,
      speed: .1,
      type: 'cruiser',
    });
    const target3 = this.add.target({
      x: 800,
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

    // Limited visual range: ships/asteroids/scenery fade with distance from
    // the player, independent of (and usually shorter than) radar range.
    this.updateVisibilityFade(player);

    // Update player controller
    const playerSpeed = player.getCurrentSpeed?.() ?? playerShipSettings.SPEED;
    player.controller?.update(playerSpeed);

    // Chaff clouds from every ship (pruned/faded here); their circles block any
    // radar beam or missile seeker passing through — so AI chaff defeats the
    // player's radar just as the player's defeats the AI.
    const decoyCircles = [player, ...this.targets]
      .flatMap(ship => ship.getActiveDecoys())
      .map(d => d.getCircle());

    // Gas clouds: spread a little further, churn their puffs, and hand the
    // radar the capsule each one currently occupies. Every radar in the world
    // gets the same list — gas is a property of the medium, not of a side.
    const gasVolumes = this.gasClouds.map(cloud => {
      cloud.update(this.time.now);
      return cloud.getVolume();
    });

    // Radar scan (pass all ships; radar excludes its owner internally).
    // Asteroids are NOT trackable entities: they go in as terrain — they block
    // the beam and are painted by the ground-mapping display instead.
    const allShips = [player, ...this.targets];
    allShips.forEach(ship => {
      ship.radar.update(delta, ship.getDirection(), allShips, this.graphics!, decoyCircles, this.asteroids, gasVolumes);
    });

    // Update AI continuous (every frame)
    this.targets.forEach(t => {
      t.controller?.updateContinuous();
    });

    // Player radio callouts (announces newly-formed radar tracks).
    this.radarVoice?.update(player);

    // Update interface with warnings
    if (player.radar) {
      this.player?.radar.getInterfaceRenderer()?.update();
    }
  }

  // Fade every ship, asteroid and registered scenery asset by distance from
  // the player: full alpha inside range - fade band, ramping to fully
  // transparent at range, so objects fade smoothly rather than popping.
  // Distance is to the nearest edge of each object's bounds, not its centre —
  // otherwise a large background image (the launchpad strip) would fade out
  // while the player is still over part of it, and a big asteroid's edge
  // would stay hidden well past where it's actually close enough to see.
  private updateVisibilityFade(player: PlayerShip): void {
    const assets: FadeableAsset[] = [...this.targets, ...this.asteroids, ...this.gasClouds, ...this.extraFadeAssets];
    for (const asset of assets) {
      const bounds = asset.getBounds();
      const dx = Math.max(bounds.left - player.x, 0, player.x - bounds.right);
      const dy = Math.max(bounds.top - player.y, 0, player.y - bounds.bottom);
      const distance = Math.hypot(dx, dy);
      const alpha = Phaser.Math.Clamp((VISIBILITY_RANGE_PX - distance) / VISIBILITY_FADE_BAND_PX, 0, 1);
      asset.setAlpha(alpha);
    }
  }

  protected destroyPlayer(): void {
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
    this.gasClouds.forEach(cloud => cloud.destroy());
    this.gasClouds = [];

    // Show game over message
    const cam = this.cameras.main;
    this.add.text(cam.centerX, cam.centerY, 'SHIP DESTROYED', {
      font: '32px Courier',
      color: '#ff0000'
    }).setOrigin(0.5, 0.5).setScrollFactor(0);
  }
}
