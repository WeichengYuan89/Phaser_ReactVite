import { Scene } from 'phaser';

import { EventBus } from '../EventBus';
import { DifficultyClass, VoiceClip, VoiceGender, VOICE_CLIPS } from '../audioCatalog';

type PlantId = 'lupinus' | 'mushroom';
type DifficultyLevel = 1 | 2 | 3;

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
    private difficultyLevel: DifficultyLevel;
    private levelCorrectCount: number;
    private level2WrongStreak: number;

    constructor ()
    {
        super('Game');

        this.plants = {} as Record<PlantId, PlantState>;
        this.activeCluster = null;
        this.score = 0;
        this.secondsLeft = 120;
        this.roundOver = false;
        this.difficultyLevel = 1;
        this.levelCorrectCount = 0;
        this.level2WrongStreak = 0;
    }

    create (data: GameInitData)
    {
        const { width, height } = this.scale;

        this.add.rectangle(width / 2, height / 2, width, height, 0xa5d8ff);
        this.add.rectangle(width / 2, height - 86, width, 172, 0x6d4c41);

        this.add.rectangle(width / 2, 90, width, 80, 0x0f172a, 0.92);
        this.scoreText = this.add.text(30, 66, 'Score: 0', {
            fontFamily: 'Arial Black',
            fontSize: 34,
            color: '#f8fafc'
        });
        this.timerText = this.add.text(width - 30, 66, 'Time: 2:00', {
            fontFamily: 'Arial Black',
            fontSize: 34,
            color: '#f8fafc'
        }).setOrigin(1, 0);

        this.hintText = this.add.text(width / 2, 140, 'Move with LEFT / RIGHT (or A / D)', {
            fontFamily: 'Arial',
            fontSize: 22,
            color: '#0f172a',
            backgroundColor: '#ffffffcc',
            padding: { x: 12, y: 6 }
        }).setOrigin(0.5);

        this.windFx = this.add.graphics();

        this.plants.lupinus = this.createPlant('lupinus', 280, 0x4caf50, 'Lupinus');
        this.plants.mushroom = this.createPlant('mushroom', width - 280, 0xef4444, 'Mushroom');

        this.cursors = this.input.keyboard!.createCursorKeys();
        this.keyA = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
        this.keyD = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);

        this.score = 0;
        this.secondsLeft = 120;
        this.roundOver = false;
        this.difficultyLevel = 1;
        this.levelCorrectCount = 0;
        this.level2WrongStreak = 0;

        this.updateHud();
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

        if (this.activeCluster)
        {
            this.moveCluster(delta);
            this.activeCluster.container.y += this.activeCluster.fallSpeed * (delta / 1000);

            if (this.activeCluster.container.y >= 628)
            {
                this.resolveClusterLanding();
            }
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

        const targetPlant = this.pickTargetPlant();
        const clip = this.pickVoiceClip(targetPlant);
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

        const voiceSound = this.startClusterVoice(clip.key);

        this.activeCluster = {
            container: cluster,
            targetPlant,
            drops,
            fallSpeed,
            voiceClip: clip,
            voiceSound
        };

        const targetLabel = targetPlant === 'lupinus' ? 'Lupinus (M voice)' : 'Mushroom (F voice)';
        this.hintText.setText(`L${this.difficultyLevel} | ${clip.difficulty}-${clip.gender} | Target: ${targetLabel}`);
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

            this.drawWind(this.activeCluster.container.x, this.activeCluster.container.y, moveLeft ? -1 : 1);
        }
        else
        {
            this.windFx.clear();
        }
    }

    private drawWind (x: number, y: number, direction: -1 | 1)
    {
        const offset = direction * 42;

        this.windFx.clear();
        this.windFx.lineStyle(3, 0xffffff, 0.7);
        this.windFx.beginPath();
        this.windFx.moveTo(x - (offset * 0.4), y - 40);
        this.windFx.lineTo(x + offset, y - 30);
        this.windFx.moveTo(x - (offset * 0.4), y - 24);
        this.windFx.lineTo(x + offset, y - 14);
        this.windFx.moveTo(x - (offset * 0.4), y - 8);
        this.windFx.lineTo(x + offset, y + 2);
        this.windFx.strokePath();
    }

    private resolveClusterLanding ()
    {
        if (!this.activeCluster)
        {
            return;
        }

        const landedX = this.activeCluster.container.x;
        const wateredPlant: PlantId = landedX < this.scale.width / 2 ? 'lupinus' : 'mushroom';
        const correct = wateredPlant === this.activeCluster.targetPlant;
        const delta = correct ? (10 * this.activeCluster.drops) : (-5 * this.activeCluster.drops);

        this.score += delta;

        if (correct)
        {
            this.plants[wateredPlant].hits = Math.min(10, this.plants[wateredPlant].hits + this.activeCluster.drops);
            this.updatePlantVisual(wateredPlant);
        }

        const transitionMessage = this.updateDifficultyByResult(correct);

        this.updateHud();
        this.showLandingFeedback(correct, delta, landedX);

        this.stopClusterVoice(this.activeCluster.voiceSound);
        this.activeCluster.container.destroy();
        this.activeCluster = null;
        this.windFx.clear();

        if (transitionMessage)
        {
            this.hintText.setText(transitionMessage);
        }

        if (this.plants.lupinus.hits >= 10 && this.plants.mushroom.hits >= 10)
        {
            this.endRound(true);
        }
    }

    private showLandingFeedback (correct: boolean, delta: number, x: number)
    {
        const msg = correct ? `Correct +${delta}` : `Wrong ${delta}`;
        const color = correct ? '#16a34a' : '#dc2626';

        const feedback = this.add.text(x, 618, msg, {
            fontFamily: 'Arial Black',
            fontSize: 28,
            color
        }).setOrigin(0.5, 1);

        this.tweens.add({
            targets: feedback,
            y: feedback.y - 80,
            alpha: 0,
            duration: 850,
            onComplete: () => feedback.destroy()
        });
    }

    private pickTargetPlant (): PlantId
    {
        const lupinus = this.plants.lupinus.hits;
        const mushroom = this.plants.mushroom.hits;

        if (lupinus === mushroom)
        {
            return Math.random() < 0.5 ? 'lupinus' : 'mushroom';
        }

        return lupinus < mushroom ? 'lupinus' : 'mushroom';
    }

    private pickVoiceClip (targetPlant: PlantId): VoiceClip
    {
        const requiredGender: VoiceGender = targetPlant === 'lupinus' ? 'M' : 'F';
        const allowedDifficulties = this.getAllowedDifficulties();

        const candidates = VOICE_CLIPS.filter((clip) => (
            allowedDifficulties.includes(clip.difficulty) && clip.gender === requiredGender
        ));

        if (candidates.length > 0)
        {
            return candidates[Math.floor(Math.random() * candidates.length)];
        }

        const fallback = VOICE_CLIPS.find((clip) => clip.gender === requiredGender) ?? VOICE_CLIPS[0];
        return fallback;
    }

    private getAllowedDifficulties (): DifficultyClass[]
    {
        if (this.difficultyLevel === 1)
        {
            return ['D1', 'D2'];
        }

        if (this.difficultyLevel === 2)
        {
            return ['D3'];
        }

        return ['D1', 'D2', 'D3'];
    }

    private updateDifficultyByResult (correct: boolean): string | null
    {
        if (this.difficultyLevel === 1)
        {
            if (correct)
            {
                this.levelCorrectCount += 1;

                if (this.levelCorrectCount >= 3)
                {
                    this.difficultyLevel = 2;
                    this.levelCorrectCount = 0;
                    this.level2WrongStreak = 0;
                    return 'Difficulty up: Level 2 (D3 only)';
                }
            }

            return null;
        }

        if (this.difficultyLevel === 2)
        {
            if (correct)
            {
                this.levelCorrectCount += 1;
                this.level2WrongStreak = 0;

                if (this.levelCorrectCount >= 3)
                {
                    this.difficultyLevel = 3;
                    this.levelCorrectCount = 0;
                    this.level2WrongStreak = 0;
                    return 'Difficulty up: Level 3 (D1/D2/D3 mixed)';
                }
            }
            else
            {
                this.level2WrongStreak += 1;

                if (this.level2WrongStreak >= 2)
                {
                    this.difficultyLevel = 1;
                    this.levelCorrectCount = 0;
                    this.level2WrongStreak = 0;
                    return 'Difficulty down: Back to Level 1 (D1/D2)';
                }
            }

            return null;
        }

        return null;
    }

    private startClusterVoice (key: string): Phaser.Sound.BaseSound | null
    {
        if (!this.cache.audio.exists(key))
        {
            return null;
        }

        const voice = this.sound.add(key, {
            loop: false,
            volume: 1
        });

        voice.play();

        return voice;
    }

    private stopClusterVoice (voiceSound: Phaser.Sound.BaseSound | null)
    {
        if (!voiceSound)
        {
            return;
        }

        voiceSound.stop();
        voiceSound.destroy();
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
        this.updateHud();

        if (this.secondsLeft <= 0)
        {
            const bothAdult = this.plants.lupinus.hits >= 10 && this.plants.mushroom.hits >= 10;
            this.endRound(bothAdult);
        }
    }

    private updateHud ()
    {
        const minutes = Math.floor(this.secondsLeft / 60);
        const seconds = this.secondsLeft % 60;
        const secondText = seconds < 10 ? `0${seconds}` : `${seconds}`;

        this.scoreText.setText(`Score: ${this.score}`);
        this.timerText.setText(`Time: ${minutes}:${secondText}`);
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
            this.stopClusterVoice(this.activeCluster.voiceSound);
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
