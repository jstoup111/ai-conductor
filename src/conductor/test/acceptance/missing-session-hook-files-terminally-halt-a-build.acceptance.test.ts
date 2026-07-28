/**
 * Acceptance specs for #896 — "missing session hook files terminally halt a build".
 *
 * Story: .docs/stories/missing-session-hook-files-terminally-halt-a-build.md (TI-2, TI-3, TI-4)
 * Plan:  .docs/plans/missing-session-hook-files-terminally-halt-a-build.md
 * ADR:   .docs/decisions/adr-2026-07-23-session-hook-repair-before-halt.md
 *
 * WHY THESE DRIVE `Conductor.run()`:
 *
 * These acceptance specs use `Conductor.run()` because they prove the live
 * production build seam: preflight repairs and rechecks hooks before arming
 * `.pipeline/build-step-active` and dispatching the build.
 *
 * So every spec here asserts an OBSERVABLE ARTIFACT at the real entry point
 * (`Conductor.run()` on a build step with enforcement configured): the hook
 * scripts on disk, the `.pipeline/build-step-active` marker as seen from inside
 * the dispatched step, the settings wiring, and the `step_failed` diagnostic.
 * They fail unless the preflight actually runs AND actually repairs.
 *
 * Third-party boundaries: none reached. The step runner is injected; no LLM,
 * no `gh`, no network. Real local filesystem only (the boundary under test).
 *
 * NOT covered here (see the step report):
 *  - TI-1 (`ensureSessionHooks` primitive) — single-operation, `unit-covered`
 *    by plan Task 1 in test/engine/worktree-prepare.test.ts.
 *  - TI-4 happy-path #1 ("all four scripts present but wiring stripped → wiring
 *    re-merged") — contradicts TI-2 happy-path #4 ("all four present → no repair
 *    attempted, silent"). Unresolved; not frozen into an assertion.
 *  - TI-2 negative "stamp path is not writable diagnostic still fires unchanged"
 *    — no such diagnostic exists in `checkAttributionMachineryIntact` today
 *    (`grep -rn "stamp path is not writable" src/` → no hits). Nothing to preserve.
 *  - TI-5 (docs/CHANGELOG) — covered by test/test_harness_integrity.sh.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, chmod, stat, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';
import {
  PRE_DISPATCH_HOOK,
  POST_DISPATCH_HOOK,
  MUTATION_GATE_HOOK,
  DOCS_GUARD_HOOK,
} from '../../src/engine/session-hook-assets.js';

/** Enforcement configured — the only condition under which the preflight runs. */
const PAST_CUTOVER = { attribution_enforcement_cutover: '2026-01-01T00:00:00Z' } as HarnessConfig;

/** The three scripts in `expectedHooks` — the halt-check set. */
const ENFORCEMENT_SCRIPTS = ['pre-dispatch.sh', 'post-dispatch.sh', 'mutation-gate.sh'] as const;

/** The repair set: enforcement scripts + docs-guard.sh (everything provisioned). */
const REPAIR_SET: Record<string, string> = {
  'pre-dispatch.sh': PRE_DISPATCH_HOOK,
  'post-dispatch.sh': POST_DISPATCH_HOOK,
  'mutation-gate.sh': MUTATION_GATE_HOOK,
  'docs-guard.sh': DOCS_GUARD_HOOK,
};

interface BuildObservation {
  dispatched: boolean;
  /** Was `.pipeline/build-step-active` present at the moment the step ran? */
  markerArmed: boolean;
}

