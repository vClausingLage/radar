import Phaser from 'phaser';
import { PlayerShip, Target } from './ship';
import { LightRadar } from '../radar/systems/lightRadar';
import { AiUnitController } from '../controller/aiUnitController';

declare global {
  namespace Phaser.GameObjects {
    interface GameObjectFactory {
      playerShip(x: number, y: number, direction: number, speed: number, radar: LightRadar): PlayerShip;
      target(x: number, y: number, direction: number, speed: number, radar: LightRadar, id: number, controller: AiUnitController): Target;
    }
  }
}

export const createShipFactory = (_scene: Phaser.Scene) => {
  Phaser.GameObjects.GameObjectFactory.register('playerShip', function(
    this: Phaser.GameObjects.GameObjectFactory,
    x: number,
    y: number,
    direction: number,
    speed: number,
    radar: LightRadar,
  ) {
    const ship = new PlayerShip(this.scene, x, y, direction, speed, radar);
    ship.addToDisplayList();
    ship.addToUpdateList();
    return ship;
  });

  Phaser.GameObjects.GameObjectFactory.register('target', function(
    this: Phaser.GameObjects.GameObjectFactory,
    x: number,
    y: number,
    direction: number,
    speed: number,
    radar: LightRadar,
    id: number,
    controller: AiUnitController
  ) {
    const target = new Target(this.scene, x, y, direction, speed, radar, id, controller);
    target.addToDisplayList();
    target.addToUpdateList();
    return target;
  });
};