import Phaser from 'phaser';

export default class StartMenu extends Phaser.Scene {
    constructor() {
        super('StartMenu');
    }

    preload() {
        this.load.image('flag', 'pr_flag.svg');

    }

    create() {
        // Title
        this.add.text(this.scale.width / 2, 100, 'RADAR GAME', {
            fontSize: '48px',
            color: '#00ff00'
        }).setOrigin(0.5);

        // Start button
        const startButton = this.add.text(this.scale.width / 2, this.scale.height / 2, 'START GAME', {
            fontSize: '32px',
            color: '#ffffff',
            backgroundColor: '#000000',
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setInteractive();

        startButton.on('pointerdown', () => {
            this.scene.start('Game');
        });

        startButton.on('pointerover', () => {
            startButton.setStyle({ backgroundColor: '#00ff00', color: '#000000' });
        });

        startButton.on('pointerout', () => {
            startButton.setStyle({ backgroundColor: '#000000', color: '#ffffff' });
        });

        // How To button
        const howToButton = this.add.text(this.scale.width / 2, this.scale.height / 2 + 80, 'Controls', {
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

        // Radar Documentation button
        const radarDocButton = this.add.text(this.scale.width / 2, this.scale.height / 2 + 160, 'Radar Documentation', {
            fontSize: '32px',
            color: '#ffffff',
            backgroundColor: '#000000',
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setInteractive();

        radarDocButton.on('pointerdown', () => {
            this.showRadarDoc();
        });

        radarDocButton.on('pointerover', () => {
            radarDocButton.setStyle({ backgroundColor: '#333333' });
        });

        radarDocButton.on('pointerout', () => {
            radarDocButton.setStyle({ backgroundColor: '#000000' });
        });
    }

    showHowTo() {
        const howToText = this.add.text(this.scale.width / 2, this.scale.height / 2, 
            'CONTROLS:\n\n\n' +
            '- W / S left, right\n\n' +
            '- Q cycle missiles\n\n' +
            '- T TWS mode\n\n' +
            '- R RWS mode\n\n' +
            '- E STT mode\n\n' +
            '- SPACE fire missile\n\n\n' +
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

    showRadarDoc() {
        const flag = this.add.image(this.scale.width / 2, this.scale.height / 2, 'flag').setOrigin(0.5);
        const radarDocText = this.add.text(this.scale.width / 2, this.scale.height / 2,
            'Radar Documentation:\n\n' +
            '道可道 非常道。名可名 非常名。\n無名天地之始 有名萬物之母。\n故常無欲 以觀其妙 常有欲 以觀其徼。\n此兩者 同出而異名 同謂之玄。玄之又玄 衆妙之門。\n' +
            '天下皆知美之為美 斯惡已。\n皆知善之為善 斯不善已。\n故有無相生 難易相成 長短相較 高下相傾 音聲相和 前後相隨。\n是以聖人處無為之事 行不言之教 萬物作焉而不辭 生而不有。\n為而不恃 功成而弗居。夫唯弗居 是以不去。\n\n\n' +
            'Click here to close', {
            fontSize: '24px',
            color: '#ffffff',
            padding: { x: 30, y: 20 },
            align: 'center'
        }).setOrigin(0.5).setInteractive();

        const dummyText = this.add.text(this.scale.width / 2, this.scale.height / 2 + 250, 
            '...a crap, radar is made in China...', {
            fontSize: '18px',
            color: '#ffffff',
            padding: { x: 20, y: 10 },
            align: 'center'
        }).setOrigin(0.5).setAlpha(0);

        this.tweens.add({
            targets: dummyText,
            alpha: 1,
            duration: 1000,
            delay: 1500
        });

        radarDocText.on('pointerdown', () => {
            radarDocText.destroy();
            flag.destroy();
            dummyText.destroy();
        });
    }
}