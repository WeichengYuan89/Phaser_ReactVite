/**
 * The training activity's React shell.
 *
 * Three screens, in order: identify the participant, show them the roadmap,
 * play a block — then back to the roadmap with one more node lit (D16-1).
 *
 * It exists for reasons Phaser cannot handle for itself:
 *
 * 1. **The AudioContext must be started inside a user gesture.** Browsers create
 *    it suspended otherwise, and a suspended context plays nothing — silently.
 *    The `StimulusPlayer` is therefore constructed and unlocked in this
 *    component's click handler and handed to the scenes through the Phaser
 *    registry, rather than being created inside `Game.create()`. It lives in a
 *    ref, so it survives the unmount between blocks with its decoded-buffer
 *    cache intact.
 * 2. **Participant identity.** Training and the pre/post test must produce the
 *    same participant and session ids, so both collect them through the same
 *    `SessionSetup` form.
 * 3. **The roadmap is not part of the game world.** It reads per-participant
 *    progress out of storage and has to be on screen before Phaser boots, so the
 *    participant sees the path before block 1, not only between blocks.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { PhaserGame } from '../PhaserGame';
import { EventBus } from '../game/EventBus';
import { SessionSetup } from './SessionSetup';
import { Roadmap } from './Roadmap';
import { StimulusPlayer } from './StimulusPlayer';
import { ParticipantIdentity, readCarryOver, writeIdentity } from './sessionStore';
import { ParticipantGroup, BLOCKS_PER_SITTING, sittingIds } from './protocol';
import { TRIALS_PER_ROUND } from '../game/training/garden';

/** Module scope so the memo inside `SessionSetup` is not fed a new function each render. */
const trainingSessions = (group: ParticipantGroup) => sittingIds(group);

type Stage = 'setup' | 'hub' | 'playing';

export function GameRoute ()
{
    const [identity, setIdentity] = useState<ParticipantIdentity | null>(null);
    const [stage, setStage] = useState<Stage>('setup');
    const [blocksCompleted, setBlocksCompleted] = useState(0);
    const playerRef = useRef<StimulusPlayer | null>(null);
    const [error, setError] = useState<string | null>(null);

    const refreshProgress = useCallback(
        (participantId: string) =>
        {
            setBlocksCompleted(readCarryOver(participantId)?.blocksCompleted ?? 0);
        },
        []
    );

    /**
     * A block ends inside Phaser, but the roadmap lives out here — and by the
     * time this fires, `Game.endRound()` has already written the carry-over and
     * exported the trial log, so re-reading storage is all that is needed.
     */
    useEffect(
        () =>
        {
            if (stage !== 'playing' || !identity)
            {
                return;
            }

            const onBlockComplete = () =>
            {
                refreshProgress(identity.participantId);
                setStage('hub');
            };

            EventBus.on('block-complete', onBlockComplete);

            return () => { EventBus.off('block-complete', onBlockComplete); };
        },
        [stage, identity, refreshProgress]
    );

    const identify = async (chosen: ParticipantIdentity) =>
    {
        // Reuse the player across blocks: unlocking is only possible inside a
        // user gesture, and its LRU of decoded buffers is worth keeping.
        const player = playerRef.current ?? new StimulusPlayer();

        playerRef.current = player;

        try
        {
            await player.unlock();
        }
        catch (cause)
        {
            setError(cause instanceof Error ? cause.message : String(cause));
            return;
        }

        writeIdentity(chosen);
        refreshProgress(chosen.participantId);
        setIdentity(chosen);
        setStage('hub');
    };

    if (error)
    {
        return (
            <div className="study">
                <div className="study-panel">
                    <h1>Cannot start audio</h1>
                    <p className="study-note study-error">{error}</p>
                </div>
            </div>
        );
    }

    if (stage === 'setup' || !identity)
    {
        return (
            <SessionSetup
                title="Voice Plant — training"
                blurb={`Training runs in blocks of ${TRIALS_PER_ROUND} raindrops, about 5–6 minutes each,`
                    + ` ${BLOCKS_PER_SITTING} blocks per sitting with a rest in between.`}
                startLabel="Continue"
                sessions={trainingSessions}
                showProgress
                onStart={identify}
            />
        );
    }

    if (stage === 'hub')
    {
        return (
            <Roadmap
                participantId={identity.participantId}
                group={identity.group}
                sittingId={identity.sessionId}
                blocksCompleted={blocksCompleted}
                onStart={() => setStage('playing')}
                onBack={() => setStage('setup')}
            />
        );
    }

    return (
        <div id="app">
            <PhaserGame
                registry={{
                    stimulusPlayer: playerRef.current,
                    participantId: identity.participantId,
                    sessionId: identity.sessionId,
                    group: identity.group
                }}
            />
        </div>
    );
}
