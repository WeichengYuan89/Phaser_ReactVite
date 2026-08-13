import { Scene } from 'phaser';

import { createRainTrail, RainTrail } from '../effects/rainTrail';
import { createWaterBucket, WaterBucket } from '../effects/waterBucket';
import { EventBus } from '../EventBus';
import { createGameHud, showLandingFeedback, updateGameHud } from '../ui/gameHud';
import { createGardenView, GardenView, GARDEN_DEPTH_CEILING } from '../ui/gardenView';
import { createFence } from '../ui/fence';
import { TRIALS_PER_ROUND } from '../training/garden';
import { TrainingSession, TrainingTrial } from '../training/trainingSession';
import {
    DEFAULT_CONFIG,
    convergedRung,
    nextSittingConfig,
    resumeStaircase,
    withinSittingConfig
} from '../training/staircase';
import { PLANT_LABEL, PLANT_FOR_SIDE, answerForLandingX } from '../../shared/sides';
import { PlaybackHandle, StimulusPlayer } from '../../study/StimulusPlayer';
import { Response, TrialLog, download } from '../../study/trialLog';
import { readCarryOver, writeCarryOver } from '../../study/sessionStore';
import { ParticipantGroup, isGroup } from '../../study/protocol';

/** Vertical travel of a drop, from spawn to the plant line. */
const SPAWN_Y = 60;
const LANDING_Y = 628;

/**
 * The drop is in front of the whole scene: it crosses the fence and lands among
 * the beds, and it is the one object the participant is steering.
 */
const DROP_DEPTH = GARDEN_DEPTH_CEILING + 100;

/** Gap between a landing and the next spawn (INTEGRATION_DESIGN §7 P2). */
const INTER_TRIAL_MS = 1000;
/**
 * If a fetch somehow outruns the gap, hold the spawn rather than starting a
 * trial in silence, and record the stall (§4.3). On localhost this should never
 * fire.
 */
const MAX_STALL_MS = 5000;

type ClusterPhase = 'falling' | 'held';

interface ClusterState
{
    container: Phaser.GameObjects.Container;
    trial: TrainingTrial;
    fallSpeed: number;
    trail: RainTrail | null;
    playback: PlaybackHandle | null;
    phase: ClusterPhase;
}

interface GameInitData
{
    participantId?: string;
    sessionId?: string;
    group?: ParticipantGroup;
}

/**
 * The training activity.
 *
 * Structure worth knowing before editing: **all adaptive logic lives outside
 * this scene**, in `game/training/` (pure, and covered by `npm run check`). The
 * scene asks `TrainingSession` for a trial, renders it, and reports the outcome.
 * Nothing here decides difficulty or which answer comes next.
 *
 * That separation is the P1 fix. The scene used to call
 * `pickTargetPlantByHits()` — which returned whichever plant had fewer hits, and
 * hits only rose on a correct answer — so the target strictly alternated
 * left/right for as long as the player was correct, and watering the shorter
 * plant scored well without listening to anything. Both that function and the
 * scene's own difficulty state are gone.
 */
export class Game extends Scene
{
    private cursors: Phaser.Types.Input.Keyboard.CursorKeys;
    private keyA: Phaser.Input.Keyboard.Key;
    private keyD: Phaser.Input.Keyboard.Key;
    private keyShift: Phaser.Input.Keyboard.Key;

    private session: TrainingSession;
    private player: StimulusPlayer;
    private log: TrialLog;
    private participantId = 'anonymous';
    private sittingId = 'sitting-1';
    private group: ParticipantGroup = 'NH';
    private blocksCompletedBefore = 0;

    private garden: GardenView;
    private waterBucket: WaterBucket;
    private windFx: Phaser.GameObjects.Graphics;
    private trialText: Phaser.GameObjects.Text;
    private hintText: Phaser.GameObjects.Text;

    private activeCluster: ClusterState | null = null;
    private spawnTimer: Phaser.Time.TimerEvent | null = null;
    private roundOver = false;
    private stalls = 0;

    constructor ()
    {
        super('Game');
    }

