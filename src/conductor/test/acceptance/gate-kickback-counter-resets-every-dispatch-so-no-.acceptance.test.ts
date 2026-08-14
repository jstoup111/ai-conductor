/**
 * RED acceptance specs for #984 — "Gate kickback counter resets every
 * dispatch, so no-progress cycles never terminate".
 *
 * Stories: `.docs/stories/gate-kickback-counter-resets-every-dispatch-so-no-.md`
 * Plan:    `.docs/plans/gate-kickback-counter-resets-every-dispatch-so-no-.md`
 * ADR:     `.docs/decisions/adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md`
 *
 * These drive REAL `Conductor.run()` dispatches over a REAL git repo
 * (`test/fixtures/git-repo.ts`) with a fake `StepRunner` — the same shape
 * `test/wiring-gate-loop.test.ts` and
 * `test/acceptance/kickback-build-noop-escalation.acceptance.test.ts` use.
 * Nothing internal is mocked; there is no third-party boundary in this flow
 * (no LLM, no `gh`, no network) beyond the injected `git` runner the
 * pre-existing wiring-gate fixture already uses for `finish`'s push-evidence
 * probe. `currentCommitSha`/`currentTreeHash` shell out to the REAL repo.
 *
 * Why acceptance level rather than unit (§3a / §3d of /writing-system-tests):
 *
 *  - Story 1 and Story 4's cross-dispatch criteria are multi-step by
 *    definition — they only exist ACROSS two sequential `Conductor` instances
 *    over one worktree. A single-instance unit test cannot observe them: the
 *    whole defect is that `kickbackCounts` (`conductor.ts:2343`) and
 *    `kickbackToBuildContext` (`:2383`) are declared inside `run()`.
 *  - Story 2 is the §3d "adversarial derivation, real call site" class.
 *    `classifyBuildProgress` is pure and gets its own unit tests (plan Task
 *    3), but a unit test that hand-injects `treeBefore`/`treeAfter` passes
 *    while the REAL call site — `checkKickbackToBuildEscalation`
 *    (`conductor.ts:2413-2451`) — still gathers `currentCommitSha`. The bug
 *    lives in that wiring, so the empty commit here is a REAL
 *    `git commit --allow-empty`, minted by a real build dispatch, and the
 *    assertion is on the observable HALT, not on the classifier's return
 *    value. Call sites of the derivation enumerated for the domain reviewer:
 *      * `conductor.ts:2423` — `checkKickbackToBuildEscalation` (the only
 *        production caller of `classifyBuildProgress`), reached from
 *        `manual_test` (`:2468`), the validation-group join (`:3288`),
 *        `build_review` (`:5115`), `prd_audit` (`:5438`), and the generic
 *        gate site (`:5597`). `wiring_check` reaches it from NOWHERE today —
 *        that absence is Story 3.
 *      * `conductor.ts:2396` — `captureKickbackToBuildContext`, the baseline
 *        producer, currently `currentCommitSha`.
 *
 * `wiring_check` is the vehicle for most cases: it is the gate that actually
 * livelocked on 2026-07-26, its failure reason is deterministic (no LLM
 * grader), and its self-heal block is not daemon-gated
 * (`conductor.ts:5246-5254`), so the fixture stays small. `build_review` is
 * driven separately for Story 5's second converted HALT site.
 *
 * EXPECTED RED (none of this exists today):
 *  - `.pipeline/kickback-ledger.json` — the module, the path, and every write
 *    of it (plan Tasks 1-2, 6, 8, 10). Nothing in `src/` mentions it.
 *  - `currentTreeHash` / `git rev-parse HEAD^{tree}` — verified absent from
 *    the whole repo (plan Task 4).
 *  - `wiring_check`'s D2 capture/check pair (plan Tasks 12-13).
 *  - `.pipeline/HALT.class` on either cap-HALT path — both hand-roll
 *    `writeFile` today (`conductor.ts:5218-5227`, `:5325-5334`) and write no
 *    class sidecar (plan Tasks 14-15).
 *
 * Three cases below are deliberate REGRESSION LOCKS that are expected to PASS
 * today (they pin behavior the fix must not break): "real file change is
 * progress", "D2 disabled still terminates", and "budget is never below
 * MAX_KICKBACKS_PER_GATE". They are marked inline. Every other case fails
 * against the current tree.
 *
 * CONFIDENCE NOTES (verify-claims protocol — genuine assumptions of this
 * file, not values pinned by the story/ADR/plan text):
 *  - LEDGER CONTAINER SHAPE — the story and plan pin the PATH
 *    (`.pipeline/kickback-ledger.json`), `version: 1`, and the per-gate entry
 *    fields (`count`, `treeHash`, `lastReason`, `priorVerdict`,
 *    `resolvedBefore`). They do NOT pin how gate entries are keyed inside the
 *    document. `readLedgerEntry` below therefore accepts `{gates:{...}}`,
 *    `{entries:{...}}`, or a flat top-level map. MEDIUM confidence; if the
 *    implemented shape is a fourth variant this helper needs one line, which
 *    is expected spec upkeep, not a sign the assertion is wrong.
 *  - HALT WORDING — asserted with loose regexes plus exact substring checks
 *    for the things the story DOES pin (gate name, lap count, recorded
 *    reason). The story never fixes a literal sentence.
 *  - NOT COVERED HERE, by design (§3a "if a test could live in a lower layer,
 *    it should"): Story 1's corrupt-JSON / wrong-`version` `console.warn`
 *    parse behavior beyond "the dispatch survives it" (plan Task 1, unit),
 *    the null-tree-hash fold to `'no-work'` (plan Task 3, pure unit — it has
 *    no acceptance-observable shape without breaking git itself), atomic
 *    temp-file+rename write durability (plan Task 2, unit, mirroring
 *    `task-evidence.test.ts`), and Story 5's empty-`lastReason` placeholder
 *    (plan Task 14 — pure message composition).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { readHaltClass } from '../../src/engine/halt-marker.js';
import type { ShipmentEvidenceInput } from '../../src/engine/shipment-evidence.js';
import { initTestRepo } from '../fixtures/git-repo.js';
import type { ConductState, StepName } from '../../src/types/index.js';

/** `conductor.ts:321` — not exported; mirrored here so the specs state the
 * budget they assert on. Story 4's negative path pins this exact value as the
 * floor for every step kind. */
