import Phaser from "phaser";
import { PlayerShip, Target } from "../entities/ship";
import { PhysicsRenderer } from "./renderer/physicsRenderer";
import type { Missile } from "../entities/missiles";

export type CollisionDependencies = {
  scene: Phaser.Scene;
  player: PlayerShip;
  shipCategory: number;
  asteroidCategory: number;
  missileCategory: number;
  physicsRenderer: PhysicsRenderer;
  destroyPlayer: () => void;
};

export class CollisionRegistrar {
  constructor(private readonly deps: CollisionDependencies) {}

  register(): void {
    const { scene } = this.deps;

    // Matter physics uses event-based collision detection
    scene.matter.world.on('collisionstart', (event: Phaser.Physics.Matter.Events.CollisionStartEvent) => {
      const pairs = event.pairs;
      const destroyedThisEvent = new Set<PlayerShip | Target>();
      const destroyedMissilesThisEvent = new Set<Missile>();

      const destroyShipOnce = (ship: PlayerShip | Target): void => {
        if (destroyedThisEvent.has(ship)) return;
        destroyedThisEvent.add(ship);
        this.handleShipDestruction(ship);
      };

      const destroyMissileOnce = (missile: Missile): void => {
        if (destroyedMissilesThisEvent.has(missile)) return;
        if (!missile.active || !missile.scene) return;
        destroyedMissilesThisEvent.add(missile);
        missile.destroy();
      };

      pairs.forEach((pair: any) => {
        const bodyA = pair.bodyA;
        const bodyB = pair.bodyB;
        const gameObjectA = (bodyA as any).gameObject;
        const gameObjectB = (bodyB as any).gameObject;

        if (!gameObjectA || !gameObjectB) return;

        // Ship-Asteroid collision
        if (this.isShip(gameObjectA) && this.isAsteroid(gameObjectB)) {
          destroyShipOnce(gameObjectA as PlayerShip | Target);
        } else if (this.isAsteroid(gameObjectA) && this.isShip(gameObjectB)) {
          destroyShipOnce(gameObjectB as PlayerShip | Target);
        }

        // Ship-Ship collision
        else if (this.isShip(gameObjectA) && this.isShip(gameObjectB)) {
          destroyShipOnce(gameObjectA as PlayerShip | Target);
          destroyShipOnce(gameObjectB as PlayerShip | Target);
        }

        // Missile-Asteroid collision
        else if (this.isMissile(gameObjectA) && this.isAsteroid(gameObjectB)) {
          destroyMissileOnce(gameObjectA as Missile);
        } else if (this.isAsteroid(gameObjectA) && this.isMissile(gameObjectB)) {
          destroyMissileOnce(gameObjectB as Missile);
        }

        // Missile-Ship collision
        else if (this.isMissile(gameObjectA) && this.isShip(gameObjectB)) {
          const missile = gameObjectA as Missile;
          const ship = gameObjectB as PlayerShip | Target;
          // Skip collision if the ship is the missile's owner
          if (missile.owner !== ship) {
            destroyMissileOnce(missile);
            destroyShipOnce(ship);
          }
        } else if (this.isShip(gameObjectA) && this.isMissile(gameObjectB)) {
          const missile = gameObjectB as Missile;
          const ship = gameObjectA as PlayerShip | Target;
          // Skip collision if the ship is the missile's owner
          if (missile.owner !== ship) {
            destroyMissileOnce(missile);
            destroyShipOnce(ship);
          }
        }
      });
    });
  }

  private isShip(obj: any): boolean {
    return obj instanceof PlayerShip || obj instanceof Target;
  }

  private isAsteroid(obj: any): boolean {
    return obj.texture?.key === 'asteroid';
  }

  private isMissile(obj: any): boolean {
    return obj.texture?.key === 'missile';
  }

  private handleShipDestruction(ship: PlayerShip | Target): void {
    // Skip if this ship has already been destroyed or detached from the scene.
    if (!ship.active || !ship.scene) {
      return;
    }

    this.deps.physicsRenderer.spawnExplosion(ship.x, ship.y);

    if (ship === this.deps.player) {
      this.deps.destroyPlayer();
      return;
    }

    ship.setActive(false);
    ship.destroy();
  }
}
