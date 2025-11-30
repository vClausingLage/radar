import { Vector2 } from "../../types";
import { Track } from "../data/track";
import { Asteroid } from "../entities/asteroid";
import { Missile } from "../entities/missiles";
import { Target } from "../entities/ship";

export class LightRadarRenderer {

    private text: Phaser.GameObjects.Text | undefined;
    private info: Phaser.GameObjects.Text | undefined;
    private rangeText: Phaser.GameObjects.Text | undefined;
    private activeMissileCache: string | undefined;
    // REFACOTR -> to obj with destroy()
    private missileSprites: Map<Missile, Phaser.GameObjects.Sprite> = new Map();

    constructor(private missileImage: Phaser.GameObjects.Image, public scene: Phaser.Scene) {
        this.missileImage.setOrigin(0.5, 0.5);
    }

    renderHud(activeMissile: string | undefined) {
        //! use cache if no changes in active missile
        if (this.activeMissileCache === activeMissile) {
            return;
        }

        this.text?.destroy();
        this.info?.destroy();
        
        if (activeMissile) {
            this.text = this.scene.add.text(20, 30, `Active Missile: ${activeMissile}`, { color: '#00ff00' }).setScrollFactor(0);
        } else {
            this.text = this.scene.add.text(20, 30, "No Active Missile", { color: '#ff0000' }).setScrollFactor(0);
        }
        this.info = this.scene.add.text(20, 50, "Press 'Q' to change missile loadout", { color: '#ffffff' }).setScrollFactor(0);
    }
    
    renderScanAzimuth(graphics: Phaser.GameObjects.Graphics, radarPosition: Vector2, radarRange: number, startAngle: number, endAngle: number, range: number) {
        graphics.lineStyle(1, 0x00ff00, 0.5);
        const startX = radarPosition.x + radarRange * Math.cos(Phaser.Math.DegToRad(startAngle));
        const startY = radarPosition.y + radarRange * Math.sin(Phaser.Math.DegToRad(startAngle));
        graphics.lineBetween(radarPosition.x, radarPosition.y, startX, startY);
        
        const endX = radarPosition.x + radarRange * Math.cos(Phaser.Math.DegToRad(endAngle));
        const endY = radarPosition.y + radarRange * Math.sin(Phaser.Math.DegToRad(endAngle));
        graphics.lineBetween(radarPosition.x, radarPosition.y, endX, endY);
        // Draw arc
        graphics.beginPath();
        graphics.arc(radarPosition.x, radarPosition.y, radarRange, Phaser.Math.DegToRad(startAngle), Phaser.Math.DegToRad(endAngle), false);
        graphics.strokePath();
        // Display range text
        this.rangeText?.destroy();
        this.rangeText = this.scene.add.text(endX - 20, endY + 25, `${range} \nbla`, { color: '#00ff00' }).setRotation(Phaser.Math.DegToRad(endAngle + 90));
    }

    renderRwsContacts(graphics: Phaser.GameObjects.Graphics, t: Target, distance: number) {
        // Draw green rectangle at target position on separate graphics object
        const rectGraphics = graphics.scene?.add.graphics();
        if (rectGraphics) {
            rectGraphics.fillStyle(0x00ff00, 0.7);
            rectGraphics.fillRect(t.x - 5, t.y - 5, 10, 10);
            graphics.scene?.tweens.add({
                targets: rectGraphics,
                alpha: 0,
                duration: 3000,
                onComplete: () => rectGraphics.destroy()
            });
        }
        
        // Display distance as text with fade out
        // distance is shown as 'nautical miles' => calculated dist divided by 10
        const distanceText = graphics.scene?.add.text(t.x + 18, t.y - 15, 
            (distance / 10).toFixed(0), 
            { fontSize: '12px', color: '#00ff00' }
        );
        if (distanceText) {
            graphics.scene?.tweens.add({
                targets: distanceText,
                alpha: 0,
                duration: 3000,
                onComplete: () => distanceText.destroy()
            });
        }
        
        // Draw short line in direction of target with fade out
        const lineLength = 20;
        const angle = Phaser.Math.DegToRad(t.getDirection());
        const endX = t.x + lineLength * Math.cos(angle);
        const endY = t.y + lineLength * Math.sin(angle);

        graphics.scene?.add.line(t.x, t.y, endX, endY, 0x00ff00, 1);
        // Create a separate graphics object for the line to fade it
        const lineGraphics = graphics.scene?.add.graphics();
        if (lineGraphics) {
            lineGraphics.lineStyle(2, 0x00ff00, 1);
            lineGraphics.lineBetween(t.x, t.y, endX, endY);
            graphics.scene?.tweens.add({
                targets: lineGraphics,
                alpha: 0,
                duration: 3000,
                onComplete: () => lineGraphics.destroy()
            });
        }
    }

