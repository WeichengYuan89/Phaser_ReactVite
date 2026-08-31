/**
 * The pre/post psychometric test — INTEGRATION_DESIGN §3.2 (DECISIONS D9-1).
 *
 * Plain React, no Phaser. The game's mechanics are structurally incompatible
 * with clean psychometrics (RT undefined, mandatory feedback, motor noise,
 * sampling hijacked by P1), so this route shares the stimulus set and the S-R
 * mapping with the game and nothing else.
 *
 * What must not creep in here: any correctness signal, any score, anything
 * progress-contingent. Most cells have no correct answer at all; the measure is
 * P("man") per cell.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { StimulusPlayer } from './StimulusPlayer';
import { TestTrial, buildTestTrials, testStimuli } from './testSession';
import { TrialLog, download } from './trialLog';
import { RESPONSE_OPTIONS, ResponseOption, optionForKey, spriteStyle } from './responseMapping';
import { SessionSetup } from './SessionSetup';
import { ParticipantIdentity, writeIdentity } from './sessionStore';

import './study.css';

/** Blank interval before the stimulus, so onset is not predictable from the response. */
const FIXATION_MS = 600;
/** Blank ISI after a response (§3.2). */
const ITI_MS = 500;

type Phase = 'setup' | 'loading' | 'fixation' | 'playing' | 'awaiting' | 'iti' | 'done' | 'error';

