import Game from "./game";
import { DishRadarStation } from "../entities/dishRadarStation";
import { AudioPlayer } from "../audio/audioPlayer";
import { SupportRadarComms } from "../audio/supportRadarComms";

// Campaign — Level 2. The player flies alongside a friendly early-warning dish
// radar mounted on an asteroid. The dish sweeps 360° out to long range and
// datalinks its contacts to the player: they show up in cyan on the tactical
// picture, and pressing C calls the bearing to the nearest one over comms.
export default class Level2 extends Game {
    private station?: DishRadarStation;
    private comms?: SupportRadarComms;
    // Transient HUD line echoing the last comms request (the visual half of the
    // datalink callout), pinned to the camera.
    private commsHud?: Phaser.GameObjects.Text;

    constructor() {
        super('Level2');
    }

    // Enemy contacts sit beyond the player's own radar reach but inside the
    // dish's 2000 px cover, so the datalink is the only way to see them at first.
    protected buildScenario(): void {
        this.station = new DishRadarStation(this, { x: 1600, y: 1900 });
        // The rock is terrain: hand it to the player's radar occlusion/ground map.
        this.asteroids.push(this.station.rock);

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

        this.input.keyboard?.on('keydown-C', this.onRequestBearing);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown-C', this.onRequestBearing);
        });
    }

    protected briefingMessage(): string {
        return 'LEVEL 2 — A friendly dish radar (cyan) shares its 360° picture with you. Contacts it sees appear on your display even beyond your own radar. Press C for the bearing to the nearest datalink contact.';
    }

    // Ask the support radar for the nearest contact: speak the bearing and echo
    // it on the HUD, so the shared picture reaches the player by voice and sight.
    private onRequestBearing = () => {
        if (!this.player || !this.station || !this.comms) return;
        const call = this.comms.requestNearest(this.player, this.station.getTracks());
        this.showCommsHud(call
            ? `SUPPORT RADAR — NEAREST CONTACT BRA ${String(call.bearing).padStart(3, '0')}`
            : 'SUPPORT RADAR — NO CONTACTS');
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