    renderStt(track: Track, graphics: Phaser.GameObjects.Graphics) {
        const rectGraphics = graphics.scene?.add.graphics();
        if (rectGraphics) {
            rectGraphics.fillStyle(0xff0000, 0.7)
            rectGraphics.fillRect(track.pos.x - 5, track.pos.y - 5, 10, 10);
            graphics.scene?.tweens.add({
                targets: rectGraphics,
                alpha: 0,
                duration: 3000,
                onComplete: () => rectGraphics.destroy()
            });
        }
        
        // Display distance as text with fade out
        const distanceText = graphics.scene?.add.text(
            track.pos.x + 18, 
            track.pos.y - 15, 
            (track.dist / 10).toFixed(0), 
            { fontSize: '12px', color: '#ff0000' }
        );
        if (distanceText) {
            graphics.scene?.tweens.add({
                targets: distanceText,
                alpha: 0,
                duration: 3000,
                onComplete: () => distanceText.destroy()
            });
        }
        
        // Draw short line in direction of target with fade out
        if (track.dir) {
            const lineLength = 20;
            const angle = Phaser.Math.DegToRad(track.dir);
            const endX = track.pos.x + lineLength * Math.cos(angle);
            const endY = track.pos.y + lineLength * Math.sin(angle);
            
            // Create a separate graphics object for the line to fade it
            const lineGraphics = graphics.scene?.add.graphics();
            if (lineGraphics) {
                lineGraphics.lineStyle(2, 0xff0000, 1)
                lineGraphics.lineBetween(track.pos.x, track.pos.y, endX, endY);
                graphics.scene?.tweens.add({
                    targets: lineGraphics,
                    alpha: 0,
                    duration: 3000,
                    onComplete: () => lineGraphics.destroy()
                });
            }
        }
    }

    renderMissiles(missiles: Missile[], graphics: Phaser.GameObjects.Graphics) {
        // Remove sprites for missiles that no longer exist
        // REFACTOR!
        const currentMissiles = new Set(missiles);
        for (const [missile, sprite] of this.missileSprites.entries()) {
            if (!currentMissiles.has(missile)) {
                sprite.destroy();
                this.missileSprites.delete(missile);
            }
        }

        // Update or create sprites for active missiles
        missiles.forEach(missile => {
            if (graphics.scene) {
                let missileSprite = this.missileSprites.get(missile);
                
                if (!missileSprite) {
                    // Create new sprite for this missile
                    missileSprite = graphics.scene.add.sprite(missile.position.x, missile.position.y, this.missileImage.texture.key);
                    // missileSprite.setScale(IMAGE_SCALE);
                    this.missileSprites.set(missile, missileSprite);
                }
                
                // Update sprite position and rotation
                missileSprite.setPosition(missile.position.x, missile.position.y);
                missileSprite.setAngle(Phaser.Math.RadToDeg(Math.atan2(missile.direction.y, missile.direction.x)));
            }
        });
    }

    renderAsteroids(asteroids: Asteroid[], graphics: Phaser.GameObjects.Graphics) {
        
    }
}