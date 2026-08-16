import { AudioPlayer } from './audioPlayer';

// The player's own "Fox" call on missile launch — brevity code for what just
// left the rail: Fox One for semi-active radar homing (VIM-177), Fox Three
// for active radar homing (VIM-220). Reuses the callsign clip ("Flatspin
// 1-1") shared with the Level 1 GCI comms and the digit words already
// recorded for RadarVoice.
const FOX_DIGIT: Record<string, string> = {
    'VIM-177': 'one',
    'VIM-220': 'three',
};

export class MissileCallout {
    constructor(private readonly audio: AudioPlayer) {}

    announceFired(weaponType: string): void {
        const digit = FOX_DIGIT[weaponType];
        if (!digit) return;
        this.audio.playMessage(['plr-flatspin', 'one', 'one', 'plr-fox', digit]);
    }
}
