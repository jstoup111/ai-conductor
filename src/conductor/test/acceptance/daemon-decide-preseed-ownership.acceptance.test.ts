// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "DECIDE-phase coherence ownership at the daemon
// boundary" (#971) — Stories 1, 2 and 3.
// .docs/stories/2026-07-26-daemon-decide-phase-coherence-ownership-971.md
// ADR: .docs/decisions/adr-2026-07-26-daemon-decide-preseed-ownership.md
//
// Entry-point note (writing-system-tests §3b/§3d). The daemon's preseed +
// stamping logic lives in `runConductorInWorktree`, a CLOSURE inside
// `runDaemonMode` (daemon-cli.ts:863-918) that is not independently callable —
// the same shape `EventPersister`/`AuditTrailWriter` wiring already has, and
// which audit-trail-daemon-wiring.integration.test.ts documents. Reaching it
// for real would require a full `runDaemonMode` run with git worktree
// creation and a live provider. These specs therefore drive the two seams the
// closure is built from, and prove the closure actually uses them:
//
//   (a) the DERIVED preseed set (`PRESEEDED_DONE`, Task 4) and the
//       tier-correct status derivation (`preseedStepStatuses`, Task 5) must be
//       EXPORTED from `src/daemon-cli.ts` so a test consumes the production
//       value rather than a hand-copied duplicate (Story 2's last negative
//       path makes that duplication itself a defect);
//   (b) a BEHAVIORAL run of `Conductor` with the exact daemon-shaped options
//       the closure sets (`daemon: true`, `mode: 'auto'`, `resume: true`,
//       `verifyArtifacts: true`), seeded from the PRODUCTION exports — so if
//       `coherence_check` is missing from the real set, the real conductor
//       executes it and the test fails; and
//   (c) a wiring guard on the real `daemon-cli.ts` source proving the stamping
//       loop consumes the tier-correct derivation instead of the current
//       unconditional `= 'done'` literal — so (b) cannot pass vacuously while
//       production still stamps everything `done`.
//
// SPEC ASSUMPTION (surfaced per the /verify-claims correctness gate): the ADR
// and plan pin the BEHAVIOR (derive from `phase: 'DECIDE'`; stamp `'skipped'`
// when `skippableForTiers` includes the resolved tier) but not the exported
// symbol names. These specs pin `PRESEEDED_DONE` (the existing constant, made
// exported — the minimal diff Task 4 describes) and `preseedStepStatuses(tier)`
// (a new export; the stamping loop is otherwise unreachable from a test).
//
// Both are loaded via DYNAMIC import inside each test: a static named import of
// a not-yet-exported symbol is an ESM link error that would fail the whole FILE
// at collection time, which is not a valid RED (§6).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState, readState } from '../../src/engine/state.js';
import type { StepName, StepStatus, ConductState } from '../../src/types/index.js';
import type { ComplexityTier } from '../../src/types/steps.js';

const DAEMON_CLI_MOD = '../../src/daemon-cli.js';

/** The production preseed set (Task 4). Never hand-copied — Story 2 forbids it. */
async function productionPreseedSet(): Promise<StepName[]> {
  const mod = (await import(DAEMON_CLI_MOD)) as Record<string, unknown>;
  const set = mod.PRESEEDED_DONE;
  if (!Array.isArray(set)) {
    throw new Error(
      'expected src/daemon-cli.ts to export "PRESEEDED_DONE" as an array (not yet exported)',
    );
  }
  return set as StepName[];
}

/** The production tier-correct stamping derivation (Task 5). */
async function productionPreseedStatuses(
  tier: ComplexityTier | undefined,
): Promise<Record<string, StepStatus>> {
  const mod = (await import(DAEMON_CLI_MOD)) as Record<string, unknown>;
  const fn = mod.preseedStepStatuses;
  if (typeof fn !== 'function') {
    throw new Error(
      'expected src/daemon-cli.ts to export "preseedStepStatuses" as a function (not yet implemented)',
    );
  }
  return (fn as (t: ComplexityTier | undefined) => Record<string, StepStatus>)(tier);
}

