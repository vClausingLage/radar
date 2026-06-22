import Phaser from 'phaser';

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

const CONTROLS = [
    'A / D  turn left / right',
    'Q  cycle missiles      SPACE  fire',
    'R  RWS search   E  STT lock   ESC  exit STT',
    'T  deploy chaff      J  jammer',
    'SHIFT + click  set VIM-220 waypoint',
];

export default class StartMenu extends Phaser.Scene {
    private selected: ScenarioKey = 'duel';
    private scenarioButtons: Phaser.GameObjects.Text[] = [];

    constructor() {
        super('StartMenu');
    }

    create(): void {
        const cx = this.scale.width / 2;

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
        this.add.text(cx, this.scale.height - 140, CONTROLS.join('\n'), {
            fontSize: '15px',
            color: '#aaaaaa',
            align: 'center',
            lineSpacing: 6,
        }).setOrigin(0.5);
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
