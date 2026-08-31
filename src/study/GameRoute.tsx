/**
 * The training activity's React shell.
 *
 * Participant-only flow: validate access, complete audio/control onboarding,
 * show the roadmap, play a block, then return to the roadmap (D24).
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
 * 2. **Participant identity.** The participant route never asks for an id,
 *    group or sitting. Until the server token exchange is implemented, local
 *    researcher setup writes the same identity record the future exchange will
 *    replace.
 * 3. **The roadmap is not part of the game world.** It reads per-participant
 *    progress out of storage and has to be on screen before Phaser boots, so the
 *    participant sees the path before block 1, not only between blocks.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { PhaserGame } from '../PhaserGame';
import { STIMULI } from '../game/data/stimulusCatalog';
import { EventBus } from '../game/EventBus';
import { ParticipantAccessGate, PilotWelcome } from './PilotWelcome';
import { SessionSetup } from './SessionSetup';
import { Roadmap } from './Roadmap';
import { StimulusPlayer } from './StimulusPlayer';
import { ParticipantIdentity, readCarryOver, readIdentity, writeIdentity } from './sessionStore';
import {
    ParticipantGroup,
    BLOCKS_PER_SITTING,
    sittingIds,
    sittingNumber
} from './protocol';
import { TRIALS_PER_ROUND } from '../game/training/garden';

/** Module scope so the memo inside `SessionSetup` is not fed a new function each render. */
const trainingSessions = (group: ParticipantGroup) => sittingIds(group);

type Stage = 'access' | 'welcome' | 'hub' | 'playing';

const AUDIO_CHECK_STIMULUS = STIMULI.find((stimulus) => (
    stimulus.set === 'train' && stimulus.cellId === 'f110_vp28'
));

function readPilotIdentity (): ParticipantIdentity | null
{
    const identity = readIdentity();

    return identity?.group === 'CI' && sittingNumber(identity.sessionId) !== null
        ? identity
        : null;
}

export function GameRoute ()
{
    const [identity] = useState<ParticipantIdentity | null>(() => readPilotIdentity());
    const [stage, setStage] = useState<Stage>(identity ? 'welcome' : 'access');
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

    useEffect(
        () =>
        {
            if (identity)
            {
                refreshProgress(identity.participantId);
            }
        },
        [identity, refreshProgress]
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

    const player = () =>
    {
        const current = playerRef.current ?? new StimulusPlayer();

        playerRef.current = current;

        return current;
    };

    const playSample = async () =>
    {
        if (!AUDIO_CHECK_STIMULUS)
        {
            throw new Error('Audio-check stimulus is missing from the catalog.');
        }

        const current = player();

        await current.unlock();
        const playback = await current.play(AUDIO_CHECK_STIMULUS);

        await playback.ended;
    };

    const enterHub = async () =>
    {
        const current = player();

        try
        {
            await current.unlock();
        }
        catch (cause)
        {
            setError(cause instanceof Error ? cause.message : String(cause));
            return;
        }

        if (identity)
        {
            refreshProgress(identity.participantId);
        }

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

    if (stage === 'access' || !identity)
    {
        return <ParticipantAccessGate />;
    }

    if (stage === 'welcome')
    {
        return (
            <PilotWelcome
                sitting={sittingNumber(identity.sessionId) ?? 1}
                onPlaySample={playSample}
                onContinue={enterHub}
            />
        );
    }

    if (stage === 'hub')
    {
        return (
            <Roadmap
                group={identity.group}
                sittingId={identity.sessionId}
                blocksCompleted={blocksCompleted}
                onStart={() => setStage('playing')}
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

/** Local-only experimenter entry. A server token exchange will replace this. */
export function ResearcherSetupRoute ()
{
    const start = (identity: ParticipantIdentity) =>
    {
        writeIdentity(identity);
        window.location.assign('/');
    };

    return (
        <SessionSetup
            title="Researcher setup"
            blurb={`Configure the local pilot identity before handing the participant the main view.`
                + ` Each sitting contains ${BLOCKS_PER_SITTING} blocks of ${TRIALS_PER_ROUND} raindrops.`}
            startLabel="Open participant view"
            sessions={trainingSessions}
            showProgress
            onStart={start}
        />
    );
}
