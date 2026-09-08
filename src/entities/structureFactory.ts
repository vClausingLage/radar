import Phaser from 'phaser';
import { Structure } from './structure';
import { Vector2 } from '../types';

/* eslint-disable @typescript-eslint/no-namespace */

type StructureParams = {
  position: Vector2;
  anchor?: Vector2;
  texture: string;
  scale?: number;
  outline?: Vector2[];
  obstacle?: boolean;
};

declare global {
  namespace Phaser.GameObjects {
    interface GameObjectFactory {
      structure(params: StructureParams): Structure;
    }
  }
}

export const createStructureFactory = () => {
  Phaser.GameObjects.GameObjectFactory.register('structure', function(
    this: Phaser.GameObjects.GameObjectFactory,
    params: StructureParams
  ) {
    const structure = new Structure({ scene: this.scene, ...params });
    if (!structure.body) throw new Error('Structure body is undefined');
    return structure;
  });
};
