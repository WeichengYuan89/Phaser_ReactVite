import { GameObjects, Scene } from 'phaser';

import { EventBus } from '../EventBus';

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

        this.add.rectangle(width / 2, height / 2, width, height, 0xf1519);
        this.add.rectangle(width / 2, height - 90, width, 180, 0x6a4a3a);

        this.add.text(width / 2, 120, 'VOICE PLANT', {
            fontFamily: 'Arial Black',
            fontSize: 64,
            color: '#1f2937',
            stroke: '#ffffff',
            strokeThickness: 6
        }).setOrigin(0.5);

        this.add.text(width / 2, 210, 'Demo 0.11', {
            fontFamily: 'Arial',
            fontSize: 28,
            color: '#ffffff'
        }).setOrigin(0.5);

        this.add.text(width / 2, 290, 'Time Attack (2:00)', {
            fontFamily: 'Arial',
            fontSize: 28,
            color: '#ffffff',
            align: 'center',
            lineSpacing: 8
        }).setOrigin(0.5);

        this.startButton = this.add.text(width / 2, 470, 'START', {
            fontFamily: 'Arial Black',
            fontSize: 40,
            color: '#1f2937',
            backgroundColor: '#131415',
            padding: { x: 24, y: 12 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        this.startButton.on('pointerdown', () => {
            this.startGame();
        });


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
        this.scene.start('Game', { mode: 'time-attack' });
    }
}
