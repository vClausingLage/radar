import Phaser from "phaser";
import { Ship, Target } from "./ship";

// A tow cable between a tug and a hull with no drive of its own. Not a Matter
// constraint: a constraint would also pull the tug back, and a fighter's
// engines dwarf anything a drifting hulk could do to it. So the line is
// one-way — it takes up slack, then drags the tow along behind at the tug's
// pace, turning it to trail on the line like a real tow does.
//
// Hauling happens through the tow's velocity only; it keeps its own Matter
// body, so it is still a radar return, still a missile target, and still
// wrecked by anything it is dragged into.
const LINE_LENGTH_PX = 95;
// How hard a taut line pulls: the slack beyond LINE_LENGTH_PX is closed at
// this fraction per step, capped at MAX_TOW_SPEED.
const LINE_STIFFNESS = 0.02;
// A little over the tug's full speed, so the tow keeps up but never overtakes.
const MAX_TOW_SPEED = 0.12;
// A slack line leaves the tow coasting — bleeding speed through nothing but
// the line dragging on it.
const SLACK_DAMPING = 0.98;
// How fast (deg per step) the tow swings round to trail on the line.
const TRAIL_TURN_DEG = 1.2;

export class TowLine {
    private attached = true;

    constructor(
        private readonly tug: Ship,
        private readonly tow: Target,
    ) {}

    isAttached(): boolean {
        return this.attached && this.tug.active && !!this.tug.body && this.tow.active && !!this.tow.body;
    }

    // Cast off: the tow keeps whatever way it has on.
    release(): void {
        this.attached = false;
    }

    // Once per frame: haul, then draw the line into the shared per-frame graphics.
    update(graphics: Phaser.GameObjects.Graphics): void {
        if (!this.isAttached()) return;

        const dx = this.tug.x - this.tow.x;
        const dy = this.tug.y - this.tow.y;
        const distance = Math.hypot(dx, dy) || 1;
        const slack = distance - LINE_LENGTH_PX;

        if (slack > 0) {
            const speed = Math.min(slack * LINE_STIFFNESS + Math.max(0, this.tug.getCurrentSpeed()), MAX_TOW_SPEED);
            this.tow.setVelocity((dx / distance) * speed, (dy / distance) * speed);
            const bearing = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
            const delta = Phaser.Math.Angle.WrapDegrees(bearing - this.tow.angle);
            this.tow.setAngle(this.tow.angle + Phaser.Math.Clamp(delta, -TRAIL_TURN_DEG, TRAIL_TURN_DEG));
        } else {
            const velocity = this.tow.body!.velocity;
            this.tow.setVelocity(velocity.x * SLACK_DAMPING, velocity.y * SLACK_DAMPING);
        }

        // Taut: a straight line. Slack: it sags off to one side.
        graphics.lineStyle(1.5, 0xcfcfcf, 0.9);
        if (slack > 0) {
            graphics.lineBetween(this.tow.x, this.tow.y, this.tug.x, this.tug.y);
        } else {
            const sag = Math.min(-slack, LINE_LENGTH_PX) * 0.4;
            const curve = new Phaser.Curves.QuadraticBezier(
                new Phaser.Math.Vector2(this.tow.x, this.tow.y),
                new Phaser.Math.Vector2(
                    (this.tow.x + this.tug.x) / 2 - (dy / distance) * sag,
                    (this.tow.y + this.tug.y) / 2 + (dx / distance) * sag,
                ),
                new Phaser.Math.Vector2(this.tug.x, this.tug.y),
            );
            curve.draw(graphics, 16);
        }
    }
}
