import Phaser from 'phaser';
import { gamepadSettings } from '../settings';

export type ScenarioKey = 'duel' | 'occluded' | 'skirmish';

interface ScenarioOption {
    key: ScenarioKey;
    label: string;
}

const SCENARIOS: ScenarioOption[] = [
    { key: 'duel', label: 'Duel — one idle ship to engage' },
    { key: 'occluded', label: 'Cover — idle ship behind an asteroid' },
    { key: 'skirmish', label: 'Skirmish — mixed ships & asteroids' },
];

const CAMPAIGN: { key: string; label: string }[] = [
    { key: 'Level1', label: '1 — MULE TRAIN' },
    { key: 'Level2', label: '2 — SHEPHERD' },
    { key: 'Level3', label: '3 — BACKDOOR' },
];

const CONTROLS = [
    'A / D  turn      W / S  throttle up / down',
    'R  RWS search   X  RWS > TWS > EMCON   E  STT lock   ESC  exit STT',
    'F  pick next target (lock and TWS shot go to it)',
    'Q  cycle missiles      SPACE  fire',
    'T  deploy chaff      J  jammer      I  IFF      M  menu',
    'C  ask Disco for a bogey dope (campaign)',
    'SHIFT + left click  set VIM-220 waypoint',
    'SHIFT + right click  clear VIM-220 waypoints',
];

const GAMEPAD_CONTROLS = [
    'GAMEPAD / STEAM DECK',
    'L-stick  turn',
    'A  fire      B  STT lock',
    'X  chaff     Y  jammer',
    'R1  RWS > TWS > EMCON',
    'L1  faster   L2  slower',
    'D-pad left  cycle missiles',
    'D-pad up  IFF',
    'D-pad right  pick next target',
    'D-pad down  bogey dope',
    'START  cold start switch, next',
    'SELECT  back to menu',
    'Menus  D-pad or stick, then A',
    'Touch  zoom',
];

const REPO_URL ='https://github.com/vClausingLage/radar';

// The menu is laid out on this fixed sheet and the camera zooms the sheet to
// fit the window. Laid out against the window itself, a laptop screen (under
// ~850 px tall) put the controls text on top of the campaign buttons and cut
// the last entries off the bottom.
const MENU_DESIGN_W_PX = 1100;
const MENU_DESIGN_H_PX = 880;

const PAD = Phaser.Input.Gamepad.Configs.XBOX_360;

// Padding (px) between a menu item and the cursor frame drawn around it.
const PAD_CURSOR_MARGIN_PX = 4;

// Set by the desktop wrapper (desktop/preload.cjs). A browser tab is the player's
// to close, so the web build has no such thing and offers no QUIT.
const desktopApp = (window as unknown as { desktopApp?: { quit(): void } }).desktopApp;

export default class StartMenu extends Phaser.Scene {
    private selected: ScenarioKey = 'duel';
    private scenarioButtons: Phaser.GameObjects.Text[] = [];
    // The menu items in pad order. A press is an emitted pointerdown, so pad and
    // touch run one code path per item.
    private padItems: Phaser.GameObjects.Text[] = [];
    private padCursor = 0;
    // The cursor stays hidden until the pad is used. The first press only reveals
    // it, because a browser needs one press just to reveal the pad to the page,
    // and that press must not launch whatever item happens to be first.
    private padCursorFrame?: Phaser.GameObjects.Graphics;
    private padCursorShown = false;
    private stickStepTaken = false;

    constructor() {
        super('StartMenu');
    }

    preload(): void {
        this.load.image('github_logo', 'github_logo.png');
    }

