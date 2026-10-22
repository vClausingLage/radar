import Game from './game';
import { world } from '../settings';

// One on one: the player and a single hostile cruiser, nose to nose across the
// world at half its height — player on the west edge facing east, opponent on
// the east edge facing west. Nothing else emits, reflects or occludes, so the
// whole exchange is one radar against another: who detects first, who locks,
// who shoots, who jams. A clean stage for showing the numbers behind it.
export default class OneOnOne extends Game {
    constructor() {
        super('OneOnOne');
    }

    // Both ships start just inside the margin the AI steers away from, so the
    // opponent closes head-on instead of turning off the wall at once.
    protected playerStart(): { x: number; y: number; direction: number } {
        return { x: world.BORDER_MARGIN, y: this.world.height / 2, direction: 0 };
    }

    protected buildScenario(): void {
        this.targets.push(this.add.target({
            x: this.world.width - 1200,
            y: this.world.height / 2,
            direction: 180,
            speed: .1,
            type: 'cruiser',
        }));
    }

    protected briefingMessage(): string {
        return 'ONE ON ONE. A single hostile cruiser is closing head-on from the east. Find it, lock it, beat it.';
    }
}