export function TestRoute ()
{
    const [phase, setPhase] = useState<Phase>('setup');
    const [trialIdx, setTrialIdx] = useState(0);
    const [loaded, setLoaded] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const playerRef = useRef<StimulusPlayer | null>(null);
    const logRef = useRef<TrialLog | null>(null);
    const trialsRef = useRef<TestTrial[]>([]);
    const onsetRef = useRef<number>(0);

    const total = trialsRef.current.length;

    const fail = useCallback((message: string) =>
    {
        setError(message);
        setPhase('error');
    }, []);

    const start = useCallback(async (identity: ParticipantIdentity) =>
    {
        writeIdentity(identity);

        // No eviction: all 100 test stimuli are preloaded and each is played
        // exactly once, so an LRU could only ever cause a refetch mid-trial.
        const player = new StimulusPlayer({ cacheLimit: Infinity });

        playerRef.current = player;
        logRef.current = new TrialLog({ ...identity, block: 'test' });
        trialsRef.current = buildTestTrials();

        setPhase('loading');

        try
        {
            // Must happen inside the click handler's task for the browser to
            // allow the AudioContext to start.
            await player.unlock();
            await player.preload(testStimuli(), (done) => setLoaded(done));
        }
        catch (cause)
        {
            return fail(cause instanceof Error ? cause.message : String(cause));
        }

        setTrialIdx(0);
        setPhase('fixation');
    }, [fail]);

    const respond = useCallback((option: ResponseOption) =>
    {
        if (phase !== 'awaiting')
        {
            return;
        }

        const current = trialsRef.current[trialIdx];
        const log = logRef.current;

        if (!current || !log)
        {
            return;
        }

        log.add({
            mode: 'test',
            trialIdx,
            stimulus: current.stimulus,
            cell: current.cell,
            response: option.answer,
            rtMs: performance.now() - onsetRef.current,
            audioOnsetMs: onsetRef.current
            // scoreCorrectness omitted: the whole test block logs correct = null.
        });

        setPhase('iti');
    }, [phase, trialIdx]);

    // --- trial state machine -------------------------------------------------

    useEffect(() =>
    {
        if (phase !== 'fixation')
        {
            return;
        }

        const timer = window.setTimeout(() => setPhase('playing'), FIXATION_MS);

        return () => window.clearTimeout(timer);
    }, [phase, trialIdx]);

    useEffect(() =>
    {
        if (phase !== 'playing')
        {
            return;
        }

        const player = playerRef.current;
        const current = trialsRef.current[trialIdx];

        if (!player || !current)
        {
            return;
        }

        let cancelled = false;

        void (async () =>
        {
            try
            {
                const handle = await player.play(current.stimulus);

                onsetRef.current = handle.onsetMs;

                await handle.ended;

                if (!cancelled)
                {
                    setPhase('awaiting');
                }
            }
            catch (cause)
            {
                if (!cancelled)
                {
                    fail(cause instanceof Error ? cause.message : String(cause));
                }
            }
        })();

        return () =>
        {
            cancelled = true;
        };
    }, [phase, trialIdx, fail]);

    useEffect(() =>
    {
        if (phase !== 'iti')
        {
            return;
        }

        const timer = window.setTimeout(() =>
        {
            const next = trialIdx + 1;

            if (next >= trialsRef.current.length)
            {
                setPhase('done');
            }
            else
            {
                setTrialIdx(next);
                setPhase('fixation');
            }
        }, ITI_MS);

        return () => window.clearTimeout(timer);
    }, [phase, trialIdx]);

    useEffect(() =>
    {
        if (phase !== 'awaiting')
        {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) =>
        {
            const option = optionForKey(event.key);

            if (option)
            {
                event.preventDefault();
                respond(option);
            }
        };

        window.addEventListener('keydown', onKeyDown);

        return () => window.removeEventListener('keydown', onKeyDown);
    }, [phase, respond]);

    useEffect(() => () =>
    {
        void playerRef.current?.dispose();
    }, []);

    // --- export --------------------------------------------------------------

    const exportBoth = useCallback(() =>
    {
        const log = logRef.current;

        if (!log)
        {
            return;
        }

        const stem = log.fileStem();

        download(`${stem}.csv`, log.toCsv(), 'text/csv');
        download(`${stem}.json`, log.toJson(), 'application/json');
    }, []);

    const stimulusCount = useMemo(() => testStimuli().length, []);

    // --- screens -------------------------------------------------------------

    if (phase === 'setup')
    {
        return (
            <SessionSetup
                title="Voice gender test"
                blurb={`${stimulusCount} words, about 5–6 minutes. You will hear one word at a time `
                    + 'and decide whether the voice sounds like a man or a woman. '
                    + 'Many voices are deliberately ambiguous — there is often no right answer, '
                    + 'so just give your immediate impression.'}
                onStart={start}
            />
        );
    }

    if (phase === 'loading')
    {
        return (
            <div className="study">
                <div className="study-panel">
                    <h1>Loading</h1>
                    <div className="study-progress">
                        <div style={{ width: `${(loaded / stimulusCount) * 100}%` }} />
                    </div>
                    <p className="study-note">{loaded} / {stimulusCount}</p>
                </div>
            </div>
        );
    }

    if (phase === 'error')
    {
        return (
            <div className="study">
                <div className="study-panel">
                    <h1>Cannot run the test</h1>
                    <p className="study-note study-error">{error}</p>
                </div>
            </div>
        );
    }

    if (phase === 'done')
    {
        return (
            <div className="study">
                <div className="study-panel">
                    <h1>Done</h1>
                    <p className="study-note">
                        {logRef.current?.length ?? 0} responses recorded. Thank you.
                    </p>
                    <button className="study-primary" onClick={exportBoth}>Download data</button>
                </div>
            </div>
        );
    }

    const awaiting = phase === 'awaiting';

    return (
        <div className="study">
            <div className="study-counter">{trialIdx + 1} / {total}</div>

            <div className="study-stage">
                {phase === 'playing' && <div className="study-listening">♪</div>}
            </div>

            <div className={`study-options${awaiting ? '' : ' is-disabled'}`}>
                {RESPONSE_OPTIONS.map((option) => (
                    <button
                        key={option.side}
                        className="study-option"
                        onClick={() => respond(option)}
                        disabled={!awaiting}
                        tabIndex={-1}
                    >
                        <span className="study-sprite" style={spriteStyle(option.icon)} />
                        <span className="study-option-label">{option.label}</span>
                        <span className="study-option-key">
                            {option.side === 'left' ? 'F  or  ←' : 'J  or  →'}
                        </span>
                    </button>
                ))}
            </div>

            {/*
              * Deliberately no feedback, no score, and no on-screen stimulus id.
              * This route runs identically under the local stimulus mount and
              * the D23 production package, so anything gated on a dev flag
              * could still leak into a real session — inspect the trial log
              * instead.
              */}
            <div className="study-hint">{awaiting ? 'Man or woman?' : '\u00a0'}</div>

        </div>
    );
}
