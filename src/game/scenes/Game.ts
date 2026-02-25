import { Scene } from 'phaser';

import { startClusterVoice, stopClusterVoice } from '../audio/voiceAudio';
import { EventBus } from '../EventBus';
import {
    DifficultyState,
    PlantId,
    pickTargetPlantByHits,
    pickVoiceClipForTarget,
    resolveLandingResult,
    updateDifficultyStateByResult
} from '../systems/gameplaySystem';
import { createGameHud, drawWindFx, showLandingFeedback, updateGameHud } from '../ui/gameHud';
import { VoiceClip, VOICE_CLIPS } from '../utils/audioCatalog';

interface PlantState
{
    id: PlantId;
    x: number;
    hits: number;
    stem: Phaser.GameObjects.Rectangle;
    crown: Phaser.GameObjects.Ellipse;
    label: Phaser.GameObjects.Text;
}

interface ClusterState
{
    container: Phaser.GameObjects.Container;
    targetPlant: PlantId;
    drops: number;
    fallSpeed: number;
    voiceClip: VoiceClip;
    voiceSound: Phaser.Sound.BaseSound | null;
}

interface GameInitData
{
    mode?: string;
}

export class Game extends Scene
{
    private cursors: Phaser.Types.Input.Keyboard.CursorKeys;
    private keyA: Phaser.Input.Keyboard.Key;
    private keyD: Phaser.Input.Keyboard.Key;
    private plants: Record<PlantId, PlantState>;
    private activeCluster: ClusterState | null;
    private clusterSpawnTimer: Phaser.Time.TimerEvent;
    private secondTimer: Phaser.Time.TimerEvent;
    private scoreText: Phaser.GameObjects.Text;
    private timerText: Phaser.GameObjects.Text;
    private hintText: Phaser.GameObjects.Text;
    private windFx: Phaser.GameObjects.Graphics;
    private score: number;
    private secondsLeft: number;
    private roundOver: boolean;
    private difficultyState: DifficultyState;

    constructor ()
    {
        super('Game');

        this.plants = {} as Record<PlantId, PlantState>;
        this.activeCluster = null;
        this.score = 0;
        this.secondsLeft = 120;
        this.roundOver = false;
        this.difficultyState = {
            difficultyLevel: 1,
            levelCorrectCount: 0,
            level2WrongStreak: 0
        };
    }

    create (data: GameInitData)
    {
        const { width, height } = this.scale;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f1519);
        this.add.rectangle(width / 2, height - 86, width, 172, 0x6d4c41);

        const hud = createGameHud(this, width);
        this.scoreText = hud.scoreText;
        this.timerText = hud.timerText;
        this.hintText = hud.hintText;
        this.windFx = this.add.graphics();

        this.plants.lupinus = this.createPlant('lupinus', 280, 0x4caf50, 'Lupinus');
        this.plants.mushroom = this.createPlant('mushroom', width - 280, 0xef4444, 'Mushroom');

