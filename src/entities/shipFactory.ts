import Phaser from 'phaser';
import { PlayerShip, Target } from './ship';
import { Radar } from '../radar/systems/radar';
import { InterfaceRenderer } from '../radar/renderer/interfaceRenderer';
import { RadarRenderer } from '../radar/renderer/radarRenderer';
import { AiUnitController } from '../controller/aiUnitController';
import { PlayerController } from '../controller/playerController';
import { targetShipSettings } from '../settings';

/* eslint-disable @typescript-eslint/no-namespace */

declare global {
  namespace Phaser.GameObjects {
    interface GameObjectFactory {
      playerShip(params: { x: number; y: number; direction: number; speed: number }): PlayerShip;
      target(params: { x: number; y: number; direction: number; speed: number; type: 'cruiser' | 'cargo' }): Target;
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
    params: { x: number; y: number; direction: number; speed: number; type: 'cruiser' | 'cargo' }
  ) {
    const target = new Target({
      scene: this.scene,
      ...params,
      radar: new Radar({
        scene: this.scene,
      }),
      shipType: params.type,
    });
    if (!target.body) throw new Error('Target body is undefined');
    const targetMissileNoCollideGroup = this.scene.matter.world.nextGroup(true);
    target.setMissileNoCollideGroup(targetMissileNoCollideGroup);
    target.addToDisplayList();
    target.addToUpdateList();
    const controller = new AiUnitController(this.scene, target, 0, false, target.radar, target.id);
    if (params.type === 'cargo') {
      controller.setTurnRate(targetShipSettings.TURN_RATE_CARGO);
    }
    if (params.type === 'cruiser') {
      controller.setTurnRate(targetShipSettings.TURN_RATE_CRUISER);
    }
    target.controller = controller;
    target.radar.setLoadout(targetShipSettings.LOADOUT);
    target.radar.attachTo(target);
    target.radar.start();
    return target;
  });
};