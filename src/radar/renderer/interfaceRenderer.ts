import { LightRadar } from "../systems/lightRadar";
import { RwrContact } from "../systems/rwr";

export class InterfaceRenderer {
    private sttBtn?: Phaser.GameObjects.Text;
    private rwsBtn?: Phaser.GameObjects.Text;
    private twsBtn?: Phaser.GameObjects.Text;
    private shootBtn?: Phaser.GameObjects.Text;
    private speedOneThirdBtn?: Phaser.GameObjects.Text;
    private speedTwoThirdBtn?: Phaser.GameObjects.Text;
    private speedFullBtn?: Phaser.GameObjects.Text;
    private zoomInBtn?: Phaser.GameObjects.Text;
    private zoomOutBtn?: Phaser.GameObjects.Text;
    private warningText?: Phaser.GameObjects.Text;
    private lockWarningText?: Phaser.GameObjects.Text;
    private goSttWarning?: Phaser.GameObjects.Text;
    private rwrImage?: Phaser.GameObjects.Image;
    private rwrDirectionGraphics?: Phaser.GameObjects.Graphics;
    private playerRadar: LightRadar;

    constructor(private scene: Phaser.Scene, playerRadar: LightRadar) {
        this.playerRadar = playerRadar;
    }

    createInterface(ship: Phaser.GameObjects.Sprite): void {
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

        // SPEED BUTTONS
        const fullSpeed = (ship as any).getSpeed ? (ship as any).getSpeed() : 3;
        const oneThirdSpeed = fullSpeed / 3;
        const twoThirdSpeed = (fullSpeed * 2) / 3;

        this.speedOneThirdBtn = this.scene.add.text(0, 0, '1/3', {
            font: '22px Courier',
            color: '#000',
            backgroundColor: '#ffdb4d',
            padding: { x: 10, y: 5 }
        })
        .setInteractive()
        .setOrigin(0)
        .on('pointerdown', () => {
            (ship as any).setCurrentSpeed?.(oneThirdSpeed);
        });

        this.speedTwoThirdBtn = this.scene.add.text(0, 0, '2/3', {
            font: '22px Courier',
            color: '#000',
            backgroundColor: '#ffdb4d',
            padding: { x: 10, y: 5 }
        })
        .setInteractive()
        .setOrigin(0)
        .on('pointerdown', () => {
            (ship as any).setCurrentSpeed?.(twoThirdSpeed);
        });

        this.speedFullBtn = this.scene.add.text(0, 0, 'FULL', {
            font: '22px Courier',
            color: '#000',
            backgroundColor: '#ffdb4d',
            padding: { x: 10, y: 5 }
        })
        .setInteractive()
        .setOrigin(0)
        .on('pointerdown', () => {
            (ship as any).setCurrentSpeed?.(fullSpeed);
        });

        // ZOOM BUTTONS (fixed to camera)
        this.zoomInBtn = this.scene.add.text(0, 0, '+', {
            font: '32px Courier',
            color: '#000',
            backgroundColor: '#ffdb4d',
            padding: { x: 15, y: 5 }
        })
        .setInteractive()
        .setOrigin(0)
        .setScrollFactor(0)
        .on('pointerdown', () => {
            const camera = this.scene.cameras.main;
            camera.setZoom(camera.zoom + 0.2);
            camera.startFollow(ship);
        });

        this.zoomOutBtn = this.scene.add.text(0, 0, '-', {
            font: '32px Courier',
            color: '#000',
            backgroundColor: '#ffdb4d',
            padding: { x: 15, y: 5 }
        })
        .setInteractive()
        .setOrigin(0)
        .setScrollFactor(0)
        .on('pointerdown', () => {
            const camera = this.scene.cameras.main;
            camera.setZoom(Math.max(0.2, camera.zoom - 0.2));
            camera.startFollow(ship);
        });

        // Position zoom buttons on right side of screen
        const camera = this.scene.cameras.main;
        const rightX = camera.width - this.zoomInBtn.width - 20;
        const centerY = camera.height / 2;
        this.zoomInBtn.setPosition(rightX, centerY - 30);
        this.zoomOutBtn.setPosition(rightX, centerY + 20);

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

        this.goSttWarning = this.scene.add.text(0, 0, 'GO STT', {
            font: '24px Courier',
            color: '#000000',
            backgroundColor: '#ff0000',
            padding: { x: 12, y: 6 }
        })
        .setOrigin(0.5)
        .setVisible(false);

        // RWR screen image fixed to bottom-left of camera viewport
        this.rwrImage = this.scene.add.image(20, camera.height - 20, 'rwr')
            .setOrigin(0, 1)
            .setScrollFactor(0)
            .setDepth(1000);

        // Keep RWR image at a practical HUD size while preserving aspect ratio
        const targetRwrHeight = 120;
        const rwrScale = targetRwrHeight / this.rwrImage.height;
        this.rwrImage.setScale(rwrScale);

        this.rwrDirectionGraphics = this.scene.add.graphics()
            .setScrollFactor(0)
            .setDepth(1001);

        this.updateLayout(ship);
    }

