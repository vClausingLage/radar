import Phaser from "phaser";
import Game from "./game";
import { DishRadarStation } from "../entities/dishRadarStation";
import { AudioPlayer } from "../audio/audioPlayer";
import { SupportRadarComms } from "../audio/supportRadarComms";

// Campaign — Level 1. The ship sits powered down on the launchpad; the player
// brings it to life with the cold-start procedure (BAT, ENG1, ENG2, SYS) before
// flight controls are handed over. Once airborne, a friendly early-warning dish
// radar mounted on an asteroid, call sign "Disco" (player call sign: "Flatspin
// 1-1"), sweeps 360° out to long range and datalinks its contacts to the
// player: they show up in cyan on the tactical picture, and pressing C keys a
// "bogey dope" request — GCI-style radio traffic — that Disco answers with the
// nearest contact's BRAA picture and a speed order.
export default class Level1 extends Game {
    private station?: DishRadarStation;
    private comms?: SupportRadarComms;
    // Transient HUD line echoing the last comms exchange (the visual half of the
    // datalink callout), pinned to the camera.
    private commsHud?: Phaser.GameObjects.Text;

    constructor() {
        super('Level1');
    }

    preload() {
        super.preload();
        // Ground scenery, campaign-only — the practice scenarios are set in open space.
        this.load.image('launchpad', 'launchpad.png');
        this.load.image('surface', 'surface.png');

        // GCI ("Disco") voice clips — ElevenLabs. Bogey-dope BRAA replies reuse
        // the same vocabulary as the player's own RadarVoice callouts, but as a
        // distinct speaker every shared word needs its own recording.
        const gciClips = [
            'gci-disco', 'gci-flatspin', 'gci-bra', 'gci-for',
            'gci-hot', 'gci-flanking', 'gci-beaming', 'gci-cold',
            'gci-clean', 'gci-hostile', 'gci-buster', 'gci-gate', 'gci-saunter',
            'gci-zero', 'gci-one', 'gci-two', 'gci-three', 'gci-four',
            'gci-five', 'gci-six', 'gci-seven', 'gci-eight', 'gci-nine',
            'gci-100', 'gci-200', 'gci-300', 'gci-400', 'gci-500',
            'gci-600', 'gci-700', 'gci-800', 'gci-900', 'gci-1000',
        ];
        // Player's radio voice — GPT, matching RadarVoice's existing clips.
        // ('plr-flatspin' is loaded globally by Game.preload() — the missile
        // Fox call shares it.)
        const playerClips = ['plr-disco', 'plr-bogey-dope'];
        [...gciClips, ...playerClips].forEach(key => this.load.audio(key, `audio/${key}.mp3`));
    }

    protected requiresColdStart(): boolean {
        return true;
    }

    protected buildTerrain(): void {
        this.registerFadeAsset(this.add.image(0, 2380, 'surface').setOrigin(0));
        this.registerFadeAsset(this.add.image(1400, 2300, 'launchpad').setOrigin(0).setScale(.25));
    }

    // Enemy contacts sit beyond the player's own radar reach but inside the
    // dish's 2000 px cover, so the datalink is the only way to see them at first.
    protected buildScenario(): void {
        this.station = new DishRadarStation(this, { x: 1600, y: 1900 });
        // The rock is terrain: hand it to the player's radar occlusion/ground map
        // (which also opts it into the visual fade, since it's a tracked asteroid).
        this.asteroids.push(this.station.rock);
        // The rotating overlay isn't tracked anywhere else — fade it to match.
        this.registerFadeAsset(this.station.getDishSprite());

        this.targets.push(this.add.target({ x: 1600, y: 600, direction: 90, speed: 0, type: 'cruiser' }));
        this.targets.push(this.add.target({ x: 750, y: 1050, direction: 0, speed: 0, type: 'cargo' }));
    }

    create() {
        super.create();

        // On-demand comms: no cooldown, so each C press is answered immediately.
        this.comms = new SupportRadarComms(new AudioPlayer(this, 0));

        this.commsHud = this.add.text(this.scale.width / 2, 120, '', {
            font: '20px Courier',
            color: '#00aeef',
            backgroundColor: '#000000aa',
            padding: { x: 12, y: 6 },
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000).setVisible(false);

        this.input.keyboard?.on('keydown-C', this.onRequestBogeyDope);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown-C', this.onRequestBogeyDope);
        });
    }

    protected briefingMessage(): string {
        return 'LEVEL 1 — Your ship is powered down on the pad. Run the startup: BAT, then ENG1, ENG2, and SYS. Once airborne: a friendly GCI station, "Disco" (cyan on the datalink), shares its 360° picture with you. Press C to call "bogey dope" — Disco answers with the nearest contact\'s bearing, range, aspect and a speed order.';
    }

    // Key a "bogey dope" call: the player transmits the request (GPT voice) and
    // Disco replies with the nearest datalink contact's BRAA picture and a speed
    // order (ElevenLabs voice), or "clean" if there's nothing on the scope. Echo
    // the same picture on the HUD so it reaches the player by voice and sight.
    private onRequestBogeyDope = () => {
        if (!this.player || !this.station || !this.comms) return;
        // EMCON forbids any active transmission, including keying the radio —
        // the request never goes out, so Disco never answers.
        if (this.player.radar.getMode() === 'emcon') {
            this.showCommsHud('EMCON — TRANSMISSION HELD');
            return;
        }
        const call = this.comms.requestBogeyDope(this.player, this.station.getTracks());
        this.showCommsHud(call
            ? `DISCO — BRA ${String(call.bearing).padStart(3, '0')} FOR ${Math.round(call.rangePx)}, ${call.aspect.toUpperCase()}, HOSTILE — ${call.speedOrder.toUpperCase()}`
            : 'DISCO — PICTURE CLEAN');
    };

    private showCommsHud(text: string): void {
        if (!this.commsHud) return;
        this.tweens.killTweensOf(this.commsHud);
        this.commsHud.setText(text).setVisible(true).setAlpha(1);
        this.tweens.add({
            targets: this.commsHud,
            alpha: 0,
            delay: 3500,
            duration: 800,
            onComplete: () => this.commsHud?.setVisible(false),
        });
    }

    update(time: number, delta: number): void {
        super.update(time, delta);

        // Base update bailed (player gone / graphics torn down): don't draw.
        if (!this.player || !this.graphics) return;

        // Sweep the dish and paint the shared picture. It detects the targets
        // (not the friendly player) and is occluded by the same terrain list.
        this.station?.update(delta, this.targets, this.asteroids, this.graphics);
    }

    protected destroyPlayer(): void {
        super.destroyPlayer();
        this.station?.destroy();
        this.station = undefined;
    }
}
