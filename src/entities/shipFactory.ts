import Phaser from 'phaser';
import { PlayerShip, Target } from './ship';
import { LightRadar } from '../radar/systems/lightRadar';
import { AiUnitController } from '../controller/aiUnitController';
import { PlayerController } from '../controller/playerController';

declare global {
  namespace Phaser.GameObjects {
    interface GameObjectFactory {
      playerShip(params: { x: number; y: number; direction: number; speed: number; radar: LightRadar }): PlayerShip;
      target(params: { x: number; y: number; direction: number; speed: number; type: 'cruiser' | 'cargo'; radar: LightRadar; id: number }): Target;
    }
  }
}

export const createPlayerShipFactory = (_scene: Phaser.Scene) => {
  Phaser.GameObjects.GameObjectFactory.register('playerShip', function(
    this: Phaser.GameObjects.GameObjectFactory,
    params: { x: number; y: number; direction: number; speed: number; radar: LightRadar }
  ) {
    const ship = new PlayerShip({ scene: this.scene, ...params });
    const controller = new PlayerController(this.scene, ship);
    ship.controller = controller;
    if (!ship.body) throw new Error('Ship body is undefined');
    ship.body.onCollide = true;
    ship.radar.attachTo(ship);
    ship.radar.start();
    (this.scene as any).shipGroup?.add(ship);
    ship.addToDisplayList();
    ship.addToUpdateList();
    return ship;
  });

  Phaser.GameObjects.GameObjectFactory.register('target', function(
    this: Phaser.GameObjects.GameObjectFactory,
    params: { x: number; y: number; direction: number; speed: number; type: 'cruiser' | 'cargo'; radar: LightRadar; id: number }
  ) {
    const target = new Target({
      scene: this.scene,
      ...params,
      shipType: params.type,
    });
    if (!target.body) throw new Error('Target body is undefined');
    target.body.onCollide = true;
    (this.scene as any).shipGroup?.add(target);
    target.addToDisplayList();
    target.addToUpdateList();
    const controller = new AiUnitController(this.scene, target);
    if (params.type === 'cargo') {
      controller.setTurnRate(2);
    }
    if (params.type === 'cruiser') {
      controller.setTurnRate(5);
    }
    target.controller = controller;
    // target.radar.attachTo(target);
    // target.radar.start();
    return target;
  });
};