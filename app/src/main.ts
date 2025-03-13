import Phaser from "phaser";

class Broomster extends Phaser.Scene
{
  preload ()
  {
    // this.load.setBaseURL('https://cdn.phaserfiles.com/v385');

    this.load.image('ship', 'ship.png');
    this.load.image('rwr', 'screen.png');
    this.load.image('radar', 'screen.png');
    this.load.image('track', 'track.png');
    this.load.image('target', 'target.png');
  }

  create ()
  {
    // this.add.image(400, 300, 'sky');

    // const particles = this.add.particles(0, 0, 'red', {
    //     speed: 100,
    //     scale: { start: 1, end: 0 },
    //     blendMode: 'ADD'
    // });

    const ship = this.physics.add.image(500, 500, 'ship');
    this.add.image(50, 450, 'rwr');
    this.add.text(3, 380, 'RWR', { font: '16px Courier', color: '#00ff00' });
    this.add.image(950, 450, 'radar');
    this.add.text(903, 380, 'RADAR', { font: '16px Courier', color: '#00ff00' });

    ship.setVelocity(0, 0);
    ship.setBounce(1, 1);
    ship.setCollideWorldBounds(true);

    // particles.startFollow(logo);
  }

  update ()
  {
    
  }
}

const config = {
    type: Phaser.AUTO,
    width: 1000,
    height: 500,
    scene: Broomster,
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { x: 0, y: 0 }
        }
    },
};

new Phaser.Game(config);