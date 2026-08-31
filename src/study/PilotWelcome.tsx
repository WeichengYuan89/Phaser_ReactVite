import { useCallback, useEffect, useState } from 'react';

import './study.css';

type AudioState = 'idle' | 'playing' | 'played' | 'error';
type Side = 'left' | 'right';

interface PilotWelcomeProps
{
    sitting: number;
    onPlaySample: () => Promise<void>;
    onContinue: () => Promise<void>;
}

/** Participant-only entry shown at the start of every remote sitting. */
export function PilotWelcome ({ sitting, onPlaySample, onContinue }: PilotWelcomeProps)
{
    const [audioState, setAudioState] = useState<AudioState>('idle');
    const [audioError, setAudioError] = useState('');
    const [practised, setPractised] = useState<Record<Side, boolean>>({ left: false, right: false });
    const [continuing, setContinuing] = useState(false);

    const mark = useCallback(
        (side: Side) => setPractised((current) => ({ ...current, [side]: true })),
        []
    );

    useEffect(
        () =>
        {
            const onKeyDown = (event: KeyboardEvent) =>
            {
                if (event.key === 'a' || event.key === 'A' || event.key === 'ArrowLeft')
                {
                    event.preventDefault();
                    mark('left');
                }
                else if (event.key === 'd' || event.key === 'D' || event.key === 'ArrowRight')
                {
                    event.preventDefault();
                    mark('right');
                }
            };

            window.addEventListener('keydown', onKeyDown);

            return () => window.removeEventListener('keydown', onKeyDown);
        },
        [mark]
    );

    const playSample = async () =>
    {
        setAudioState('playing');
        setAudioError('');

        try
        {
            await onPlaySample();
            setAudioState('played');
        }
        catch
        {
            setAudioState('error');
            setAudioError('The sample could not be played. Check your audio output and try again.');
        }
    };

    const ready = audioState === 'played' && practised.left && practised.right;

    const continueToStudy = async () =>
    {
        if (!ready || continuing)
        {
            return;
        }

        setContinuing(true);

        try
        {
            await onContinue();
        }
        catch
        {
            setContinuing(false);
            setAudioState('error');
            setAudioError('Audio access was interrupted. Play the sample once more before continuing.');
        }
    };

    return (
        <div className="study participant-shell">
            <main className="participant-panel participant-panel-wide">
                <div className="participant-eyebrow">Remote listening pilot</div>
                <div className="participant-heading-row">
                    <div>
                        <h1>Welcome to Voice Plant</h1>
                        <p className="participant-lead">
                            Listen to each voice and guide its raindrop to the matching plant.
                        </p>
                    </div>
                    <span className="participant-chip">Sitting {sitting} of 2</span>
                </div>

                <section className="participant-section" aria-labelledby="audio-check-title">
                    <div className="participant-step">1</div>
                    <div className="participant-section-content">
                        <h2 id="audio-check-title">Check your listening setup</h2>
                        <p>
                            Use your usual comfortable listening setup. Set the volume to a clear,
                            comfortable level and keep it unchanged during the block.
                        </p>
                        <button
                            className="participant-secondary"
                            type="button"
                            onClick={playSample}
                            disabled={audioState === 'playing'}
                        >
                            {audioState === 'playing'
                                ? 'Playing sample…'
                                : audioState === 'played'
                                    ? 'Play sample again'
                                    : 'Play audio sample'}
                        </button>
                        {audioState === 'played' && (
                            <p className="participant-check" role="status">✓ Audio sample completed</p>
                        )}
                        {audioState === 'error' && (
                            <p className="participant-error" role="alert">{audioError}</p>
                        )}
                    </div>
                </section>

                <section className="participant-section" aria-labelledby="controls-title">
                    <div className="participant-step">2</div>
                    <div className="participant-section-content">
                        <h2 id="controls-title">Practise both directions</h2>
                        <p>Press each control once. You can use either the letter key or arrow key.</p>
                        <div className="mapping-grid">
                            <button
                                className={`mapping-card ${practised.left ? 'is-practised' : ''}`}
                                type="button"
                                onClick={() => mark('left')}
                                aria-pressed={practised.left}
                            >
                                <span className="mapping-direction">← Left</span>
                                <strong>Man voice</strong>
                                <span>Lupinus</span>
                                <kbd>A</kbd>
                            </button>
                            <button
                                className={`mapping-card ${practised.right ? 'is-practised' : ''}`}
                                type="button"
                                onClick={() => mark('right')}
                                aria-pressed={practised.right}
                            >
                                <span className="mapping-direction">Right →</span>
                                <strong>Woman voice</strong>
                                <span>Cactus</span>
                                <kbd>D</kbd>
                            </button>
                        </div>
                    </div>
                </section>

                <aside className="participant-callout">
                    <strong>Before a block starts</strong>
                    <span>
                        A block takes about 5–6 minutes. If you close or refresh the page during a
                        block, that whole block will need to be repeated. Completed blocks are kept.
                    </span>
                </aside>

                <button
                    className="participant-primary"
                    type="button"
                    onClick={continueToStudy}
                    disabled={!ready || continuing}
                >
                    {continuing ? 'Preparing…' : 'Continue to study overview'}
                </button>
                {!ready && (
                    <p className="participant-requirement" aria-live="polite">
                        Play the sample and practise both directions to continue.
                    </p>
                )}
            </main>
        </div>
    );
}

/** Shown when the participant route has not yet received server-backed access. */
export function ParticipantAccessGate ()
{
    return (
        <div className="study participant-shell">
            <main className="participant-panel participant-panel-compact">
                <div className="participant-eyebrow">Voice Plant</div>
                <h1>Open your private study link</h1>
                <p className="participant-lead">
                    We could not open your study access from this page. Please use the private link
                    in your invitation email or contact the researcher for help.
                </p>
                <div className="participant-callout">
                    <strong>Your completed blocks are not affected.</strong>
                    <span>Do not create a new participant profile or choose a sitting yourself.</span>
                </div>
                {import.meta.env.DEV && (
                    <a className="participant-text-link" href="/researcher">
                        Open local researcher setup
                    </a>
                )}
            </main>
        </div>
    );
}
