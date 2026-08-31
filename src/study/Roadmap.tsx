/**
 * Participant-only protocol hub (D24).
 *
 * Nodes represent completed dose only: never accuracy or difficulty. The
 * sitting stored by researcher/server access gates which row may be started,
 * so finishing Sitting 1 cannot silently flow into Sitting 2.
 */

import {
    ParticipantGroup,
    BLOCKS_PER_SITTING,
    SITTINGS,
    blockWithinSitting,
    protocolComplete,
    roadmap,
    sittingNumber,
    totalBlocks
} from './protocol';

import './study.css';

interface RoadmapProps
{
    group: ParticipantGroup;
    /** The visit authorized by researcher/server access. */
    sittingId: string;
    blocksCompleted: number;
    onStart: () => void;
}

export function Roadmap ({ group, sittingId, blocksCompleted, onStart }: RoadmapProps)
{
    const nodes = roadmap(group, blocksCompleted);
    const total = totalBlocks(group);
    const complete = protocolComplete(group, blocksCompleted);
    const sittings = groupBySitting(nodes);
    const permittedSitting = sittingNumber(sittingId) ?? 1;
    const currentNode = nodes.find((node) => node.state === 'current');
    const canStart = currentNode?.sitting === permittedSitting;
    const sittingComplete = !complete && currentNode !== undefined && currentNode.sitting > permittedSitting;
    const visitTooEarly = !complete && currentNode !== undefined && currentNode.sitting < permittedSitting;
    const nextPosition = blockWithinSitting(blocksCompleted);

    const title = complete
        ? 'Thank you — study complete'
        : sittingComplete
            ? `Sitting ${permittedSitting} complete`
            : `Sitting ${permittedSitting} of ${SITTINGS[group]}`;

    return (
        <div className="study participant-shell">
            <main className="participant-panel participant-panel-wide">
                <div className="participant-eyebrow">Voice Plant</div>
                <div className="participant-heading-row">
                    <div>
                        <h1>{title}</h1>
                        <p className="participant-lead">
                            {complete
                                ? 'You have completed all six training blocks.'
                                : sittingComplete
                                    ? 'All three blocks for this sitting have been completed.'
                                    : visitTooEarly
                                        ? 'This sitting is not ready to begin from the current study progress.'
                                        : `Block ${nextPosition} of ${BLOCKS_PER_SITTING} is next.`}
                        </p>
                    </div>
                    {!complete && (
                        <span className="participant-chip">Block {Math.min(blocksCompleted + 1, total)} of {total}</span>
                    )}
                </div>

                <div className="roadmap" aria-label="Study progress">
                    {sittings.map((sitting) => (
                        <section
                            className={`roadmap-sitting ${sitting.number === permittedSitting ? 'is-visit' : ''}`}
                            key={sitting.number}
                            aria-label={`Sitting ${sitting.number}`}
                        >
                            <div className="roadmap-sitting-heading">
                                <span className="roadmap-sitting-label">Sitting {sitting.number}</span>
                                <span className="roadmap-sitting-count">3 short blocks</span>
                            </div>
                            <div className="roadmap-track">
                                {sitting.nodes.map((node, position) =>
                                {
                                    const unavailable = node.state === 'current' && node.sitting !== permittedSitting;
                                    const state = unavailable ? 'locked' : node.state;

                                    return (
                                        <div className="roadmap-step" key={node.index}>
                                            {position > 0 && (
                                                <span className={`roadmap-link is-${state === 'locked' ? 'locked' : 'open'}`} />
                                            )}
                                            <span
                                                className={`roadmap-node is-${state}`}
                                                aria-label={`Block ${position + 1}: ${state}`}
                                            >
                                                {state === 'done' ? '✓' : position + 1}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                </div>

                {canStart && (
                    <>
                        {nextPosition > 1 && (
                            <aside className="participant-callout participant-callout-rest">
                                <strong>Take a short break before continuing.</strong>
                                <span>Start when you feel ready. The next block takes about 5–6 minutes.</span>
                            </aside>
                        )}
                        <div className="participant-reminder">
                            <span><kbd>A</kbd> / ← &nbsp; Man voice → Lupinus</span>
                            <span><kbd>D</kbd> / → &nbsp; Woman voice → Cactus</span>
                        </div>
                        <button className="participant-primary" type="button" onClick={onStart} autoFocus>
                            Start block {nextPosition} of {BLOCKS_PER_SITTING}
                        </button>
                        <p className="participant-requirement">
                            Do not close or refresh the page during the block. An interrupted block must be repeated.
                        </p>
                    </>
                )}

                {sittingComplete && (
                    <aside className="participant-completion" role="status">
                        <span className="participant-completion-mark">✓</span>
                        <div>
                            <strong>Your progress for this sitting has been recorded.</strong>
                            <p>You may close this page now. Use the study link again at your next scheduled sitting.</p>
                        </div>
                    </aside>
                )}

                {visitTooEarly && (
                    <aside className="participant-callout">
                        <strong>Please contact the researcher.</strong>
                        <span>The private link and current study progress do not refer to the same sitting.</span>
                    </aside>
                )}

                {complete && (
                    <aside className="participant-completion" role="status">
                        <span className="participant-completion-mark">✓</span>
                        <div>
                            <strong>All study blocks are complete.</strong>
                            <p>Your responses have been recorded. You may close this page.</p>
                        </div>
                    </aside>
                )}
            </main>
        </div>
    );
}

interface SittingRow
{
    number: number;
    nodes: ReturnType<typeof roadmap>;
}

function groupBySitting (nodes: ReturnType<typeof roadmap>): SittingRow[]
{
    const rows: SittingRow[] = [];

    for (const node of nodes)
    {
        const row = rows[rows.length - 1];

        if (!row || row.number !== node.sitting)
        {
            rows.push({ number: node.sitting, nodes: [node] });
        }
        else if (row.nodes.length < BLOCKS_PER_SITTING)
        {
            row.nodes.push(node);
        }
    }

    return rows;
}
