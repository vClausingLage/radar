import { LightRadar } from "../systems/lightRadar";

export class InterfaceRenderer {
    private sttBtn?: Phaser.GameObjects.Text;
    private rwsBtn?: Phaser.GameObjects.Text;
    private twsBtn?: Phaser.GameObjects.Text;
    private shootBtn?: Phaser.GameObjects.Text;

    constructor(private scene: Phaser.Scene) {}

    createInterface(radar: LightRadar, ship: Phaser.Physics.Arcade.Image): void {
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
            radar.setMode('tws');
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
            if (radar.getTracks().length === 0) return;
            radar.setMode('stt');
        });
        // RWS BTN
        this.rwsBtn = this.scene.add.text(0, 0, 'RWS', { 
            font: '22px Courier', 
            color: '#000', 
            backgroundColor: radar.getMode() === 'rws' ? '#00ff00' : '#ffdb4d',
            padding: { x: 10, y: 5 } 
        })
        .setInteractive()
        .setOrigin(0)
        .on('pointerdown', () => {
            radar.setTracks([]);
            radar.setMode('rws');
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
            radar.shoot(ship.angle || 0);
        });

        this.updateLayout(ship);
    }

    updateButtonColors(radar: LightRadar): void {
        const mode = radar.getMode();
        const tracks = radar.getTracks();
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
    }

    update(radar: LightRadar, ship: Phaser.Physics.Arcade.Image): void {
        this.updateButtonColors(radar);
        this.updateLayout(ship);
    }
}