const MAX_KICKBACKS_PER_GATE = 2;

const KICKBACK_LEDGER = '.pipeline/kickback-ledger.json';
const HALT_MARKER = '.pipeline/HALT';
const HALT_CLASS_MARKER = '.pipeline/HALT.class';

interface LedgerEntry {
  count?: number;
  treeHash?: string | null;
  lastReason?: string;
  priorVerdict?: boolean;
  resolvedBefore?: number;
}

/** Tolerant reader — see the LEDGER CONTAINER SHAPE confidence note. */
async function readLedgerEntry(dir: string, gate: string): Promise<LedgerEntry | null> {
  let raw: string;
  try {
    raw = await readFile(join(dir, KICKBACK_LEDGER), 'utf-8');
  } catch {
    return null;
  }
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const container = (doc.gates ?? doc.entries ?? doc) as Record<string, unknown> | undefined;
  const entry = container?.[gate];
  return entry !== null && typeof entry === 'object' ? (entry as LedgerEntry) : null;
}

async function exists(dir: string, rel: string): Promise<boolean> {
  return access(join(dir, rel)).then(
    () => true,
    () => false,
  );
}

function treeHash(dir: string): string {
  return execSync('git rev-parse "HEAD^{tree}"', { cwd: dir }).toString().trim();
}

function frontDone(): ConductState {
  return {
    complexity_tier: 'S',
    feature_desc: 'add foo',
    worktree: 'done',
    memory: 'done',
    explore: 'done',
    prd: 'done',
    complexity: 'done',
    stories: 'done',
    conflict_check: 'skipped',
    plan: 'done',
    architecture_diagram: 'skipped',
    architecture_review: 'skipped',
    acceptance_specs: 'skipped',
  };
}

/** The kickback vehicle. `build_review` is the deterministic BUILD gate that
 * still routes an unsatisfied verdict back to `build`: a non-completeness
 * rubric FAIL takes `buildReviewFailRoute -> 'build'`, which is the cap path
 * this file bounds. (`wiring_check`, the original 2026-07-26 vehicle, is now a
 * deprecated no-op that never kicks back —
 * adr-2026-08-11-wiring-judged-in-build-review.) */
const FAIL_VERDICT = (message: string): string =>
  JSON.stringify({
    verdict: 'FAIL',
    rubric: { tautology: true, scope: false, rootCause: false, completeness: false },
    findings: { tautology: [message] },
  });

