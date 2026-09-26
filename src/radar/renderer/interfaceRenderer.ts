import Phaser from "phaser";
import { Radar } from "../systems/radar";
import { RwrContact } from "../systems/modules/rwr";
import { Ship } from "../../entities/ship";
import { StartupStepKey, STARTUP_STEPS } from "../../audio/startup";
import { landingSettings } from "../../settings";
import {
    GO_STT_WARNING_OFFSET_Y_PX,
    LOCK_WARNING_OFFSET_Y_PX,
    MISSILE_TTA_OFFSET_Y_PX,
    RADAR_BUTTON_SPACING_X_PX,
    RADAR_BUTTON_SPACING_Y_PX,
    RADAR_WARNING_OFFSET_Y_PX,
    RWR_CONTACT_DIAMOND_SIZE_PX,
    RWR_MARKER_RADIUS_FACTOR,
    RWR_THREAT_ALPHA_RANGE,
    RWR_THREAT_BASE_RADIUS_PX,
    RWR_THREAT_FLARE_RADIUS_PX,
    RWR_THREAT_MIN_ALPHA,
    RWR_THREAT_PULSE_TIME_DIVISOR_MS,
    RWR_THREAT_SPIKES,
    RWR_WIDGET_HEIGHT_PX,
    RWR_WIDGET_MARGIN_PX,
    SPEED_BUTTON_OFFSET_X_PX,
} from "../data/radarGameSettings";

// Cold-start switch states: waiting to be thrown, running its sequence, done.
const STARTUP_COLOR_PENDING = '#ffdb4d';
const STARTUP_COLOR_BUSY = '#ed9209';
const STARTUP_COLOR_DONE = '#00ff00';

export class InterfaceRenderer {
    private sttBtn?: Phaser.GameObjects.Text;
    private rwsBtn?: Phaser.GameObjects.Text;
    private twsBtn?: Phaser.GameObjects.Text;
    private emconBtn?: Phaser.GameObjects.Text;
    private shootBtn?: Phaser.GameObjects.Text;
    private speedOneThirdBtn?: Phaser.GameObjects.Text;
    private speedTwoThirdBtn?: Phaser.GameObjects.Text;
    private speedFullBtn?: Phaser.GameObjects.Text;
    // Slow astern: the landing setting (see landingSettings).
    private speedReverseBtn?: Phaser.GameObjects.Text;
    private zoomInBtn?: Phaser.GameObjects.Text;
    private zoomOutBtn?: Phaser.GameObjects.Text;
    private warningText?: Phaser.GameObjects.Text;
    private lockWarningText?: Phaser.GameObjects.Text;
    private goSttWarning?: Phaser.GameObjects.Text;
    private missileTtaText?: Phaser.GameObjects.Text;
    private rwrImage?: Phaser.GameObjects.Image;
    private rwrDirectionGraphics?: Phaser.GameObjects.Graphics;
    // Cold-start switches (campaign only). Present instead of the flight
    // controls until the startup procedure completes.
    private startupBtns = new Map<StartupStepKey, Phaser.GameObjects.Text>();
    private playerShip: Ship;
    private playerRadar: Radar;

    constructor(private scene: Phaser.Scene, playerShip: Ship) {
        this.playerShip = playerShip;
        this.playerRadar = playerShip.radar;
    }

