import { Scene } from 'phaser';

import { EventBus } from '../EventBus';

interface GameOverData
{
    trials?: number;
    accuracy?: number | null;
    rungReached?: number;
    plantsGrown?: number;
    stalls?: number;
}

/**
 * End of a training block.
 *
 * No win/lose split and no score (DECISIONS D11-4/D11-6): the round ends on a
 * fixed trial count, so "finishing" is not an achievement and not finishing is
 * not a failure. What is shown instead is what the participant actually did —
 * how much they grew, and how far up the ladder they got.
 */
export class GameOver extends Scene
{
    constructor ()
    {
        super('GameOver');
    }

    create (data: GameOverData)
    {
        const { width, height } = this.scale;
        const trials = data.trials ?? 0;
        const accuracy = data.accuracy ?? null;
        const rungReached = data.rungReached ?? 1;
        const plantsGrown = data.plantsGrown ?? 0;
        const stalls = data.stalls ?? 0;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f172a);

        this.add.text(width / 2, 140, 'Session complete', {
            fontFamily: 'Arial Black',
            fontSize: 48,
            color: '#f8fafc'
        }).setOrigin(0.5);

        this.add.text(width / 2, 240, `${plantsGrown} plant${plantsGrown === 1 ? '' : 's'} fully grown`, {
            fontFamily: 'Arial Black',
            fontSize: 40,
            color: '#86efac'
        }).setOrigin(0.5);

        this.add.text(width / 2, 320, `${trials} raindrops  ·  reached level ${rungReached} of 8`, {
            fontFamily: 'Arial',
            fontSize: 28,
            color: '#cbd5e1'
        }).setOrigin(0.5);

        // Experimenter-facing, not participant-facing: the accuracy figure and
        // any audio stalls belong on screen for the person running the session.
        const detail = accuracy === null
            ? 'No scored trials.'
            : `Accuracy ${(accuracy * 100).toFixed(0)}%  ·  data exported to your downloads folder`;

        this.add.text(width / 2, 390, detail, {
            fontFamily: 'Arial',
            fontSize: 22,
            color: '#94a3b8'
        }).setOrigin(0.5);

        if (stalls > 0)
        {
            this.add.text(width / 2, 428, `${stalls} trial(s) started before audio was ready — check the log`, {
                fontFamily: 'Arial',
                fontSize: 20,
                color: '#fbbf24'
            }).setOrigin(0.5);
        }

        const againButton = this.add.text(width / 2, 520, 'ANOTHER BLOCK (R)', {
            fontFamily: 'Arial Black',
            fontSize: 34,
            color: '#0f172a',
            backgroundColor: '#22c55e',
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        const menuButton = this.add.text(width / 2, 600, 'MAIN MENU (M)', {
            fontFamily: 'Arial Black',
            fontSize: 30,
            color: '#f8fafc',
            backgroundColor: '#334155',
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        againButton.on('pointerdown', () => this.scene.start('Game'));
        menuButton.on('pointerdown', () => this.scene.start('MainMenu'));

        this.input.keyboard?.once('keydown-R', () => this.scene.start('Game'));
        this.input.keyboard?.once('keydown-M', () => this.scene.start('MainMenu'));

        EventBus.emit('current-scene-ready', this);
    }
}
