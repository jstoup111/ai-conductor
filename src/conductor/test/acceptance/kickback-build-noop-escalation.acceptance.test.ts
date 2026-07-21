/**
 * RED acceptance specs for #647 — "kickback to build is a no-op when the
 * target task's evidence is still stamped".
 *
 * Drives a real daemon-mode Conductor.run() through the as-built-review
 * remediation kickback→build route (conductor.ts ~3084-3107, the same
 * `planRemediation`-fed site `test/engine/merged-pr-guard-kickback.test.ts`
 * exercises for `finish`) with a fake StepRunner, asserting the two new
 * deterministic guards from
 * `.docs/decisions/adr-2026-07-13-kickback-build-no-op-escalation.md`:
 *
 *  - D1 (Story 2): `planRemediation` must recompute build completion after
 *    append+re-seed and HALT (not route) when there is no dispatchable work.
 *  - D2 (Story 3): a kickback→build re-entry that ends with zero net
 *    progress AND an unchanged next verdict must HALT on the FIRST cycle
 *    instead of re-kicking toward `MAX_KICKBACKS_PER_GATE` (=2).
 *  - D3 (Story 4): the audit trail must distinguish `did-work` from
 *    `derived-already-complete` kickback outcomes.
 *
 * `architecture_review_as_built` (not `finish`) is the pivot step: its
 * completion predicate (artifacts.ts:1014-1052) only requires a fresh
 * `.pipeline/architecture-review-as-built.md` with a `Verdict:` line — no
 * git remote / `gh` push-evidence chain, so a plain mkdtemp fixture is
 * enough to drive it for real.
 *
 * None of D1/D2/D3 exist yet — `planRemediation` (conductor.ts:888-960)
 * unconditionally returns `{kind:'route', target}` whenever `fixes.length >
 * 0`, with no completion recompute and no progress/verdict comparison. These
 * tests are expected to FAIL against today's code for that reason.
 *
 * CONFIDENCE NOTE (verify-claims protocol — these are this file's genuine
 * guesses, not values pinned by the story/ADR/plan text):
 *  - Exact HALT-reason wording is asserted with loose regexes (e.g.
 *    /no dispatchable build work|already evidence-complete/i,
 *    /unchanged|zero.*(work|progress)/i) rather than exact strings — the
 *    plan only pins the substance ("no dispatchable build work", "names the
 *    unchanged input"), not a literal sentence. MEDIUM confidence the
 *    eventual message matches one of these phrasings; if not, this file's
 *    RED reason stays valid (assertion failure) but the regex may need a
 *    follow-up tweak once D1/D2 land — that is expected spec upkeep, not a
 *    sign the guard is wrong.
 *  - The `kickback_outcome` discriminator (D3) is asserted via a loose
 *    JSON.stringify(event) grep for /did-work/i or /derived-already-complete/i
 *    on any emitted event, mirroring the merged-pr-guard-kickback.test.ts
 *    convention of not depending on a specific event-type shape. LOW-MEDIUM
 *    confidence on exactly which event carries it (plan says "extend the
 *    kickback audit event" but not the emitted-event field name).
 *  - `kickback_escalation.enabled: false` (Story 4's third negative path) is
 *    NOT covered here. `config.ts`'s `knownTopLevelKeys` allowlist
 *    (validateConfig, ~:156-204) rejects any unrecognized top-level key
 *    today, so a real `.ai-conductor/config.yml` carrying this key would
 *    fail config validation for an unrelated reason (schema, not routing)
 *    before ever reaching the D2 guard — an acceptance-level test would be
 *    RED for the wrong reason until Task 5 lands the schema entry. This
 *    negative path is left to `/tdd`'s Task 5 unit/integration test against
 *    `resolved-config.ts` directly, per this skill's "if a test could live
 *    in a lower layer, it should" rule.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepName } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

const AS_BUILT_MD = '.pipeline/architecture-review-as-built.md';

async function markerExists(dir: string, rel: string): Promise<boolean> {
  return access(join(dir, rel)).then(
    () => true,
    () => false,
  );
}

/** Fake GhRunner (OPEN PR, never merged out-of-band) — mirrors
 * merged-pr-guard-kickback.test.ts's makeGhFake so the merged-PR guard
 * (#358) never shells out to a real `gh` during these specs. */
function makeGhFake(): GhRunner {
  return async () => ({
    stdout: JSON.stringify({
      state: 'OPEN',
      mergeable: 'MERGEABLE',
      statusCheckRollup: [],
      labels: [],
    }),
  });
}

/** Snapshot every emitted event so we can grep the future D3 discriminator
 * without depending on a specific ConductorEvent variant name. */
function captureEvents(events: ConductorEventEmitter): { all: unknown[] } {
  const all: unknown[] = [];
  const spy = vi.spyOn(events, 'emit');
  spy.mockImplementation(async (e: unknown) => {
    all.push(e);
    return undefined;
  });
  return { all };
}

