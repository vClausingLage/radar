import Phaser from 'phaser';
import { PlayerShip, Side, Target } from './ship';
import { Vector2 } from '../types';
import { Radar } from '../radar/systems/radar';
import { InterfaceRenderer } from '../radar/renderer/interfaceRenderer';
import { RadarRenderer } from '../radar/renderer/radarRenderer';
import { TerrainRenderer } from '../radar/renderer/terrainRenderer';
import { ReceiverVideoRenderer } from '../radar/renderer/receiverVideoRenderer';
import { AiUnitController, UnitActivity } from '../controller/aiUnitController';
import { JevTactician } from '../controller/jevTactician';
import { PlayerController } from '../controller/playerController';
import { targetShipSettings } from '../settings';

/* eslint-disable @typescript-eslint/no-namespace */

// `activity` tags whether the unit is under way ('active', the default) or a
// stationary emplacement ('inactive') that holds position and heading while its
// radar, jammer and weapons keep working. `side` defaults to hostile. `route`
// hands a cargo ship a fixed itinerary — a flight from A to B with a
// destination — instead of the endless loop it otherwise flies. `brain` picks
// who makes the tactical calls: the scripted doctrine or Jev, the decision
// model behind the dev server's /api/jev proxy; unset, it is
// targetShipSettings.CRUISER_BRAIN. Jev is DEV-only — a production build has
// no proxy to hold the key — and cruiser-only: cargo never fights, so it has
// nothing to decide.
export type TargetParams = {
  x: number;
  y: number;
  direction: number;
  speed: number;
  type: 'cruiser' | 'cargo';
  activity?: UnitActivity;
  side?: Side;
  route?: Vector2[];
  brain?: 'scripted' | 'jev';
};

declare global {
  namespace Phaser.GameObjects {
    interface GameObjectFactory {
      playerShip(params: { x: number; y: number; direction: number; speed: number }): PlayerShip;
      target(params: TargetParams): Target;
    }
  }
}

export const createPlayerShipFactory = () => {
  Phaser.GameObjects.GameObjectFactory.register('playerShip', function(
    this: Phaser.GameObjects.GameObjectFactory,
    params: { x: number; y: number; direction: number; speed: number }
  ) {
    const ship = new PlayerShip({
      scene: this.scene,
      ...params,
      radar: new Radar({
        scene: this.scene,
      }),
    });
    const controller = new PlayerController(this.scene, ship);
    ship.controller = controller;
    if (!ship.body) throw new Error('Ship body is undefined');
    const playerMissileNoCollideGroup = this.scene.matter.world.nextGroup(true);
    ship.setMissileNoCollideGroup(playerMissileNoCollideGroup);
    // Matter physics doesn't use onCollide flag like Arcade
    ship.radar.attachTo(ship);
    ship.radar.start();

    // Only the player's radar renders; target radars track silently.
    const radarRenderer = new RadarRenderer();
    radarRenderer.setScene(this.scene);
    ship.radar.setRadarRenderer(radarRenderer);
    // Ground-mapping display for terrain returns (player-only, like above).
    ship.radar.setTerrainRenderer(new TerrainRenderer());
    // Receiver video ring: the raw echo and jamming power around the ship,
    // before the detector has judged it (player-only, like above).
    ship.radar.setReceiverVideoRenderer(new ReceiverVideoRenderer(this.scene));

    const interfaceRenderer = new InterfaceRenderer(this.scene, ship);
    interfaceRenderer.createInterface(ship);
    ship.radar.setInterfaceRenderer(interfaceRenderer);
    (this.scene as Phaser.Scene & { interfaceRenderer?: InterfaceRenderer }).interfaceRenderer = interfaceRenderer;

    ship.addToDisplayList();
    ship.addToUpdateList();
    return ship;
  });

  Phaser.GameObjects.GameObjectFactory.register('target', function(
    this: Phaser.GameObjects.GameObjectFactory,
    params: TargetParams
  ) {
    const target = new Target({
      scene: this.scene,
      ...params,
      radar: new Radar({
        scene: this.scene,
      }),
      shipType: params.type,
      side: params.side,
    });
    if (!target.body) throw new Error('Target body is undefined');
    const targetMissileNoCollideGroup = this.scene.matter.world.nextGroup(true);
    target.setMissileNoCollideGroup(targetMissileNoCollideGroup);
    target.addToDisplayList();
    target.addToUpdateList();
    const brain = params.brain ?? targetShipSettings.CRUISER_BRAIN;
    const useJev = brain === 'jev' && params.type === 'cruiser' && import.meta.env.DEV;
    const controller = new AiUnitController(
      this.scene, target, 0, false, target.radar, target.id, params.activity ?? 'active',
      useJev ? new JevTactician() : null,
    );
    if (params.type === 'cargo') {
      controller.setTurnRate(targetShipSettings.TURN_RATE_CARGO);
    }
    if (params.type === 'cruiser') {
      controller.setTurnRate(targetShipSettings.TURN_RATE_CRUISER);
    }
    if (params.route) {
      controller.setRoute(params.route);
    }
    target.controller = controller;
    target.radar.setLoadout(targetShipSettings.LOADOUT);
    target.radar.attachTo(target);
    target.radar.start();
    // An AI set runs its IFF by itself: it asks on a cadence and will not
    // release on a track that answered friendly.
    target.radar.setIffAutonomous(true);
    return target;
  });
};