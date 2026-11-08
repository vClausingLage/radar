import Phaser from "phaser";
import { ScenarioKey } from "./startMenu";
import { createPlayerShipFactory } from "../entities/shipFactory";
import { createAsteroidFactory } from "../entities/asteroidFactory";
import { createStructureFactory } from "../entities/structureFactory";
import { createGasCloudFactory } from "../entities/gasCloudFactory";
import { createFlightFactory } from "../entities/flightFactory";
import { Terrain } from "../radar/data/types";
import { GasCloud } from "../entities/gasCloud";
import { Starfield } from "../entities/starfield";
import { PlayerShip, Target } from "../entities/ship";
import { CAMERA_ZOOM, playerShipSettings, VISIBILITY_FADE_BAND_PX, VISIBILITY_RANGE_PX, world } from "../settings";
import { createMissileFactory, MISSILE_SPAWNED_EVENT } from "../entities/missileFactory";
import type { Missile } from "../entities/missiles";
import { CollisionRegistrar } from "../physics/collisionRegistrar";
import { PhysicsRenderer } from "../physics/renderer/physicsRenderer";
import { AudioPlayer } from "../audio/audioPlayer";
import { RadarVoice } from "../audio/radarVoice";
import { ShipStartup } from "../audio/startup";
import { MissileCallout } from "../audio/missileCallout";
import { SIM_MAX_TICKS_PER_FRAME, SIM_STEP_MS, SIM_TICK_TOLERANCE_MS } from "../radar/data/radarGameSettings";

// The briefing column: where it sits on screen, how wide, how long it stays.
const BRIEFING_LEFT_PX = 16;
const BRIEFING_TOP_PX = 84;
const BRIEFING_WIDTH_PX = 380;
const BRIEFING_SHOW_MS = 25000;
const EDGE_WARNING_TOP_PX = 200;

// Anything in the world whose visibility fades with distance from the player:
// ships and terrain (tracked below) plus the groups a level registers via
// registerFadeGroup() (pad + surface, rock + dish).
export type FadeableAsset = {
  setAlpha(value: number): unknown;
  getBounds(): Phaser.Geom.Rectangle;
};

// Several assets that show and hide as one. The fade is judged on their
// combined bounds and the same alpha is dealt to every member, so the pad
// never thins out while the player is still over the ground it is set into.
class FadeGroup implements FadeableAsset {
  constructor(private readonly members: FadeableAsset[]) {}

  getBounds(): Phaser.Geom.Rectangle {
    const union = this.members[0].getBounds();
    for (const member of this.members.slice(1)) {
      Phaser.Geom.Rectangle.Union(union, member.getBounds(), union);
    }
    return union;
  }

  setAlpha(value: number): void {
    for (const member of this.members) member.setAlpha(value);
  }
}

// The free-play scene: a world, a player ship and one of the practice scenarios.
// The campaign levels subclass this and override the terrain/scenario hooks
// rather than rebuilding the world wiring (see scenes/campaignLevel.ts).
export default class Game extends Phaser.Scene
{
  protected world = {
    width: world.WIDTH,
    height: world.HEIGHT
  };
  protected graphics?: Phaser.GameObjects.Graphics;
  protected player?: PlayerShip;
  protected targets: Target[] = [];
  // Solid world geometry no radar can see through — asteroids, the ground,
  // the pad. Every radar in the scene, the dish station's included, is
  // occluded by the whole list. Added through registerTerrain().
  protected terrain: Terrain[] = [];
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
  // Groups that aren't ships or terrain but still fade with distance
  // (see registerFadeGroup()).
  private extraFadeAssets: FadeableAsset[] = [];
  // Members of a fade group: faded through the group, never on their own.
  private groupedFadeAssets = new Set<FadeableAsset>();
  // Every missile in flight, whoever fired it: seen by eye like a ship, so it
  // fades with distance too. Its explosion is a separate sprite and does not —
  // a detonation is bright enough to be seen from anywhere on the map.
  private missiles = new Set<Missile>();
  // Time owed to the simulation, and the fixed ticks this frame runs (see
  // SIM_STEP_MS). A subclass that steps a radar of its own steps it that many
  // times, with SIM_STEP_MS.
  private simClockMs = 0;
  // The briefing column, kept so B can bring it back.
  private briefing?: Phaser.GameObjects.Text;
  // The free-play verdict has been given (see hasObjective()).
  private objectiveMet = false;
  // "World edge" warning, shown while the ship presses against the boundary.
  private edgeWarning?: Phaser.GameObjects.Text;
  protected simTicks = 0;
  // How much simulated time each of this frame's ticks carries.
  protected simStepMs = SIM_STEP_MS;

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
  // Whether the scene dresses the world: the sky and the detonation effects.
  // Pure looks, no sensor sees them; a scene that measures the simulation (the
  // test scene) turns them off so they cost it no frame time and no dice.
  protected hasScenery(): boolean {
    return true;
  }

