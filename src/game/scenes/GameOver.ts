import { Scene } from 'phaser';

import { EventBus } from '../EventBus';
import {
    ParticipantGroup,
    BLOCKS_PER_SITTING,
    blockWithinSitting,
    totalBlocks
} from '../../study/protocol';

interface GameOverData
{
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
 * D24 makes this participant-only. Accuracy, rung, stalls and export details
 * belong in researcher data, never on this completion screen.
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
        const group = data.group ?? 'CI';
        const blocksCompleted = data.blocksCompleted ?? 1;
        const position = blockWithinSitting(blocksCompleted - 1);
        const complete = blocksCompleted >= totalBlocks(group);
        const sittingComplete = !complete && position === BLOCKS_PER_SITTING;
        const title = complete ? 'Study complete' : sittingComplete ? 'Sitting complete' : 'Block complete';
        const message = complete
            ? 'You have completed all six training blocks.'
            : sittingComplete
                ? 'You have completed all three blocks in this sitting.'
                : `You have completed block ${position} of ${BLOCKS_PER_SITTING}.`;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f172a);

        this.add.text(width / 2, 150, title, {
            fontFamily: 'Arial Black',
            fontSize: 48,
            color: '#f8fafc'
        }).setOrigin(0.5);

        this.add.text(width / 2, 250, '✓', {
            fontFamily: 'Arial Black',
            fontSize: 68,
            color: '#86efac'
        }).setOrigin(0.5);

        this.add.text(width / 2, 350, message, {
            fontFamily: 'Arial',
            fontSize: 28,
            color: '#cbd5e1',
            align: 'center',
            wordWrap: { width: 760 }
        }).setOrigin(0.5);

        this.add.text(width / 2, 410,
            complete
                ? 'Thank you for taking part.'
                : sittingComplete
                    ? 'The overview will show what to do next.'
                    : 'Take a short break before the next block.', {
                fontFamily: 'Arial',
                fontSize: 22,
                color: '#94a3b8'
            }).setOrigin(0.5);

        // One exit, to the roadmap (D16-1). "Another block" used to restart the
        // scene directly, which is how a block could silently begin without the
        // participant ever seeing where they were in the protocol.
        const continueButton = this.add.text(width / 2, 540, 'VIEW NEXT STEP', {
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
