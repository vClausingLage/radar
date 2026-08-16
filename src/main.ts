import Phaser from "phaser";
import StartMenu from "./scenes/startMenu";
import Game from "./scenes/game";
import Level1 from "./scenes/level1";

const debugConfig = import.meta.env.DEV ? {
  showBody: true,
  showStaticBody: true,
  showVelocity: true,
  velocityColor: 0x00aeef,
  showCollisions: true,
  collisionColor: 0xf5950c,
  renderFill: false,
  renderLine: true,
  lineColor: 0x28de19,
  lineOpacity: 1,
  lineThickness: 1
} : false;

const config = {
  type: Phaser.AUTO,
  scene: [StartMenu, Game, Level1],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight
  },
  physics: {
    default: 'matter',
    matter: {
      gravity: { x: 0, y: 0 },
      debug: debugConfig
    }
  },
};

const game = new Phaser.Game(config);

// DEV-only: expose the game instance for debugging/automation from the console.
if (import.meta.env.DEV) {
  (window as unknown as { game?: Phaser.Game }).game = game;
}