describe('acceptance: session hooks self-heal at the build preflight (#896)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  const hooksDir = (): string => join(dir, '.pipeline', 'session-hooks');
  const settingsPath = (): string => join(dir, '.claude', 'settings.local.json');

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'session-hook-repair-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await mkdir(join(dir, '.pipeline'), { recursive: true });
    // task-status.json present so the guard reaches the session-hooks branch
    // rather than short-circuiting on the seed/plan branches.
    await writeFile(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', status: 'pending' }] }),
      'utf-8',
    );
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    // Undo any chmod that would defeat rm.
    await chmod(hooksDir(), 0o755).catch(() => {});
    await chmod(join(dir, '.claude'), 0o755).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });

  /** Provision the named scripts with their real asset contents at 0755. */
  async function provisionHooks(names: readonly string[]): Promise<void> {
    await mkdir(hooksDir(), { recursive: true });
    for (const name of names) {
      const path = join(hooksDir(), name);
      await writeFile(path, REPAIR_SET[name], 'utf-8');
      await chmod(path, 0o755);
    }
  }

  async function exists(path: string): Promise<boolean> {
    return access(path).then(() => true).catch(() => false);
  }

  /**
   * Drive the REAL production entry point: a conductor run entering at the
   * build step with enforcement configured.
   *
   * Bounded per .agents/skills/write-tests/SKILL.md §3: every step before
   * `build` is pre-resolved, entry is `fromStep: 'build'`, and the injected
   * runner returns an expected sentinel failure for the FIRST step after build
   * so the run terminates immediately after the observation instead of walking
   * the SHIP tail. `maxRetries: 1` bounds the retry loop.
   */
  async function runBuildPreflight(): Promise<{
    observation: BuildObservation;
    stepFailures: Array<{ step: StepName; error: string }>;
  }> {
    const observation: BuildObservation = { dispatched: false, markerArmed: false };
    const stepFailures: Array<{ step: StepName; error: string }> = [];

    events.on('step_failed', (e) => {
      if (e.type === 'step_failed') stepFailures.push({ step: e.step, error: e.error });
    });

    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        if (step === 'build') {
          observation.dispatched = true;
          // The #505 Surface B mutation gate is armed by this marker. Observed
          // from INSIDE the dispatch because the conductor removes it once the
          // step returns — asserting after `run()` would always see it absent.
          observation.markerArmed = await exists(join(dir, '.pipeline', 'build-step-active'));
          return { success: true };
        }
        return { success: false, output: `sentinel: stop after build (${step})` };
      },
    };

    const preState: Record<string, unknown> = {};
    for (const s of ALL_STEPS) {
      if (s.name === 'build') break;
      preState[s.name] = 'done';
    }
    preState.complexity_tier = 'M';
    preState.feature_desc = 'missing-session-hook-files-terminally-halt-a-build';
    preState.track = 'technical';
    await writeState(statePath, preState as unknown as ConductState);

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      config: PAST_CUTOVER,
      fromStep: 'build',
      maxRetries: 1,
      mode: 'auto',
      daemon: true,
      // Never touch gh/git from an ordinary test.
      escalateBuildFailure: async () => ({ escalated: false }) as never,
    });

    await conductor.run();

    return { observation, stepFailures };
  }

  // ---------------------------------------------------------------------------
  // TI-2 — the build preflight repairs missing hooks and proceeds
  // ---------------------------------------------------------------------------

  it('TI-2 happy: all three enforcement scripts ABSENT → preflight restores them (byte-identical, 0755) and the build dispatches', async () => {
    await mkdir(hooksDir(), { recursive: true });
    // Directory exists, every enforcement script gone — the #896 wipe shape.

    const { observation, stepFailures } = await runBuildPreflight();

    expect(observation.dispatched).toBe(true);
    expect(stepFailures.filter((f) => f.step === 'build')).toHaveLength(0);

    for (const name of ENFORCEMENT_SCRIPTS) {
      const path = join(hooksDir(), name);
      expect(await exists(path), `${name} should have been restored`).toBe(true);
      expect(await readFile(path, 'utf-8')).toBe(REPAIR_SET[name]);
      expect((await stat(path)).mode & 0o777).toBe(0o755);
    }
  });

  it('TI-2 happy: the repair is visible in daemon.log — a [session-hooks] console.warn names each restored script', async () => {
    await mkdir(hooksDir(), { recursive: true });

    await runBuildPreflight();

    const warnings = warnSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[session-hooks]'));
    expect(warnings.length).toBeGreaterThan(0);
    for (const name of ENFORCEMENT_SCRIPTS) {
      expect(
        warnings.some((w) => w.includes(name)),
        `expected a [session-hooks] warning naming ${name}, got: ${JSON.stringify(warnings)}`,
      ).toBe(true);
    }
  });

  it('TI-2 happy: only post-dispatch.sh missing → it is restored, the intact scripts are not rewritten, and the build dispatches', async () => {
    await provisionHooks(['pre-dispatch.sh', 'mutation-gate.sh', 'docs-guard.sh']);
    const before = new Map<string, number>();
    for (const name of ['pre-dispatch.sh', 'mutation-gate.sh', 'docs-guard.sh']) {
      before.set(name, (await stat(join(hooksDir(), name))).mtimeMs);
    }
    // Coarse mtime resolution on some filesystems — separate the writes.
    await new Promise((r) => setTimeout(r, 20));

    const { observation } = await runBuildPreflight();

    expect(observation.dispatched).toBe(true);
    expect(await readFile(join(hooksDir(), 'post-dispatch.sh'), 'utf-8')).toBe(POST_DISPATCH_HOOK);
    for (const [name, mtime] of before) {
      expect((await stat(join(hooksDir(), name))).mtimeMs, `${name} was rewritten needlessly`).toBe(mtime);
    }
  });

  it('TI-2 happy: docs-guard.sh alone missing → repaired, and the guard never produces a diagnostic for it (halt-check set unchanged)', async () => {
    await provisionHooks(ENFORCEMENT_SCRIPTS);
    // docs-guard.sh deliberately absent — it is NOT in `expectedHooks`.

    const { observation, stepFailures } = await runBuildPreflight();

    expect(observation.dispatched).toBe(true);
    expect(stepFailures.filter((f) => f.step === 'build')).toHaveLength(0);
    expect(await exists(join(hooksDir(), 'docs-guard.sh'))).toBe(true);
    expect(await readFile(join(hooksDir(), 'docs-guard.sh'), 'utf-8')).toBe(DOCS_GUARD_HOOK);
  });

  it('TI-2 regression: all four scripts present and current → the healthy path is silent, writes nothing, and dispatches', async () => {
    await provisionHooks(Object.keys(REPAIR_SET));
    const before = new Map<string, number>();
    for (const name of Object.keys(REPAIR_SET)) {
      before.set(name, (await stat(join(hooksDir(), name))).mtimeMs);
    }
    await new Promise((r) => setTimeout(r, 20));

    const { observation, stepFailures } = await runBuildPreflight();

    expect(observation.dispatched).toBe(true);
    expect(stepFailures.filter((f) => f.step === 'build')).toHaveLength(0);
    for (const [name, mtime] of before) {
      expect((await stat(join(hooksDir(), name))).mtimeMs, `${name} rewritten on the healthy path`).toBe(mtime);
    }
    const warnings = warnSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[session-hooks]'));
    expect(warnings).toEqual([]);
  });

  it('TI-2 negative: scripts missing AND session-hooks/ unwritable → a "could not restore" diagnostic naming the unwritten files, textually distinct from the absence message', async () => {
    await mkdir(hooksDir(), { recursive: true });
    await chmod(hooksDir(), 0o500);

    const { observation, stepFailures } = await runBuildPreflight();

    expect(observation.dispatched).toBe(false);
    const buildFailure = stepFailures.find((f) => f.step === 'build');
    expect(buildFailure, 'the build step must fail when the repair itself cannot write').toBeDefined();
    expect(buildFailure!.error).toMatch(/could not restore/i);
    // Distinct from today's absence wording so an operator can tell
    // "could not restore" from "was not there".
    expect(buildFailure!.error).not.toMatch(/is missing expected script\(s\)/);
    for (const name of ENFORCEMENT_SCRIPTS) {
      expect(buildFailure!.error).toContain(name);
    }
  });

  it('TI-2 negative: no .pipeline/ at all → benign null, and NO hooks are provisioned into an uninitialized project', async () => {
    await rm(join(dir, '.pipeline'), { recursive: true, force: true });

    const { observation } = await runBuildPreflight();

    expect(observation.dispatched).toBe(true);
    expect(await exists(hooksDir()), 'the guard must not provision into a pre-init project').toBe(false);
  });

  it('TI-2 negative: plan unresolvable + hooks ALSO missing → the plan-unresolvable diagnostic still wins (branch precedence unchanged)', async () => {
    await rm(join(dir, '.pipeline', 'task-status.json'), { force: true });
    await mkdir(hooksDir(), { recursive: true });
    // No .docs/plans/ → resolveFeaturePlanPath finds nothing → planResolvable false.

    const { observation, stepFailures } = await runBuildPreflight();

    expect(observation.dispatched).toBe(false);
    const buildFailure = stepFailures.find((f) => f.step === 'build');
    expect(buildFailure).toBeDefined();
    expect(buildFailure!.error).toMatch(/plan could not be resolved/i);
    expect(buildFailure!.error).not.toMatch(/session-hooks|could not restore/i);
  });

  // ---------------------------------------------------------------------------
  // TI-3 — the mutation gate is never armed against a missing script
  // ---------------------------------------------------------------------------

  it('TI-3 happy: after a genuine repair the build-step marker IS armed and mutation-gate.sh exists at the path recorded in settings.local.json', async () => {
    await mkdir(hooksDir(), { recursive: true });

    const { observation } = await runBuildPreflight();

    expect(observation.markerArmed, '.pipeline/build-step-active must be armed for a repaired worktree').toBe(true);

    const settings = JSON.parse(await readFile(settingsPath(), 'utf-8'));
    const commands: string[] = (settings.hooks?.PreToolUse ?? [])
      .flatMap((e: { hooks?: Array<{ command?: string }> }) => e.hooks ?? [])
      .map((h: { command?: string }) => h.command ?? '');
    const gateCommand = commands.find((c) => c.includes('mutation-gate.sh'));
    expect(gateCommand, 'mutation-gate.sh must be wired in settings.local.json').toBeDefined();
    const gatePath = gateCommand!.split(' ')[0];
    expect(await exists(gatePath), `${gatePath} recorded in settings but absent on disk`).toBe(true);
  });

  it('TI-3 negative: PARTIAL repair (mutation-gate.sh unwritable, pre-dispatch.sh restorable) → diagnostic names mutation-gate.sh and the marker is NEVER armed', async () => {
    // A real partial failure with no injected seam: mutation-gate.sh is a
    // DIRECTORY, so writeFile to it fails (EISDIR) while its siblings write
    // cleanly. This is the adversarial "repair reports partial success" case —
    // the guard's verdict must come from re-stat'ing the filesystem, never from
    // the repair's own report (risk R1).
    await mkdir(join(hooksDir(), 'mutation-gate.sh'), { recursive: true });

    const { observation, stepFailures } = await runBuildPreflight();

    expect(observation.dispatched).toBe(false);
    expect(observation.markerArmed).toBe(false);
    expect(await exists(join(dir, '.pipeline', 'build-step-active'))).toBe(false);
    const buildFailure = stepFailures.find((f) => f.step === 'build');
    expect(buildFailure).toBeDefined();
    expect(buildFailure!.error).toContain('mutation-gate.sh');
    // A partial repair is never treated as a pass: the two siblings restoring
    // successfully must not turn the verdict green.
    expect(await exists(join(hooksDir(), 'pre-dispatch.sh'))).toBe(true);
  });

  it('TI-3 negative: whenever the guard returns a diagnostic, .pipeline/build-step-active does not exist afterwards', async () => {
    await mkdir(hooksDir(), { recursive: true });
    await chmod(hooksDir(), 0o500);

    const { stepFailures } = await runBuildPreflight();

    expect(stepFailures.find((f) => f.step === 'build')).toBeDefined();
    // Asserted on the marker FILE, not only the return value (risk R1).
    expect(await exists(join(dir, '.pipeline', 'build-step-active'))).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // TI-4 — settings wiring is restored alongside the scripts
  // ---------------------------------------------------------------------------

  it('TI-4 happy: repair re-merges every engine hook entry exactly once and preserves unrelated operator keys and hooks byte-for-byte', async () => {
    await mkdir(hooksDir(), { recursive: true });
    await mkdir(join(dir, '.claude'), { recursive: true });
    const operatorEntry = {
      matcher: 'Grep',
      hooks: [{ type: 'command', command: '/opt/operator/audit.sh' }],
    };
    await writeFile(
      settingsPath(),
      JSON.stringify(
        {
          permissions: { allow: ['Bash(npm test:*)'] },
          hooks: { PreToolUse: [operatorEntry] },
        },
        null,
        2,
      ),
      'utf-8',
    );

    await runBuildPreflight();

    const settings = JSON.parse(await readFile(settingsPath(), 'utf-8'));
    const pre = settings.hooks?.PreToolUse ?? [];
    const post = settings.hooks?.PostToolUse ?? [];

    const countEntries = (
      entries: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>,
      matcher: string,
      marker: string,
    ): number =>
      entries.filter(
        (e) => e.matcher === matcher && (e.hooks ?? []).some((h) => (h.command ?? '').includes(marker)),
      ).length;

    expect(countEntries(pre, 'Task|Agent', 'pre-dispatch.sh')).toBe(1);
    expect(countEntries(post, 'Task|Agent', 'post-dispatch.sh')).toBe(1);
    expect(countEntries(pre, 'Edit|Write|NotebookEdit', 'mutation-gate.sh')).toBe(1);
    expect(countEntries(pre, 'Bash', 'mutation-gate.sh')).toBe(1);
    expect(countEntries(pre, 'Edit|Write|NotebookEdit', 'docs-guard.sh')).toBe(1);

    // Both mutation-gate entries carry their distinct subcommand.
    const gateCommands = pre
      .filter((e: { hooks?: Array<{ command?: string }> }) =>
        (e.hooks ?? []).some((h) => (h.command ?? '').includes('mutation-gate.sh')),
      )
      .flatMap((e: { hooks?: Array<{ command?: string }> }) => (e.hooks ?? []).map((h) => h.command ?? ''));
    expect(gateCommands.some((c: string) => c.endsWith(' write'))).toBe(true);
    expect(gateCommands.some((c: string) => c.endsWith(' bash'))).toBe(true);

    // Operator surface untouched.
    expect(settings.permissions).toEqual({ allow: ['Bash(npm test:*)'] });
    expect(pre).toContainEqual(operatorEntry);
  });

  it('TI-4 negative: settings unwritable while the scripts repair fine → scripts restored, build dispatches, and NO diagnostic is produced for the wiring failure alone', async () => {
    await mkdir(hooksDir(), { recursive: true });
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(settingsPath(), '{}', 'utf-8');
    await chmod(join(dir, '.claude'), 0o500);

    let observation: BuildObservation;
    let stepFailures: Array<{ step: StepName; error: string }>;
    try {
      ({ observation, stepFailures } = await runBuildPreflight());
    } finally {
      await chmod(join(dir, '.claude'), 0o755).catch(() => {});
    }

    // This feature must never create a NEW way to terminally halt a build.
    expect(observation!.dispatched).toBe(true);
    expect(stepFailures!.filter((f) => f.step === 'build')).toHaveLength(0);
    for (const name of ENFORCEMENT_SCRIPTS) {
      expect(await exists(join(hooksDir(), name))).toBe(true);
    }
  });

  it('TI-4 negative: settings.local.json is malformed JSON → it is backed up to .bak-<ts> and the scripts are still provisioned', async () => {
    await mkdir(hooksDir(), { recursive: true });
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(settingsPath(), '{ this is not json', 'utf-8');

    await runBuildPreflight();

    const { readdir } = await import('node:fs/promises');
    const claudeFiles = await readdir(join(dir, '.claude'));
    expect(claudeFiles.some((f) => f.startsWith('settings.local.json.bak-'))).toBe(true);
    // A settings failure never suppresses script repair.
    for (const name of ENFORCEMENT_SCRIPTS) {
      expect(await exists(join(hooksDir(), name))).toBe(true);
    }
  });
});
