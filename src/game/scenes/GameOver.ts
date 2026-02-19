import { Scene } from 'phaser';

import { EventBus } from '../EventBus';

interface GameOverData
{
    score?: number;
    win?: boolean;
    lupinusHits?: number;
    mushroomHits?: number;
}

export class GameOver extends Scene
{
    constructor ()
    {
        super('GameOver');
    }

    create (data: GameOverData)
    {
        const { width, height } = this.scale;
        const score = data.score ?? 0;
        const win = data.win ?? false;
        const lupinusHits = data.lupinusHits ?? 0;
        const mushroomHits = data.mushroomHits ?? 0;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f172a);

        this.add.text(width / 2, 130, win ? 'Both Plants Reached Adult Stage' : 'Time Attack Complete', {
            fontFamily: 'Arial Black',
            fontSize: 48,
            color: '#f8fafc',
            align: 'center'
        }).setOrigin(0.5);

        this.add.text(width / 2, 240, `Total Score: ${score}`, {
            fontFamily: 'Arial Black',
            fontSize: 56,
            color: '#facc15'
        }).setOrigin(0.5);

        this.add.text(width / 2, 330, `Lupinus: ${lupinusHits}/10   Mushroom: ${mushroomHits}/10`, {
            fontFamily: 'Arial',
            fontSize: 30,
            color: '#cbd5e1'
        }).setOrigin(0.5);

        this.add.text(width / 2, 400, 'This serious-game prototype has no hard lose state.', {
            fontFamily: 'Arial',
            fontSize: 24,
            color: '#94a3b8'
        }).setOrigin(0.5);

        const retryButton = this.add.text(width / 2, 500, 'RETRY (R)', {
            fontFamily: 'Arial Black',
            fontSize: 40,
            color: '#0f172a',
            backgroundColor: '#22c55e',
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        const menuButton = this.add.text(width / 2, 590, 'MAIN MENU (M)', {
            fontFamily: 'Arial Black',
            fontSize: 36,
            color: '#f8fafc',
            backgroundColor: '#334155',
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        retryButton.on('pointerdown', () => this.scene.start('Game', { mode: 'time-attack' }));
        menuButton.on('pointerdown', () => this.scene.start('MainMenu'));

        this.input.keyboard?.once('keydown-R', () => this.scene.start('Game', { mode: 'time-attack' }));
        this.input.keyboard?.once('keydown-M', () => this.scene.start('MainMenu'));

        EventBus.emit('current-scene-ready', this);
    }
}