describe('acceptance: kickback→build no-op escalation (#647)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kickback-noop-escalation-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seedShipTail(taskStatus: unknown): Promise<void> {
    const res = await readState(statePath);
    const state = (res.ok ? res.value : {}) as Record<string, unknown>;
    for (const s of ALL_STEPS) {
      if (s.name === 'architecture_review_as_built') break;
      state[s.name] = 'done';
    }
    Object.assign(state, {
      complexity_tier: 'L',
      feature_desc: 'feat',
      build_review: 'skipped',
      manual_test: 'skipped',
      prd_audit: 'skipped',
      pr_url: 'https://github.com/jstoup111/ai-conductor/pull/647',
    });
    await writeState(statePath, state as unknown as ConductState);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify(taskStatus));
  }

  function makeConductor(runner: StepRunner): Conductor {
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      fromStep: 'architecture_review_as_built',
      maxRetries: 1,
      escalateBuildFailure: async () => ({}),
      runGh: makeGhFake(),
    } as never);
  }

  async function writeAsBuiltVerdict(verdict: 'BLOCKED' | 'APPROVED'): Promise<void> {
    await writeFile(
      join(dir, AS_BUILT_MD),
      `# As-built architecture review\n\nVerdict: ${verdict}\n\nsome finding\n`,
    );
  }

  // ── Story 1 (happy, regression) + Story 2 (negative): a genuinely new,
  // not-yet-complete rem-* task still self-heals — build is dispatched with
  // the kickback hint and the review re-runs (existing behavior; expected to
  // PASS today). Locks the self-heal path so D1/D2 cannot regress it.
  it('Story 1 happy / Story 2 negative: a new pending rem-* task self-heals — build dispatches, no D1/D2 escalation', async () => {
    await seedShipTail({ tasks: [{ id: 'task-1', status: 'completed' }] });
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calls.push(step);
        if (step === 'architecture_review_as_built') {
          await writeAsBuiltVerdict('BLOCKED');
        } else if (step === 'remediate') {
          await writeFile(
            join(dir, '.pipeline/remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'test:as-built-gap',
                  disposition: 'build',
                  category: null,
                  rationale: 'as-built review found a missing fix',
                  tasks: [{ id: 'rem-1', title: 'fix the missing behavior' }],
                },
              ],
            }),
          );
        } else if (step === 'build') {
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({
              tasks: [
                { id: 'task-1', status: 'completed' },
                { id: 'rem-as-built-architecture-review-rem-1', status: 'completed' },
              ],
            }),
          );
        }
        return { success: true };
      }),
    };

    const conductor = makeConductor(runner);
    await conductor.run();

    // The guard must never fire when the append produced genuinely new work
    // — build is re-entered at least once.
    expect(calls.filter((s) => s === 'build').length).toBeGreaterThanOrEqual(1);
    if (await markerExists(dir, '.pipeline/HALT')) {
      const haltBody = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(haltBody).not.toMatch(/no dispatchable build work|already evidence-complete/i);
    }
  });

  // ── Story 2 happy (D1): the remediation route to build resolves with
  // completion already satisfied (empty appended tasks, task-status.json
  // already all-complete) — the engine must HALT with the gap ledger
  // instead of re-entering a guaranteed no-op build.
  it('Story 2 happy: build route with already-satisfied completion HALTs instead of re-entering build (D1)', async () => {
    await seedShipTail({ tasks: [{ id: 'task-1', status: 'completed' }] });
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calls.push(step);
        if (step === 'architecture_review_as_built') {
          await writeAsBuiltVerdict('BLOCKED');
        } else if (step === 'remediate') {
          await writeFile(
            join(dir, '.pipeline/remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'test:as-built-gap',
                  disposition: 'build',
                  category: null,
                  rationale: 'as-built review says the fix is missing',
                  tasks: [], // no new dispatchable work — the classic #647 shape
                },
              ],
            }),
          );
        }
        return { success: true };
      }),
    };

    const conductor = makeConductor(runner);
    await conductor.run();

    // D1: build must never be re-entered when the recomputed completion is
    // already satisfied and there is nothing new to dispatch.
    expect(calls.filter((s) => s === 'build')).toHaveLength(0);

    expect(await markerExists(dir, '.pipeline/HALT')).toBe(true);
    const haltBody = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(haltBody).toMatch(/no dispatchable build work|already evidence-complete/i);
  });

  // ── Story 3 happy (D2) + Story 3's third negative (reviewer-wrong is
  // capped on the FIRST cycle, not ping-ponged toward MAX_KICKBACKS_PER_GATE
  // = 2): a build re-entered via kickback that makes zero net progress
  // (the appended task stays pending, no commits — this sandboxed dir has
  // no git repo, so head-sha comparison degrades to "unknown, treated as
  // no-work" per the plan's Task 1 spec) and whose next as-built verdict is
  // byte-identical to the prior one must HALT on this very cycle, not after
  // a second re-kick.
  it('Story 3 happy: zero net progress + unchanged verdict escalates to HALT on the first cycle, not the retry cap (D2)', async () => {
    await seedShipTail({ tasks: [{ id: 'task-1', status: 'completed' }] });
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calls.push(step);
        if (step === 'architecture_review_as_built') {
          // Byte-identical BLOCKED verdict every time.
          await writeAsBuiltVerdict('BLOCKED');
        } else if (step === 'remediate') {
          await writeFile(
            join(dir, '.pipeline/remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'test:as-built-gap',
                  disposition: 'build',
                  category: null,
                  rationale: 'as-built review says the fix is missing',
                  tasks: [{ id: 'rem-1', title: 'fix the missing behavior' }],
                },
              ],
            }),
          );
        }
        // step === 'build': deliberately does NOT touch task-status.json —
        // the dispatched agent produced zero net progress on rem-1.
        return { success: true };
      }),
    };

    const conductor = makeConductor(runner);
    await conductor.run();

    // D2: escalates on the FIRST zero-work + unchanged-verdict cycle — build
    // is re-entered exactly once, never a second time toward the cap.
    expect(calls.filter((s) => s === 'build')).toHaveLength(1);

    expect(await markerExists(dir, '.pipeline/HALT')).toBe(true);
    const haltBody = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(haltBody).toMatch(/unchanged|zero.*(work|progress)|no.*progress/i);
    // Not the generic cap-exhaustion message this scenario produces today.
    expect(haltBody).not.toMatch(/unresolved after \d+ build kickback/i);
  });

  // ── Story 3 negative (did real work): a kickback build that DOES resolve
  // the appended task must not escalate — the review re-runs normally
  // (build is re-entered a second time once it clears the review again, or
  // the run ends cleanly if the second review approves).
  it('Story 3 negative: a kickback build that resolves the appended task does not escalate', async () => {
    await seedShipTail({ tasks: [{ id: 'task-1', status: 'completed' }] });
    let reviewCalls = 0;
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calls.push(step);
        if (step === 'architecture_review_as_built') {
          reviewCalls++;
          await writeAsBuiltVerdict(reviewCalls > 1 ? 'APPROVED' : 'BLOCKED');
        } else if (step === 'remediate') {
          await writeFile(
            join(dir, '.pipeline/remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'test:as-built-gap',
                  disposition: 'build',
                  category: null,
                  rationale: 'as-built review says the fix is missing',
                  tasks: [{ id: 'rem-1', title: 'fix the missing behavior' }],
                },
              ],
            }),
          );
        } else if (step === 'build') {
          // Real progress: the appended task gets resolved.
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({
              tasks: [
                { id: 'task-1', status: 'completed' },
                { id: 'rem-as-built-architecture-review-rem-1', status: 'completed' },
              ],
            }),
          );
        }
        return { success: true };
      }),
    };

    const conductor = makeConductor(runner);
    await conductor.run();

    if (await markerExists(dir, '.pipeline/HALT')) {
      const haltBody = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(haltBody).not.toMatch(/unchanged|zero.*(work|progress)/i);
    }
    expect(reviewCalls).toBeGreaterThanOrEqual(2);
  });

  // ── Story 4 happy (D3): the audit trail distinguishes a no-op kickback
  // ("derived-already-complete") from a productive one ("did-work").
  it('Story 4 happy: audit trail records derived-already-complete for a D1 no-op kickback', async () => {
    await seedShipTail({ tasks: [{ id: 'task-1', status: 'completed' }] });
    const { all: emitted } = captureEvents(events);
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'architecture_review_as_built') {
          await writeAsBuiltVerdict('BLOCKED');
        } else if (step === 'remediate') {
          await writeFile(
            join(dir, '.pipeline/remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'test:as-built-gap',
                  disposition: 'build',
                  category: null,
                  rationale: 'as-built review says the fix is missing',
                  tasks: [],
                },
              ],
            }),
          );
        }
        return { success: true };
      }),
    };

    const conductor = makeConductor(runner);
    await conductor.run();

    const found = emitted.find((e) => /derived-already-complete/i.test(JSON.stringify(e)));
    expect(found).toBeTruthy();
  });

  // ── Story 4 negative (idempotent): the D1 HALT must be written at most
  // once and surface exactly one remediation PR — no duplicate PRs, no
  // counter drift, for a single run through the guard.
  it('Story 4 negative: the D1 HALT is written once and surfaces exactly one loop_halt event', async () => {
    await seedShipTail({ tasks: [{ id: 'task-1', status: 'completed' }] });
    const { all: emitted } = captureEvents(events);
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'architecture_review_as_built') {
          await writeAsBuiltVerdict('BLOCKED');
        } else if (step === 'remediate') {
          await writeFile(
            join(dir, '.pipeline/remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'test:as-built-gap',
                  disposition: 'build',
                  category: null,
                  rationale: 'as-built review says the fix is missing',
                  tasks: [],
                },
              ],
            }),
          );
        }
        return { success: true };
      }),
    };

    const conductor = makeConductor(runner);
    await conductor.run();

    const haltEvents = emitted.filter((e) => (e as { type?: string })?.type === 'loop_halt');
    expect(haltEvents).toHaveLength(1);
  });
});