describe('acceptance: cross-dispatch kickback livelock bound (#984)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  let kicks: Array<{ from: string; to: string }>;
  let halts: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kickback-ledger-acceptance-'));
    // The `finish` completion predicate reads pr_url from the hardcoded
    // `.pipeline/conduct-state.json` path (see wiring-gate-loop.test.ts).
    statePath = join(dir, '.pipeline/conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, '.docs'), { recursive: true });
    await mkdir(join(dir, '.ai-conductor'), { recursive: true });
    await writeFile(
      join(dir, '.ai-conductor/config.yml'),
      'test_suite:\n  command: true\n  working_directory: .\n  timeout_seconds: 10\n',
    );
    // A REAL repo: the tree-hash witness under test must resolve for real.
    await initTestRepo(dir);
    await writeFile(join(dir, '.gitignore'), '.pipeline/\n');
    await writeFile(join(dir, 'README.md'), 'fixture\n');
    execSync('git add -A', { cwd: dir });
    execSync('git commit -q -m "init"', { cwd: dir });

    events = new ConductorEventEmitter();
    kicks = [];
    halts = [];
    events.on('kickback', (e) => {
      if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
    });
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') halts.push(e.reason);
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function satisfy(step: string): Promise<StepRunResult> {
    if (step === 'build') {
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
      );
    } else if (step === 'build_review') {
      await writeFile(
        join(dir, '.pipeline/build-review.json'),
        JSON.stringify({
          verdict: 'PASS',
          rubric: { tautology: false, scope: false, rootCause: false, completeness: false },
        }),
      );
    } else if (step === 'manual_test') {
      await writeFile(
        join(dir, '.pipeline/manual-test-results.md'),
        '| Story | Result |\n|---|---|\n| foo | PASS |\n',
      );
    } else if (step === 'finish') {
      const current = await readState(statePath);
      const merged = { ...(current.ok ? current.value : {}), pr_url: 'https://example.com/pr/1' };
      await writeState(statePath, merged);
      await writeFile(join(dir, '.pipeline/finish-choice'), 'pr');
    }
    return { success: true };
  }

  /** Injected git runner so `finish`'s push-evidence probe resolves — the
   * real repo has no upstream. Only this probe is faked; `currentCommitSha`
   * and the new tree-hash witness shell out to the real repo directly. */
  const fakeGit = async (args: string[]): Promise<{ stdout: string }> => {
    if (args[0] === 'rev-parse' && args.includes('@{u}')) {
      return { stdout: 'refs/remotes/origin/main' };
    }
    return { stdout: '' };
  };

  function makeConductor(
    runner: StepRunner,
    opts: {
      escalationEnabled?: boolean;
      fromStep?: StepName;
      onFullSuiteEnsure?: () => void;
    } = {},
  ): Conductor {
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep: opts.fromStep ?? 'build',
      maxRetries: 1,
      daemon: true,
      config: {
        build_review: { enabled: true },
        kickback_escalation: { enabled: opts.escalationEnabled ?? true },
      },
      git: fakeGit,
      shipmentEvidence: async (input: ShipmentEvidenceInput) => ({
        kind: 'valid',
        slug: input.slug,
        pr: input.implementationPr,
        recordPath: `.docs/shipped/${input.slug}.md`,
        hash: 'fixture-hash',
        commit: input.candidateCommit,
      }),
      fullSuiteVerifier: {
        ensure: async () => {
          opts.onFullSuiteEnsure?.();
          return { status: 'REUSED', evidence: {} as never };
        },
        inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
      },
    } as never);
  }

  /** Restage the SHIP tail so a second `Conductor` re-enters `build_review`,
   * exactly as the daemon's next dispatch does. `run_started_at` is left
   * intact — this is a re-dispatch of the SAME feature session, not a fresh
   * one, which is precisely the boundary the bound must survive. */
  async function restageForRedispatch(): Promise<void> {
    const res = await readState(statePath);
    const state = (res.ok ? res.value : {}) as Record<string, unknown>;
    state.build_review = 'pending';
    state.test_suite = 'stale';
    state.manual_test = 'stale';
    state.finish = 'pending';
    await writeState(statePath, state as unknown as ConductState);
    // The daemon's re-kick sweep clears a prior dispatch's markers before
    // re-dispatching; do the same so assertions read THIS dispatch's HALT.
    await rm(join(dir, HALT_MARKER), { force: true });
    await rm(join(dir, HALT_CLASS_MARKER), { force: true });
  }

  // ───────────────────────────── Story 1 ─────────────────────────────

  it(
    'Story 1 happy: a kickback consumed in one dispatch is remembered by the next — ' +
      'the re-dispatch spends only the remaining budget and HALTs',
    async () => {
      await writeState(statePath, { ...frontDone(), track: 'technical' });
      let wiringRuns = 0;
      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build_review') {
            wiringRuns++;
            // Dispatch 1: gap once (consumes exactly 1 kickback), then clean
            // so the dispatch converges and ENDS with the budget partly spent.
            if (wiringRuns === 1) {
              await writeFile(join(dir, '.pipeline/build-review.json'), FAIL_VERDICT('foo unreachable'));
              return { success: true };
            }
            return satisfy('build_review');
          }
          return satisfy(step);
        },
      };
      // D2 disabled so this case isolates D1 (the persisted counter). D2's own
      // cross-dispatch behavior is covered by the Story 2/3 cases below.
      await makeConductor(runner, { escalationEnabled: false }).run();

      const t1 = treeHash(dir);
      const afterFirst = await readLedgerEntry(dir, 'build_review');
      expect(afterFirst).not.toBeNull();
      expect(afterFirst?.count).toBe(1);
      expect(afterFirst?.treeHash).toBe(t1);
      expect(afterFirst?.lastReason).toContain('foo unreachable');
      expect(kicks.filter((k) => k.from === 'build_review')).toHaveLength(1);

      // ── The dispatch boundary: a brand-new Conductor over the same worktree,
      // same feature session, unchanged tree. The budget must NOT refresh.
      await restageForRedispatch();
      kicks = [];
      halts = [];

      const alwaysGapping: StepRunner = {
        run: async (step) => {
          if (step === 'build_review') {
            await writeFile(join(dir, '.pipeline/build-review.json'), FAIL_VERDICT('foo unreachable'));
            return { success: true };
          }
          return satisfy(step);
        },
      };
      await makeConductor(alwaysGapping, {
        escalationEnabled: false,
        fromStep: 'build_review',
      }).run();

      // Resumes at 1 → one more kickback reaches the cap → HALT. Today the
      // counter restarts at 0 and this dispatch spends the FULL budget again,
      // which is the livelock: every dispatch buys two more laps forever.
      expect(kicks.filter((k) => k.from === 'build_review' && k.to === 'build')).toHaveLength(1);
      expect(halts).toHaveLength(1);
      expect(await exists(dir, HALT_MARKER)).toBe(true);
      expect(treeHash(dir)).toBe(t1);
    },
    60_000,
  );

  it(
    'Story 1 negative: an absent ledger fails open — the first dispatch gets a full budget, ' +
      'no HALT on the first lap, and the ledger is created',
    async () => {
      await writeState(statePath, { ...frontDone(), track: 'technical' });
      expect(await exists(dir, KICKBACK_LEDGER)).toBe(false);

      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build_review') {
            await writeFile(join(dir, '.pipeline/build-review.json'), FAIL_VERDICT('foo unreachable'));
            return { success: true };
          }
          return satisfy(step);
        },
      };
      await makeConductor(runner, { escalationEnabled: false }).run();

      // Fails OPEN: the missing ledger never short-circuits into a halt on the
      // first failing lap — the gate still gets its whole budget.
      expect(kicks.filter((k) => k.from === 'build_review' && k.to === 'build')).toHaveLength(
        MAX_KICKBACKS_PER_GATE,
      );
      expect(await readLedgerEntry(dir, 'build_review')).not.toBeNull();
    },
    60_000,
  );

  it(
    'Story 1 negative: a corrupt ledger is treated as absent — the dispatch survives it, ' +
    'warns, and proceeds on a fresh budget',
    async () => {
      await writeState(statePath, {
        ...frontDone(),
        track: 'technical',
        // An unset value means a fresh session and deliberately clears the
        // ledger before its tolerant reader can observe corruption.
        run_started_at: 1,
      });
      await writeFile(join(dir, KICKBACK_LEDGER), '{ not json at all');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build_review') {
            await writeFile(join(dir, '.pipeline/build-review.json'), FAIL_VERDICT('foo unreachable'));
            return { success: true };
          }
          return satisfy(step);
        },
      };
      await expect(makeConductor(runner, { escalationEnabled: false }).run()).resolves.not.toThrow();

      expect(kicks.filter((k) => k.from === 'build_review' && k.to === 'build')).toHaveLength(
        MAX_KICKBACKS_PER_GATE,
      );
      expect(warn).toHaveBeenCalled();
      // The corrupt document is replaced, not left to poison the next dispatch.
      const entry = await readLedgerEntry(dir, 'build_review');
      expect(entry).not.toBeNull();
      warn.mockRestore();
    },
    60_000,
  );

  it(
    'Story 1 negative: a fresh feature session (run_started_at unset) clears a stale ledger ' +
      'instead of inheriting a prior feature budget',
    async () => {
      // No run_started_at → fresh feature session, the same lifecycle
      // `.pipeline/build-review-regrade.json` follows (conductor.ts:2184-2185).
      await writeState(statePath, { ...frontDone(), track: 'technical' });
      await writeFile(
        join(dir, KICKBACK_LEDGER),
        JSON.stringify({
          version: 1,
          gates: {
            build_review: {
              count: MAX_KICKBACKS_PER_GATE,
              treeHash: treeHash(dir),
              lastReason: 'stale reason from a prior feature',
              priorVerdict: false,
              resolvedBefore: 0,
            },
          },
        }),
      );

      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build_review') {
            await writeFile(join(dir, '.pipeline/build-review.json'), FAIL_VERDICT('foo unreachable'));
            return { success: true };
          }
          return satisfy(step);
        },
      };
      await makeConductor(runner, { escalationEnabled: false }).run();

      // A brand-new feature never starts already-exhausted.
      expect(kicks.filter((k) => k.from === 'build_review' && k.to === 'build')).toHaveLength(
        MAX_KICKBACKS_PER_GATE,
      );
      const raw = await readFile(join(dir, KICKBACK_LEDGER), 'utf-8');
      expect(raw).not.toContain('stale reason from a prior feature');
    },
    60_000,
  );

  // ──────────────────────── Stories 2 and 3 ────────────────────────

  it(
    'Story 2 + Story 3 happy: a build that only mints a REAL empty commit is not progress — ' +
      'build_review escalates on that cycle instead of spending the rest of its budget',
    async () => {
      await writeState(statePath, { ...frontDone(), track: 'technical' });
      const t0 = treeHash(dir);
      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build_review') {
            // Byte-identical gap every lap: the incident shape.
            await writeFile(join(dir, '.pipeline/build-review.json'), FAIL_VERDICT('foo unreachable'));
            return { success: true };
          }
          if (step === 'build') {
            // The exact laundering the incident used (commit 0c4515db): HEAD
            // advances over a byte-identical tree.
            execSync('git commit -q --allow-empty -m "chore: no-op"', { cwd: dir });
            return satisfy('build');
          }
          return satisfy(step);
        },
      };
      await makeConductor(runner, { escalationEnabled: true }).run();

      // The empty commit advanced HEAD, so today's sha-keyed classifier scores
      // 'did-work' and suppresses the escalation — and the gate never
      // consults it at all. Both must change: exactly one kickback, then HALT.
      expect(kicks.filter((k) => k.from === 'build_review' && k.to === 'build')).toHaveLength(1);
      expect(await exists(dir, HALT_MARKER)).toBe(true);
      const body = await readFile(join(dir, HALT_MARKER), 'utf-8');
      expect(body).toMatch(/no.?(work|progress)|unchanged|no-op/i);
      // Tree is provably identical across the whole run despite the commits.
      expect(treeHash(dir)).toBe(t0);
      expect(execSync('git rev-parse HEAD', { cwd: dir }).toString().trim()).not.toBe(
        execSync('git rev-parse HEAD~1', { cwd: dir }).toString().trim(),
      );
    },
    60_000,
  );

  it(
    'Story 2 negative (REGRESSION LOCK — expected to pass today): a build that changes real ' +
      'files IS progress — the lap that did work does not escalate',
    async () => {
      await writeState(statePath, { ...frontDone(), track: 'technical' });
      const t0 = treeHash(dir);
      let builds = 0;
      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build_review') {
            await writeFile(join(dir, '.pipeline/build-review.json'), FAIL_VERDICT('foo unreachable'));
            return { success: true };
          }
          if (step === 'build') {
            builds++;
            // Only the FIRST rework lap does real work; later laps go quiet so
            // the run still terminates (a tree that moves every lap earns a
            // fresh budget forever, by design — Story 4 happy).
            if (builds === 2) {
              await mkdir(join(dir, 'src'), { recursive: true });
              await writeFile(join(dir, 'src/real.ts'), 'export const foo = 1;\n');
              execSync('git add -A', { cwd: dir });
              execSync('git commit -q -m "feat: real change"', { cwd: dir });
            }
            return satisfy('build');
          }
          return satisfy(step);
        },
      };
      await makeConductor(runner, { escalationEnabled: true }).run();

      expect(treeHash(dir)).not.toBe(t0);
      // The productive lap bought a second kickback rather than escalating.
      expect(
        kicks.filter((k) => k.from === 'build_review' && k.to === 'build').length,
      ).toBeGreaterThanOrEqual(2);
    },
    60_000,
  );

  it(
    'Story 3 negative (REGRESSION LOCK — expected to pass today): with kickback_escalation ' +
      'disabled, D2 stays silent and the D1 cap still terminates the loop',
    async () => {
      await writeState(statePath, { ...frontDone(), track: 'technical' });
      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build_review') {
            await writeFile(join(dir, '.pipeline/build-review.json'), FAIL_VERDICT('foo unreachable'));
            return { success: true };
          }
          if (step === 'build') {
            execSync('git commit -q --allow-empty -m "chore: no-op"', { cwd: dir });
            return satisfy('build');
          }
          return satisfy(step);
        },
      };
      await makeConductor(runner, { escalationEnabled: false }).run();

      expect(kicks.filter((k) => k.from === 'build_review' && k.to === 'build')).toHaveLength(
        MAX_KICKBACKS_PER_GATE,
      );
      expect(halts).toHaveLength(1);
      // Terminated by the cap, not by D2.
      expect(halts[0]).toMatch(/cap 2|kickback\(s\)/i);
    },
    60_000,
  );

  // ───────────────────────────── Story 4 ─────────────────────────────

  it(
    'Story 4 happy: a changed tree restores the full budget — count resets to 1 and treeHash ' +
      'is rewritten to the new tree',
    async () => {
      await writeState(statePath, { ...frontDone(), track: 'technical' });
      let wiringRuns = 0;
      let builds = 0;
      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build_review') {
            wiringRuns++;
            if (wiringRuns <= 2) {
              await writeFile(join(dir, '.pipeline/build-review.json'), FAIL_VERDICT('foo unreachable'));
              return { success: true };
            }
            return satisfy('build_review');
          }
          if (step === 'build') {
            builds++;
            if (builds === 2) {
              await mkdir(join(dir, 'src'), { recursive: true });
              await writeFile(join(dir, 'src/real.ts'), 'export const foo = 1;\n');
              execSync('git add -A', { cwd: dir });
              execSync('git commit -q -m "feat: real change"', { cwd: dir });
            }
            return satisfy('build');
          }
          return satisfy(step);
        },
      };
      await makeConductor(runner, { escalationEnabled: false }).run();

      const t2 = treeHash(dir);
      const entry = await readLedgerEntry(dir, 'build_review');
      expect(entry).not.toBeNull();
      // Two failing laps, but the tree moved between them: a full fresh budget,
      // no penalty carried from T1.
      expect(entry?.count).toBe(1);
      expect(entry?.treeHash).toBe(t2);
    },
    60_000,
  );

  it(
    'Story 4 negative: failure-reason text that differs on EVERY lap still terminates — the ' +
      'bound is keyed on the tree, never on reason text (central design constraint)',
    async () => {
      await writeState(statePath, { ...frontDone(), track: 'technical' });
      let lap = 0;
      const nextRunner = (): StepRunner => ({
        run: async (step) => {
          if (step === 'build_review') {
            lap++;
            // Every lap reports a DIFFERENT reason, the way build_review's
            // grader prose, manual_test's rows and test_suite's runner output
            // legitimately do. A reason-keyed counter would reset here forever.
            await writeFile(
              join(dir, '.pipeline/build-review.json'),
              FAIL_VERDICT(`unreachable symbol variant #${lap} at 0x${lap}abc`),
            );
            return { success: true };
          }
          return satisfy(step);
        },
      });

      await makeConductor(nextRunner(), { escalationEnabled: false, fromStep: 'build' }).run();
      // Dispatch 1 spends the budget it has; assert only that the ledger moved.
      const afterFirst = await readLedgerEntry(dir, 'build_review');
      expect(afterFirst).not.toBeNull();
      expect(afterFirst?.count).toBeGreaterThanOrEqual(1);

      await restageForRedispatch();
      const kicksBefore = kicks.filter((k) => k.from === 'build_review').length;
      await makeConductor(nextRunner(), {
        escalationEnabled: false,
        fromStep: 'build_review',
      }).run();

      // Across BOTH dispatches the gate never exceeds its single budget, even
      // though no two laps share a reason string.
      const total = kicks.filter((k) => k.from === 'build_review' && k.to === 'build').length;
      expect(total).toBe(MAX_KICKBACKS_PER_GATE);
      expect(kicks.filter((k) => k.from === 'build_review').length).toBeGreaterThan(kicksBefore - 1);
      expect(halts.length).toBeGreaterThanOrEqual(1);
      expect(await exists(dir, HALT_MARKER)).toBe(true);
    },
    60_000,
  );

  it(
    'Story 4 negative (REGRESSION LOCK — expected to pass today): the budget is never reduced ' +
      'below MAX_KICKBACKS_PER_GATE — a nondeterministic step still gets every lap',
    async () => {
      await writeState(statePath, { ...frontDone(), track: 'technical' });
      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build_review') {
            await writeFile(join(dir, '.pipeline/build-review.json'), FAIL_VERDICT('foo unreachable'));
            return { success: true };
          }
          return satisfy(step);
        },
      };
      await makeConductor(runner, { escalationEnabled: false }).run();

      const spent = kicks.filter((k) => k.from === 'build_review' && k.to === 'build').length;
      expect(spent).not.toBe(0);
      expect(spent).not.toBe(1);
      expect(spent).toBe(MAX_KICKBACKS_PER_GATE);
    },
    60_000,
  );

  // ───────────────────────────── Story 5 ─────────────────────────────

  it(
    'Story 5 happy: the build_review cap HALT names the gate, the laps consumed and the ' +
      'recorded reason, and writes .pipeline/HALT.class as needs-human',
    async () => {
      await writeState(statePath, { ...frontDone(), track: 'technical' });
      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build_review') {
            await writeFile(
              join(dir, '.pipeline/build-review.json'), FAIL_VERDICT('foo unreachable from any entry point'),
            );
            return { success: true };
          }
          return satisfy(step);
        },
      };
      await makeConductor(runner, { escalationEnabled: false }).run();

      expect(await exists(dir, HALT_MARKER)).toBe(true);
      const body = await readFile(join(dir, HALT_MARKER), 'utf-8');
      expect(body).toContain('build_review');
      expect(body).toContain(String(MAX_KICKBACKS_PER_GATE));
      expect(body).toContain('foo unreachable from any entry point');
      // Today this path hand-rolls writeFile and writes no class sidecar, so
      // the re-kick sweep recycles the livelock as 'unclassified'.
      expect(await readHaltClass(dir)).toBe('needs-human');
    },
    60_000,
  );

  it(
    'Story 5 negative: a rubric FAIL authored inline — not through the shared vehicle — ' +
      'reaches the same cap HALT, classified needs-human and naming its gate',
    async () => {
      await writeState(statePath, { ...frontDone(), track: 'technical' });
      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build_review') {
            // A non-completeness rubric FAIL routes straight back to `build`
            // (buildReviewFailRoute → 'build'), so this exercises the cap path
            // rather than the remediation planner.
            await writeFile(
              join(dir, '.pipeline/build-review.json'),
              JSON.stringify({
                verdict: 'FAIL',
                rubric: { tautology: true, scope: false, rootCause: false, completeness: false },
                findings: { tautology: ['assertion restates the implementation'] },
              }),
            );
            return { success: true };
          }
          return satisfy(step);
        },
      };
      await makeConductor(runner, { escalationEnabled: false }).run();

      expect(kicks.filter((k) => k.from === 'build_review' && k.to === 'build')).toHaveLength(
        MAX_KICKBACKS_PER_GATE,
      );
      expect(await exists(dir, HALT_MARKER)).toBe(true);
      const body = await readFile(join(dir, HALT_MARKER), 'utf-8');
      expect(body).toContain('build_review');
      expect(await readHaltClass(dir)).toBe('needs-human');
    },
    60_000,
  );
});
