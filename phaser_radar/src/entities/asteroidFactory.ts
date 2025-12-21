import Phaser from 'phaser';
import { Asteroid } from './asteroid';
import { Vector2 } from '../types';

declare global {
  namespace Phaser.GameObjects {
    interface GameObjectFactory {
      asteroid(position: Vector2, direction: number, speed: number): Asteroid;
    }
  }
}

export const createAsteroidFactory = (scene: Phaser.Scene) => {
  Phaser.GameObjects.GameObjectFactory.register('asteroid', function(
    position: Vector2,
    direction: number,
    speed: number
  ) {
    const asteroid = new Asteroid(scene, position, direction, speed);
    // @ts-ignore
    this.displayList.add(asteroid);
    // @ts-ignore
    this.updateList.add(asteroid);
    return asteroid;
  });
};