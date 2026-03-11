export class GameMath {
    static normalizeAngle(angle: number): number {
        while (angle > 180) angle -= 360;
        while (angle < -180) angle += 360;
        return angle;
    }

    static getAspect(sourceAngle: number, targetAngle: number): {
        aspect: 'hot' | 'cold' | 'flanking_left' | 'flanking_right',
        angle: number
     } {
        let relativeAngle = targetAngle - sourceAngle;
        relativeAngle = this.normalizeAngle(relativeAngle);
        
        // Determine aspect based on 90-degree quarters
        if (relativeAngle >= -45 && relativeAngle <= 45) {
            return { aspect: 'hot', angle: relativeAngle };
        } else if (relativeAngle > 45 && relativeAngle <= 135) {
            return { aspect: 'flanking_right', angle: relativeAngle };
        } else if (relativeAngle > 135 || relativeAngle < -135) {
            return { aspect: 'cold', angle: relativeAngle };
        } else {
            return { aspect: 'flanking_left', angle: relativeAngle };
        }
    }

    static getDistance(x1: number, y1: number, x2: number, y2: number): number {
        return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    }
}