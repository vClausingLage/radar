import Phaser from 'phaser';
import { AudioPlayer } from './audioPlayer';
import radioScript from './radioScript.json';

// The campaign's scripted radio traffic — briefings, check-ins, the other
// ships on the frequency. Every line lives in radioScript.json: who says it,
// the subtitle, and (for the clip generator) what the voice actually speaks.
// tools/generateClips.js records each line to public/audio/story/<key>.mp3.
export type RadioLineKey = keyof typeof radioScript.lines;
export type RadioSpeakerKey = keyof typeof radioScript.speakers;

// What the scene shows while a line is on the air.
export type RadioTransmission = {
    key: RadioLineKey;
    speaker: string;
    color: string;
    text: string;
};

// A transmission without its recording is still shown for the time it takes
// to read — so the story plays whole before the voices are generated.
const READING_MS_PER_CHAR = 55;
const READING_MIN_MS = 1800;
// Dead air between two transmissions: nobody on a real net keys up on top of
// the last word.
const GAP_BETWEEN_LINES_MS = 450;

type OnAir = {
    key: RadioLineKey;
    audioDone: boolean;
    holdUntil: number;
};

// One radio frequency. Transmissions go out one at a time, in order, and never
// on top of anything else on the same net: the AudioPlayer is shared with the
// datalink comms (SupportRadarComms), so a scripted line waits for a contact
// call to finish and vice versa (the comms ask isBusy() before keying up).
export class RadioNet {
    private queue: RadioLineKey[] = [];
    private onAir?: OnAir;
    private quietUntil = 0;

    constructor(
        private readonly scene: Phaser.Scene,
        private readonly audio: AudioPlayer,
        // Called with each transmission as it starts, and with null when the
        // net goes quiet again.
        private readonly onTransmission: (transmission: RadioTransmission | null) => void,
    ) {}

    // Clip keys and paths for every scripted line, for a scene's preload.
    static clips(): { key: RadioLineKey; path: string }[] {
        return (Object.keys(radioScript.lines) as RadioLineKey[])
            .map(key => ({ key, path: `audio/story/${key}.mp3` }));
    }

    // Queue lines behind whatever is already waiting.
    say(...keys: RadioLineKey[]): void {
        this.queue.push(...keys);
    }

    // Drop what is still waiting and put these next — for the verdict at the
    // end of a mission, which must not sit behind idle chatter. A line already
    // on the air finishes: a transmission cannot be un-said.
    interrupt(...keys: RadioLineKey[]): void {
        this.queue = [...keys];
    }

    // Something is on the air or waiting to go out.
    isBusy(): boolean {
        return this.onAir !== undefined || this.queue.length > 0;
    }

    update(): void {
        const now = this.scene.time.now;

        if (this.onAir) {
            if (!this.onAir.audioDone || now < this.onAir.holdUntil) return;
            this.onAir = undefined;
            this.quietUntil = now + GAP_BETWEEN_LINES_MS;
            this.onTransmission(null);
        }

        if (this.queue.length === 0 || now < this.quietUntil) return;
        // Someone else (a Disco contact call) has the frequency.
        if (this.audio.isPlaying()) return;

        const key = this.queue.shift()!;
        const line = radioScript.lines[key];
        const speaker = radioScript.speakers[line.speaker as RadioSpeakerKey];
        const recorded = this.scene.cache.audio.exists(key);

        const onAir: OnAir = {
            key,
            audioDone: false,
            // With a recording the clip decides how long the line lasts;
            // without one, reading time does.
            holdUntil: recorded ? now : now + Math.max(READING_MIN_MS, line.text.length * READING_MS_PER_CHAR),
        };
        this.onAir = onAir;
        // A missing clip is skipped by the player and completes at once.
        const accepted = this.audio.playMessage([key], () => { onAir.audioDone = true; });
        if (!accepted) onAir.audioDone = true;

        this.onTransmission({
            key,
            speaker: speaker?.label ?? line.speaker.toUpperCase(),
            color: speaker?.color ?? '#ffffff',
            text: line.text,
        });
    }
}