const DECIDE_STEPS: StepName[] = ALL_STEPS.filter((s) => s.phase === 'DECIDE').map((s) => s.name);

/** Steps the ADR's D2 correction covers: DECIDE steps skippable at S tier. */
const TIER_SKIPPABLE_DECIDE_STEPS: StepName[] = [
  'coherence_check',
  'architecture_diagram',
  'architecture_review',
  'conflict_check',
];

let dir: string;
let statePath: string;
let events: ConductorEventEmitter;

/**
 * Seed `conduct-state.json` exactly as the daemon's preseed block does, using
 * the PRODUCTION derivation — the point of the test is that production decides
 * the contents, not the test.
 */
async function seedDaemonState(
  tier: ComplexityTier,
  extra: Partial<Record<StepName, StepStatus>> = {},
): Promise<void> {
  const statuses = await productionPreseedStatuses(tier);
  const state: Record<string, unknown> = {
    complexity_tier: tier,
    track: 'technical',
    feature_desc: 'preseed-ownership-fixture',
    ...statuses,
    // Technical track carries no PRD — the daemon records it skipped.
    prd: 'skipped',
    ...extra,
  };
  await writeState(statePath, state as ConductState);
}

function recordingRunner(stepsRun: StepName[]): StepRunner {
  return {
    run: async (step: StepName): Promise<StepRunResult> => {
      stepsRun.push(step);
      return { success: true };
    },
  };
}

