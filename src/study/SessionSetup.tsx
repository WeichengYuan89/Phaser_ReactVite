/**
 * Participant / session entry, shared by both activities.
 *
 * One component rather than two forms, because the two activities must produce
 * the *same* participant and session identifiers — that is what lets the Phase 3
 * analysis join a training block to the pre and post tests for the same person.
 * Two forms would eventually disagree about, say, whether the id is trimmed.
 */

import { FormEvent, useMemo, useState } from 'react';

import { ParticipantIdentity, clearCarryOver, readCarryOver, readIdentity } from './sessionStore';

import './study.css';

interface SessionSetupProps
{
    title: string;
    /** Participant-facing description of what is about to happen. */
    blurb: string;
    startLabel?: string;
    sessions?: readonly string[];
    /**
     * Show the participant's accumulated progress, and offer to clear it.
     * Training only — the pre/post test carries nothing between sessions.
     */
    showProgress?: boolean;
    onStart: (identity: ParticipantIdentity) => void;
}

export function SessionSetup ({
    title,
    blurb,
    startLabel = 'Start',
    sessions = ['pre', 'post'],
    showProgress = false,
    onStart
}: SessionSetupProps)
{
    const remembered = readIdentity();
    const [participantId, setParticipantId] = useState(remembered?.participantId ?? '');
    const [sessionId, setSessionId] = useState(sessions[0]);
    /**
     * The id the reset button is armed for, not a bare boolean: arming for P01
     * and then editing the field to P02 must not leave a live button pointing at
     * the wrong record.
     */
    const [armedFor, setArmedFor] = useState<string | null>(null);
    const [cleared, setCleared] = useState(0);

    const trimmed = participantId.trim();
    const carry = useMemo(
        () => (showProgress && trimmed ? readCarryOver(trimmed) : null),
        [showProgress, trimmed, cleared]
    );

    const submit = (event: FormEvent) =>
    {
        event.preventDefault();

        if (trimmed)
        {
            onStart({ participantId: trimmed, sessionId: sessionId.trim() || sessions[0] });
        }
    };

    const reset = () =>
    {
        clearCarryOver(trimmed);
        setArmedFor(null);
        setCleared((n) => n + 1);
    };

    const plantsGrown = carry
        ? carry.garden.man.completed + carry.garden.woman.completed
        : 0;

    return (
        <div className="study">
            <form className="study-panel" onSubmit={submit}>
                <h1>{title}</h1>
                <p className="study-note">{blurb}</p>

                <label className="study-field">
                    Participant ID
                    <input
                        value={participantId}
                        onChange={(event) => setParticipantId(event.target.value)}
                        placeholder="e.g. P01"
                        autoFocus
                    />
                </label>

                <label className="study-field">
                    Session
                    <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
                        {sessions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                </label>

                <button className="study-primary" type="submit" disabled={!trimmed}>
                    {startLabel}
                </button>

                {showProgress && trimmed && (
                    <div className="study-progress-panel">
                        {carry
                            ? (
                                <>
                                    <p className="study-note">
                                        <strong>{trimmed}</strong> has {carry.blocksCompleted} block
                                        {carry.blocksCompleted === 1 ? '' : 's'} completed
                                        {' · '}resuming at level {carry.startRung} of 8
                                        {' · '}{plantsGrown} plant{plantsGrown === 1 ? '' : 's'} grown.
                                    </p>

                                    {armedFor === trimmed
                                        ? (
                                            <p className="study-note study-confirm">
                                                Clear all of {trimmed}&apos;s progress? Exported data files
                                                are not affected.
                                                <span className="study-confirm-actions">
                                                    <button type="button" className="study-danger" onClick={reset}>
                                                        Clear
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="study-quiet"
                                                        onClick={() => setArmedFor(null)}
                                                    >
                                                        Cancel
                                                    </button>
                                                </span>
                                            </p>
                                        )
                                        : (
                                            <button
                                                type="button"
                                                className="study-quiet"
                                                onClick={() => setArmedFor(trimmed)}
                                            >
                                                Reset progress
                                            </button>
                                        )}
                                </>
                            )
                            : (
                                <p className="study-note">
                                    No previous progress for <strong>{trimmed}</strong> — this will be
                                    their first block.
                                </p>
                            )}
                    </div>
                )}
            </form>
        </div>
    );
}
