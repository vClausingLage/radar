import { Vector2 } from "../../types";
import { Track } from "../data/track";
import { Asteroid } from "../../entities/asteroid";
import { Missile } from "../../entities/missiles";
import { Target } from "../../entities/ship";
import { Loadout } from "../../types"

export class LightRadarRenderer {

    private rangeText: Phaser.GameObjects.Text | undefined;
    private activeLoadout: Phaser.GameObjects.Text | undefined;

    constructor(public scene: Phaser.Scene) {}
    
    renderRadarScanInterface(graphics: Phaser.GameObjects.Graphics, radarPosition: Vector2, radarRange: number, startAngle: number, endAngle: number, range: number, activeMissiles: Missile[], loadout: Loadout): void {
        const endX = radarPosition.x + radarRange * Math.cos(Phaser.Math.DegToRad(endAngle));
        const endY = radarPosition.y + radarRange * Math.sin(Phaser.Math.DegToRad(endAngle));
        
        if (!this.activeLoadout) {
            this.activeLoadout = this.scene.add.text(endX, endY, "\n\n\n No Active Missile", { color: '#00ff00' }).setRotation(Phaser.Math.DegToRad(endAngle + 90));
        }
        if (!this.rangeText) {
            this.rangeText = this.scene.add.text(endX, endY, `\n ${range}\n ${activeMissiles?.length && activeMissiles[0].age > 0 ? activeMissiles[0].age : ''}`, { color: '#00ff00' }).setRotation(Phaser.Math.DegToRad(endAngle + 90));
        }

        graphics.lineStyle(1, 0x00ff00, 0.5);
        const startX = radarPosition.x + radarRange * Math.cos(Phaser.Math.DegToRad(startAngle));
        const startY = radarPosition.y + radarRange * Math.sin(Phaser.Math.DegToRad(startAngle));
        graphics.lineBetween(radarPosition.x, radarPosition.y, startX, startY);
        
        graphics.lineBetween(radarPosition.x, radarPosition.y, endX, endY);
        // Draw arc
        graphics.beginPath();
        graphics.arc(radarPosition.x, radarPosition.y, radarRange, Phaser.Math.DegToRad(startAngle), Phaser.Math.DegToRad(endAngle), false);
        graphics.strokePath();

        this.rangeText.setPosition(endX, endY);
        this.rangeText.setRotation(Phaser.Math.DegToRad(endAngle + 90));
        this.activeLoadout?.setPosition(endX, endY);
        this.activeLoadout?.setRotation(Phaser.Math.DegToRad(endAngle + 90));
        if (loadout) {
            let loadoutText = '';
            for (const missileType in loadout) {
                const missileData = loadout[missileType as keyof Loadout];
                if (missileData.active) {
                    loadoutText += `${missileType}\n ${missileData.load} `;
                }
            }
            this.activeLoadout.setText(`\n\n\n ${loadoutText}`);
        } else {
            this.activeLoadout.setText(`\n\n\n No Active Missile`);
        }
    }

    renderRwsContacts(graphics: Phaser.GameObjects.Graphics, t: Target, distance: number): void {
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

    renderStt(track: Track, graphics: Phaser.GameObjects.Graphics): void {
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

    renderMissiles(missiles: Missile[]): void {
        missiles.forEach(m => {
            // Update sprite position and rotation
            m.setPosition(m.position.x, m.position.y);
            m.setAngle(Phaser.Math.RadToDeg(Math.atan2(m.direction.y, m.direction.x)));
        });
    }

    renderAsteroids(asteroids: Asteroid[]): void {
        console.log('Rendering asteroids:', asteroids);
    }

    destroy(): void {
        this.rangeText?.destroy();
        this.activeLoadout?.destroy();
        this.rangeText = undefined;
        this.activeLoadout = undefined;
    }
}