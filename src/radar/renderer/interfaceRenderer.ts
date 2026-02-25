import { LightRadar } from "../systems/lightRadar";

export class InterfaceRenderer {
    private sttBtn?: Phaser.GameObjects.Text;
    private rwsBtn?: Phaser.GameObjects.Text;
    private twsBtn?: Phaser.GameObjects.Text;
    private shootBtn?: Phaser.GameObjects.Text;
    private warningText?: Phaser.GameObjects.Text;
    private lockWarningText?: Phaser.GameObjects.Text;
    private playerRadar: LightRadar;

    constructor(private scene: Phaser.Scene, playerRadar: LightRadar) {
        this.playerRadar = playerRadar;
    }

    createInterface(ship: Phaser.Physics.Arcade.Image): void {
        // TWS BTN
        this.twsBtn = this.scene.add.text(0, 0, 'TWS', { 
            font: '22px Courier', 
            color: '#000',
            backgroundColor: '#ffdb4d',
            padding: { x: 10, y: 5 } 
        })
        .setInteractive()
        .setOrigin(0)
        .on('pointerdown', () => {
            this.playerRadar.setMode('tws');
        });
        // STT BTN
        this.sttBtn = this.scene.add.text(0, 0, 'STT', { 
            font: '22px Courier',
            color: '#000',
            backgroundColor: '#ffdb4d',
            padding: { x: 10, y: 5 }
        })
        .setInteractive()
        .setOrigin(0)
        .on('pointerdown', () => {
            if (this.playerRadar.getTracks().length === 0) return;
            this.playerRadar.setMode('stt');
        });
        // RWS BTN
        this.rwsBtn = this.scene.add.text(0, 0, 'RWS', { 
            font: '22px Courier', 
            color: '#000', 
            backgroundColor: this.playerRadar.getMode() === 'rws' ? '#00ff00' : '#ffdb4d',
            padding: { x: 10, y: 5 } 
        })
        .setInteractive()
        .setOrigin(0)
        .on('pointerdown', () => {
            this.playerRadar.setTracks([]);
            this.playerRadar.setMode('rws');
        });
        // SHOOT BTN
        this.shootBtn = this.scene.add.text(0, 0, 'SHOOT', {
            font: '22px Courier',
            color: '#000',
            backgroundColor: '#ffdb4d',
            padding: { x: 10, y: 5 }
        })
        .setInteractive()
        .setOrigin(0)
        .on('pointerdown', () => {
            this.playerRadar.shoot(ship.angle || 0);
        });

        // Warning texts
        this.warningText = this.scene.add.text(0, 0, 'RADAR WARNING', {
            font: '24px Courier',
            color: '#ff9900',
            backgroundColor: '#000000',
            padding: { x: 10, y: 5 }
        })
        .setOrigin(0.5)
        .setVisible(false);

        this.lockWarningText = this.scene.add.text(0, 0, '!!! MISSILE LOCK !!!', {
            font: '28px Courier',
            color: '#ff0000',
            backgroundColor: '#000000',
            padding: { x: 15, y: 8 }
        })
        .setOrigin(0.5)
        .setVisible(false);

        this.updateLayout(ship);
    }

    updateButtonColors(): void {
        const mode = this.playerRadar.getMode();
        const tracks = this.playerRadar.getTracks();
        const isTWSActive = mode === 'tws';
        const hasTracks = tracks.length > 0;
        if (this.sttBtn) this.sttBtn.setBackgroundColor(mode === 'stt' ? '#ff0000' : '#ffdb4d');
        if (this.rwsBtn) this.rwsBtn.setBackgroundColor(mode === 'rws' ? '#00ff00' : '#ffdb4d');
        if (this.twsBtn) this.twsBtn.setBackgroundColor(mode === 'tws' ? '#00ff00' : '#ffdb4d');
        if (this.shootBtn) this.shootBtn.setBackgroundColor(mode === 'stt' || (isTWSActive && hasTracks) ? '#ed9209' : '#ffdb4d');
    }

    updateLayout(ship: Phaser.Physics.Arcade.Image): void {
        if (!this.sttBtn || !this.rwsBtn || !this.shootBtn) return;
        const shipX = ship.x;
        const shipY = ship.y;

        // radius from getCircle if present, else half display height
        // @ts-ignore
        const circle = ship.getCircle ? ship.getCircle() : null;
        const radius = circle ? circle.radius : (ship.displayHeight / 2);

        const verticalOffset = radius + 16; // gap below ship
        const topY = shipY + verticalOffset;

        const spacingX = 12;
        const spacingY = 6;

        const sttW = this.sttBtn.width;
        const rwsW = this.rwsBtn.width;
        const rowWidth = sttW + spacingX + rwsW;

        const rowLeft = shipX - rowWidth / 2;

        this.sttBtn.setPosition(rowLeft, topY);
        this.rwsBtn.setPosition(rowLeft + sttW + spacingX, topY);

        const twsY = topY + this.sttBtn.height + spacingY;
        const twsX = shipX - (this.twsBtn!.width / 2);
        this.twsBtn!.setPosition(twsX, twsY);

        const shootY = twsY + this.twsBtn!.height + spacingY;
        const shootX = shipX - (this.shootBtn.width / 2);
        this.shootBtn.setPosition(shootX, shootY);

        // Position warning texts above ship
        if (this.warningText) {
            const warningY = shipY - 100;
            this.warningText.setPosition(shipX, warningY);
        }

        if (this.lockWarningText) {
            const lockWarningY = shipY - 140;
            this.lockWarningText.setPosition(shipX, lockWarningY);
        }
    }

    updateWarnings(isTracked: boolean, isLocked: boolean): void {
        if (this.warningText) {
            this.warningText.setVisible(isTracked && !isLocked);
        }

        if (this.lockWarningText) {
            this.lockWarningText.setVisible(isLocked);
            
            // Blinking effect for lock warning
            if (isLocked) {
                this.scene.tweens.add({
                    targets: this.lockWarningText,
                    alpha: 0.3,
                    duration: 300,
                    yoyo: true,
                    repeat: -1
                });
            } else {
                this.scene.tweens.killTweensOf(this.lockWarningText);
                this.lockWarningText.setAlpha(1);
            }
        }
    }

    update(ship: Phaser.Physics.Arcade.Image): void {
        this.updateButtonColors();
        this.updateLayout(ship);
    }

    destroy(): void {
        this.sttBtn?.destroy();
        this.rwsBtn?.destroy();
        this.twsBtn?.destroy();
        this.shootBtn?.destroy();
        this.warningText?.destroy();
        this.lockWarningText?.destroy();
        this.sttBtn = undefined;
        this.rwsBtn = undefined;
        this.twsBtn = undefined;
        this.shootBtn = undefined;
        this.warningText = undefined;
        this.lockWarningText = undefined;
    }
}