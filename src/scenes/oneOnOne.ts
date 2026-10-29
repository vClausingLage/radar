import Game from './game';
import { world } from '../settings';

// One versus two: the player against a two-ship flight of hostile cruisers,
// nose to nose across the world at half its height — player on the west edge
// facing east, the flight on the east edge facing west, wingman abeam of its
// lead. Nothing else emits, reflects or occludes, so the whole exchange is one
// radar against a pair: who detects first, whether two ships read as one
// contact at range, who locks, who shoots, who jams. A clean stage for showing
// the numbers behind it. The scene key stays 'OneOnOne'.
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
        const flight = this.add.flight({
            x: this.world.width - 1200,
            y: this.world.height / 2,
            direction: 180,
            speed: .1,
        });
        this.targets.push(...flight.members());
    }

    protected briefingMessage(): string {
        return 'ONE VERSUS TWO. A two-ship flight of hostile cruisers is closing head-on from the east, wingman abeam of its lead. Find them, lock them, beat them.';
    }
}
