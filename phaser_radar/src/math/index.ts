export class Math {
    static normalizeAngle(angle: number): number {
        while (angle > 180) angle -= 360;
        while (angle < -180) angle += 360;
        return angle;
    }

    static getRelativeAngle(sourceAngle: number, targetAngle: number): 'hot' | 'cold' | 'flanking_left' | 'flanking_right' {
        let relativeAngle = targetAngle - sourceAngle;
        relativeAngle = this.normalizeAngle(relativeAngle);
        
        // Determine aspect based on 90-degree quarters
        if (relativeAngle >= -45 && relativeAngle <= 45) {
            return 'hot';
        } else if (relativeAngle > 45 && relativeAngle <= 135) {
            return 'flanking_right';
        } else if (relativeAngle > 135 || relativeAngle < -135) {
            return 'cold';
        } else {
            return 'flanking_left';
        }
    }
}