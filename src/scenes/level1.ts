import Game from "./game";
import { AudioPlayer } from "../audio/audioPlayer";
import { ShipStartup } from "../audio/startup";

// Campaign — Level 1. The ship sits powered down on the launchpad and the
// player brings it to life with the cold-start procedure (BAT, ENG1, ENG2, SYS)
// before the normal flight controls are handed over.
export default class Level1 extends Game {
    private startup?: ShipStartup;

    constructor() {
        super('Level1');
    }

    preload() {
        super.preload();
        // Ground scenery, campaign-only — the practice scenarios are set in open space.
        this.load.image('launchpad', 'launchpad.png');
        this.load.image('surface', 'surface.png');

        // Crew callbacks for the startup procedure.
        const startupClips = [
            'power_is_up',
            'starting_number_one', 'number_one_is_running',
            'starting_number_two', 'number_two_is_running',
            'ready_departure',
        ];
        startupClips.forEach(key => this.load.audio(key, `audio/${key}.mp3`));
    }

    create() {
        super.create();
        this.beginColdStart();
    }

    protected buildTerrain(): void {
        this.add.image(0, 2380, 'surface').setOrigin(0);
        this.add.image(1400, 2300, 'launchpad').setOrigin(0).setScale(.25);
    }

    // Level 1 is the cold start on the pad — no traffic in the world yet.
    protected buildScenario(): void {}

    protected briefingMessage(): string {
        return 'LEVEL 1 — Your ship is powered down on the pad. Run the startup: BAT, then ENG1, ENG2, and SYS. Flight controls are handed over once the ship is ready for departure.';
    }

    // Park the ship cold and put the startup switches where the flight controls
    // normally sit. Each switch drives the ShipStartup sequence, which calls back
    // to light the engine plumes and to hand the ship over when it is done.
    private beginColdStart(): void {
        const player = this.player;
        if (!player) return;

        // On the pad: no way on and both engines out.
        player.setCurrentSpeed(0);
        player.shutDownEngines();

        const ui = player.radar.getInterfaceRenderer();
        ui?.setFlightControlsVisible(false);

        // No cooldown — the crew callbacks are a scripted sequence, not the
        // throttled radio chatter the default cooldown exists for.
        this.startup = new ShipStartup(this, new AudioPlayer(this, 0), {
            onStepBusy: step => ui?.setStartupStepState(step, 'busy'),
            onStepDone: step => ui?.setStartupStepState(step, 'done'),
            onEngineStart: engineIndex => player.setEngineRunning(engineIndex, true),
            onComplete: () => {
                ui?.destroyStartupPanel();
                ui?.setFlightControlsVisible(true);
            },
        });

        ui?.createStartupPanel(step => this.startup?.press(step));
    }
}
