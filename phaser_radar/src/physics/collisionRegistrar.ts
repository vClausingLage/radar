import Phaser from "phaser";
import { PlayerShip, Target } from "../entities/ship";

export type CollisionDependencies = {
  scene: Phaser.Scene;
  player: PlayerShip;
  shipGroup: Phaser.Physics.Arcade.Group;
  asteroidGroup: Phaser.Physics.Arcade.Group;
  missileGroup: Phaser.Physics.Arcade.Group;
  destroyPlayer: () => void;
};

export class CollisionRegistrar {
  constructor(private readonly deps: CollisionDependencies) {}

  register(): void {
    const { scene, shipGroup, asteroidGroup, missileGroup } = this.deps;

    scene.physics.add.collider(shipGroup, asteroidGroup, (shipObj) => {
      const ship = shipObj as PlayerShip | Target;
      this.handleShipDestruction(ship);
    });

    scene.physics.add.collider(shipGroup, shipGroup, (objA, objB) => {
      const shipA = objA as PlayerShip | Target;
      const shipB = objB as PlayerShip | Target;
      this.handleShipDestruction(shipA);
      this.handleShipDestruction(shipB);
    });

    scene.physics.add.collider(missileGroup, asteroidGroup, (missileObj) => {
      const missile = missileObj as Phaser.Physics.Arcade.Sprite;
      missile.destroy();
    });

    scene.physics.add.collider(missileGroup, shipGroup, (missileObj, shipObj) => {
      const missile = missileObj as Phaser.Physics.Arcade.Sprite;
      const ship = shipObj as PlayerShip | Target;
      missile.destroy();
      this.handleShipDestruction(ship);
    });
  }

  private handleShipDestruction(ship: PlayerShip | Target): void {
    if (ship === this.deps.player) {
      this.deps.destroyPlayer();
      return;
    }

    ship.destroy();
  }
}
