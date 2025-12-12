import Phaser from 'phaser';

export default class StartMenu extends Phaser.Scene {
    constructor() {
        super('StartMenu');
    }

    preload() {
    }

    create() {
        // Title
        this.add.text(this.scale.width / 2, 100, 'RADAR GAME', {
            fontSize: '48px',
            color: '#ffffff'
        }).setOrigin(0.5);

        // Start button
        const startButton = this.add.text(this.scale.width / 2, this.scale.height / 2, 'START GAME', {
            fontSize: '32px',
            color: '#ffffff',
            backgroundColor: '#000000',
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setInteractive();

        startButton.on('pointerdown', () => {
            this.scene.start('Main');
        });

        startButton.on('pointerover', () => {
            startButton.setStyle({ backgroundColor: '#333333' });
        });

        startButton.on('pointerout', () => {
            startButton.setStyle({ backgroundColor: '#000000' });
        });

        // How To button
        const howToButton = this.add.text(this.scale.width / 2, this.scale.height / 2 + 80, 'HOW TO PLAY', {
            fontSize: '32px',
            color: '#ffffff',
            backgroundColor: '#000000',
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setInteractive();

        howToButton.on('pointerdown', () => {
            this.showHowTo();
        });

        howToButton.on('pointerover', () => {
            howToButton.setStyle({ backgroundColor: '#333333' });
        });

        howToButton.on('pointerout', () => {
            howToButton.setStyle({ backgroundColor: '#000000' });
        });
    }

    showHowTo() {
        const howToText = this.add.text(this.scale.width / 2, this.scale.height / 2, 
            'HOW TO PLAY:\n\n' +
            '- Use arrow keys to move\n' +
            '- Avoid obstacles\n' +
            '- Reach the goal\n\n' +
            'Click here to close', {
            fontSize: '24px',
            color: '#ffffff',
            backgroundColor: '#000000',
            padding: { x: 30, y: 20 },
            align: 'center'
        }).setOrigin(0.5).setInteractive();

        howToText.on('pointerdown', () => {
            howToText.destroy();
        });
    }
}