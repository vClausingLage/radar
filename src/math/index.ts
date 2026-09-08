import { Vector2 } from "../types";

export type Aspect = 'hot' | 'flanking' | 'beaming' | 'cold';

export class GameMath {
    static normalizeAngle(angle: number): number {
        while (angle > 180) angle -= 360;
        while (angle < -180) angle += 360;
        return angle;
    }

    // A target's aspect relative to an observer: the angle between the target's
    // own heading and the line of sight from the target back to the observer.
    // Nose-on → hot, diagonal → flanking, perpendicular (~90°) → beaming,
    // tail-on → cold. Bin widths follow docs/gci-comms.md. Shared by RadarVoice
    // (player's own radar callouts) and SupportRadarComms (GCI bogey dope calls).
    static getAspect(targetHeadingDeg: number, targetPos: Vector2, observerPos: Vector2): Aspect {
        const losToObserverDeg = Math.atan2(observerPos.y - targetPos.y, observerPos.x - targetPos.x) * 180 / Math.PI;
        const off = Math.abs(this.normalizeAngle(targetHeadingDeg - losToObserverDeg));
        if (off <= 30) return 'hot';
        if (off < 70) return 'flanking';
        if (off <= 110) return 'beaming';
        return 'cold';
    }

    static getDistance(x1: number, y1: number, x2: number, y2: number): number {
        return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    }

    // Area centroid of a simple polygon (shoelace formula), independent of
    // winding. This is the point Matter puts a fromVertices body's position at
    // (Vertices.centre), so a sprite whose origin sits here lines up with its
    // polygon body exactly.
    static polygonCentroid(points: Vector2[]): Vector2 {
        let area = 0;
        let cx = 0;
        let cy = 0;
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const q = points[(i + 1) % points.length];
            const cross = p.x * q.y - q.x * p.y;
            area += cross;
            cx += (p.x + q.x) * cross;
            cy += (p.y + q.y) * cross;
        }
        if (area === 0) return { x: points[0]?.x ?? 0, y: points[0]?.y ?? 0 };
        return { x: cx / (3 * area), y: cy / (3 * area) };
    }
}