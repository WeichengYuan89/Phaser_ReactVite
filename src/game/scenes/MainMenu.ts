import { GameObjects, Scene } from 'phaser';

import { EventBus } from '../EventBus';
import { TRIALS_PER_ROUND } from '../training/garden';

export class MainMenu extends Scene
{
    startButton: GameObjects.Text;

    constructor ()
    {
        super('MainMenu');
    }

    create ()
    {
        const { width, height } = this.scale;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f1519);
        this.add.rectangle(width / 2, height - 90, width, 180, 0x5A3F31);

        this.add.text(width / 2, 130, 'VOICE PLANT', {
            fontFamily: 'Arial Black',
            fontSize: 64,
            color: '#1f2937',
            stroke: '#ffffff',
            strokeThickness: 6
        }).setOrigin(0.5);

        this.add.text(width / 2, 230, `Training block · ${TRIALS_PER_ROUND} raindrops, about 5–6 minutes`, {
            fontFamily: 'Arial',
            fontSize: 26,
            color: '#ffffff'
        }).setOrigin(0.5);

        this.add.text(width / 2, 310,
            'A voice falls with each raindrop.\n'
            + 'Steer it LEFT to the Lupinus if the voice sounds like a man,\n'
            + 'RIGHT to the Cactus if it sounds like a woman.\n'
            + 'Correct answers make that plant grow.', {
                fontFamily: 'Arial',
                fontSize: 24,
                color: '#e2e8f0',
                align: 'center',
                lineSpacing: 8
            }).setOrigin(0.5);

        this.startButton = this.add.text(width / 2, 500, 'START', {
            fontFamily: 'Arial Black',
            fontSize: 40,
            color: '#f8fafc',
            backgroundColor: '#131415',
            padding: { x: 24, y: 12 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        this.startButton.on('pointerdown', () => this.startGame());

        this.add.text(width / 2, 620, 'Press ENTER or SPACE to start', {
            fontFamily: 'Arial',
            fontSize: 24,
            color: '#0f172a'
        }).setOrigin(0.5);

        this.input.keyboard?.once('keydown-ENTER', () => this.startGame());
        this.input.keyboard?.once('keydown-SPACE', () => this.startGame());

        EventBus.emit('current-scene-ready', this);
    }

    changeScene ()
    {
        this.startGame();
    }

    private startGame ()
    {
        this.scene.start('Game');
    }
}
