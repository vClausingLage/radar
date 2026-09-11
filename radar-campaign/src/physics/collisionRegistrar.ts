import Phaser from "phaser";
import { PlayerShip, Target } from "../entities/ship";
import { Asteroid } from "../entities/asteroid";
import { Structure } from "../entities/structure";
import { PhysicsRenderer } from "./renderer/physicsRenderer";
import { assessTouchdown, touchdownSpeed } from "./landing";
import { landingSettings } from "../settings";
import type { Missile } from "../entities/missiles";

export type CollisionDependencies = {
  scene: Phaser.Scene;
  player: PlayerShip;
  physicsRenderer: PhysicsRenderer;
  destroyPlayer: () => void;
  // The player has set down on ground by the book (see physics/landing.ts).
  onPlayerLanded: () => void;
};

type CollisionGameObject = PlayerShip | Target | Missile | Phaser.GameObjects.GameObject;

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

      pairs.forEach((pair) => {
        const bodyA = pair.bodyA;
        const bodyB = pair.bodyB;
        const gameObjectA = bodyA.gameObject as CollisionGameObject | undefined;
        const gameObjectB = bodyB.gameObject as CollisionGameObject | undefined;

        if (!gameObjectA || !gameObjectB) return;

        // Ship-Terrain contact: a landing, a crash, or a bump — see
        // shipMeetsTerrain().
        if (this.isShip(gameObjectA) && this.isTerrain(gameObjectB)) {
          this.shipMeetsTerrain(gameObjectA, gameObjectB, destroyShipOnce);
        } else if (this.isTerrain(gameObjectA) && this.isShip(gameObjectB)) {
          this.shipMeetsTerrain(gameObjectB, gameObjectA, destroyShipOnce);
        }

        // Ship-Ship collision
        else if (this.isShip(gameObjectA) && this.isShip(gameObjectB)) {
          destroyShipOnce(gameObjectA as PlayerShip | Target);
          destroyShipOnce(gameObjectB as PlayerShip | Target);
        }

        // Missile-Terrain collision. Ground is below flight level — a missile
        // passes over a pad (and is not lost the instant it leaves a ship
        // parked on one); only rocks and towers stop it.
        else if (this.isMissile(gameObjectA) && this.isObstacle(gameObjectB)) {
          destroyMissileOnce(gameObjectA as Missile);
        } else if (this.isObstacle(gameObjectA) && this.isMissile(gameObjectB)) {
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

  private isShip(obj: unknown): obj is PlayerShip | Target {
    return obj instanceof PlayerShip || obj instanceof Target;
  }

  private isTerrain(obj: unknown): obj is Asteroid | Structure {
    return obj instanceof Asteroid || obj instanceof Structure;
  }

  // Ground a ship can set down on, as opposed to something it can only hit.
  private isGround(obj: unknown): obj is Structure {
    return obj instanceof Structure && !obj.obstacle;
  }

  private isObstacle(obj: unknown): obj is Asteroid | Structure {
    return this.isTerrain(obj) && !this.isGround(obj);
  }

  // What a hull meeting terrain means, by the landing rules in
  // physics/landing.ts. Ground: a slow, tail-first arrival is a landing,
  // anything else a crash. An obstacle: fatal at speed, at a crawl the hull
  // just fetches up against it. Only the player lands by hand — AI traffic
  // sets down by its route script (CampaignLevel.landShip) and otherwise never
  // reaches the ground, so its ground contacts are left alone.
  private shipMeetsTerrain(
    ship: PlayerShip | Target,
    terrain: Asteroid | Structure,
    destroyShipOnce: (ship: PlayerShip | Target) => void,
  ): void {
    if (this.isGround(terrain)) {
      if (ship !== this.deps.player) return;
      if (assessTouchdown(ship) === 'landed') this.deps.onPlayerLanded();
      else destroyShipOnce(ship);
      return;
    }
    if (touchdownSpeed(ship) > landingSettings.MAX_TOUCHDOWN_SPEED) destroyShipOnce(ship);
    else ship.setCurrentSpeed(0);
  }

  private isMissile(obj: unknown): obj is Missile {
    if (!obj || typeof obj !== 'object') return false;
    const maybeWithTexture = obj as { texture?: { key?: string } };
    return maybeWithTexture.texture?.key === 'missile';
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
