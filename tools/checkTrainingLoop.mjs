/**
 * Behavioural checks for the adaptive training loop (PROGRESS 2.0).
 *
 *     node tools/checkTrainingLoop.mjs
 *
 * The loop is pure logic, so it can be exercised without a browser. It is worth
 * exercising: the rule it replaces had an absorbing top level that nobody
 * noticed for months, and the same class of bug — a staircase that quietly
 * stops adapting — would not show up as a crash, only as flat, unusable data
 * after a participant has already sat through a session.
 *
 * No test framework: this compiles the modules with the project's own tsc and
 * asserts against them, which keeps the dependency list unchanged.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const out = mkdtempSync(path.join(tmpdir(), 'training-check-'));

let failures = 0;

function check (name, fn)
{
    try
    {
        fn();
        process.stdout.write(`  ok    ${name}\n`);
    }
    catch (error)
    {
        failures += 1;
        process.stdout.write(`  FAIL  ${name}\n        ${error.message.split('\n')[0]}\n`);
    }
}

try
{
    execFileSync(
        path.join(ROOT, 'node_modules/.bin/tsc'),
        [
            'src/game/training/trainingSession.ts',
            'src/game/training/staircase.ts',
            'src/game/training/cellPicker.ts',
            'src/game/training/dealer.ts',
            'src/study/trialLog.ts',
            'src/study/sessionStore.ts',
            'src/shared/sides.ts',
            '--outDir', out,
            '--rootDir', 'src',
            // CommonJS on purpose: tsc emits extensionless relative imports,
            // which Node's ESM resolver rejects but its CJS resolver handles.
            '--module', 'commonjs',
            '--target', 'es2020',
            '--moduleResolution', 'node'
        ],
        { cwd: ROOT, stdio: 'inherit' }
    );

    // sessionStore reaches for window.localStorage; give it one before the
    // module is imported.
    const store = new Map();
    globalThis.window = {
        localStorage: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: (k) => store.delete(k)
        }
    };

    const load = async (rel) => import(pathToFileURL(path.join(out, rel)).href);

    const { initStaircase, updateStaircase, convergedRung, nextSessionStartRung, nextSessionConfig, DEFAULT_CONFIG }
        = await load('game/training/staircase.js');
    const { initCellPicker, pickCellForLevel, MAX_SAME_SIDE_RUN } = await load('game/training/cellPicker.js');
    const { Dealer } = await load('game/training/dealer.js');
    const { TrainingSession, fallDurationMs } = await load('game/training/trainingSession.js');
    const { initGarden, grow, stagesGrown, CORRECT_PER_STAGE, STAGES_PER_PLANT, TRIALS_PER_ROUND }
        = await load('game/training/garden.js');
    const { TrialLog, toCsv } = await load('study/trialLog.js');
    const { otherSide, answerForLandingX, MIN_ANSWER_TRAVEL } = await load('shared/sides.js');
    const { CELLS } = await load('game/data/stimulusCatalog.js');
    const { readCarryOver, writeCarryOver, clearCarryOver } = await load('study/sessionStore.js');

    /** Drive the staircase through a sequence of outcomes. */
    const run = (outcomes, config = DEFAULT_CONFIG) =>
    {
        let state = initStaircase(config);
        const track = [state.rung];

        for (const correct of outcomes)
        {
            state = updateStaircase(state, correct, config).state;
            track.push(state.rung);
        }

        return { state, track };
    };

    const warmup = Array(DEFAULT_CONFIG.warmupTrials).fill(true);

    process.stdout.write('\nstaircase\n');

    check('warm-up locks R1 and ignores its own outcomes', () =>
    {
        const { state, track } = run([false, false, true, false, true, false]);
        assert.deepEqual(track, [1, 1, 1, 1, 1, 1, 1], 'rung moved during warm-up');
        assert.equal(state.inWarmup, false, 'warm-up did not end after 6 trials');
        assert.equal(state.trialsCompleted, 6);
    });

    check('warm-up resumes at the carried-over rung', () =>
    {
        const config = { ...DEFAULT_CONFIG, startRung: 5 };
        const { state } = run(warmup, config);
        assert.equal(state.rung, 5);
    });

    check('3 consecutive correct steps up, 1 wrong steps down', () =>
    {
        const config = { ...DEFAULT_CONFIG, initialStep: 1 };
        const { track } = run([...warmup, true, true, true, false], config);
        const post = track.slice(DEFAULT_CONFIG.warmupTrials);
        assert.deepEqual(post, [1, 1, 1, 2, 1], `unexpected track ${post}`);
    });

    check('two correct alone never step up', () =>
    {
        const config = { ...DEFAULT_CONFIG, initialStep: 1 };
        const { state } = run([...warmup, true, true, false, true, true, false], config);
        assert.equal(state.rung, 1);
    });

    check('the cap is NOT absorbing — R8 descends on a wrong answer', () =>
    {
        const config = { ...DEFAULT_CONFIG, initialStep: 1, startRung: 8 };
        const { state: atCap } = run([...warmup, true, true, true], config);
        assert.equal(atCap.rung, 8, 'should be pinned at the cap');

        const after = updateStaircase(atCap, false, config).state;
        assert.equal(after.rung, 7, 'R8 is absorbing — this is the defect being fixed');
    });

    check('the floor is not absorbing either — R1 climbs on three correct', () =>
    {
        const config = { ...DEFAULT_CONFIG, initialStep: 1 };
        const { state } = run([...warmup, false, false, true, true, true], config);
        assert.equal(state.rung, 2);
    });

    check('a step absorbed by the clamp is not counted as a reversal', () =>
    {
        const config = { ...DEFAULT_CONFIG, initialStep: 1 };
        // Sit at the floor, fail repeatedly (no movement), then climb.
        const { state } = run([...warmup, false, false, false, true, true, true], config);
        assert.equal(state.reversalRungs.length, 0, `phantom reversals: ${state.reversalRungs}`);
    });

    check('step size drops from 2 to 1 at the first reversal', () =>
    {
        const config = { ...DEFAULT_CONFIG, initialStep: 2, startRung: 4 };
        let state = initStaircase(config);

        for (const correct of [...warmup, true, true, true]) // up 2 → R6
        {
            state = updateStaircase(state, correct, config).state;
        }

        assert.equal(state.rung, 6, 'coarse step should move 2 rungs');
        assert.equal(state.step, 2, 'step should still be coarse before any reversal');

        state = updateStaircase(state, false, config).state; // reversal, down 2 → R4
        assert.equal(state.rung, 4);
        assert.equal(state.step, 1, 'step should refine to 1 after the first reversal');
    });

    check('convergence estimate discards the coarse first reversal', () =>
    {
        const state = {
            rung: 5,
            inWarmup: false,
            trialsCompleted: 40,
            consecutiveCorrect: 0,
            step: 1,
            lastDirection: 'up',
            reversalRungs: [2, 6, 4, 6, 4]
        };
        assert.equal(convergedRung(state), 5, 'mean of [6,4,6,4] is 5');
        assert.equal(nextSessionStartRung(state), 4, 'next session starts one rung easier');
    });

    check('a session with too few reversals falls back to the rung reached', () =>
    {
        const state = {
            rung: 3, inWarmup: false, trialsCompleted: 10, consecutiveCorrect: 0,
            step: 1, lastDirection: 'up', reversalRungs: [7]
        };
        assert.equal(convergedRung(state), 3);
    });

    check('session 2 config carries over and uses the fine step', () =>
    {
        const state = {
            rung: 6, inWarmup: false, trialsCompleted: 60, consecutiveCorrect: 0,
            step: 1, lastDirection: 'down', reversalRungs: [3, 6, 5, 6, 5]
        };
        const config = nextSessionConfig(state);
        assert.equal(config.initialStep, 1);
        assert.equal(config.startRung, 5, 'mean of [6,5,6,5] = 5.5 → R6, minus one rung');
    });

    check('converges near the 79.4 % point against a simulated listener', () =>
    {
        // A listener whose accuracy falls with rung. 3-down/1-up should settle
        // where p(correct) ~ 0.794, i.e. around R5-R6 for this profile.
        const pCorrect = [1, 0.99, 0.97, 0.94, 0.88, 0.79, 0.62, 0.55];
        const rng = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; })();
        const config = { ...DEFAULT_CONFIG, initialStep: 2 };

        let state = initStaircase(config);

        for (let i = 0; i < 2000; i += 1)
        {
            const correct = rng() < pCorrect[state.rung - 1];
            state = updateStaircase(state, correct, config).state;
        }

        const settled = convergedRung(state);
        assert.ok(state.reversalRungs.length > 20, `too few reversals: ${state.reversalRungs.length}`);
        assert.ok(settled >= 4 && settled <= 7, `settled at R${settled}, expected R4-R7`);
    });

    process.stdout.write('\ncell picker\n');

    check('a rung\'s two cells carry opposite answers', () =>
    {
        for (let rung = 1; rung <= 8; rung += 1)
        {
            const man = pickCellForLevel(rung, { lastSide: 'woman', sameSideRun: 9 }, () => 0);
            const woman = pickCellForLevel(rung, { lastSide: 'man', sameSideRun: 9 }, () => 0);
            assert.equal(man.cell.answer, 'man', `rung ${rung}`);
            assert.equal(woman.cell.answer, 'woman', `rung ${rung}`);
        }
    });

    check(`never more than ${MAX_SAME_SIDE_RUN} consecutive same-side trials`, () =>
    {
        // An adversarial rng that always wants the same side.
        let state = initCellPicker();
        let run = 0;
        let last = null;

        for (let i = 0; i < 500; i += 1)
        {
            const pick = pickCellForLevel(4, state, () => 0.1); // always draws 'man'
            state = pick.state;
            run = pick.side === last ? run + 1 : 1;
            last = pick.side;
            assert.ok(run <= MAX_SAME_SIDE_RUN, `run of ${run} same-side trials at i=${i}`);
        }
    });

    check('selection never consults the participant\'s answers', () =>
    {
        // Structural: the picker's only memory is side history. If a score, a
        // hit count or an outcome ever appears in this state, P1 has been
        // reintroduced by the back door.
        assert.deepEqual(Object.keys(initCellPicker()).sort(), ['lastSide', 'sameSideRun']);

        // And the same cell comes back for a given rung and state regardless of
        // how the participant has been doing — the only inputs are the rung,
        // the side history and the rng.
        const state = { lastSide: 'man', sameSideRun: 1 };
        const a = pickCellForLevel(6, state, () => 0.9);
        const b = pickCellForLevel(6, state, () => 0.9);
        assert.equal(a.cell.id, b.cell.id);
    });

    process.stdout.write('\ndealer\n');

    check('deals the whole pool before repeating any sentence', () =>
    {
        const dealer = new Dealer(undefined, () => 0.42);
        const first = new Set();

        for (let i = 0; i < 20; i += 1)
        {
            const token = dealer.next();
            assert.ok(!first.has(token), `${token} repeated inside one deal`);
            first.add(token);
        }

        assert.equal(first.size, 20);
    });

    check('no adjacent repeat across the deck boundary', () =>
    {
        for (let seed = 0; seed < 200; seed += 1)
        {
            let s = seed + 1;
            const rng = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
            const dealer = new Dealer(undefined, rng);
            let previous = null;

            for (let i = 0; i < 120; i += 1)
            {
                const token = dealer.next();
                assert.notEqual(token, previous, `adjacent repeat at i=${i}, seed=${seed}`);
                previous = token;
            }
        }
    });

    process.stdout.write('\ntraining session\n');

    check('the correct answer comes from the cell, never from plant state', () =>
    {
        const session = new TrainingSession({ rng: () => 0.3 });

        for (let i = 0; i < 60; i += 1)
        {
            const trial = session.nextTrial();
            assert.equal(trial.answer, trial.cell.answer, 'trial answer diverged from its cell');
            assert.equal(trial.stimulus.cellId, trial.cell.id);
            assert.equal(trial.stimulus.set, 'train');
            session.recordResult(i % 3 === 0 ? 'incorrect' : 'correct');
        }
    });

    check('the answer sequence is not predictable from outcomes (P1)', () =>
    {
        // Always answering correctly must not produce a strict alternation,
        // which is exactly what pickTargetPlantByHits() did.
        let s = 7;
        const rng = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
        const session = new TrainingSession({ rng });
        const sides = [];

        for (let i = 0; i < 200; i += 1)
        {
            sides.push(session.nextTrial().answer);
            session.recordResult('correct');
        }

        let alternations = 0;

        for (let i = 1; i < sides.length; i += 1)
        {
            if (sides[i] !== sides[i - 1]) alternations += 1;
        }

        const rate = alternations / (sides.length - 1);
        assert.ok(rate < 0.9, `sides alternate ${(rate * 100).toFixed(0)}% of the time — P1 pattern`);
        assert.ok(rate > 0.3, `sides barely alternate (${(rate * 100).toFixed(0)}%) — check the cap`);
    });

    check('nextTrial is idempotent until the result is recorded', () =>
    {
        const session = new TrainingSession({ rng: () => 0.7 });
        const a = session.nextTrial();
        const b = session.nextTrial();
        assert.equal(a.stimulus.id, b.stimulus.id, 'prefetch and spawn would disagree');
        session.recordResult('correct');
        assert.notEqual(session.nextTrial().index, a.index);
    });

    check('an aborted trial is missing data, not a wrong answer (P4)', () =>
    {
        const session = new TrainingSession({ rng: () => 0.5, config: { ...DEFAULT_CONFIG, warmupTrials: 0 } });

        for (let i = 0; i < 3; i += 1)
        {
            session.nextTrial();
            session.recordResult('correct');
        }

        const rung = session.rung;
        const accuracy = session.accuracy;

        session.nextTrial();
        const outcome = session.recordResult('aborted');

        assert.equal(outcome.rungAfter, rung, 'abort moved the staircase');
        assert.equal(session.accuracy, accuracy, 'abort entered the accuracy tally');
    });

    check('the fall always outlasts the sentence (P3)', () =>
    {
        const session = new TrainingSession({ rng: () => 0.9 });

        for (let i = 0; i < 100; i += 1)
        {
            const trial = session.nextTrial();
            assert.ok(
                trial.fallDurationMs >= (trial.stimulus.durationS * 1000) + 1000,
                `fall ${trial.fallDurationMs}ms vs sentence ${trial.stimulus.durationS}s`
            );
            assert.ok(trial.fallDurationMs >= 4500);
            session.recordResult('correct');
        }
    });

    check('the fall never ramps with round progress (P3)', () =>
    {
        const session = new TrainingSession({ rng: () => 0.2 });
        const byStimulus = new Map();

        for (let i = 0; i < 120; i += 1)
        {
            const trial = session.nextTrial();
            const seen = byStimulus.get(trial.stimulus.id);
            if (seen !== undefined)
            {
                assert.equal(trial.fallDurationMs, seen, 'same stimulus got a different fall duration');
            }
            byStimulus.set(trial.stimulus.id, trial.fallDurationMs);
            session.recordResult(i % 2 === 0 ? 'correct' : 'incorrect');
        }

        assert.ok(byStimulus.size > 10);
    });

    check('a 60-trial round fits the 5-minute dose', () =>
    {
        const session = new TrainingSession({ rng: () => 0.4 });
        let total = 0;

        for (let i = 0; i < 60; i += 1)
        {
            total += session.nextTrial().fallDurationMs + 1000; // + inter-trial gap
            session.recordResult('correct');
        }

        const minutes = total / 60000;
        assert.ok(minutes > 4.5 && minutes < 7, `60 trials would take ${minutes.toFixed(1)} min`);
    });

    check('fallDurationMs floors at 4.5 s for short stimuli', () =>
    {
        assert.equal(fallDurationMs({ durationS: 0.5 }), 4500);
        assert.equal(fallDurationMs({ durationS: 3.67 }), 4670);
    });

    process.stdout.write('\ncross-session carry-over (PROGRESS 2.6e)\n');

    check('progress round-trips per participant', () =>
    {
        const carry = { startRung: 4, garden: initGarden(), blocksCompleted: 3 };

        writeCarryOver('P01', carry);
        assert.deepEqual(readCarryOver('P01'), carry);
        assert.equal(readCarryOver('P02'), null, 'participants must not share a record');
    });

    check('reset clears only the participant it names', () =>
    {
        writeCarryOver('P01', { startRung: 4, garden: initGarden(), blocksCompleted: 3 });
        writeCarryOver('P02', { startRung: 7, garden: initGarden(), blocksCompleted: 9 });

        clearCarryOver('P01');

        assert.equal(readCarryOver('P01'), null, 'the named record survived the reset');
        // The real hazard: wiping a participant who was merely nearby.
        assert.equal(readCarryOver('P02')?.blocksCompleted, 9, 'reset hit the wrong participant');
    });

    check('a cleared participant starts as if new', () =>
    {
        writeCarryOver('P03', { startRung: 8, garden: initGarden(), blocksCompleted: 5 });
        clearCarryOver('P03');

        // Game.create() reads null and falls back to DEFAULT_CONFIG.
        const carry = readCarryOver('P03');
        const session = new TrainingSession({
            config: carry ? { ...DEFAULT_CONFIG, startRung: carry.startRung } : DEFAULT_CONFIG,
            garden: carry?.garden,
            rng: () => 0.5
        });

        assert.equal(session.rung, 1, 'a cleared participant resumed mid-ladder');
        assert.equal(session.garden.man.completed, 0, 'a cleared participant kept their garden');
    });

    check('clearing a participant with no record is a no-op, not a crash', () =>
    {
        clearCarryOver('never-seen');
        assert.equal(readCarryOver('never-seen'), null);
    });

    check('a corrupt record does not take the session down', () =>
    {
        window.localStorage.setItem('voice-plant:participant:P09', '{not json');
        assert.equal(readCarryOver('P09'), null, 'corrupt storage should read as absent');
    });

    process.stdout.write('\ngarden and round termination (D11)\n');

    check('a wrong answer changes nothing — no growth, no shrink', () =>
    {
        const before = initGarden();
        const after = grow(before, 'man', false);
        assert.equal(after.state, before, 'the state object was replaced on a wrong answer');
        assert.equal(after.advanced, false);
    });

    check(`${CORRECT_PER_STAGE} correct answers advance one stage`, () =>
    {
        let state = initGarden();

        for (let i = 1; i < CORRECT_PER_STAGE; i += 1)
        {
            const step = grow(state, 'man', true);
            state = step.state;
            assert.equal(step.advanced, false, `advanced early at ${i} correct`);
            assert.equal(state.man.active.stage, 0);
        }

        const last = grow(state, 'man', true);
        assert.equal(last.advanced, true);
        assert.equal(last.state.man.active.stage, 1);
        assert.equal(last.state.man.active.progress, 0);
    });

    check('growth is uncapped — a finished plant is kept and a new seedling sown', () =>
    {
        let state = initGarden();
        let completions = 0;

        // Enough correct answers for two full plants on one side.
        for (let i = 0; i < CORRECT_PER_STAGE * (STAGES_PER_PLANT - 1) * 2; i += 1)
        {
            const step = grow(state, 'woman', true);
            state = step.state;
            if (step.completed) completions += 1;
        }

        assert.equal(completions, 2, 'should have completed exactly two plants');
        assert.equal(state.woman.completed, 2);
        assert.equal(state.woman.active.stage, 0, 'a fresh seedling should be growing');
        assert.equal(state.man.completed, 0, 'the other side must be untouched');
    });

    check('only the correct-answer side grows', () =>
    {
        let state = initGarden();

        for (let i = 0; i < CORRECT_PER_STAGE; i += 1)
        {
            state = grow(state, 'man', true).state;
        }

        assert.equal(state.man.active.stage, 1);
        assert.equal(state.woman.active.stage, 0);
    });

    check('the garden carries into the next session', () =>
    {
        const carried = { man: { completed: 3, active: { stage: 2, progress: 1 } },
            woman: { completed: 1, active: { stage: 0, progress: 0 } } };
        const session = new TrainingSession({ rng: () => 0.5, garden: carried });
        assert.equal(session.garden.man.completed, 3);
        assert.equal(stagesGrown(session.garden.man), (3 * (STAGES_PER_PLANT - 1)) + 2);
    });

    check('the round ends on trial count, NOT on filling the plants', () =>
    {
        // The old rule ended the round after 8 correct answers. A perfect
        // performer must now still get the full dose.
        const session = new TrainingSession({ rng: () => 0.5, trialsPerRound: 60 });
        let trials = 0;

        while (!session.roundOver)
        {
            session.nextTrial();
            session.recordResult('correct');
            trials += 1;
            assert.ok(trials <= 60, 'round never ended');
        }

        assert.equal(trials, 60, `a perfect performer got ${trials} trials, not 60`);
    });

    check('dose does not depend on performance', () =>
    {
        const doseFor = (pattern) =>
        {
            const session = new TrainingSession({ rng: () => 0.5, trialsPerRound: 60 });
            let trials = 0;

            while (!session.roundOver)
            {
                session.nextTrial();
                session.recordResult(pattern(trials));
                trials += 1;
            }

            return trials;
        };

        const perfect = doseFor(() => 'correct');
        const poor = doseFor((i) => (i % 4 === 0 ? 'correct' : 'incorrect'));
        const mixed = doseFor((i) => (i % 3 === 0 ? 'aborted' : 'correct'));

        assert.equal(perfect, 60);
        assert.equal(poor, 60, `a struggling participant got ${poor} trials`);
        assert.equal(mixed, 60, 'aborted trials must count toward the round');
    });

    check('growth rate matches what the constants predict', () =>
    {
        // Derived rather than hard-coded, so retuning CORRECT_PER_STAGE (as D12
        // did, 4 → 2) moves the expectation with it instead of failing.
        const correct = TRIALS_PER_ROUND * 0.794;
        const perSide = correct / 2;
        const advancesPerSide = perSide / CORRECT_PER_STAGE;
        const expected = 2 * (advancesPerSide / (STAGES_PER_PLANT - 1));

        let s = 99;
        const rng = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
        const session = new TrainingSession({ rng, trialsPerRound: TRIALS_PER_ROUND });

        while (!session.roundOver)
        {
            session.nextTrial();
            session.recordResult(rng() < 0.794 ? 'correct' : 'incorrect');
        }

        const { man, woman } = session.garden;
        const total = man.completed + woman.completed;

        assert.ok(
            Math.abs(total - expected) <= 2,
            `${total} plants completed, expected about ${expected.toFixed(1)}`
        );
    });

    check('every correct answer on a side is visible within a couple of trials', () =>
    {
        // The complaint D12 fixes: at CORRECT_PER_STAGE = 4, three of every four
        // correct answers changed nothing on screen. Assert the gap between
        // visible advances on one side stays short.
        let state = initGarden();
        let sinceAdvance = 0;
        let worst = 0;

        for (let i = 0; i < 40; i += 1)
        {
            // Alternating sides, as the cell picker roughly produces.
            const side = i % 2 === 0 ? 'man' : 'woman';
            const step = grow(state, side, true);

            state = step.state;
            sinceAdvance += 1;

            if (step.advanced && side === 'man')
            {
                worst = Math.max(worst, sinceAdvance);
                sinceAdvance = 0;
            }
        }

        assert.ok(worst <= 4, `${worst} trials between visible advances on one side`);
    });

    process.stdout.write('\ntrial log wiring (INTEGRATION_DESIGN §8)\n');

    /**
     * Replays what Game.ts does for a whole block, without Phaser: ask for a
     * trial, decide which side was watered, log it, report the outcome. This is
     * the seam most likely to be subtly wrong — a mislabelled response column
     * would not crash anything, it would just quietly invert the data.
     */
    const simulateBlock = (accuracy) =>
    {
        let s = 4242;
        const rng = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
        const session = new TrainingSession({ rng, trialsPerRound: 60 });
        const log = new TrialLog({ participantId: 'P01', sessionId: 'train-1', block: 'train' });

        while (!session.roundOver)
        {
            const trial = session.nextTrial();
            const correct = rng() < accuracy;
            // What the scene computes from the landing x, via answerForLandingX.
            const landingX = correct
                ? (trial.answer === 'man' ? 300 : 700)
                : (trial.answer === 'man' ? 700 : 300);
            const watered = answerForLandingX(landingX, 1024);

            assert.ok(watered !== null, 'a steered drop must resolve to a side');

            log.add({
                mode: 'train',
                trialIdx: trial.index,
                stimulus: trial.stimulus,
                cell: trial.cell,
                response: watered,
                scoreCorrectness: true,
                rtMs: 900 + (rng() * 600),
                audioOnsetMs: 1000 + trial.index,
                difficultyLevel: trial.rung,
                staircaseState: trial.staircaseState,
                landingX,
                fallDurationMs: trial.fallDurationMs
            });

            session.recordResult(correct ? 'correct' : 'incorrect');
        }

        return { log, session };
    };

    check('a full block logs one row per trial with a complete header', () =>
    {
        const { log } = simulateBlock(0.8);
        const lines = log.toCsv().trim().split('\n');

        assert.equal(log.length, 60);
        assert.equal(lines.length, 61, 'header + 60 rows');

        const header = lines[0].split(',');
        for (const column of ['stimulusId', 'response', 'correct', 'rtMs', 'difficultyLevel',
            'staircaseState', 'landingX', 'fallDurationMs', 'vtlN', 'region'])
        {
            assert.ok(header.includes(column), `missing column ${column}`);
        }
    });

    check('the logged response is the side watered, and correct follows from it', () =>
    {
        const { log } = simulateBlock(0.75);

        for (const record of log.all())
        {
            const cell = CELLS.find((c) => c.id === record.stimulusId.match(/(f\d+_v[a-z]*\d+)$/)[1]);
            assert.ok(cell, `no cell for ${record.stimulusId}`);
            assert.equal(record.correct, record.response === cell.answer,
                `${record.stimulusId}: response=${record.response} answer=${cell.answer} correct=${record.correct}`);
        }
    });

    check('training rows never carry a null correct — conflict cells are excluded', () =>
    {
        const { log } = simulateBlock(0.6);

        for (const record of log.all())
        {
            assert.notEqual(record.correct, null, `${record.stimulusId} has no ground truth`);
            assert.notEqual(record.region, 'conflict', 'a conflict cell reached training');
        }
    });

    check('vtlN uses the stimulus\'s realized ΔVTL, not the nominal one (D6)', () =>
    {
        const { log } = simulateBlock(0.8);

        for (const record of log.all())
        {
            assert.ok(Math.abs(record.vtlN - (record.dvtlRealizedSt / 3.6)) < 1e-9);
            // The realized value must actually differ from nominal somewhere,
            // or the regressor has silently fallen back to the design values.
        }

        assert.ok(
            log.all().some((r) => Math.abs(r.dvtlRealizedSt - r.dvtlNominalSt) > 0.05),
            'realized and nominal ΔVTL are identical — is the catalog stale?'
        );
    });

    check('null is written as an empty CSV field, distinct from false', () =>
    {
        const { log } = simulateBlock(0.8);
        const record = log.all()[0];
        const csv = toCsv([
            { ...record, correct: null, rtMs: null },
            { ...record, correct: false, rtMs: 0 }
        ]).trim().split('\n');

        const header = csv[0].split(',');
        const nullRow = csv[1].split(',');
        const falseRow = csv[2].split(',');

        assert.equal(nullRow[header.indexOf('correct')], '', 'null correct must be empty');
        assert.equal(falseRow[header.indexOf('correct')], 'false');
        assert.equal(nullRow[header.indexOf('rtMs')], '');
        assert.equal(falseRow[header.indexOf('rtMs')], '0', '0 ms must not be confused with missing');
    });

    check('an unsteered drop is a non-response, not an answer', () =>
    {
        const W = 1024;

        // The drop spawns at exactly the midline and stays there if nothing is
        // pressed. A plain `x < W/2` split resolved that tie to one fixed side,
        // so every non-response was silently recorded as "woman".
        assert.equal(answerForLandingX(W / 2, W), null, 'the spawn point must not be an answer');
        assert.equal(answerForLandingX(W / 2 - 1, W), null);
        assert.equal(answerForLandingX(W / 2 + 1, W), null);

        // A real answer still resolves, and to the correct side.
        assert.equal(answerForLandingX(280, W), 'man', 'the Lupinus is on the left');
        assert.equal(answerForLandingX(744, W), 'woman', 'the Cactus is on the right');
        assert.equal(answerForLandingX(0, W), 'man');
        assert.equal(answerForLandingX(W, W), 'woman');

        // The dead zone is narrow enough not to swallow deliberate answers.
        assert.equal(answerForLandingX((W / 2) - MIN_ANSWER_TRAVEL, W), 'man');
        assert.equal(answerForLandingX((W / 2) + MIN_ANSWER_TRAVEL, W), 'woman');
        assert.ok(MIN_ANSWER_TRAVEL < 100, 'dead zone must stay far from the plants at +-232 px');
    });

    check('a non-response is logged with correct = null, not false', () =>
    {
        const session = new TrainingSession({ rng: () => 0.5, config: { ...DEFAULT_CONFIG, warmupTrials: 0 } });
        const log = new TrialLog({ participantId: 'P01', sessionId: 'train-1', block: 'train' });

        for (const response of ['timeout', 'aborted'])
        {
            const trial = session.nextTrial();

            log.add({
                mode: 'train',
                trialIdx: trial.index,
                stimulus: trial.stimulus,
                cell: trial.cell,
                response,
                scoreCorrectness: true,
                rtMs: null,
                audioOnsetMs: 0,
                difficultyLevel: trial.rung
            });

            session.recordResult(response);
        }

        for (const record of log.all())
        {
            // false would count a trial the participant sat out as an error and
            // deflate the learning curve; the runtime already excludes them.
            assert.equal(record.correct, null, `${record.response} logged as an error`);
        }

        assert.equal(session.accuracy, null, 'non-responses entered the accuracy tally');
    });

    check('a timed-out trial still counts toward the round', () =>
    {
        const session = new TrainingSession({ rng: () => 0.5, trialsPerRound: 10 });
        let trials = 0;

        while (!session.roundOver)
        {
            session.nextTrial();
            session.recordResult('timeout');
            trials += 1;
        }

        // Otherwise a participant could extend their own round by not answering.
        assert.equal(trials, 10);
    });

    check('an aborted trial is logged and skips the staircase', () =>
    {
        const session = new TrainingSession({ rng: () => 0.5, config: { ...DEFAULT_CONFIG, warmupTrials: 0 } });
        const log = new TrialLog({ participantId: 'P01', sessionId: 'train-1', block: 'train' });
        const trial = session.nextTrial();

        log.add({
            mode: 'train',
            trialIdx: trial.index,
            stimulus: trial.stimulus,
            cell: trial.cell,
            response: 'aborted',
            scoreCorrectness: true,
            rtMs: null,
            audioOnsetMs: 0,
            difficultyLevel: trial.rung,
            staircaseState: trial.staircaseState
        });

        session.recordResult('aborted');

        const record = log.all()[0];
        assert.equal(record.response, 'aborted');
        assert.equal(record.correct, null, 'an abort is missing data, not an error');
        assert.equal(record.rtMs, null, 'an aborted trial has no reaction time');
        assert.equal(session.accuracy, null, 'abort entered the accuracy tally');
    });

    check('nothing in the garden feeds back into stimulus selection (P1)', () =>
    {
        // Two sessions driven by the same rng but opposite outcomes must present
        // the same stimuli: selection depends on the rung and the deal, and the
        // rung is the only channel through which performance may act.
        const sidesFor = (outcome) =>
        {
            let s = 5;
            const rng = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
            const session = new TrainingSession({
                rng,
                garden: outcome === 'correct'
                    ? { man: { completed: 9, active: { stage: 3, progress: 2 } },
                        woman: { completed: 0, active: { stage: 0, progress: 0 } } }
                    : undefined,
                config: { ...DEFAULT_CONFIG, warmupTrials: 60 } // pin the rung
            });
            const ids = [];

            for (let i = 0; i < 40; i += 1)
            {
                ids.push(session.nextTrial().stimulus.id);
                session.recordResult(outcome);
            }

            return ids;
        };

        assert.deepEqual(sidesFor('correct'), sidesFor('incorrect'),
            'a lopsided garden changed which stimuli were presented');
    });
}
finally
{
    rmSync(out, { recursive: true, force: true });
}

process.stdout.write(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
