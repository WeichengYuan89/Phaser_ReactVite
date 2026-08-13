/**
 * Participant / session entry, shared by both activities.
 *
 * One component rather than two forms, because the two activities must produce
 * the *same* participant and session identifiers — that is what lets the Phase 3
 * analysis join a training block to the pre and post tests for the same person.
 * Two forms would eventually disagree about, say, whether the id is trimmed.
 *
 * The group is collected here in both routes even though only training branches
 * on it, so that the arm a record belongs to is written down rather than
 * inferred from a naming convention. D15-2 forbids pooling the CI and NH arms —
 * they answer different questions over different spans — and that is safer as a
 * field than as a habit about participant ids.
 */

import { FormEvent, useEffect, useMemo, useState } from 'react';

import { ParticipantIdentity, clearCarryOver, readCarryOver, readIdentity } from './sessionStore';
import {
    GROUPS,
    GROUP_LABEL,
    ParticipantGroup,
    sittingId,
    sittingOfBlock
} from './protocol';

import './study.css';

type SessionOptions = readonly string[] | ((group: ParticipantGroup) => readonly string[]);

interface SessionSetupProps
{
    title: string;
    /** Participant-facing description of what is about to happen. */
    blurb: string;
    startLabel?: string;
    /** Fixed list, or one derived from the group (the training protocol). */
    sessions?: SessionOptions;
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
    const [group, setGroup] = useState<ParticipantGroup>(remembered?.group ?? 'NH');
    const [sessionId, setSessionId] = useState('');
    /**
     * The id the reset button is armed for, not a bare boolean: arming for P01
     * and then editing the field to P02 must not leave a live button pointing at
     * the wrong record.
     */
    const [armedFor, setArmedFor] = useState<string | null>(null);
    const [cleared, setCleared] = useState(0);

    const trimmed = participantId.trim();
    const carry = useMemo(
        () => (trimmed ? readCarryOver(trimmed) : null),
        [trimmed, cleared]
    );

    const options = useMemo(
        () => (typeof sessions === 'function' ? sessions(group) : sessions),
        [sessions, group]
    );

    /**
     * Default to the sitting the next block falls in, but leave it editable.
     *
     * It cannot simply be derived: a participant who does two blocks and leaves
     * would have their third block counted into the same sitting, so the
     * staircase would resume instead of dropping a rung and re-calibrating on
     * arrival (D15-3). Only the experimenter knows whether this is the same
     * appointment, so the derived value is a default, not a rule.
     */
    const suggested = useMemo(
        () =>
        {
            if (!showProgress)
            {
                return options[0] ?? '';
            }

            const next = sittingId(sittingOfBlock(carry?.blocksCompleted ?? 0));

            return options.includes(next) ? next : (options[options.length - 1] ?? '');
        },
        [showProgress, options, carry]
    );

    useEffect(
        () =>
        {
            setSessionId((current) => (options.includes(current) ? current : suggested));
        },
        [options, suggested]
    );

    const submit = (event: FormEvent) =>
    {
        event.preventDefault();

        if (trimmed)
        {
            onStart({ participantId: trimmed, group, sessionId: sessionId || suggested });
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
                    Group
                    <select
                        value={group}
                        onChange={(event) => setGroup(event.target.value as ParticipantGroup)}
                    >
                        {GROUPS.map((option) => (
                            <option key={option} value={option}>{GROUP_LABEL[option]}</option>
                        ))}
                    </select>
                </label>

                <label className="study-field">
                    {showProgress ? 'Sitting' : 'Session'}
                    <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
                        {options.map((option) => <option key={option} value={option}>{option}</option>)}
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
                                        {' · '}last seen in {carry.lastSittingId}
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
