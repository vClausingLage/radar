import { Vector2 } from "../../types";
import { Track } from "../data/track";
import { Missile } from "../entities/missiles";

export class LightRadarRenderer {

    renderScanAzimuth(graphics: Phaser.GameObjects.Graphics, radarPosition: Vector2, radarRange: number, startAngle: number, endAngle: number) {
        graphics.lineStyle(1, 0x00ff00, 0.5);
        const startX = radarPosition.x + radarRange * Math.cos(Phaser.Math.DegToRad(startAngle - 90));
        const startY = radarPosition.y + radarRange * Math.sin(Phaser.Math.DegToRad(startAngle - 90));
        graphics.lineBetween(radarPosition.x, radarPosition.y, startX, startY);

        const endX = radarPosition.x + radarRange * Math.cos(Phaser.Math.DegToRad(endAngle - 90));
        const endY = radarPosition.y + radarRange * Math.sin(Phaser.Math.DegToRad(endAngle - 90));
        graphics.lineBetween(radarPosition.x, radarPosition.y, endX, endY);
    }

    renderRwsContacts(graphics: Phaser.GameObjects.Graphics, t: any, distance: number) {
        // Draw green rectangle at target position on separate graphics object
        const rectGraphics = graphics.scene?.add.graphics();
        if (rectGraphics) {
            rectGraphics.fillStyle(0x00ff00, 0.7);
            rectGraphics.fillRect(t.position.x - 5, t.position.y - 5, 10, 10);
            graphics.scene?.tweens.add({
                targets: rectGraphics,
                alpha: 0,
                duration: 3000,
                onComplete: () => rectGraphics.destroy()
            });
        }
        
        // Display distance as text with fade out
        // distance is shown as 'nautical miles' => calculated dist divided by 10
        const distanceText = graphics.scene?.add.text(t.position.x + 10, t.position.y - 10, 
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
        const angle = Math.atan2(t.direction.y, t.direction.x);
        const endX = t.position.x + lineLength * Math.cos(angle);
        const endY = t.position.y + lineLength * Math.sin(angle);
        
        graphics.lineStyle(2, 0x00ff00, 1);
        graphics.lineBetween(t.position.x, t.position.y, endX, endY);
        
        // Create a separate graphics object for the line to fade it
        const lineGraphics = graphics.scene?.add.graphics();
        if (lineGraphics) {
            lineGraphics.lineStyle(2, 0x00ff00, 1);
            lineGraphics.lineBetween(t.position.x, t.position.y, endX, endY);
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
            track.pos.x + 10, 
            track.pos.y - 10, 
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
            const angle = Math.atan2(track.dir.y, track.dir.x);
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
        missiles.forEach(missile => {
            const rectGraphics = graphics.scene?.add.graphics();
            if (rectGraphics) {
                rectGraphics.fillStyle(0xff0000, 0.7);
                rectGraphics.fillRect(missile.position.x - 5, missile.position.y - 5, 10, 10);
                graphics.scene?.tweens.add({
                    targets: rectGraphics,
                    alpha: 0,
                    duration: 3000,
                    onComplete: () => rectGraphics.destroy()
                });
            }
        });
    }
}