    create (data: GameInitData)
    {
        const { width, height } = this.scale;

        this.roundOver = false;
        this.activeCluster = null;
        this.stalls = 0;

        this.participantId = data.participantId
            ?? (this.registry.get('participantId') as string | undefined)
            ?? 'anonymous';
        this.sittingId = data.sessionId
            ?? (this.registry.get('sessionId') as string | undefined)
            ?? 'sitting-1';

        const group = data.group ?? this.registry.get('group');

        this.group = isGroup(group) ? group : 'NH';

        // The AudioContext is created and unlocked in React, inside the click
        // that starts the session — a browser will not let it start otherwise.
        this.player = this.registry.get('stimulusPlayer') as StimulusPlayer;

        if (!this.player)
        {
            // Reaching a scene without one means the game was booted outside
            // GameRoute, so no AudioContext was unlocked in a user gesture and
            // every trial would run in silence. Fail loudly instead.
            throw new Error(
                'No StimulusPlayer in the registry — start the game through study/GameRoute.tsx.'
            );
        }

        const carry = readCarryOver(this.participantId);

        this.blocksCompletedBefore = carry?.blocksCompleted ?? 0;

        this.log = new TrialLog({
            participantId: this.participantId,
            sessionId: this.sittingId,
            block: `block-${this.blocksCompletedBefore + 1}`
        });

        /**
         * Where the staircase picks up — three cases, and the middle one is the
         * defect D14 found and D15-3 settled. Every block used to take the
         * cross-sitting path: drop a rung, re-run the 6-trial warm-up. In a
         * 3-block sitting that spent 18 trials, a tenth of the appointment,
         * re-learning a level the participant had not left, and walked the rung
         * down three times in one hour.
         *
         *   no record          → fresh track, R1 warm-up, coarse step
         *   same sitting       → resume exactly, no drop, no warm-up
         *   a later sitting    → one rung below convergence, warm-up, fine step
         */
        const sameSitting = carry !== null && carry.lastSittingId === this.sittingId;

        this.session = new TrainingSession(
            carry === null
                ? { config: DEFAULT_CONFIG }
                : (sameSitting
                    ? {
                        config: withinSittingConfig(carry.staircase),
                        staircase: resumeStaircase(carry.staircase),
                        garden: carry.garden
                    }
                    : { config: nextSittingConfig(carry.staircase), garden: carry.garden })
        );

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f1519);

        // The ground band. Its top edge is the soil/sky horizon the fence and
        // the garden beds both sit on.
        const horizonY = height - 86 - (172 / 2);

        this.add.rectangle(width / 2, height - 86, width, 172, 0x5a3f31);
        createFence(this, width, horizonY);

        const hud = createGameHud(this, width);
        this.trialText = hud.trialText;
        this.hintText = hud.hintText;
        this.windFx = this.add.graphics();

        // Restored positions, not fresh random ones (D16-3): the plants a
        // participant grew last block must stand where they stood.
        this.garden = createGardenView(this, width, carry?.placements);
        this.garden.render(this.session.garden);