    updateButtonColors(ship: Phaser.GameObjects.Sprite): void {
        const mode = this.playerRadar.getMode();
        const tracks = this.playerRadar.getTracks();
        const isTWSActive = mode === 'tws';
        const hasTracks = tracks.length > 0;
        if (this.sttBtn) this.sttBtn.setBackgroundColor(mode === 'stt' ? '#ff0000' : '#ffdb4d');
        if (this.rwsBtn) this.rwsBtn.setBackgroundColor(mode === 'rws' ? '#00ff00' : '#ffdb4d');
        if (this.twsBtn) this.twsBtn.setBackgroundColor(mode === 'tws' ? '#00ff00' : '#ffdb4d');
        if (this.shootBtn) this.shootBtn.setBackgroundColor(mode === 'stt' || (isTWSActive && hasTracks) ? '#ed9209' : '#ffdb4d');

        // Update speed button colors
        const fullSpeed = (ship as any).getSpeed ? (ship as any).getSpeed() : 3;
        const oneThirdSpeed = fullSpeed / 3;
        const twoThirdSpeed = (fullSpeed * 2) / 3;
        const currentShipSpeed = (ship as any).getCurrentSpeed ? (ship as any).getCurrentSpeed() : fullSpeed;

        if (this.speedOneThirdBtn) this.speedOneThirdBtn.setBackgroundColor(Math.abs(currentShipSpeed - oneThirdSpeed) < 0.01 ? '#00ff00' : '#ffdb4d');
        if (this.speedTwoThirdBtn) this.speedTwoThirdBtn.setBackgroundColor(Math.abs(currentShipSpeed - twoThirdSpeed) < 0.01 ? '#00ff00' : '#ffdb4d');
        if (this.speedFullBtn) this.speedFullBtn.setBackgroundColor(Math.abs(currentShipSpeed - fullSpeed) < 0.01 ? '#00ff00' : '#ffdb4d');
    }

