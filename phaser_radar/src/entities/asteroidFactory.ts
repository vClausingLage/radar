import Phaser from 'phaser';
import { Asteroid } from './asteroid';
import { Vector2 } from '../../types';

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
    const asteroid = new Asteroid(this.scene, position, direction, speed);
    this.displayList.add(asteroid);
    this.updateList.add(asteroid);
    return asteroid;
  });
};