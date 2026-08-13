/**
 * The training activity's React shell.
 *
 * It exists for two reasons, both about things Phaser cannot do for itself:
 *
 * 1. **The AudioContext must be started inside a user gesture.** Browsers create
 *    it suspended otherwise, and a suspended context plays nothing — silently.
 *    The `StimulusPlayer` is therefore constructed and unlocked in this
 *    component's click handler and handed to the scenes through the Phaser
 *    registry, rather than being created inside `Game.create()`.
 * 2. **Participant identity.** Training and the pre/post test must produce the
 *    same participant and session ids, so both collect them through the same
 *    `SessionSetup` form.
 */

import { useRef, useState } from 'react';

import { PhaserGame } from '../PhaserGame';
import { SessionSetup } from './SessionSetup';
import { StimulusPlayer } from './StimulusPlayer';
import { ParticipantIdentity, writeIdentity } from './sessionStore';
import { TRIALS_PER_ROUND } from '../game/training/garden';

export function GameRoute ()
{
    const [identity, setIdentity] = useState<ParticipantIdentity | null>(null);
    const playerRef = useRef<StimulusPlayer | null>(null);
    const [error, setError] = useState<string | null>(null);

    const start = async (chosen: ParticipantIdentity) =>
    {
        const player = new StimulusPlayer();

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
        setIdentity(chosen);
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

    if (!identity)
    {
        return (
            <SessionSetup
                title="Voice Plant — training"
                blurb={`One training block: ${TRIALS_PER_ROUND} raindrops, about 5–6 minutes. `
                    + 'Each raindrop carries a voice — steer it to the plant that matches.'}
                startLabel="Start training"
                sessions={['train-1', 'train-2', 'train-3', 'train-4', 'train-5']}
                showProgress
                onStart={start}
            />
        );
    }

    return (
        <div id="app">
            <PhaserGame
                registry={{
                    stimulusPlayer: playerRef.current,
                    participantId: identity.participantId,
                    sessionId: identity.sessionId
                }}
            />
        </div>
    );
}
