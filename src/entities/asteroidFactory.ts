import Phaser from 'phaser';
import { Asteroid } from './asteroid';
import { Vector2 } from '../types';

/* eslint-disable @typescript-eslint/no-namespace */

declare global {
  namespace Phaser.GameObjects {
    interface GameObjectFactory {
      asteroid(params: { position: Vector2; direction: number; speed: number }): Asteroid;
    }
  }
}

export const createAsteroidFactory = () => {
  Phaser.GameObjects.GameObjectFactory.register('asteroid', function(
    this: Phaser.GameObjects.GameObjectFactory,
    params: { position: Vector2; direction: number; speed: number }
  ) {
    const asteroid = new Asteroid({ scene: this.scene, ...params });
    if (!asteroid.body) throw new Error('Asteroid body is undefined');
    // Matter physics doesn't use onCollide flag like Arcade
    asteroid.addToDisplayList();
    asteroid.addToUpdateList();
    return asteroid;
  });
};