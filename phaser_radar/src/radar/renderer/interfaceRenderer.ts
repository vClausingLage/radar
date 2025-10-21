import { LightRadar } from "../systems/lightRadar";

export class InterfaceRenderer {
    private sttBtn?: Phaser.GameObjects.Text;
    private rwsBtn?: Phaser.GameObjects.Text;
    private twsBtn?: Phaser.GameObjects.Text;
    private emconBtn?: Phaser.GameObjects.Text;
    private shootBtn?: Phaser.GameObjects.Text;

    constructor(private scene: Phaser.Scene) {}

    createInterface(radar: LightRadar, ship: Phaser.Physics.Arcade.Image) {
        const camera = this.scene.cameras.main;
        
        // STT Button
        this.sttBtn = this.scene.add.text(20, camera.height - 50, 'STT', { 
            font: '22px Courier',
            color: '#000',
            backgroundColor: '#ffdb4d',
            padding: { x: 10, y: 5 }
        })
        .setInteractive()
        .setOrigin(0)
        .setScrollFactor(0)
        .on('pointerdown', () => {
            if (radar.getTracks().length === 0) return;
            radar.setMode('stt');
        });

        // RWS Button
        this.rwsBtn = this.scene.add.text(100, camera.height - 50, 'RWS', { 
            font: '22px Courier', 
            color: '#000', 
            backgroundColor: radar.getMode() === 'rws' ? '#00ff00' : '#ffdb4d',
            padding: { x: 10, y: 5 } 
        })
        .setInteractive()
        .setOrigin(0)
        .setScrollFactor(0)
        .on('pointerdown', () => {
            radar.setTracks([]);
            radar.setMode('rws');
        });

        // TWS Button (commented out in original)
        // this.twsBtn = this.scene.add.text(200, camera.height - 50, 'TWS', { 
        //     font: '22px Courier', 
        //     color: '#000', 
        //     backgroundColor: radar.getMode() === 'tws' ? '#00ff00' : '#ffdb4d', 
        //     padding: { x: 10, y: 5 }
        // })
        // .setInteractive()
        // .setOrigin(0)
        // .setScrollFactor(0)
        // .on('pointerdown', () => {
        //     radar.setMode('tws');
        // });

        // EMCON Button
        // this.emconBtn = this.scene.add.text(300, camera.height - 50, 'EMCON', {
        //     font: '22px Courier',
        //     color: '#000',
        //     backgroundColor: radar.getMode() === 'emcon' ? '#00ff00' : '#ffdb4d',
        //     padding: { x: 10, y: 5 }
        // })
        // .setInteractive()
        // .setOrigin(0)
        // .setScrollFactor(0)
        // .on('pointerdown', () => {
        //     radar.setMode('emcon');
        // });

        // Shoot Button
        this.shootBtn = this.scene.add.text(400, camera.height - 50, 'SHOOT', {
            font: '22px Courier',
            color: '#000',
            backgroundColor: '#ffdb4d',
            padding: { x: 10, y: 5 }
        })
        .setInteractive()
        .setOrigin(0)
        .setScrollFactor(0)
        .on('pointerdown', () => {
            radar.shoot((ship.angle || 0) - 90);
        });

        // RWR Display
        this.scene.add.image(60, 80, 'rwr').setScrollFactor(0);
        this.scene.add.text(75, 135, 'RWR', { font: '18px Courier', color: '#00ff00' }).setScrollFactor(0);
    }

    updateButtonColors(radar: LightRadar) {
        const mode = radar.getMode();
        const defaultColor = '#ffdb4d';
        const buttonConfigs = [
            { btn: this.sttBtn, mode: 'stt', active: '#ff0000' },
            { btn: this.rwsBtn, mode: 'rws', active: '#00ff00' },
            { btn: this.twsBtn, mode: 'tws', active: '#00ff00' },
            { btn: this.emconBtn, mode: 'emcon', active: '#00ff00' },
            { btn: this.shootBtn, mode: 'stt', active: '#ed9209ff', onlyActive: true },
        ];

        buttonConfigs.forEach(cfg => {
            if (!cfg.btn) return;
            if (cfg.onlyActive) {
                cfg.btn.setBackgroundColor(mode === cfg.mode ? cfg.active : defaultColor);
            } else {
                cfg.btn.setBackgroundColor(mode === cfg.mode ? cfg.active : defaultColor);
            }
        });
    }

    destroy() {
        this.sttBtn?.destroy();
        this.rwsBtn?.destroy();
        this.twsBtn?.destroy();
        this.emconBtn?.destroy();
        this.shootBtn?.destroy();
    }
}