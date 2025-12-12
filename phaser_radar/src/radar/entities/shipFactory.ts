import Phaser from 'phaser';
import { PlayerShip, Target } from './ship';
import { LightRadar } from '../systems/lightRadar';
import { AiUnitController } from '../../controller/aiUnitController';

declare global {
  namespace Phaser.GameObjects {
    interface GameObjectFactory {
      playerShip(scene: Phaser.Scene, x: number, y: number, direction: number, speed: number, radar: LightRadar): PlayerShip;
      target(scene: Phaser.Scene, x: number, y: number, direction: number, speed: number, radar: LightRadar, id: number, controller: AiUnitController): Target;
    }
  }
}

export const createShipFactory = (scene: Phaser.Scene) => {
  Phaser.GameObjects.GameObjectFactory.register('playerShip', function(
    x: number,
    y: number,
    direction: number,
    speed: number,
    radar: LightRadar,
  ) {
    const ship = new PlayerShip(scene, x, y, direction, speed, radar);
    ship.addToDisplayList();
    ship.addToUpdateList();
    return ship;
  });

  Phaser.GameObjects.GameObjectFactory.register('target', function(
    x: number,
    y: number,
    direction: number,
    speed: number,
    radar: LightRadar,
    id: number,
    controller: AiUnitController
  ) {
    const target = new Target(scene, x, y, direction, speed, radar, id, controller);
    target.addToDisplayList();
    target.addToUpdateList();
    return target;
  });
};