/**
 * Participant / session entry, shared by both activities.
 *
 * One component rather than two forms, because the two activities must produce
 * the *same* participant and session identifiers — that is what lets the Phase 3
 * analysis join a training block to the pre and post tests for the same person.
 * Two forms would eventually disagree about, say, whether the id is trimmed.
 */

import { FormEvent, useState } from 'react';

import { ParticipantIdentity, readIdentity } from './sessionStore';

import './study.css';

interface SessionSetupProps
{
    title: string;
    /** Participant-facing description of what is about to happen. */
    blurb: string;
    startLabel?: string;
    sessions?: readonly string[];
    onStart: (identity: ParticipantIdentity) => void;
    /** Rendered under the form — e.g. what the last session carried over. */
    footnote?: string;
}

export function SessionSetup ({
    title,
    blurb,
    startLabel = 'Start',
    sessions = ['pre', 'post'],
    onStart,
    footnote
}: SessionSetupProps)
{
    const remembered = readIdentity();
    const [participantId, setParticipantId] = useState(remembered?.participantId ?? '');
    const [sessionId, setSessionId] = useState(sessions[0]);

    const submit = (event: FormEvent) =>
    {
        event.preventDefault();

        const id = participantId.trim();

        if (id)
        {
            onStart({ participantId: id, sessionId: sessionId.trim() || sessions[0] });
        }
    };

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

                <button className="study-primary" type="submit" disabled={!participantId.trim()}>
                    {startLabel}
                </button>

                {footnote && <p className="study-note">{footnote}</p>}
            </form>
        </div>
    );
}