    updateLayout(ship: Phaser.GameObjects.Sprite): void {
        if (!this.sttBtn || !this.rwsBtn || !this.shootBtn) return;
        const shipX = ship.x;
        const shipY = ship.y;

        // radius from getCircle if present, else half display height
        // @ts-ignore
        const circle = ship.getCircle ? ship.getCircle() : null;
        const radius = circle ? circle.radius : (ship.displayHeight / 2);

        // Check if ship is pointing downwards (45-135 degrees)
        const shipAngle = (ship as any).angle ?? 0;
        const isPointingDown = shipAngle > 45 && shipAngle < 135;
        
        // Flip button position based on ship direction
        const verticalOffset = (radius + 16) * (isPointingDown ? -1 : 1);
        const topY = shipY + verticalOffset;

        const spacingX = 12;
        const spacingY = 6;

        const sttW = this.sttBtn.width;
        const rwsW = this.rwsBtn.width;
        const rowWidth = sttW + spacingX + rwsW;

        const rowLeft = shipX - rowWidth / 2;

        this.sttBtn.setPosition(rowLeft, topY);
        this.rwsBtn.setPosition(rowLeft + sttW + spacingX, topY);

        const twsY = isPointingDown 
            ? topY - this.sttBtn.height - spacingY 
            : topY + this.sttBtn.height + spacingY;
        const twsX = shipX - (this.twsBtn!.width / 2);
        this.twsBtn!.setPosition(twsX, twsY);

        const shootY = isPointingDown
            ? twsY - this.twsBtn!.height - spacingY
            : twsY + this.twsBtn!.height + spacingY;
        const shootX = shipX - (this.shootBtn.width / 2);
        this.shootBtn.setPosition(shootX, shootY);

        // Position speed buttons to the right, stacked vertically
        if (this.speedOneThirdBtn && this.speedTwoThirdBtn && this.speedFullBtn) {
            const speedX = shipX + 120; // Distance to the right of ship
            const speedTopY = topY;
            
            if (isPointingDown) {
                this.speedOneThirdBtn.setPosition(speedX, speedTopY);
                this.speedTwoThirdBtn.setPosition(speedX, speedTopY - this.speedOneThirdBtn.height - spacingY);
                this.speedFullBtn.setPosition(speedX, speedTopY - (this.speedOneThirdBtn.height + spacingY) * 2);
            } else {
                this.speedOneThirdBtn.setPosition(speedX, speedTopY);
                this.speedTwoThirdBtn.setPosition(speedX, speedTopY + this.speedOneThirdBtn.height + spacingY);
                this.speedFullBtn.setPosition(speedX, speedTopY + (this.speedOneThirdBtn.height + spacingY) * 2);
            }
        }

        // Position warning texts above ship
        if (this.warningText) {
            const warningY = shipY - 100;
            this.warningText.setPosition(shipX, warningY);
        }

        if (this.lockWarningText) {
            const lockWarningY = shipY - 140;
            this.lockWarningText.setPosition(shipX, lockWarningY);
        }

        if (this.goSttWarning) {
            const goSttY = shipY - 180;
            this.goSttWarning.setPosition(shipX, goSttY);
        }

        // Keep RWR widget pinned to camera bottom-left
        if (this.rwrImage) {
            const camera = this.scene.cameras.main;
            this.rwrImage.setPosition(20, camera.height - 20);
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

    update(ship: Phaser.GameObjects.Sprite): void {
        this.updateButtonColors(ship);
        this.updateLayout(ship);

        const primaryContact = this.playerRadar.getPrimaryRwrContact();
        this.renderRwrDirectionDiamond(primaryContact);
    }

    private renderRwrDirectionDiamond(contact: RwrContact | null): void {
        if (!this.rwrDirectionGraphics || !this.rwrImage) return;

        this.rwrDirectionGraphics.clear();
        if (!contact) return;

        const centerX = this.rwrImage.x + this.rwrImage.displayWidth / 2;
        const centerY = this.rwrImage.y - this.rwrImage.displayHeight / 2;
        const markerRadius = Math.min(this.rwrImage.displayWidth, this.rwrImage.displayHeight) * 0.35;

        const angleRad = Phaser.Math.DegToRad(contact.bearingDeg);
        const markerX = centerX + Math.cos(angleRad) * markerRadius;
        const markerY = centerY + Math.sin(angleRad) * markerRadius;

        const diamondSize = 8;
        const color = contact.isLocked ? 0xff0000 : 0x00ff00;

        this.rwrDirectionGraphics.lineStyle(2, color, 1);
        this.rwrDirectionGraphics.beginPath();
        this.rwrDirectionGraphics.moveTo(markerX, markerY - diamondSize);
        this.rwrDirectionGraphics.lineTo(markerX + diamondSize, markerY);
        this.rwrDirectionGraphics.lineTo(markerX, markerY + diamondSize);
        this.rwrDirectionGraphics.lineTo(markerX - diamondSize, markerY);
        this.rwrDirectionGraphics.closePath();
        this.rwrDirectionGraphics.strokePath();
    }

    showGoSttWarning(): void {
        if (this.goSttWarning) {
            this.goSttWarning.setVisible(true);
            this.goSttWarning.setAlpha(1);
            
            // Auto-hide after 2 seconds
            this.scene.time.delayedCall(2000, () => {
                if (this.goSttWarning) {
                    this.goSttWarning.setVisible(false);
                }
            });
        }
    }

    destroy(): void {
        this.sttBtn?.destroy();
        this.rwsBtn?.destroy();
        this.twsBtn?.destroy();
        this.shootBtn?.destroy();
        this.speedOneThirdBtn?.destroy();
        this.speedTwoThirdBtn?.destroy();
        this.speedFullBtn?.destroy();
        this.zoomInBtn?.destroy();
        this.zoomOutBtn?.destroy();
        this.warningText?.destroy();
        this.lockWarningText?.destroy();
        this.goSttWarning?.destroy();
        this.rwrImage?.destroy();
        this.rwrDirectionGraphics?.destroy();
        this.sttBtn = undefined;
        this.rwsBtn = undefined;
        this.twsBtn = undefined;
        this.shootBtn = undefined;
        this.speedOneThirdBtn = undefined;
        this.speedTwoThirdBtn = undefined;
        this.speedFullBtn = undefined;
        this.zoomInBtn = undefined;
        this.zoomOutBtn = undefined;
        this.warningText = undefined;
        this.lockWarningText = undefined;
        this.goSttWarning = undefined;
        this.rwrImage = undefined;
        this.rwrDirectionGraphics = undefined;
    }
}