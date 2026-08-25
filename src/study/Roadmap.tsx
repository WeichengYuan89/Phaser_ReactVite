/**
 * The roadmap hub — PROGRESS 2.6c, DECISIONS D15-4 and D16-1.
 *
 * The screen between the setup form and each block: it shows the whole protocol
 * as a path of nodes, one per 60-trial block, grouped into sittings, and starts
 * the next one.
 *
 * **Why this exists at all.** Cross-block progress used to be carried only by
 * the garden, and a garden says "I have grown N plants" — never "where am I,
 * how much is left, what is next". Worse, the garden grows on *correct answers*,
 * so as the only progress display it makes progress synonymous with performance:
 * a participant having a hard time sees themselves standing still while in fact
 * completing the protocol exactly on schedule. That is the score-as-verdict
 * problem D11-6 removed the score to avoid, returning in another shape.
 *
 * **Three hard constraints, none of them cosmetic:**
 *
 *  1. *Progress only, never difficulty* (D15-4). Difficulty is the staircase's
 *     job (D10) and two competing difficulty controls would fight. Nothing here
 *     renders a rung — see also D16-5, which moved the rung off the end-of-block
 *     screen for the same reason.
 *  2. *A node lights on completion, not on accuracy* (D16-2). Its only input is
 *     `blocksCompleted`, and by D11-1 a block ends after a fixed 60 trials
 *     however it went.
 *  3. *Nothing here flows back into stimulus selection* (D9-5, the P1 lesson).
 *     This module imports no training code and exports no state into it.
 *
 * The path length is the participant's own protocol — 3 nodes for the CI case
 * study, 9 for an NH participant (D15-1) — so it always ends somewhere reachable
 * rather than showing a mostly-locked road to someone who is here once.
 */

import { ParticipantGroup, BLOCKS_PER_SITTING, protocolComplete, roadmap, totalBlocks } from './protocol';

import './study.css';

interface RoadmapProps
{
    participantId: string;
    group: ParticipantGroup;
    /** Which appointment this is; blocks of one sitting resume the staircase. */
    sittingId: string;
    blocksCompleted: number;
    onStart: () => void;
    onBack: () => void;
}

export function Roadmap ({
    participantId,
    group,
    sittingId,
    blocksCompleted,
    onStart,
    onBack
}: RoadmapProps)
{
    const nodes = roadmap(group, blocksCompleted);
    const total = totalBlocks(group);
    const complete = protocolComplete(group, blocksCompleted);
    const sittings = groupBySitting(nodes);

    return (
        <div className="study">
            <div className="study-panel study-panel-wide">
                <h1>Voice Plant</h1>

                <p className="study-note">
                    A voice falls with each raindrop. Steer it <strong>left to the Lupinus</strong> if
                    the voice sounds like a man, <strong>right to the Cactus</strong> if it sounds like
                    a woman. Correct answers make that plant grow. Nothing is scored and nothing is
                    timed — you can let a drop go by.
                </p>

                <div className="roadmap">
                    {sittings.map((sitting) => (
                        <div className="roadmap-sitting" key={sitting.number}>
                            <span className="roadmap-sitting-label">Sitting {sitting.number}</span>
                            <div className="roadmap-track">
                                {sitting.nodes.map((node, position) => (
                                    <div className="roadmap-step" key={node.index}>
                                        {position > 0 && (
                                            <span
                                                className={`roadmap-link is-${node.state === 'locked' ? 'locked' : 'open'}`}
                                            />
                                        )}
                                        <span className={`roadmap-node is-${node.state}`}>
                                            {node.state === 'done' ? '✓' : node.index + 1}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <p className="study-note">
                    {complete
                        ? `All ${total} blocks done — this is the end of the training protocol.`
                        : `Block ${blocksCompleted + 1} of ${total}. About 5–6 minutes.`}
                </p>

                {!complete && (
                    <button className="study-primary" type="button" onClick={onStart} autoFocus>
                        Start block {blocksCompleted + 1}
                    </button>
                )}

                <div className="study-progress-panel">
                    <p className="study-note">
                        <strong>{participantId}</strong> · {group} · {sittingId}
                    </p>

                    {/*
                      * Beyond the protocol, and labelled as such. Piloting needs a
                      * way to run "one more" without pretending it is a protocol
                      * block: extra blocks never appear on the path, because the
                      * path is the protocol (D15-4).
                      */}
                    {complete && (
                        <button className="study-quiet" type="button" onClick={onStart}>
                            Run an extra block (beyond protocol)
                        </button>
                    )}

                    <button className="study-quiet" type="button" onClick={onBack}>
                        Change participant
                    </button>
                </div>
            </div>
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