    create(): void {
        const cx = MENU_DESIGN_W_PX / 2;
        this.fitToWindow();
        const onResize = () => this.fitToWindow();
        this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, onResize));
        // Phaser reuses the scene instance: the campaign's M / ENTER bring the
        // menu back, and last run's buttons were destroyed with its display list.
        this.scenarioButtons = [];

        // Title
        this.add.text(cx, 90, 'RADAR GAME', {
            fontSize: '48px',
            color: '#00ff00',
        }).setOrigin(0.5);

        // Start button
        const startButton = this.add.text(cx, 180, 'START GAME', {
            fontSize: '32px',
            color: '#ffffff',
            backgroundColor: '#000000',
            padding: { x: 20, y: 10 },
        }).setOrigin(0.5).setInteractive();

        startButton.on('pointerdown', () => {
            this.scene.start('Game', { scenario: this.selected });
        });
        startButton.on('pointerover', () => {
            startButton.setStyle({ backgroundColor: '#00ff00', color: '#000000' });
        });
        startButton.on('pointerout', () => {
            startButton.setStyle({ backgroundColor: '#000000', color: '#ffffff' });
        });

        // Campaign — its own scenes, independent of the practice scenarios.
        this.add.text(cx, 432, 'CAMPAIGN', {
            fontSize: '18px',
            color: '#888888',
        }).setOrigin(0.5);
        const campaignButtons = CAMPAIGN.map((level, i) => this.createCampaignButton(cx, 470 + i * 44, level.label, level.key));

        // One versus two — its own scene, a two-ship hostile flight closing head-on.
        campaignButtons.push(this.createCampaignButton(cx, 470 + CAMPAIGN.length * 44 + 16, 'ONE VERSUS TWO', 'OneOnOne'));

        // Scenario selector (under Start)
        this.add.text(cx, 250, 'SCENARIO', {
            fontSize: '18px',
            color: '#888888',
        }).setOrigin(0.5);

        SCENARIOS.forEach((scenario, i) => {
            const button = this.add.text(cx, 290 + i * 44, scenario.label, {
                fontSize: '20px',
                color: '#ffffff',
                backgroundColor: '#000000',
                padding: { x: 16, y: 8 },
            }).setOrigin(0.5).setInteractive();

            button.on('pointerdown', () => {
                this.selected = scenario.key;
                this.refreshScenarioButtons();
            });
            button.on('pointerover', () => {
                if (scenario.key !== this.selected) button.setStyle({ backgroundColor: '#222222' });
            });
            button.on('pointerout', () => {
                if (scenario.key !== this.selected) button.setStyle({ backgroundColor: '#000000' });
            });

            button.setData('key', scenario.key);
            this.scenarioButtons.push(button);
        });
        this.refreshScenarioButtons();

        // Controls — small, light gray, beneath the menu
        this.add.text(cx, MENU_DESIGN_H_PX - 16, CONTROLS.join('\n'), {
            fontSize: '15px',
            color: '#aaaaaa',
            align: 'center',
            lineSpacing: 6,
        }).setOrigin(0.5, 1);

        this.add.text(16, MENU_DESIGN_H_PX - 16, GAMEPAD_CONTROLS.join('\n'), {
            fontSize: '15px',
            color: '#aaaaaa',
            lineSpacing: 6,
        }).setOrigin(0, 1);

        this.createRepoLink();

        this.padItems = [startButton, ...this.scenarioButtons, ...campaignButtons];
        if (desktopApp) this.padItems.push(this.createQuitButton(desktopApp.quit));
        this.setupPadCursor();
    }

    // Zoom the design sheet to the window, never above life size, centred.
    private fitToWindow(): void {
        const cam = this.cameras.main;
        const fit = Math.min(1, this.scale.width / MENU_DESIGN_W_PX, this.scale.height / MENU_DESIGN_H_PX);
        cam.setZoom(fit);
        cam.centerOn(MENU_DESIGN_W_PX / 2, MENU_DESIGN_H_PX / 2);
    }

    private createQuitButton(quit: () => void): Phaser.GameObjects.Text {
        const button = this.add.text(16, 16, 'QUIT', {
            fontSize: '20px',
            color: '#ffffff',
            backgroundColor: '#000000',
            padding: { x: 20, y: 10 },
        }).setInteractive();

        button.on('pointerdown', () => quit());
        button.on('pointerover', () => button.setStyle({ backgroundColor: '#00ff00', color: '#000000' }));
        button.on('pointerout', () => button.setStyle({ backgroundColor: '#000000', color: '#ffffff' }));
        return button;
    }

    // ── Gamepad cursor ─────────────────────────────────────────────────────

    private setupPadCursor(): void {
        this.padCursor = 0;
        this.padCursorShown = false;
        this.stickStepTaken = false;
        this.padCursorFrame = this.add.graphics();
        this.input.gamepad?.on('down', this.onPadButtonDown);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            this.input.gamepad?.off('down', this.onPadButtonDown);
        });
    }

    private onPadButtonDown = (_pad: Phaser.Input.Gamepad.Gamepad, button: Phaser.Input.Gamepad.Button) => {
        if (button.index === PAD.UP) this.movePadCursor(-1);
        else if (button.index === PAD.DOWN) this.movePadCursor(1);
        else if (button.index === PAD.A) this.pressPadItem();
    };

    private movePadCursor(step: 1 | -1): void {
        if (this.padCursorShown) {
            this.padCursor = Phaser.Math.Wrap(this.padCursor + step, 0, this.padItems.length);
        }
        this.drawPadCursor();
    }

    private pressPadItem(): void {
        if (!this.padCursorShown) {
            this.drawPadCursor();
            return;
        }
        this.padItems[this.padCursor].emit('pointerdown');
    }

    private drawPadCursor(): void {
        this.padCursorShown = true;
        const bounds = this.padItems[this.padCursor].getBounds();
        this.padCursorFrame?.clear()
            .lineStyle(2, 0x00ff00)
            .strokeRect(
                bounds.x - PAD_CURSOR_MARGIN_PX,
                bounds.y - PAD_CURSOR_MARGIN_PX,
                bounds.width + PAD_CURSOR_MARGIN_PX * 2,
                bounds.height + PAD_CURSOR_MARGIN_PX * 2,
            );
    }

    // The stick steps once per push, like the D-pad: it has to come back to centre
    // before it can step again, or the cursor would run away at frame rate.
    update(): void {
        let deflection = 0;
        for (const pad of this.input.gamepad?.getAll() ?? []) {
            if (Math.abs(pad.leftStick.y) > Math.abs(deflection)) deflection = pad.leftStick.y;
        }
        if (Math.abs(deflection) < gamepadSettings.MENU_STICK_THRESHOLD) {
            this.stickStepTaken = false;
        } else if (!this.stickStepTaken) {
            this.stickStepTaken = true;
            this.movePadCursor(deflection > 0 ? 1 : -1);
        }
    }

    // GitHub wordmark in the bottom-right corner, opening the repo in a new tab.
    private createRepoLink(): void {
        const margin = 16;
        const logoHeight = 28;
        const logo = this.add.image(MENU_DESIGN_W_PX - margin, MENU_DESIGN_H_PX - margin, 'github_logo')
            .setOrigin(1, 1)
            .setInteractive({ useHandCursor: true });
        logo.setScale(logoHeight / logo.height);

        logo.on('pointerdown', () => window.open(REPO_URL, '_blank', 'noopener'));
        logo.on('pointerover', () => logo.setAlpha(1));
        logo.on('pointerout', () => logo.setAlpha(0.7));
        logo.setAlpha(0.7);
    }

    private createCampaignButton(x: number, y: number, label: string, sceneKey: string): Phaser.GameObjects.Text {
        const button = this.add.text(x, y, label, {
            fontSize: '20px',
            color: '#ffffff',
            backgroundColor: '#000000',
            padding: { x: 20, y: 10 },
        }).setOrigin(0.5).setInteractive();

        button.on('pointerdown', () => this.scene.start(sceneKey));
        button.on('pointerover', () => button.setStyle({ backgroundColor: '#00ff00', color: '#000000' }));
        button.on('pointerout', () => button.setStyle({ backgroundColor: '#000000', color: '#ffffff' }));
        return button;
    }

    private refreshScenarioButtons(): void {
        this.scenarioButtons.forEach(button => {
            const isSelected = button.getData('key') === this.selected;
            button.setStyle({
                backgroundColor: isSelected ? '#00ff00' : '#000000',
                color: isSelected ? '#000000' : '#ffffff',
            });
        });
    }
}
