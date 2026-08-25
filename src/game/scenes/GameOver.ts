import { Scene } from 'phaser';

import { EventBus } from '../EventBus';
import { MAX_RUNG } from '../data/difficulty';
import { ParticipantGroup, blockWithinSitting, totalBlocks } from '../../study/protocol';

interface GameOverData
{
    trials?: number;
    accuracy?: number | null;
    rungReached?: number;
    plantsGrown?: number;
    stalls?: number;
    group?: ParticipantGroup;
    blocksCompleted?: number;
}

/**
 * End of a training block.
 *
 * No win/lose split and no score (DECISIONS D11-4/D11-6): the block ends on a
 * fixed trial count, so "finishing" is not an achievement and not finishing is
 * not a failure.
 *
 * **The rung is not shown to the participant (D16-5).** It used to headline this
 * screen as "reached level 5 of 8", and that breaks in both directions once the
 * roadmap exists: a second "N of M" appears next to the progress path, and this
 * one measures difficulty — the one thing D15-4 forbids the progress display
 * from expressing. A participant reads it as a score they should raise, which
 * they cannot (the staircase sets it), and a participant who ends low reads it
 * as a verdict, which is the failure signal removing the score was meant to
 * delete. It now sits in the grey experimenter line with accuracy and stalls.
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
        const group = data.group ?? 'NH';
        const blocksCompleted = data.blocksCompleted ?? 1;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f172a);

        this.add.text(width / 2, 140, 'Block complete', {
            fontFamily: 'Arial Black',
            fontSize: 48,
            color: '#f8fafc'
        }).setOrigin(0.5);

        this.add.text(width / 2, 240, `${plantsGrown} plant${plantsGrown === 1 ? '' : 's'} fully grown`, {
            fontFamily: 'Arial Black',
            fontSize: 40,
            color: '#86efac'
        }).setOrigin(0.5);

        // Dose, not performance — the same quantity the roadmap advances on.
        const position = blockWithinSitting(blocksCompleted - 1);
        const remaining = Math.max(0, totalBlocks(group) - blocksCompleted);

        this.add.text(width / 2, 320,
            `${trials} raindrops  ·  block ${position} of this sitting`
            + (remaining > 0 ? `  ·  ${remaining} left in the study` : '  ·  study complete'), {
                fontFamily: 'Arial',
                fontSize: 28,
                color: '#cbd5e1'
            }).setOrigin(0.5);

        // Experimenter-facing, not participant-facing: accuracy, the staircase
        // rung and any audio stalls belong on screen for the person running the
        // session, and nowhere near the participant's summary.
        const detail = accuracy === null
            ? `No scored trials  ·  ladder R${rungReached}/R${MAX_RUNG}`
            : `Accuracy ${(accuracy * 100).toFixed(0)}%  ·  ladder R${rungReached}/R${MAX_RUNG}`
                + '  ·  data exported to your downloads folder';

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

        // One exit, to the roadmap (D16-1). "Another block" used to restart the
        // scene directly, which is how a block could silently begin without the
        // participant ever seeing where they were in the protocol.
        const continueButton = this.add.text(width / 2, 540, 'CONTINUE', {
            fontFamily: 'Arial Black',
            fontSize: 34,
            color: '#0f172a',
            backgroundColor: '#22c55e',
            padding: { x: 28, y: 12 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        this.add.text(width / 2, 610, 'Press ENTER or SPACE', {
            fontFamily: 'Arial',
            fontSize: 22,
            color: '#64748b'
        }).setOrigin(0.5);

        const leave = () => EventBus.emit('block-complete');

        continueButton.on('pointerdown', leave);
        this.input.keyboard?.once('keydown-ENTER', leave);
        this.input.keyboard?.once('keydown-SPACE', leave);

        EventBus.emit('current-scene-ready', this);
    }
}
