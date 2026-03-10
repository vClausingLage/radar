import Phaser from 'phaser';
import { SARHMissile, ActiveRadarMissile } from './missiles';
import type { Ship } from './ship';

const missileCategoryByScene = new WeakMap<Phaser.Scene, number>();

const getMissileCollisionCategory = (scene: Phaser.Scene): number => {
  let category = missileCategoryByScene.get(scene);
  if (!category) {
    category = scene.matter.world.nextCategory();
    missileCategoryByScene.set(scene, category);
  }
  return category;
};

const configureMissileCollisionFilter = (scene: Phaser.Scene, missile: Phaser.Physics.Matter.Sprite): void => {
  const missileCategory = getMissileCollisionCategory(scene);
  missile.setCollisionCategory(missileCategory);
  // Collide with everything except missiles.
  missile.setCollidesWith((~missileCategory) >>> 0);
};

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
    configureMissileCollisionFilter(this.scene, missile);
    // Matter physics doesn't use onCollide flag like Arcade
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
    configureMissileCollisionFilter(this.scene, missile);
    // Matter physics doesn't use onCollide flag like Arcade
    missile.addToDisplayList();
    missile.addToUpdateList();
    return missile;
  });
};