    createInterface(ship: Ship): void {
        this.playerShip = ship;
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
            this.playerRadar.enterTws();
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
            this.playerRadar.enterStt();
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
            this.playerRadar.enterRws();
        });
        // EMCON BTN — silence the transmitter; RWR/comms reception keep working.
        this.emconBtn = this.scene.add.text(0, 0, 'EMCON', {
            font: '22px Courier',
            color: '#000',
            backgroundColor: '#ffdb4d',
            padding: { x: 10, y: 5 }
        })
        .setInteractive()
        .setOrigin(0)
        .on('pointerdown', () => {
            this.playerRadar.enterEmcon();
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
            this.playerRadar.shoot();
        });

        // SPEED BUTTONS
        const fullSpeed = this.getFullSpeed(ship);
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
            ship.setCurrentSpeed(oneThirdSpeed);
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
            ship.setCurrentSpeed(twoThirdSpeed);
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
            ship.setCurrentSpeed(fullSpeed);
        });

        this.speedReverseBtn = this.scene.add.text(0, 0, 'REV', {
            font: '22px Courier',
            color: '#000',
            backgroundColor: '#ffdb4d',
            padding: { x: 10, y: 5 }
        })
        .setInteractive()
        .setOrigin(0)
        .on('pointerdown', () => {
            ship.setCurrentSpeed(-landingSettings.REVERSE_SPEED);
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

        this.lockWarningText = this.scene.add.text(0, 0, 'MISSILE LOCK', {
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

        this.missileTtaText = this.scene.add.text(0, 0, '', {
            font: '20px Courier',
            color: '#00ff88',
            backgroundColor: '#001a11',
            padding: { x: 10, y: 5 }
        })
        .setOrigin(0.5)
        .setVisible(false);

        // RWR screen image fixed to bottom-left of camera viewport. Final
        // placement (zoom-corrected) happens in updateLayout via positionRwr().
        this.rwrImage = this.scene.add.image(0, 0, 'rwr')
            .setOrigin(0, 1)
            .setScrollFactor(0)
            .setDepth(1000);

        // Keep RWR image at a practical HUD size while preserving aspect ratio
        const rwrScale = RWR_WIDGET_HEIGHT_PX / this.rwrImage.height;
        this.rwrImage.setScale(rwrScale);

        this.rwrDirectionGraphics = this.scene.add.graphics()
            .setScrollFactor(0)
            .setDepth(1001);

        this.updateLayout(ship);
    }

    updateButtonColors(ship: Ship): void {
        const mode = this.playerRadar.getMode();
        const tracks = this.playerRadar.getTracks();
        const isTWSActive = mode === 'tws';
        const hasTracks = tracks.length > 0;
        if (this.sttBtn) this.sttBtn.setBackgroundColor(mode === 'stt' ? '#ff0000' : '#ffdb4d');
        if (this.rwsBtn) this.rwsBtn.setBackgroundColor(mode === 'rws' ? '#00ff00' : '#ffdb4d');
        if (this.twsBtn) this.twsBtn.setBackgroundColor(mode === 'tws' ? '#00ff00' : '#ffdb4d');
        if (this.emconBtn) this.emconBtn.setBackgroundColor(mode === 'emcon' ? '#888888' : '#ffdb4d');
        const canShootTws = isTWSActive && (hasTracks || this.playerRadar.hasFullVim220Route());
        if (this.shootBtn) this.shootBtn.setBackgroundColor(mode === 'stt' || canShootTws ? '#ed9209' : '#ffdb4d');

        // Update speed button colors
        const fullSpeed = this.getFullSpeed(ship);
        const oneThirdSpeed = fullSpeed / 3;
        const twoThirdSpeed = (fullSpeed * 2) / 3;
        const currentShipSpeed = ship.getCurrentSpeed();

        if (this.speedOneThirdBtn) this.speedOneThirdBtn.setBackgroundColor(Math.abs(currentShipSpeed - oneThirdSpeed) < 0.01 ? '#00ff00' : '#ffdb4d');
        if (this.speedTwoThirdBtn) this.speedTwoThirdBtn.setBackgroundColor(Math.abs(currentShipSpeed - twoThirdSpeed) < 0.01 ? '#00ff00' : '#ffdb4d');
        if (this.speedFullBtn) this.speedFullBtn.setBackgroundColor(Math.abs(currentShipSpeed - fullSpeed) < 0.01 ? '#00ff00' : '#ffdb4d');
        if (this.speedReverseBtn) this.speedReverseBtn.setBackgroundColor(Math.abs(currentShipSpeed + landingSettings.REVERSE_SPEED) < 0.01 ? '#00ff00' : '#ffdb4d');
    }

    // ── Cold-start switches ────────────────────────────────────────────────
    // The campaign starts the ship powered down: the flight controls are hidden
    // and replaced by the startup switches until the procedure is complete.
    // Deliberately mouse-only — a cold start is a drill, not a reflex, so these
    // get no keyboard shortcuts.

    // Show or hide the normal ship/radar controls that sit around the hull.
    // The zoom buttons are camera-fixed and stay put.
    setFlightControlsVisible(visible: boolean): void {
        [
            this.sttBtn, this.rwsBtn, this.twsBtn, this.emconBtn, this.shootBtn,
            this.speedOneThirdBtn, this.speedTwoThirdBtn, this.speedFullBtn, this.speedReverseBtn,
        ].forEach(btn => btn?.setVisible(visible));
    }

    createStartupPanel(onPress: (step: StartupStepKey) => void): void {
        this.destroyStartupPanel();
        STARTUP_STEPS.forEach(step => {
            const button = this.scene.add.text(0, 0, step, {
                font: '22px Courier',
                color: '#000',
                backgroundColor: STARTUP_COLOR_PENDING,
                padding: { x: 10, y: 5 },
            })
            .setInteractive()
            .setOrigin(0)
            .on('pointerdown', () => onPress(step));
            this.startupBtns.set(step, button);
        });
        this.updateLayout(this.playerShip);
    }

    setStartupStepState(step: StartupStepKey, state: 'pending' | 'busy' | 'done'): void {
        const colors = {
            pending: STARTUP_COLOR_PENDING,
            busy: STARTUP_COLOR_BUSY,
            done: STARTUP_COLOR_DONE,
        };
        this.startupBtns.get(step)?.setBackgroundColor(colors[state]);
    }

    destroyStartupPanel(): void {
        this.startupBtns.forEach(btn => btn.destroy());
        this.startupBtns.clear();
    }

    // Lay the switches out in one row centred under the hull, where the flight
    // controls they stand in for would be.
    private layoutStartupPanel(shipX: number, topY: number): void {
        if (this.startupBtns.size === 0) return;
        const buttons = [...this.startupBtns.values()];
        const spacing = RADAR_BUTTON_SPACING_X_PX;
        const rowWidth = buttons.reduce((sum, b) => sum + b.width, 0) + spacing * (buttons.length - 1);

        let x = shipX - rowWidth / 2;
        for (const button of buttons) {
            button.setPosition(x, topY);
            x += button.width + spacing;
        }
    }

    updateLayout(ship: Ship): void {
        if (!this.sttBtn || !this.rwsBtn || !this.shootBtn) return;
        const shipX = ship.x;
        const shipY = ship.y;

        const circle = ship.getCircle();
        const radius = circle ? circle.radius : (ship.displayHeight / 2);

        // Check if ship is pointing downwards (45-135 degrees)
        const shipAngle = ship.angle;
        const isPointingDown = shipAngle > 45 && shipAngle < 135;
        
        // Flip button position based on ship direction
        const verticalOffset = (radius + 16) * (isPointingDown ? -1 : 1);
        const topY = shipY + verticalOffset;

        const spacingX = RADAR_BUTTON_SPACING_X_PX;
        const spacingY = RADAR_BUTTON_SPACING_Y_PX;

        // Row 1: RWS — STT side by side. Rows below, one button each: TWS,
        // EMCON, SHOOT, stacking outward from the ship.
        const rwsW = this.rwsBtn.width;
        const sttW = this.sttBtn.width;
        const rowWidth = rwsW + spacingX + sttW;

        const rowLeft = shipX - rowWidth / 2;

        this.rwsBtn.setPosition(rowLeft, topY);
        this.sttBtn.setPosition(rowLeft + rwsW + spacingX, topY);

        const twsY = isPointingDown
            ? topY - this.rwsBtn.height - spacingY
            : topY + this.rwsBtn.height + spacingY;
        const twsX = shipX - (this.twsBtn!.width / 2);
        this.twsBtn!.setPosition(twsX, twsY);

        const emconY = isPointingDown
            ? twsY - this.twsBtn!.height - spacingY
            : twsY + this.twsBtn!.height + spacingY;
        const emconX = shipX - (this.emconBtn!.width / 2);
        this.emconBtn!.setPosition(emconX, emconY);

        const shootY = isPointingDown
            ? emconY - this.emconBtn!.height - spacingY
            : emconY + this.emconBtn!.height + spacingY;
        const shootX = shipX - (this.shootBtn.width / 2);
        this.shootBtn.setPosition(shootX, shootY);

        this.layoutStartupPanel(shipX, topY);

        // Position speed buttons to the right, stacked vertically
        if (this.speedOneThirdBtn && this.speedTwoThirdBtn && this.speedFullBtn && this.speedReverseBtn) {
            const speedX = shipX + SPEED_BUTTON_OFFSET_X_PX;
            const speedTopY = topY;
            
            // Astern sits on the far side of 1/3 from the ahead settings.
            const step = this.speedOneThirdBtn.height + spacingY;
            if (isPointingDown) {
                this.speedReverseBtn.setPosition(speedX, speedTopY + step);
                this.speedOneThirdBtn.setPosition(speedX, speedTopY);
                this.speedTwoThirdBtn.setPosition(speedX, speedTopY - step);
                this.speedFullBtn.setPosition(speedX, speedTopY - step * 2);
            } else {
                this.speedReverseBtn.setPosition(speedX, speedTopY - step);
                this.speedOneThirdBtn.setPosition(speedX, speedTopY);
                this.speedTwoThirdBtn.setPosition(speedX, speedTopY + step);
                this.speedFullBtn.setPosition(speedX, speedTopY + step * 2);
            }
        }

        // Position warning texts above ship
        if (this.warningText) {
            const warningY = shipY + RADAR_WARNING_OFFSET_Y_PX;
            this.warningText.setPosition(shipX, warningY);
        }

        if (this.lockWarningText) {
            const lockWarningY = shipY + LOCK_WARNING_OFFSET_Y_PX;
            this.lockWarningText.setPosition(shipX, lockWarningY);
        }

        if (this.goSttWarning) {
            const goSttY = shipY + GO_STT_WARNING_OFFSET_Y_PX;
            this.goSttWarning.setPosition(shipX, goSttY);
        }

        if (this.missileTtaText) {
            const missileTtaY = shipY + MISSILE_TTA_OFFSET_Y_PX;
            this.missileTtaText.setPosition(shipX, missileTtaY);
        }

        // Keep RWR widget pinned to camera bottom-left
        this.positionRwr();
    }

    // Pin the RWR widget to the bottom-left viewport corner.
    //
    // The image uses setScrollFactor(0) so it ignores camera scroll, but Phaser
    // still applies the camera's zoom about its centre to fixed objects. That
    // means a fixed object at screen-pixel (sx, sy) must be placed at the
    // *local* coordinate that maps back to (sx, sy) after the zoom transform:
    //
    //   screen = (local - centre) * zoom + centre
    //   local  = (screen - centre) / zoom + centre
    //
    // Computing it this way keeps the widget in the true corner at any zoom
    // level (the zoom buttons change it at runtime) and any viewport size.
    private positionRwr(): void {
        if (!this.rwrImage) return;
        const cam = this.scene.cameras.main;
        const centreX = cam.width * cam.originX;
        const centreY = cam.height * cam.originY;
        const margin = RWR_WIDGET_MARGIN_PX;
        const localX = (margin - centreX) / cam.zoom + centreX;
        const localY = (cam.height - margin - centreY) / cam.zoom + centreY;
        this.rwrImage.setPosition(localX, localY);
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

    update(): void {
        this.updateButtonColors(this.playerShip);
        this.updateLayout(this.playerShip);

        const signals = this.playerRadar.rwrReceiver.getRwrSignals();
        const primaryContact = this.playerRadar.rwrReceiver.getPrimaryRwrContact();
        const missileHudText = this.playerRadar.rwrReceiver.getLastFiredMissileHudText();

        this.updateWarnings(Boolean(primaryContact), Boolean(primaryContact?.isLocked));
        if (this.missileTtaText) {
            this.missileTtaText.setText(missileHudText ?? '');
            this.missileTtaText.setVisible(Boolean(missileHudText));
        }
        this.renderRwrDirectionDiamonds(signals);
    }

    private getFullSpeed(ship: Ship): number {
        return ship.getSpeed();
    }

    private renderRwrDirectionDiamonds(contacts: RwrContact[]): void {
        if (!this.rwrDirectionGraphics || !this.rwrImage) return;

        this.rwrDirectionGraphics.clear();
        if (contacts.length === 0) return;

        const centerX = this.rwrImage.x + this.rwrImage.displayWidth / 2;
        const centerY = this.rwrImage.y - this.rwrImage.displayHeight / 2;
        const markerRadius = Math.min(this.rwrImage.displayWidth, this.rwrImage.displayHeight) * RWR_MARKER_RADIUS_FACTOR;
        const diamondSize = RWR_CONTACT_DIAMOND_SIZE_PX;

        for (const contact of contacts) {
            const angleRad = Phaser.Math.DegToRad(contact.bearingDeg);
            const markerX = centerX + Math.cos(angleRad) * markerRadius;
            const markerY = centerY + Math.sin(angleRad) * markerRadius;

            // A locked contact is an incoming missile threat: draw a pulsating
            // red flare pointing at it instead of a plain diamond.
            if (contact.isLocked) {
                this.drawMissileThreatFlare(markerX, markerY, centerX, centerY);
                continue;
            }

            // A jammer strobe: the emitter is painting us with noise. Filled
            // and yellow, so it reads as louder than a search contact and
            // distinct from both the green sweep symbol and the red flare.
            if (contact.isJammer) {
                this.rwrDirectionGraphics.fillStyle(0xffff00, 1);
                this.rwrDirectionGraphics.fillPoints([
                    new Phaser.Math.Vector2(markerX, markerY - diamondSize),
                    new Phaser.Math.Vector2(markerX + diamondSize, markerY),
                    new Phaser.Math.Vector2(markerX, markerY + diamondSize),
                    new Phaser.Math.Vector2(markerX - diamondSize, markerY),
                ], true);
                continue;
            }

            this.rwrDirectionGraphics.lineStyle(2, 0x00ff00, 1);
            this.rwrDirectionGraphics.beginPath();
            this.rwrDirectionGraphics.moveTo(markerX, markerY - diamondSize);
            this.rwrDirectionGraphics.lineTo(markerX + diamondSize, markerY);
            this.rwrDirectionGraphics.lineTo(markerX, markerY + diamondSize);
            this.rwrDirectionGraphics.lineTo(markerX - diamondSize, markerY);
            this.rwrDirectionGraphics.closePath();
            this.rwrDirectionGraphics.strokePath();
        }
    }

    // Pulsating red "flurry" marking an incoming missile-lock threat on the RWR
    // screen, at the bearing (markerX/Y) of the locking contact.
    private drawMissileThreatFlare(markerX: number, markerY: number, centerX: number, centerY: number): void {
        const g = this.rwrDirectionGraphics;
        if (!g) return;

        // 0..1 pulse from a sine wave driven by the scene clock (~2.5 Hz).
        const pulse = 0.5 + 0.5 * Math.sin(this.scene.time.now / RWR_THREAT_PULSE_TIME_DIVISOR_MS);
        const baseRadius = RWR_THREAT_BASE_RADIUS_PX;
        const flareRadius = baseRadius + pulse * RWR_THREAT_FLARE_RADIUS_PX;
        const alpha = RWR_THREAT_MIN_ALPHA + pulse * RWR_THREAT_ALPHA_RANGE;
        const red = 0xff0000;

        // Soft pulsing glow.
        g.fillStyle(red, alpha * 0.35);
        g.fillCircle(markerX, markerY, flareRadius + 4);

        // Bright pulsing core.
        g.fillStyle(red, alpha);
        g.fillCircle(markerX, markerY, baseRadius);

        // Radial spikes — the "flurry" — expanding with the pulse.
        g.lineStyle(2, red, alpha);
        const spikes = RWR_THREAT_SPIKES;
        for (let i = 0; i < spikes; i++) {
            const a = (Math.PI * 2 * i) / spikes;
            g.beginPath();
            g.moveTo(markerX + Math.cos(a) * baseRadius, markerY + Math.sin(a) * baseRadius);
            g.lineTo(markerX + Math.cos(a) * (flareRadius + 6), markerY + Math.sin(a) * (flareRadius + 6));
            g.strokePath();
        }

        // A line from the RWR centre toward the threat bearing, for direction.
        g.lineStyle(2, red, alpha * 0.8);
        g.lineBetween(centerX, centerY, markerX, markerY);
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
        this.destroyStartupPanel();
        this.sttBtn?.destroy();
        this.rwsBtn?.destroy();
        this.twsBtn?.destroy();
        this.emconBtn?.destroy();
        this.shootBtn?.destroy();
        this.speedOneThirdBtn?.destroy();
        this.speedTwoThirdBtn?.destroy();
        this.speedFullBtn?.destroy();
        this.speedReverseBtn?.destroy();
        this.zoomInBtn?.destroy();
        this.zoomOutBtn?.destroy();
        this.warningText?.destroy();
        this.lockWarningText?.destroy();
        this.goSttWarning?.destroy();
        this.missileTtaText?.destroy();
        this.rwrImage?.destroy();
        this.rwrDirectionGraphics?.destroy();
        this.sttBtn = undefined;
        this.rwsBtn = undefined;
        this.twsBtn = undefined;
        this.emconBtn = undefined;
        this.shootBtn = undefined;
        this.speedOneThirdBtn = undefined;
        this.speedTwoThirdBtn = undefined;
        this.speedFullBtn = undefined;
        this.speedReverseBtn = undefined;
        this.zoomInBtn = undefined;
        this.zoomOutBtn = undefined;
        this.warningText = undefined;
        this.lockWarningText = undefined;
        this.goSttWarning = undefined;
        this.missileTtaText = undefined;
        this.rwrImage = undefined;
        this.rwrDirectionGraphics = undefined;
    }
}
