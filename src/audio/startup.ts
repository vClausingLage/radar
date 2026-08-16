import Phaser from 'phaser';
import { AudioPlayer } from './audioPlayer';

// The ship's cold-start procedure: the player throws four switches in order and
// the crew calls each one back over the intercom. This module owns the sequence
// and its audio only — the switches themselves are drawn by the InterfaceRenderer
// and the engine plumes are lit by the Ship, both via the hooks below.

export type StartupStepKey = 'BAT' | 'ENG1' | 'ENG2' | 'SYS';

export const STARTUP_STEPS: readonly StartupStepKey[] = ['BAT', 'ENG1', 'ENG2', 'SYS'];

// Pause between throwing a switch and the crew's callback — the beat in which
// the system is coming up.
const SWITCH_ACK_DELAY_MS = 600;
// Spool-up: how long an engine turns between "starting number x" and the
// confirmation that it is running.
const ENGINE_SPOOL_MS = 2200;

type StartupHooks = {
    // A switch was thrown and its sequence is running (switch shows as busy).
    onStepBusy: (step: StartupStepKey) => void;
    // The switch's sequence finished (switch shows as done).
    onStepDone: (step: StartupStepKey) => void;
    // An engine has begun turning — light its exhaust plume. 0-based index.
    onEngineStart: (engineIndex: number) => void;
    // The whole procedure is complete: the ship is ready for departure.
    onComplete: () => void;
};

export class ShipStartup {
    // How many steps of STARTUP_STEPS are done; also the index of the next one.
    private completedCount = 0;
    // True while a step's audio/timers are in flight — blocks further presses.
    private busy = false;

    constructor(
        private readonly scene: Phaser.Scene,
        private readonly audio: AudioPlayer,
        private readonly hooks: StartupHooks,
    ) {}

    isComplete(): boolean {
        return this.completedCount >= STARTUP_STEPS.length;
    }

    // Steps must be thrown in order, one at a time — this is the only step the
    // player may press right now.
    canPress(step: StartupStepKey): boolean {
        return !this.busy && STARTUP_STEPS[this.completedCount] === step;
    }

    press(step: StartupStepKey): void {
        if (!this.canPress(step)) return;
        this.busy = true;
        this.hooks.onStepBusy(step);
        this.scene.time.delayedCall(SWITCH_ACK_DELAY_MS, () => this.runStep(step));
    }

    private runStep(step: StartupStepKey): void {
        switch (step) {
            case 'BAT':
                this.say(['power_is_up'], () => this.finishStep(step));
                break;
            case 'ENG1':
                this.startEngine(0, 'starting_number_one', 'number_one_is_running', step);
                break;
            case 'ENG2':
                this.startEngine(1, 'starting_number_two', 'number_two_is_running', step);
                break;
            case 'SYS':
                this.say(['ready_departure'], () => this.finishStep(step));
                break;
        }
    }

    // "starting number x" → the engine lights and spools → "number x is running".
    private startEngine(
        engineIndex: number,
        startingClip: string,
        runningClip: string,
        step: StartupStepKey,
    ): void {
        this.say([startingClip], () => {
            this.hooks.onEngineStart(engineIndex);
            this.scene.time.delayedCall(ENGINE_SPOOL_MS, () => {
                this.say([runningClip], () => this.finishStep(step));
            });
        });
    }

    // Play a callback clip and continue when it ends. If the player rejects the
    // message (something else is on the intercom) the sequence continues anyway
    // rather than leaving the startup stuck on a half-thrown switch.
    private say(keys: string[], then: () => void): void {
        if (!this.audio.playMessage(keys, then)) then();
    }

    private finishStep(step: StartupStepKey): void {
        this.completedCount++;
        this.busy = false;
        this.hooks.onStepDone(step);
        if (this.isComplete()) this.hooks.onComplete();
    }
}