        this.cursors = this.input.keyboard!.createCursorKeys();
        this.keyA = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
        this.keyD = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);
        this.keyShift = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

        // A corner prop, not a feature of the play area: ~60 % of its original
        // footprint, tucked left of the Lupinus planter (which spans x 190-370).
        this.waterBucket = createWaterBucket(this, { x: 70, bottomY: 600, width: 50, height: 82 });

        updateGameHud({ trialText: this.trialText }, 1, TRIALS_PER_ROUND);
        this.hintText.setText('Steer each raindrop to the plant that matches the voice.');

        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanUp());

        this.scheduleNextTrial(0);

        EventBus.emit('current-scene-ready', this);
    }

    update (_time: number, delta: number)
    {
        if (this.roundOver || !this.activeCluster || this.activeCluster.phase === 'held')
        {
            return;
        }

        if (Phaser.Input.Keyboard.JustDown(this.keyShift))
        {
            this.holdActiveCluster();
            return;
        }

        const prevX = this.activeCluster.container.x;
        const prevY = this.activeCluster.container.y;

        this.moveCluster(delta);
        this.activeCluster.container.y += this.activeCluster.fallSpeed * (delta / 1000);

        if (this.activeCluster.trail && delta > 0)
        {
            const dt = delta / 1000;
            this.activeCluster.trail.updateVelocity(
                (this.activeCluster.container.x - prevX) / dt,
                (this.activeCluster.container.y - prevY) / dt
            );
        }

        if (this.activeCluster.container.y >= LANDING_Y)
        {
            this.resolveClusterLanding();
        }
    }

    /**
     * Decide the next trial immediately and start fetching it, then spawn once
     * both the inter-trial gap has elapsed and the buffer is decoded (§4.3).
     *
     * `nextTrial()` is idempotent until a result is recorded, so asking now to
     * prefetch and asking again at spawn time yield the same trial.
     */
    private scheduleNextTrial (delayMs: number)
    {
        if (this.roundOver)
        {
            return;
        }

        const trial = this.session.nextTrial();

        this.player.prefetch(trial.stimulus);

        const startedWaiting = performance.now();

        const attempt = () =>
        {
            if (this.roundOver)
            {
                return;
            }

            const waited = performance.now() - startedWaiting;

            if (this.player.isReady(trial.stimulus) || waited >= MAX_STALL_MS)
            {
                if (!this.player.isReady(trial.stimulus))
                {
                    this.stalls += 1;
                }

                this.spawnCluster(trial);
                return;
            }

            this.spawnTimer = this.time.delayedCall(50, attempt);
        };

        this.spawnTimer = this.time.delayedCall(delayMs, attempt);
    }

    private spawnCluster (trial: TrainingTrial)
    {
        if (this.roundOver || this.activeCluster)
        {
            return;
        }

        const container = this.add.container(this.scale.width / 2, SPAWN_Y);

        container.add(this.add.image(0, 0, 'rain-particle'));
        container.setDepth(DROP_DEPTH);

        // The fall is sized by the stimulus, and never ramps (P3 / D9-4):
        // difficulty comes from the stimulus alone, and time pressure on a motor
        // task would confound the in-game learning curve.
        const fallSpeed = (LANDING_Y - SPAWN_Y) / (trial.fallDurationMs / 1000);
        // One below the drop, so the head reads on top of its own trail.
        const trail = createRainTrail(this, container, {
            offsetY: 14,
            maxSpeed: 200,
            depth: DROP_DEPTH - 1
        });

        trail.updateVelocity(0, fallSpeed);

        const cluster: ClusterState = {
            container,
            trial,
            fallSpeed,
            trail,
            playback: null,
            phase: 'falling'
        };

        this.activeCluster = cluster;

        updateGameHud({ trialText: this.trialText }, trial.index + 1, TRIALS_PER_ROUND);

        void this.player.play(trial.stimulus).then((playback) =>
        {
            if (this.activeCluster === cluster)
            {
                cluster.playback = playback;
            }
            else
            {
                playback.stop();
            }
        }).catch(() =>
        {
            // A stimulus that will not play must not silently become a trial.
            this.hintText.setText('Audio failed to load — check the stimulus server.');
        });
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
            this.activeCluster.container.x = Phaser.Math.Clamp(
                this.activeCluster.container.x + dx, 68, this.scale.width - 68
            );
        }
        else
        {
            this.windFx.clear();
        }
    }

    /**
     * SHIFT parks the drop in the bucket — the P4 case. It used to vanish with
     * no judgement, no record and no effect on anything. It is now logged as
     * `aborted` and skipped by the staircase: missing data, not a wrong answer.
     */
    private holdActiveCluster ()
    {
        if (!this.activeCluster || this.activeCluster.phase !== 'falling')
        {
            return;
        }

        const cluster = this.activeCluster;

        cluster.phase = 'held';
        cluster.playback?.stop();
        cluster.playback = null;
        cluster.trail?.destroy();
        cluster.trail = null;
        this.windFx.clear();

        this.logTrial(cluster, 'aborted', null, null);

        const outcome = this.session.recordResult('aborted');

        this.waterBucket.holdCluster(cluster.container, cluster.trial.stimulus, () =>
        {
            cluster.container.destroy();

            if (this.activeCluster === cluster)
            {
                this.activeCluster = null;
            }

            this.afterTrial(outcome.roundOver);
        });
    }

    private resolveClusterLanding ()
    {
        const cluster = this.activeCluster;

        if (!cluster)
        {
            return;
        }

        const landedX = cluster.container.x;
        // The one geometric rule, shared with /test (D11-6). Null when the drop
        // was never steered clear of the midline: that is a non-response, not an
        // answer, and scoring it either way would invent data.
        const watered = answerForLandingX(landedX, this.scale.width);
        const answered = watered !== null;
        const correct = watered === cluster.trial.answer;
        const rtMs = answered && cluster.playback
            ? performance.now() - cluster.playback.onsetMs
            : null;

        this.logTrial(cluster, watered ?? 'timeout', rtMs, landedX);

        const outcome = this.session.recordResult(
            !answered ? 'timeout' : (correct ? 'correct' : 'incorrect')
        );

        this.garden.render(this.session.garden);

        if (outcome.plantCompleted)
        {
            this.garden.celebrate(cluster.trial.answer);
        }

        showLandingFeedback(
            this,
            answered ? (correct ? 'correct' : 'incorrect') : 'no-answer',
            PLANT_LABEL[PLANT_FOR_SIDE[cluster.trial.answer]],
            landedX
        );

        cluster.playback?.stop();
        cluster.trail?.destroy();
        cluster.container.destroy();
        this.activeCluster = null;
        this.windFx.clear();

        this.afterTrial(outcome.roundOver);
    }

    private afterTrial (roundOver: boolean)
    {
        if (roundOver)
        {
            this.endRound();
        }
        else
        {
            this.scheduleNextTrial(INTER_TRIAL_MS);
        }
    }

    /**
     * One record per trial (INTEGRATION_DESIGN §8).
     *
     * `scoreCorrectness: true` here and only here: training cells always have a
     * ground truth, because conflict and centre cells are excluded from the
     * ladder (D10-4). The pre/post test passes false.
     */
    private logTrial (
        cluster: ClusterState,
        response: Response,
        rtMs: number | null,
        landingX: number | null
    )
    {
        this.log.add({
            mode: 'train',
            trialIdx: cluster.trial.index,
            stimulus: cluster.trial.stimulus,
            cell: cluster.trial.cell,
            // The side actually watered, not whether it was right — `correct` is
            // derived from the cell inside the logger.
            response,
            scoreCorrectness: true,
            rtMs,
            audioOnsetMs: cluster.playback?.onsetMs ?? 0,
            difficultyLevel: cluster.trial.rung,
            staircaseState: cluster.trial.staircaseState,
            landingX,
            fallDurationMs: cluster.trial.fallDurationMs
        });
    }

    private endRound ()
    {
        if (this.roundOver)
        {
            return;
        }

        this.roundOver = true;
        this.spawnTimer?.destroy();
        this.spawnTimer = null;

        if (this.activeCluster)
        {
            this.activeCluster.playback?.stop();
            this.activeCluster.trail?.destroy();
            this.activeCluster.container.destroy();
            this.activeCluster = null;
        }

        const blocksCompleted = this.blocksCompletedBefore + 1;

        // The whole track is stored, not a summary of it: what happens next
        // depends on whether the next block opens a new sitting, and that is not
        // known here (D15-3). `blocksCompleted` is also the roadmap's only
        // input — it advances on completion, never on performance (D16-2).
        writeCarryOver(this.participantId, {
            group: this.group,
            lastSittingId: this.sittingId,
            staircase: this.session.state,
            garden: this.session.garden,
            placements: this.garden.placements(),
            blocksCompleted
        });

        // Exported without asking. The study runs locally and a block that is
        // not written to disk is a participant's session lost to a forgotten
        // click; the browser download is the only durable copy.
        const stem = this.log.fileStem();

        download(`${stem}.csv`, this.log.toCsv(), 'text/csv');
        download(`${stem}.json`, this.log.toJson(), 'application/json');

        this.time.delayedCall(350, () =>
        {
            this.scene.start('GameOver', {
                trials: this.log.length,
                accuracy: this.session.accuracy,
                rungReached: convergedRung(this.session.state),
                plantsGrown: this.session.garden.man.completed + this.session.garden.woman.completed,
                stalls: this.stalls,
                group: this.group,
                blocksCompleted
            });
        });
    }

    private cleanUp ()
    {
        this.spawnTimer?.destroy();
        this.spawnTimer = null;
        this.activeCluster?.playback?.stop();
        this.activeCluster?.trail?.destroy();
        this.waterBucket?.destroy();
        this.garden?.destroy();
    }
}