        this.cursors = this.input.keyboard!.createCursorKeys();
        this.keyA = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
        this.keyD = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);

        this.score = 0;
        this.secondsLeft = 120;
        this.roundOver = false;
        this.difficultyState = {
            difficultyLevel: 1,
            levelCorrectCount: 0,
            level2WrongStreak: 0
        };

        updateGameHud({ scoreText: this.scoreText, timerText: this.timerText }, this.score, this.secondsLeft);
        this.updatePlantVisual('lupinus');
        this.updatePlantVisual('mushroom');

        if (data.mode === 'time-attack')
        {
            this.hintText.setText('Time Attack: route each raindrop to the correct plant.');
        }

        this.clusterSpawnTimer = this.time.addEvent({
            delay: 10000,
            loop: true,
            callback: () => this.trySpawnCluster()
        });

        this.secondTimer = this.time.addEvent({
            delay: 1000,
            loop: true,
            callback: () => this.tickSecond()
        });

        this.trySpawnCluster();

        EventBus.emit('current-scene-ready', this);
    }

    update (_time: number, delta: number)
    {
        if (this.roundOver)
        {
            return;
        }

        if (!this.activeCluster)
        {
            return;
        }

        this.moveCluster(delta);
        this.activeCluster.container.y += this.activeCluster.fallSpeed * (delta / 1000);

        if (this.activeCluster.container.y >= 628)
        {
            this.resolveClusterLanding();
        }
    }

    private createPlant (id: PlantId, x: number, flowerColor: number, title: string): PlantState
    {
        this.add.rectangle(x, 650, 180, 76, 0x5a3f31);
        this.add.rectangle(x, 622, 124, 14, 0x7c523f);

        const stem = this.add.rectangle(x, 618, 16, 60, 0x2e7d32).setOrigin(0.5, 1);
        const crown = this.add.ellipse(x, 554, 36, 28, flowerColor);

        const label = this.add.text(x, 705, `${title}: 0/10`, {
            fontFamily: 'Arial Black',
            fontSize: 24,
            color: '#ffffff'
        }).setOrigin(0.5);

        return {
            id,
            x,
            hits: 0,
            stem,
            crown,
            label
        };
    }

    private trySpawnCluster ()
    {
        if (this.roundOver || this.activeCluster)
        {
            return;
        }

        const targetPlant = pickTargetPlantByHits(this.plants.lupinus.hits, this.plants.mushroom.hits);
        const clip = pickVoiceClipForTarget(targetPlant, this.difficultyState.difficultyLevel, VOICE_CLIPS);
        const drops = 3;
        const difficultyProgress = 1 - (this.secondsLeft / 120);
        const fallSpeed = Phaser.Math.Linear(110, 220, difficultyProgress);

        const cluster = this.add.container(this.scale.width / 2, 184);
        const cloud = this.add.ellipse(0, -20, 120, 56, 0xe2e8f0).setStrokeStyle(2, 0x64748b);
        const d1 = this.add.ellipse(-24, 12, 20, 28, 0x38bdf8).setStrokeStyle(1, 0x0369a1);
        const d2 = this.add.ellipse(0, 20, 20, 28, 0x38bdf8).setStrokeStyle(1, 0x0369a1);
        const d3 = this.add.ellipse(24, 12, 20, 28, 0x38bdf8).setStrokeStyle(1, 0x0369a1);
        const marker = this.add.text(0, -21, targetPlant === 'lupinus' ? 'L' : 'M', {
            fontFamily: 'Arial Black',
            fontSize: 24,
            color: '#0f172a'
        }).setOrigin(0.5);

        cluster.add([cloud, d1, d2, d3, marker]);

        const voiceSound = startClusterVoice(this, clip.key);

        this.activeCluster = {
            container: cluster,
            targetPlant,
            drops,
            fallSpeed,
            voiceClip: clip,
            voiceSound
        };

        const targetLabel = targetPlant === 'lupinus' ? 'Lupinus (M voice)' : 'Mushroom (F voice)';
        this.hintText.setText(`L${this.difficultyState.difficultyLevel} | ${clip.difficulty}-${clip.gender} | Target: ${targetLabel}`);
    }

    private moveCluster (delta: number)
    {
        if (!this.activeCluster)
        {
            return;
        }

        const moveLeft = this.cursors.left.isDown || this.keyA.isDown;
        const moveRight = this.cursors.right.isDown || this.keyD.isDown;

        if (moveLeft !== moveRight)
        {
            const dx = (moveLeft ? -1 : 1) * 280 * (delta / 1000);
            this.activeCluster.container.x = Phaser.Math.Clamp(this.activeCluster.container.x + dx, 68, this.scale.width - 68);

            drawWindFx(this.windFx, this.activeCluster.container.x, this.activeCluster.container.y, moveLeft ? -1 : 1);
        }
        else
        {
            this.windFx.clear();
        }
    }

    private resolveClusterLanding ()
    {
        if (!this.activeCluster)
        {
            return;
        }

        const landedX = this.activeCluster.container.x;
        const landing = resolveLandingResult(landedX, this.scale.width, this.activeCluster.targetPlant, this.activeCluster.drops);

        this.score += landing.delta;

        if (landing.correct)
        {
            this.plants[landing.wateredPlant].hits = Math.min(10, this.plants[landing.wateredPlant].hits + this.activeCluster.drops);
            this.updatePlantVisual(landing.wateredPlant);
        }

        const difficultyUpdate = updateDifficultyStateByResult(this.difficultyState, landing.correct);
        this.difficultyState = difficultyUpdate.state;

        updateGameHud({ scoreText: this.scoreText, timerText: this.timerText }, this.score, this.secondsLeft);
        showLandingFeedback(this, landing.correct, landing.delta, landedX);

        stopClusterVoice(this.activeCluster.voiceSound);
        this.activeCluster.container.destroy();
        this.activeCluster = null;
        this.windFx.clear();

        if (difficultyUpdate.transitionMessage)
        {
            this.hintText.setText(difficultyUpdate.transitionMessage);
        }

        if (this.plants.lupinus.hits >= 10 && this.plants.mushroom.hits >= 10)
        {
            this.endRound(true);
        }
    }

    private updatePlantVisual (id: PlantId)
    {
        const plant = this.plants[id];
        const progress = plant.hits / 10;
        const title = id === 'lupinus' ? 'Lupinus' : 'Mushroom';

        plant.stem.setScale(1, Phaser.Math.Linear(0.55, 2.7, progress));
        plant.crown.setDisplaySize(
            Phaser.Math.Linear(34, 108, progress),
            Phaser.Math.Linear(24, 82, progress)
        );

        const stage = progress >= 1 ? 'Adult' : (progress >= 0.4 ? 'Growing' : 'Seedling');
        plant.label.setText(`${title} ${stage}: ${plant.hits}/10`);
    }

    private tickSecond ()
    {
        if (this.roundOver)
        {
            return;
        }

        this.secondsLeft -= 1;
        updateGameHud({ scoreText: this.scoreText, timerText: this.timerText }, this.score, this.secondsLeft);

        if (this.secondsLeft <= 0)
        {
            const bothAdult = this.plants.lupinus.hits >= 10 && this.plants.mushroom.hits >= 10;
            this.endRound(bothAdult);
        }
    }

    private endRound (win: boolean)
    {
        if (this.roundOver)
        {
            return;
        }

        this.roundOver = true;

        if (this.clusterSpawnTimer)
        {
            this.clusterSpawnTimer.destroy();
        }

        if (this.secondTimer)
        {
            this.secondTimer.destroy();
        }

        if (this.activeCluster)
        {
            stopClusterVoice(this.activeCluster.voiceSound);
            this.activeCluster.container.destroy();
            this.activeCluster = null;
        }

        this.time.delayedCall(350, () => {
            this.scene.start('GameOver', {
                score: this.score,
                win,
                lupinusHits: this.plants.lupinus.hits,
                mushroomHits: this.plants.mushroom.hits
            });
        });
    }
}