  protected requiresColdStart(): boolean {
    return false;
  }

  create()
  {
    // Phaser reuses the scene instance across stop/start, so these still hold
    // whatever the last run put in them. The game objects themselves went with
    // the old display list, but the lists did not: a stale gas cloud has no
    // physics body to be pruned by, and would go on absorbing the beam from a
    // world that no longer exists.
    this.targets = [];
    this.terrain = [];
    this.gasClouds = [];
    this.extraFadeAssets = [];
    this.groupedFadeAssets = new Set();
    this.missiles = new Set();
    this.simClockMs = 0;
    this.simTicks = 0;
    // The scene's event bus outlives a restart, so the listener comes off at
    // shutdown — otherwise every run would add another one.
    const onMissileSpawned = (missile: Missile) => this.trackMissile(missile);
    this.events.on(MISSILE_SPAWNED_EVENT, onMissileSpawned);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(MISSILE_SPAWNED_EVENT, onMissileSpawned));
    this.briefing = undefined;
    this.objectiveMet = false;
    this.edgeWarning = undefined;
    this.input.keyboard?.on('keydown-M', this.onMenu);
    this.input.keyboard?.on('keydown-B', this.revealBriefing);
    this.input.gamepad?.on('down', this.onPadButtonDown);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-B', this.revealBriefing);
      this.input.keyboard?.off('keydown-M', this.onMenu);
      this.input.gamepad?.off('down', this.onPadButtonDown);
    });

    // Register factories
    createPlayerShipFactory();
    createAsteroidFactory();
    createStructureFactory();
    createGasCloudFactory();
    createFlightFactory();
    createMissileFactory();

    // WORLD
    this.matter.world.setBounds(0, 0, this.world.width, this.world.height);
    this.physicsRenderer = new PhysicsRenderer(this, this.hasScenery());
    // ADD IMAGES
    if (this.hasScenery()) new Starfield(this);
    // GRAPHICS
    this.graphics = this.add.graphics();

    // Scene-specific terrain (the campaign's surface and launchpad).
    this.buildTerrain();

    // PLAYER SHIP using factory
    const start = this.playerStart();
    this.player = this.add.playerShip({
      x: start.x,
      y: start.y,
      direction: start.direction,
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
        onPlayerLanded: () => this.onPlayerLanded(),
      });
      collisionRegistrar.register();
    }

    this.buildScenario();
    this.showBriefing();

    if (this.requiresColdStart()) {
      this.beginColdStart();
    }
  }

  // Whether M / Select may leave for the menu right now. Free play has no ending
  // of its own, and a desktop build has no browser reload to fall back on.
  protected canLeaveToMenu(): boolean {
    return true;
  }

  private onMenu = () => {
    if (this.canLeaveToMenu()) this.scene.start('StartMenu');
  };

  private onPadButtonDown = (_pad: Phaser.Input.Gamepad.Gamepad, button: Phaser.Input.Gamepad.Button) => {
    const pad = Phaser.Input.Gamepad.Configs.XBOX_360;
    if (button.index === pad.BACK) this.onMenu();
    else if (button.index === pad.START && this.player) this.startup?.pressNext();
  };

  // Where the player's ship enters the world and which way it points.
  // Free play and the campaign start on the pad's spot, nose north.
  protected playerStart(): { x: number; y: number; direction: number } {
    return {
      x: playerShipSettings.START_POSITION.x,
      y: playerShipSettings.START_POSITION.y,
      direction: playerShipSettings.DIRECTION,
    };
  }

  // Whether the ships of this scene carry working IFF: an interrogator on every
  // radar and a transponder on every hull. On in free play. A story level
  // whose premise is that the radar cannot tell friend from bogey (level 1's
  // visual identification) turns it off, which leaves that level exactly as it
  // was written.
  iffAvailable(): boolean {
    return true;
  }

  // Static scenery under the ships. Free play is set in open space.
  protected buildTerrain(): void {}

  // Put a solid body into the world. From here on it blocks and shadows
  // every radar's beam, paints on the ground map, and fades with distance
  // like a ship does. Returned so a creation can be registered inline.
  protected registerTerrain<T extends Terrain>(body: T): T {
    this.terrain.push(body);
    return body;
  }

  // Tie assets together so they fade as one (a pad and the ground under it).
  // Members already tracked elsewhere — terrain, ships — are taken out of
  // their own fade and follow the group's from here on.
  protected registerFadeGroup(members: FadeableAsset[]): void {
    members.forEach(member => this.groupedFadeAssets.add(member));
    this.extraFadeAssets.push(new FadeGroup(members));
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
      duel: 'There is a drone in front of you. It cannot move, but it works its radar, chaff and jammer to defend itself. Use it to practise different radar modes and weapons.',
      occluded: 'There is a stationary drone behind the asteroid, out of your missiles\' reach from here. Close in, then use your VIM-220 with waypoints to go round the rock. It defends itself with chaff and jammer.',
      skirmish: 'Free scenario.',
    };
    return messages[this.scenario];
  }

  // Scenario briefing: a column down the left edge, below the tasking lines,
  // clear of the radio subtitles along the top and of the ship in the middle.
  // It stays up for BRIEFING_SHOW_MS and comes back on B - it is the only
  // statement of the task, and the radio talks over the first reading of it.
  protected showBriefing(): void {
    this.briefing?.destroy();
    this.briefing = this.add.text(0, 0, this.briefingMessage() + '\n\n[B] show this again', {
      font: '16px Courier',
      color: '#00ff00',
      backgroundColor: '#000000aa',
      padding: { x: 12, y: 8 },
      wordWrap: { width: BRIEFING_WIDTH_PX },
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(1000);
    this.revealBriefing();
  }

  private revealBriefing = () => {
    const briefing = this.briefing;
    if (!briefing?.active) return;
    this.tweens.killTweensOf(briefing);
    briefing.setAlpha(1).setVisible(true);
    this.tweens.add({
      targets: briefing,
      alpha: 0,
      delay: BRIEFING_SHOW_MS,
      duration: 1000,
      onComplete: () => briefing.setVisible(false),
    });
  };

  // Put a camera-fixed object at a screen position whatever the zoom. A
  // scroll-factor-0 object is still zoomed about the camera centre, so the
  // screen point is mapped back to the local point that lands on it (the same
  // correction InterfaceRenderer.positionRwr() makes), and the object is
  // counter-scaled to keep its size.
  protected pinToScreen(object: Phaser.GameObjects.Text, screenX: number, screenY: number): void {
    const cam = this.cameras.main;
    const centreX = cam.width * cam.originX;
    const centreY = cam.height * cam.originY;
    object
      .setScale(1 / cam.zoom)
      .setPosition((screenX - centreX) / cam.zoom + centreX, (screenY - centreY) / cam.zoom + centreY);
  }

  // Whether the ship is up and flyable: always in free play, and in the
  // campaign once the cold-start procedure has run through.
  protected isReadyForFlight(): boolean {
    return !this.requiresColdStart() || (this.startup?.isComplete() ?? false);
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
    player.controller?.setThrottleLocked(true);
    // Nor is there power for the radar, the weapons, the chaff or the jammer:
    // a transmitter that radiated before the battery was on would warn every
    // listener of a ship that is supposed to be a cold hull on the pad.
    player.controller?.setSystemsLocked(true);
    player.radar.enterEmcon();

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
        player.controller?.setThrottleLocked(false);
        player.controller?.setSystemsLocked(false);
        player.radar.enterRws();
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
    this.registerTerrain(this.add.asteroid({
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
      let x: number;
      let y: number;
      do {
        x = Phaser.Math.Between(SPAWN_MARGIN, this.world.width - SPAWN_MARGIN);
        y = Phaser.Math.Between(SPAWN_MARGIN, this.world.height - SPAWN_MARGIN);
      } while (Phaser.Math.Distance.Between(x, y, playerStart.x, playerStart.y) < CLEAR_RADIUS);

      this.registerTerrain(this.add.asteroid({
        position: { x, y },
        direction: Phaser.Math.Between(0, 359),
        // A drifting rock, not a missile: per frame, 0.02-0.12 is 1-7 px/s,
        // about the ship's own pace. At 0.2-1.2 (12-70 px/s, up to twelve
        // times the ship) a rock could not be seen coming and ended most runs
        // by ramming whoever happened to be in the way, the AI ships first.
        speed: Phaser.Math.FloatBetween(0.02, 0.12),
      }));
    }
  }

  // Fold this frame's time into the simulation clock and say how many fixed
  // ticks it buys: none on a frame faster than the step, two on one twice as
  // slow.
  protected advanceSimClock(deltaMs: number): number {
    this.simStepMs = SIM_STEP_MS;
    this.simClockMs += Math.min(deltaMs, SIM_STEP_MS * SIM_MAX_TICKS_PER_FRAME);
    const ticks = Math.floor((this.simClockMs + SIM_TICK_TOLERANCE_MS) / SIM_STEP_MS);
    this.simClockMs -= ticks * SIM_STEP_MS;
    return ticks;
  }

  update(_: number, delta: number)
  {
    this.simTicks = this.advanceSimClock(delta);
    // The scope marks are redrawn by the ticks. A frame that runs none leaves
    // the last picture standing instead of blanking it for a frame.
    if (this.simTicks > 0) this.graphics?.clear();

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
    // Terrain is NOT trackable: it goes in as occluders — it blocks the beam
    // and is painted by the ground-mapping display instead.
    const iffOn = this.iffAvailable();
    for (let tick = 0; tick < this.simTicks; tick++) {
      // A hull lost in an earlier tick of this frame takes no further part.
      const allShips = [player, ...this.targets].filter(ship => ship.active && ship.body);
      allShips.forEach(ship => {
        ship.radar.setIffAvailable(iffOn);
        ship.radar.update(this.simStepMs, ship.getDirection(), allShips, this.graphics!, decoyCircles, this.terrain, gasVolumes);
      });

      // Update AI continuous (every tick)
      this.targets.forEach(t => {
        if (t.active && t.body) t.controller?.updateContinuous();
      });
    }

    // Player radio callouts (announces newly-formed radar tracks).
    this.radarVoice?.update(player);

    if (this.briefing?.visible) this.pinToScreen(this.briefing, BRIEFING_LEFT_PX, BRIEFING_TOP_PX);
    this.updateEdgeWarning(player);

    if (!this.objectiveMet && this.hasObjective() && this.targets.length === 0) {
      this.objectiveMet = true;
      this.showOutcome('ALL TARGETS DESTROYED', '#00ff00');
    }

    // Update interface with warnings
    if (player.radar) {
      this.player?.radar.getInterfaceRenderer()?.update();
    }
  }

  // The boundary is a wall: a ship that presses on against it stays there
  // for ever with nothing said. Warn while within the margin and heading out.
  private updateEdgeWarning(player: PlayerShip): void {
    const margin = world.BORDER_MARGIN;
    const rad = Phaser.Math.DegToRad(player.angle);
    const outward = (player.x < margin && Math.cos(rad) < 0) || (player.x > this.world.width - margin && Math.cos(rad) > 0)
      || (player.y < margin && Math.sin(rad) < 0) || (player.y > this.world.height - margin && Math.sin(rad) > 0);
    if (outward && !this.edgeWarning) {
      this.edgeWarning = this.add.text(0, 0, 'WORLD EDGE - TURN BACK', {
        font: '20px Courier',
        color: '#000000',
        backgroundColor: '#ffb000',
        padding: { x: 12, y: 6 },
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000);
    }
    if (this.edgeWarning) {
      this.edgeWarning.setVisible(outward);
      this.pinToScreen(this.edgeWarning, this.cameras.main.width / 2, EDGE_WARNING_TOP_PX);
    }
  }

  // Fade every ship, terrain body and registered overlay by distance from
  // the player: full alpha inside range - fade band, ramping to fully
  // transparent at range, so objects fade smoothly rather than popping.
  // Distance is to the nearest edge of each object's bounds, not its centre —
  // otherwise a large background image (the launchpad strip) would fade out
  // while the player is still over part of it, and a big asteroid's edge
  // would stay hidden well past where it's actually close enough to see.
  private updateVisibilityFade(player: PlayerShip): void {
    const assets: FadeableAsset[] = [
      ...this.targets, ...this.terrain, ...this.gasClouds, ...this.missiles, ...this.extraFadeAssets,
    ];
    for (const asset of assets) {
      if (this.groupedFadeAssets.has(asset)) continue;
      asset.setAlpha(this.sightAlpha(asset, player));
    }
  }

  private sightAlpha(asset: FadeableAsset, player: PlayerShip): number {
    const bounds = asset.getBounds();
    const dx = Math.max(bounds.left - player.x, 0, player.x - bounds.right);
    const dy = Math.max(bounds.top - player.y, 0, player.y - bounds.bottom);
    const distance = Math.hypot(dx, dy);
    return Phaser.Math.Clamp((VISIBILITY_RANGE_PX - distance) / VISIBILITY_FADE_BAND_PX, 0, 1);
  }

  // A new missile is faded at once rather than on the next frame, so a shot
  // fired beyond eyesight never flashes up for a frame at the shooter's rail.
  // Its exhaust plume copies the missile's alpha (Exhaust.update()).
  private trackMissile(missile: Missile): void {
    this.missiles.add(missile);
    missile.once(Phaser.GameObjects.Events.DESTROY, () => this.missiles.delete(missile));
    const player = this.player;
    if (player?.active && player.body) missile.setAlpha(this.sightAlpha(missile, player));
  }

  // The player has set down on a pad or the ground by the landing rules
  // (physics/landing.ts): hold the ship there. Levels add their radio call.
  protected onPlayerLanded(): void {
    this.player?.setCurrentSpeed(0);
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

    this.graphics?.destroy();

    // Freeze the world where the ship was lost instead of wiping it: the
    // missile, the rock or the opponent that did it is the thing worth looking
    // at, and a blank screen teaches nothing. The scene's update has already
    // stopped (no player); this stops the bodies too. A restart builds a
    // fresh Matter world, so the pause does not carry over.
    this.matter.world.pause();

    this.showOutcome('SHIP DESTROYED', '#ff0000');
  }

  // The scenario's closing line — loss of the ship here, a mission's own
  // pass/fail verdict in the campaign levels — pinned to the camera centre,
  // with the keys that leave it.
  protected showOutcome(text: string, color: string): void {
    const cam = this.cameras.main;
    this.add.text(cam.centerX, cam.centerY, text, {
      font: '32px Courier',
      color,
      align: 'center',
      backgroundColor: '#000000aa',
      padding: { x: 20, y: 12 },
      wordWrap: { width: Math.min(cam.width - 80, 800) },
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(1000);
    this.add.text(cam.centerX, cam.centerY + 60, this.outcomeHint(), {
      font: '18px Courier',
      color: '#aaaaaa',
      backgroundColor: '#000000aa',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000);
  }

  // The line under the verdict naming the keys out of it. Free play has only
  // the menu; the campaign adds retry and next.
  protected outcomeHint(): string {
    return 'M / SELECT  menu';
  }

  // Whether the scenario can be won: free play's practice scenarios end when
  // everything hostile in them is destroyed; the open skirmish never ends.
  protected hasObjective(): boolean {
    return this.scenario === 'duel' || this.scenario === 'occluded';
  }
}
