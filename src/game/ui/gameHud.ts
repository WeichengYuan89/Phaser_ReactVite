import { GameObjects, Scene } from 'phaser';

export interface GameHud
{
    scoreText: GameObjects.Text;
    timerText: GameObjects.Text;
    hintText: GameObjects.Text;
}

export function createGameHud (scene: Scene, width: number): GameHud
{

    const scoreText = scene.add.text(30, 66, 'Score: 0', {
        fontFamily: 'Arial Black',
        fontSize: 34,
        color: '#f8fafc'
    });

    const timerText = scene.add.text(width - 30, 66, 'Time: 2:00', {
        fontFamily: 'Arial Black',
        fontSize: 34,
        color: '#f8fafc'
    }).setOrigin(1, 0);

    const hintText = scene.add.text(width / 2, 20, 'Move with LEFT / RIGHT (or A / D)', {
        fontFamily: 'Arial',
        fontSize: 22,
        color: '#0f172a',
        backgroundColor: '#ffffffcc',
        padding: { x: 12, y: 6 }
    }).setOrigin(0.5);

    return { scoreText, timerText, hintText };
}

export function updateGameHud (hud: Pick<GameHud, 'scoreText' | 'timerText'>, score: number, secondsLeft: number)
{
    const minutes = Math.floor(secondsLeft / 60);
    const seconds = secondsLeft % 60;
    const secondText = seconds < 10 ? `0${seconds}` : `${seconds}`;

    hud.scoreText.setText(`Score: ${score}`);
    hud.timerText.setText(`Time: ${minutes}:${secondText}`);
}

export function showLandingFeedback (scene: Scene, correct: boolean, delta: number, x: number)
{
    const msg = correct ? `Correct +${delta}` : `Wrong ${delta}`;
    const color = correct ? '#16a34a' : '#dc2626';

    const feedback = scene.add.text(x, 618, msg, {
        fontFamily: 'Arial Black',
        fontSize: 28,
        color
    }).setOrigin(0.5, 1);

    scene.tweens.add({
        targets: feedback,
        y: feedback.y - 80,
        alpha: 0,
        duration: 850,
        onComplete: () => feedback.destroy()
    });
}
