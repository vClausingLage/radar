import Phaser from 'phaser';
import { Asteroid } from './asteroid';
import { Vector2 } from '../types';

declare global {
  namespace Phaser.GameObjects {
    interface GameObjectFactory {
      asteroid(params: { position: Vector2; direction: number; speed: number }): Asteroid;
    }
  }
}

export const createAsteroidFactory = (scene: Phaser.Scene) => {
  Phaser.GameObjects.GameObjectFactory.register('asteroid', function(
    params: { position: Vector2; direction: number; speed: number }
  ) {
    const asteroid = new Asteroid({ scene, ...params });
    if (!asteroid.body) throw new Error('Asteroid body is undefined');
    asteroid.body.onCollide = true;
    (scene as any).asteroidGroup?.add(asteroid);
    asteroid.addToDisplayList();
    asteroid.addToUpdateList();
    return asteroid;
  });
};