function daemonShapedConductor(runner: StepRunner): Conductor {
  // The exact option shape `runConductorInWorktree` constructs (daemon-cli.ts).
  return new Conductor({
    projectRoot: dir,
    stateFilePath: statePath,
    stepRunner: runner,
    events,
    mode: 'auto',
    resume: true,
    verifyArtifacts: true,
    daemon: true,
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'daemon-decide-preseed-'));
  statePath = join(dir, 'conduct-state.json');
  events = new ConductorEventEmitter();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// ─── Story 1 ─────────────────────────────────────────────────────────────────
// A daemon-dispatched run never executes the coherence-check authoring step.

describe('Story 1 — a daemon-dispatched run never executes coherence_check', () => {
  it('happy: an M-tier daemon-shaped run never runs coherence_check and starts at acceptance_specs', async () => {
    await seedDaemonState('M');

    const stepsRun: StepName[] = [];
    await daemonShapedConductor(recordingRunner(stepsRun)).run();

    // Asserted in BOTH directions: a bare `.not.toContain` would also pass if
    // the run executed nothing at all (plan Task 6).
    expect(stepsRun).not.toContain('coherence_check');
    expect(stepsRun[0]).toBe('acceptance_specs');
  });

  it('happy: coherence_check is resolved in state BEFORE the first dispatch, not as an execution result', async () => {
    await seedDaemonState('M');

    // The preseeded state is what the daemon writes before the conductor ever
    // resumes — coherence_check must already be resolved there.
    const beforeRun = await readState(statePath);
    expect(beforeRun.ok).toBe(true);
    const preRunStatus = (beforeRun.ok ? beforeRun.value : ({} as ConductState)) as Record<
      string,
      unknown
    >;
    expect(preRunStatus.coherence_check).toBe('done');

    const stepsRun: StepName[] = [];
    await daemonShapedConductor(recordingRunner(stepsRun)).run();
    expect(stepsRun).not.toContain('coherence_check');
  });

  it('negative: an L-tier run — the tier least likely to skip the step — still never executes it', async () => {
    await seedDaemonState('L');

    const stepsRun: StepName[] = [];
    await daemonShapedConductor(recordingRunner(stepsRun)).run();

    expect(stepsRun).not.toContain('coherence_check');
    expect(stepsRun[0]).toBe('acceptance_specs');
  });

  it('negative: a RE-DISPATCH with prior BUILD progress still stamps coherence_check and never executes it', async () => {
    // The resume path, not a fresh start: acceptance_specs already completed on
    // a prior daemon cycle, so the conductor must resume at `build`. Preseeding
    // applies on resume exactly as on fresh start — a re-kick must not
    // reintroduce the authoring step.
    await seedDaemonState('M', { acceptance_specs: 'done' });

    const stepsRun: StepName[] = [];
    await daemonShapedConductor(recordingRunner(stepsRun)).run();

    expect(stepsRun).not.toContain('coherence_check');
    expect(stepsRun[0]).toBe('build');

    const after = await readState(statePath);
    const state = (after.ok ? after.value : ({} as ConductState)) as Record<string, unknown>;
    expect(state.coherence_check).toBe('done');
  });
});

// ─── Story 2 ─────────────────────────────────────────────────────────────────
// The preseed set is derived from the step table, so it cannot drift.

describe('Story 2 — the preseed set is derived from ALL_STEPS and cannot drift', () => {
  it('happy: the production set is exactly worktree, memory, and every phase:DECIDE step', async () => {
    const set = await productionPreseedSet();

    expect([...set].sort()).toEqual([...['worktree', 'memory', ...DECIDE_STEPS]].sort());
    // Named explicitly: this is the omission the feature exists to fix.
    expect(set).toContain('coherence_check');
  });

  it('happy: every phase:DECIDE step in ALL_STEPS is present in the daemon preseed set', async () => {
    const set = new Set(await productionPreseedSet());
    const missing = DECIDE_STEPS.filter((name) => !set.has(name));

    expect(missing, `DECIDE steps absent from the daemon preseed set: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('negative: the derivation does not over-capture — no BUILD/SHIP step is preseeded', async () => {
    const set = new Set(await productionPreseedSet());
    // `worktree` (SETUP) and `memory` (UNDERSTAND) are the two intentional
    // non-DECIDE literals; anything else non-DECIDE would suppress a
    // legitimate, daemon-executable build step.
    const overCaptured = ALL_STEPS.filter(
      (s) => s.phase !== 'DECIDE' && s.name !== 'worktree' && s.name !== 'memory' && set.has(s.name),
    ).map((s) => s.name);

    expect(overCaptured, `non-DECIDE steps wrongly preseeded: ${overCaptured.join(', ')}`).toEqual(
      [],
    );
    expect(set.has('build')).toBe(false);
    expect(set.has('acceptance_specs')).toBe(false);
    expect(set.has('finish')).toBe(false);
  });

  it('negative: no hand-copied duplicate of the preseed list remains in the test tree', async () => {
    // Story 2's final negative path: the integration test held its own copy of
    // the list, so the two could silently disagree. It must IMPORT the
    // production set instead.
    const integrationSpec = await readFile(
      fileURLToPath(
        new URL(
          '../integration/audit-trail-daemon-wiring.integration.test.ts',
          import.meta.url,
        ),
      ),
      'utf-8',
    );

    expect(integrationSpec).not.toMatch(/const\s+DAEMON_PRESEEDED_DONE\s*:/);
    expect(integrationSpec).toMatch(/PRESEEDED_DONE.*from\s+'\.\.\/\.\.\/src\/daemon-cli\.js'|from\s+'\.\.\/\.\.\/src\/daemon-cli\.js'/);
  });

  it('negative: a future phase:DECIDE step needs NO daemon edit — the set is derived from the table, not a literal', async () => {
    // Proves derivation rather than coincidence: the production source must not
    // carry a hand-written array of DECIDE step names.
    const source = await readFile(
      fileURLToPath(new URL('../../src/daemon-cli.ts', import.meta.url)),
      'utf-8',
    );

    expect(source).toMatch(/ALL_STEPS/);
    expect(source).toMatch(/phase\s*===\s*'DECIDE'/);
    // The hand-maintained literal list is gone — the defect's root cause.
    expect(source).not.toMatch(/'architecture_review',\s*\n\s*\]/);
  });
});

// ─── Story 3 ─────────────────────────────────────────────────────────────────
// A preseeded step carries a tier-correct status.

describe('Story 3 — preseeded steps carry a tier-correct status', () => {
  it('happy: at S tier the four tier-skippable DECIDE steps are stamped skipped, not done', async () => {
    const statuses = await productionPreseedStatuses('S');

    for (const step of TIER_SKIPPABLE_DECIDE_STEPS) {
      expect(statuses[step], `expected "${step}" stamped 'skipped' at S tier`).toBe('skipped');
    }
  });

  it('regression: the as-built review stays independently S-skippable while following architecture_review skips', () => {
    // The Task 2 audit originally overlooked this consumer of the architecture
    // review status. Its own S-tier rule must remain intact; upstream skipping
    // is an additional condition, not a replacement for the tier rule.
    const asBuilt = ALL_STEPS.find((step) => step.name === 'architecture_review_as_built');

    expect(asBuilt?.skippableForTiers).toContain('S');
    expect(asBuilt?.skipWhenSkipped).toBe('architecture_review');
  });

  it('happy: at M tier coherence_check is stamped done — the artifact was authored during DECIDE', async () => {
    const statuses = await productionPreseedStatuses('M');

    expect(statuses.coherence_check).toBe('done');
    for (const step of TIER_SKIPPABLE_DECIDE_STEPS) {
      expect(statuses[step], `expected "${step}" stamped 'done' at M tier`).toBe('done');
    }
  });

  it('negative: a step not skippable at the resolved tier is always stamped done, never downgraded', async () => {
    for (const tier of ['S', 'M', 'L'] as ComplexityTier[]) {
      const statuses = await productionPreseedStatuses(tier);
      const notSkippable = ALL_STEPS.filter(
        (s) =>
          (s.phase === 'DECIDE' || s.name === 'worktree' || s.name === 'memory') &&
          !s.skippableForTiers.includes(tier),
      );
      for (const step of notSkippable) {
        expect(
          statuses[step.name],
          `"${step.name}" is not skippable at ${tier} — must stamp 'done'`,
        ).toBe('done');
      }
    }
  });

  it('negative: an unresolved tier is never stamped as if it were S — the fallback applies BEFORE stamping', async () => {
    // A spec with no resolvable complexity marker must not be silently exempted
    // from the artifact-bearing steps. The tier fallback runs first, so the
    // stamping derivation never sees `undefined` — and if it does, it must fail
    // toward the NON-skipped value.
    const statuses = await productionPreseedStatuses(undefined);

    for (const step of TIER_SKIPPABLE_DECIDE_STEPS) {
      expect(
        statuses[step],
        `unresolved tier must not exempt "${step}" the way S does`,
      ).not.toBe('skipped');
      expect(statuses[step]).toBe('done');
    }
  });

  it('negative: the daemon stamping loop CONSUMES the tier-correct derivation (not a vacuous pass)', async () => {
    // Wiring guard (§3b): without this, every behavioral assertion above could
    // pass against a well-formed helper that production never calls, while the
    // real stamping loop still writes an unconditional `'done'`.
    const source = await readFile(
      fileURLToPath(new URL('../../src/daemon-cli.ts', import.meta.url)),
      'utf-8',
    );

    expect(source).toMatch(/preseedStepStatuses/);
    // The unconditional stamp is gone.
    expect(source).not.toMatch(/\(baseState as Record<string, unknown>\)\[name\] = 'done';/);
    // Ordering hazard (plan Task 3): the tier fallback must precede stamping.
    const fallbackAt = source.indexOf('baseState.complexity_tier = item.tier');
    // The helper is exported near the module top; inspect its final reference,
    // which is the production stamping call inside the daemon closure.
    const stampAt = source.lastIndexOf('preseedStepStatuses');
    expect(fallbackAt).toBeGreaterThan(-1);
    expect(stampAt).toBeGreaterThan(-1);
    expect(
      fallbackAt,
      'the complexity-tier fallback must be assigned BEFORE the preseed stamping loop',
    ).toBeLessThan(stampAt);
  });
});
