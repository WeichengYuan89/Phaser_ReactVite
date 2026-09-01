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
 *    group or sitting. Remote builds exchange an invitation for a server-owned
 *    session; local research builds retain the experimenter setup route.
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
import { ParticipantIdentity, REMOTE_PILOT, readCarryOver, readIdentity, writeIdentity } from './sessionStore';
import { bootstrapRemote, observeRemoteSave, startRemoteAttempt } from './remoteClient';
import type { SaveStatus } from './remoteClient';
import type { RemoteAttempt } from '../shared/remoteProtocol';
import {
    ParticipantGroup,
    BLOCKS_PER_SITTING,
    sittingIds,
    sittingNumber
} from './protocol';
import { TRIALS_PER_ROUND } from '../game/training/garden';

/** Module scope so the memo inside `SessionSetup` is not fed a new function each render. */
const trainingSessions = (group: ParticipantGroup) => sittingIds(group);

type Stage = 'connecting' | 'access' | 'welcome' | 'hub' | 'playing';

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
    const [identity, setIdentity] = useState<ParticipantIdentity | null>(() => readPilotIdentity());
    const [stage, setStage] = useState<Stage>(REMOTE_PILOT ? 'connecting' : identity ? 'welcome' : 'access');
    const [blocksCompleted, setBlocksCompleted] = useState(0);
    const playerRef = useRef<StimulusPlayer | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
    const [starting, setStarting] = useState(false);
    const attemptRef = useRef<RemoteAttempt | null>(null);

    useEffect(() => {
        if (!REMOTE_PILOT) return;
        let current = true;
        // Opening a fragment-only invite from an already-open access gate does
        // not remount React. Reload so it gets a fresh, single token exchange.
        const onInvite = () => {
            if (new URLSearchParams(window.location.hash.slice(1)).has('invite')) window.location.reload();
        };
        window.addEventListener('hashchange', onInvite);
        void bootstrapRemote().then((state) => {
            if (!current) return;
            setIdentity(state.identity);
            setBlocksCompleted(state.checkpoint?.blocksCompleted ?? 0);
            setStage('welcome');
        }).catch((cause: unknown) => {
            if (!current) return;
            if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 401) setStage('access');
            else {
                setStage('access');
                setError('The preview server could not be reached. Check your connection and reopen this page.');
            }
        });
        const stop = observeRemoteSave(setSaveStatus);
        return () => { current = false; stop(); window.removeEventListener('hashchange', onInvite); };
    }, []);

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

    const startBlock = async () => {
        if (starting) return;
        setStarting(true);
        try {
            if (REMOTE_PILOT) attemptRef.current = await startRemoteAttempt();
            setStage('playing');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Cannot start the block');
        } finally { setStarting(false); }
    };

    if (stage === 'connecting') return <div className="study"><main className="participant-panel"><h1>Opening your preview…</h1></main></div>;

    if (error)
    {
        return (
            <div className="study">
                <div className="study-panel">
                    <h1>Unable to continue</h1>
                    <p className="study-note study-error">{error}</p>
                    <button onClick={() => window.location.reload()}>Reopen saved overview</button>
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
                onStart={() => { void startBlock(); }}
                starting={starting}
            />
        );
    }

    return (
        <div id="app" className={REMOTE_PILOT ? 'remote-game-shell' : undefined}>
            {REMOTE_PILOT && <div className="remote-save-status" role="status" aria-live="polite">
                {saveStatus === 'saved' ? 'Saved to server' : saveStatus === 'saving' ? 'Saving…'
                    : saveStatus === 'retrying' ? 'Connection lost — paused while retrying…' : 'Block interrupted — reopen to repeat this block'}
            </div>}
            <PhaserGame
                registry={{
                    stimulusPlayer: playerRef.current,
                    participantId: identity.participantId,
                    sessionId: identity.sessionId,
                    group: identity.group,
                    remoteAttempt: attemptRef.current
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
