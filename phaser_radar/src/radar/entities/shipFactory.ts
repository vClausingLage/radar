import Phaser from 'phaser';
import { PlayerShip, Target } from './ship';
import { LightRadar } from '../systems/lightRadar';
import { Loadout } from '../../types';
import { AiUnitController } from '../../controller/aiUnitController';

declare global {
  namespace Phaser.GameObjects {
    interface GameObjectFactory {
      playerShip(x: number, y: number, direction: number, speed: number, radar: LightRadar, loadout: Loadout): PlayerShip;
      target(x: number, y: number, direction: number, speed: number, radar: LightRadar, loadout: Loadout, id: number, controller: AiUnitController): Target;
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
    loadout: Loadout
  ) {
    const ship = new PlayerShip(this.scene, x, y, direction, speed, radar, loadout);
    this.displayList.add(ship);
    this.updateList.add(ship);
    return ship;
  });

  Phaser.GameObjects.GameObjectFactory.register('target', function(
    x: number,
    y: number,
    direction: number,
    speed: number,
    radar: LightRadar,
    loadout: Loadout,
    id: number,
    controller: AiUnitController
  ) {
    const target = new Target(this.scene, x, y, direction, speed, radar, loadout, id, controller);
    this.displayList.add(target);
    this.updateList.add(target);
    return target;
  });
};