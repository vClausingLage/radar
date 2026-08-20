import Phaser from 'phaser';
import { GasCloud, GasCloudParams } from './gasCloud';

/* eslint-disable @typescript-eslint/no-namespace */

type GasCloudFactoryParams = Omit<GasCloudParams, 'scene'>;

declare global {
  namespace Phaser.GameObjects {
    interface GameObjectFactory {
      gasCloud(params: GasCloudFactoryParams): GasCloud;
    }
  }
}

export const createGasCloudFactory = () => {
  Phaser.GameObjects.GameObjectFactory.register('gasCloud', function(
    this: Phaser.GameObjects.GameObjectFactory,
    params: GasCloudFactoryParams
  ) {
    const cloud = new GasCloud({ scene: this.scene, ...params });
    cloud.addToDisplayList();
    // No update list: the scene drives the spread and the puff drift from its
    // own loop, alongside the other per-frame world state the radar reads.
    return cloud;
  });
};
