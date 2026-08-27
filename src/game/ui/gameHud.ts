import { GameObjects, Scene } from 'phaser';

import { GARDEN_DEPTH_CEILING } from './gardenView';

/** Above the drop and everything else — nothing may occlude the HUD. */
const HUD_DEPTH = GARDEN_DEPTH_CEILING + 300;

/**
 * Training HUD — DECISIONS D11-6.
 *
 * Two things are deliberately gone:
 *
 *  - **the numeric score.** It duplicated the garden, and its negative half was
 *    a failure signal in a rehabilitation task that is designed not to have one.
 *  - **the countdown clock.** The round ends on trial count, so a clock would be
 *    meaningless — and it would put back exactly the time pressure that removing
 *    the fall-speed ramp took out (D9-4). Time pressure on a motor task
 *    confounds the in-game learning curve RQ3 reports.
 *
 * What replaces them is a neutral trial counter.
 */

export interface GameHud
{
    trialText: GameObjects.Text;
    hintText: GameObjects.Text;
}

export function createGameHud (scene: Scene, width: number): GameHud
{
    const trialText = scene.add.text(30, 20, '', {
        fontFamily: 'Arial Black',
        fontSize: 30,
        color: '#f8fafc'
    }).setDepth(HUD_DEPTH);

    const hintText = scene.add.text(width / 2, 24, 'Move LEFT / RIGHT (A / D)', {
        fontFamily: 'Arial',
        fontSize: 22,
        color: '#0f172a',
        backgroundColor: '#ffffffcc',
        padding: { x: 12, y: 6 }
    }).setOrigin(0.5, 0).setDepth(HUD_DEPTH);

    return { trialText, hintText };
}

export function updateGameHud (
    hud: Pick<GameHud, 'trialText'>,
    trial: number,
    total: number,
    wildcard = false
)
{
    const progress = `${Math.min(trial, total)} / ${total}`;

    hud.trialText.setText(wildcard ? `★ Mystery  ·  ${progress}` : progress);
}

export type LandingOutcome = 'correct' | 'incorrect' | 'wildcard' | 'no-answer';

/**
 * Feedback after a landing.
 *
 * Training keeps feedback — that is the point of training, and it is the one
 * place the two activities legitimately differ (`/test` has none, per route C).
 * But it carries no points, and the wrong-answer form is informational rather
 * than punitive: it names the voice that was played instead of scoring the miss.
 *
 * `no-answer` is its own state, not a miss. The drop was never steered to a
 * side, so telling the participant they were wrong would be false — they did
 * not answer.
 */
export function showLandingFeedback (
    scene: Scene,
    outcome: LandingOutcome,
    answerLabel: string,
    x: number
)
{
    const message = outcome === 'correct'
        ? 'Correct'
        : outcome === 'incorrect'
            ? `That was ${answerLabel}`
            : outcome === 'wildcard'
                ? 'Mystery voice collected'
                : 'Steer the drop to a plant';
    const color = outcome === 'correct' || outcome === 'wildcard' ? '#16a34a' : '#e2e8f0';

    const feedback = scene.add.text(x, 600, message, {
        fontFamily: 'Arial Black',
        fontSize: 26,
        color
    }).setOrigin(0.5, 1).setDepth(GARDEN_DEPTH_CEILING + 200);

    scene.tweens.add({
        targets: feedback,
        y: feedback.y - 80,
        alpha: 0,
        duration: 850,
        onComplete: () => feedback.destroy()
    });
}
