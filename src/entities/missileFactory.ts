import Phaser from 'phaser';
import { SARHMissile, ActiveRadarMissile } from './missiles';
import type { Ship } from './ship';

declare global {
  namespace Phaser.GameObjects {
    interface GameObjectFactory {
      sarhMissile(params: { x: number; y: number; dirX: number; dirY: number; owner?: Ship }): SARHMissile;
      activeRadarMissile(params: { x: number; y: number; dirX: number; dirY: number; owner?: Ship }): ActiveRadarMissile;
    }
  }
}

export const createMissileFactory = (_scene: Phaser.Scene) => {
  Phaser.GameObjects.GameObjectFactory.register('sarhMissile', function(
    this: Phaser.GameObjects.GameObjectFactory,
    params: { x: number; y: number; dirX: number; dirY: number; owner?: Ship }
  ) {
    const missile = new SARHMissile(this.scene, params);
    missile.owner = params.owner;
    (this.scene as any).missileGroup?.add(missile);
    (missile.body as Phaser.Physics.Arcade.Body).onCollide = true;
    missile.addToDisplayList();
    missile.addToUpdateList();
    return missile;
  });

  Phaser.GameObjects.GameObjectFactory.register('activeRadarMissile', function(
    this: Phaser.GameObjects.GameObjectFactory,
    params: { x: number; y: number; dirX: number; dirY: number; owner?: Ship }
  ) {
    const missile = new ActiveRadarMissile(this.scene, params);
    missile.owner = params.owner;
    (this.scene as any).missileGroup?.add(missile);
    (missile.body as Phaser.Physics.Arcade.Body).onCollide = true;
    missile.addToDisplayList();
    missile.addToUpdateList();
    return missile;
  });
};
