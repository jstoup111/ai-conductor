/**
 * Acceptance specs for .docs/stories/setup-before-dispatch-wedge-deterministic-setup-fa.md
 * (TS-2..TS-5) — "Setup-before-dispatch wedge: deterministic setup-failure
 * triage" (#446, adr-2026-07-09-setup-failure-triage.md, APPROVED).
 *
 * TS-1 (classification) is single-operation / unit-covered by
 * test/engine/worktree-prepare.test.ts (Tasks 1-2 of the plan) and is
 * deliberately NOT duplicated here (§3a).
 *
 * These drive the REAL production entry points named by the stories:
 *   - `makeRunFeature` (src/engine/daemon-runner.ts) over a REAL git repo in a
 *     tmpdir with a REAL, controllable `bin/setup` script (no `vi.mock`,
 *     no fake GitRunner) — TS-2, TS-3, TS-4.
 *   - `DefaultStepRunner.run('build', ...)` (src/engine/step-runners.ts) — the
 *     real dispatch path a resumed/new build session goes through — TS-5.
 *
 * Only the LLM/agent seam is stubbed (`dispatchFixSession`, and the injected
 * `LLMProvider` for TS-5): per the kill-switch convention (test/setup.ts sets
 * AI_CONDUCTOR_NO_REAL_EXEC=1), no real agent process is ever spawned by this
 * file, and no production code path currently invokes any real provider for
 * setup triage — the fake seam is asserted against directly.
 *
 * Pre-implementation: `engine/setup-triage.ts` does not exist yet (Task 3+ of
 * the plan), `daemon-runner.ts`'s `FeatureRunnerDeps` has no `runSetupTriage`
 * or `dispatchFixSession` field, and `prepareWorktree`'s failures are plain
 * `Error`s (no `SetupFailureError`, no triage ever runs). Every scenario below
 * therefore fails on its behavioral assertion (a git ref that was never
 * created, a HALT that never names triage evidence, a fix-session stub that
 * is never called, a build prompt that never mentions a quarantine) — RED for
 * the right reason, never a wrong-reason failure (syntax error, collection
 * error, or accidentally-already-true assertion).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

import { makeRunFeature, type FeatureRunnerDeps } from '../../src/engine/daemon-runner.js';
import { prepareWorktree, SETUP_SCRIPT } from '../../src/engine/worktree-prepare.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { runTriage, fixSession as runFixSession, writeQuarantineSentinel } from '../../src/engine/setup-triage.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import type { SetupFailureError } from '../../src/engine/worktree-prepare.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { ConductState } from '../../src/types/index.js';
import type { BacklogItem } from '../../src/engine/daemon.js';

const execFileAsync = promisify(execFile);

/** The plan's forward-declared (not-yet-added) triage wiring surface. */
type FutureDeps = FeatureRunnerDeps & {
  dispatchFixSession?: (...args: unknown[]) => Promise<unknown>;
};

describe('acceptance: setup-before-dispatch wedge — deterministic setup-failure triage (#446)', () => {
  let dir: string;
  const counterFiles: string[] = [];

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }

  async function gitOrNull(...args: string[]): Promise<string | null> {
    try {
      return await git(...args);
    } catch {
      return null;
    }
  }

  async function initRepo(): Promise<void> {
    await execFileAsync('git', ['init', '-b', 'main', dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    // `.env` is written by prepareWorktree on every run, and `.pipeline/HALT`
    // is written by the engine's error-park path on every error (today AND
    // after #446 ships) — ignore both so git-status/dirty-tree assertions only
    // see state THIS spec constructed, not the engine's own bookkeeping.
    await writeFile(join(dir, '.gitignore'), '.env\n.pipeline/\n', 'utf-8');
    await writeFile(join(dir, 'README.md'), '# base\n');
    await git('add', '-A');
    await git('commit', '-m', 'initial commit');
  }

  async function commitAll(msg: string): Promise<void> {
    await git('add', '-A');
    await git('commit', '-m', msg);
  }

  async function writeSetupScript(body: string): Promise<void> {
    await mkdir(join(dir, 'bin'), { recursive: true });
    const path = join(dir, SETUP_SCRIPT);
    await writeFile(path, body, 'utf-8');
    await chmod(path, 0o755);
  }

  /** Fails the first `failCount` invocations (persisted in an external counter
   *  file, outside the repo, so retries survive a `git reset --hard`), then
   *  passes forever after. */
  async function writeSetupFailNTimes(failCount: number): Promise<string> {
    const counterPath = join(tmpdir(), `setup-triage-ctr-${randomUUID()}`);
    counterFiles.push(counterPath);
    await writeSetupScript(`#!/usr/bin/env bash
COUNTER_FILE="${counterPath}"
N=0
if [ -f "$COUNTER_FILE" ]; then N=$(cat "$COUNTER_FILE"); fi
N=$((N+1))
echo "$N" > "$COUNTER_FILE"
if [ "$N" -le ${failCount} ]; then
  for i in $(seq 1 60); do echo "setup noise line $i (attempt $N)" >&2; done
  echo "TAIL_MARKER_ATTEMPT_$N" >&2
  exit 1
fi
echo "setup ok on attempt $N"
exit 0
`);
    return counterPath;
  }

  /** Never passes — models committed breakage at a clean HEAD. */
  async function writeSetupAlwaysFails(marker: string): Promise<void> {
    await writeSetupScript(`#!/usr/bin/env bash
for i in $(seq 1 60); do echo "setup noise line $i" >&2; done
echo "${marker}" >&2
exit 1
`);
  }

  /** Passes iff `filename` exists in the worktree — used to model a
   *  fix-session that half-fixes (writes the file) without committing it. */
  async function writeSetupPassesOnlyIfFileExists(filename: string): Promise<void> {
    await writeSetupScript(`#!/usr/bin/env bash
if [ -f "${filename}" ]; then
  echo ok
  exit 0
else
  echo "missing ${filename}" >&2
  exit 1
fi
`);
  }

  function baseDeps(overrides: Partial<FutureDeps> = {}): FeatureRunnerDeps {
    const dispatchFixSession = overrides.dispatchFixSession ?? (async () => ({ attempted: true }));
    const runSetupTriage = async (
      error: SetupFailureError,
      worktree: { path: string },
      item: BacklogItem,
    ) => {
      const git = makeGitRunner(worktree.path);
      const runPrepare = (worktreePath: string) => prepareWorktree(worktreePath);
      const logFn = overrides.log ?? (() => {});
      const triageOutcome = await runTriage(git, worktree.path, item.slug, error, runPrepare, {
        log: logFn,
      });
      if (triageOutcome.kind === 'park' && !triageOutcome.quarantineRef) {
        return triageOutcome;
      }
      const fixOutcome = await runFixSession(
        git,
        worktree.path,
        item.slug,
        () => dispatchFixSession(error, worktree, item) as Promise<void>,
        runPrepare,
      );
      if (fixOutcome.kind === 'park' && !fixOutcome.quarantineRef && triageOutcome.quarantineRef) {
        return { ...fixOutcome, quarantineRef: triageOutcome.quarantineRef };
      }
      return fixOutcome;
    };

    const base: FutureDeps = {
      createWorktree: async (slug) => ({ path: dir, branch: `feat/${slug}` }),
      prepareWorktree: async (wt) => {
        await prepareWorktree(wt.path);
      },
      runConductor: async () => {},
      readOutcome: async () => ({
        done: true,
        halted: false,
        finishChoice: 'pr',
        prUrl: 'http://pr/1',
      }),
      teardownWorktree: async () => {},
      markProcessed: async () => {},
      daemon: true,
      runSetupTriage,
      provider: {
        invoke: async () => ({ success: true, output: '' }),
        invokeInteractive: async () => {},
      },
      project: 'test-project',
      ...overrides,
    };
    return base as FeatureRunnerDeps;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'setup-triage-acceptance-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    while (counterFiles.length) {
      const f = counterFiles.pop()!;
      await rm(f, { force: true }).catch(() => {});
    }
  });

  // ── TS-2: uncommitted breakage is quarantined and the feature dispatches ──

  it('TS-2 happy: dirty tree + failing-then-passing setup ⇒ quarantine ref preserves the exact pre-reset content, feature branch resets clean, prepare re-runs, dispatch proceeds', async () => {
    await initRepo();
    await writeSetupFailNTimes(1);
    await commitAll('add bin/setup (fails once, then passes)');

    const headBefore = await git('rev-parse', 'HEAD');

    // Dirty tree: a tracked modification AND an untracked file.
    await writeFile(join(dir, 'README.md'), '# base\nlocal WIP edit\n');
    await writeFile(join(dir, 'scratch.txt'), 'untracked WIP\n');
    const preReadme = await readFile(join(dir, 'README.md'), 'utf-8');
    const preScratch = await readFile(join(dir, 'scratch.txt'), 'utf-8');

    const log: string[] = [];
    let conductorCalls = 0;
    const run = makeRunFeature(
      baseDeps({
        log: (m) => log.push(m),
        runConductor: async () => {
          conductorCalls++;
        },
      }),
    );

    const out = await run({ slug: 'feat-quarantine-happy' } as BacklogItem);

    // The quarantine ref must exist and be reachable.
    const quarantineTip = await gitOrNull(
      'rev-parse',
      '--verify',
      'refs/heads/wip/setup-quarantine-feat-quarantine-happy',
    );
    expect(quarantineTip).not.toBeNull();

    // Its tip must contain the pre-reset dirty content byte-for-byte (modulo
    // the `git()` test helper's own trailing-newline trim()).
    expect(await gitOrNull('show', 'wip/setup-quarantine-feat-quarantine-happy:README.md')).toBe(
      preReadme.trimEnd(),
    );
    expect(await gitOrNull('show', 'wip/setup-quarantine-feat-quarantine-happy:scratch.txt')).toBe(
      preScratch.trimEnd(),
    );

    // Feature branch is reset back to the original HEAD, clean.
    expect(await git('rev-parse', 'HEAD')).toBe(headBefore);
    expect(await git('status', '--porcelain')).toBe('');

    // Full prepare re-ran and dispatch proceeded normally.
    expect(conductorCalls).toBe(1);
    expect(out.status).toBe('done');

    // The log names the quarantine ref and the preserved paths.
    expect(log.some((l) => l.includes('wip/setup-quarantine-feat-quarantine-happy'))).toBe(true);
    expect(log.some((l) => l.includes('README.md') && l.includes('scratch.txt'))).toBe(true);
  });

  it('TS-2 negative: the quarantine commit itself cannot be created ⇒ the tree is left byte-for-byte untouched and the feature errors+parks with the preservation failure named', async () => {
    await initRepo();
    await writeSetupAlwaysFails('INJECTED_SETUP_FAILURE');
    await commitAll('add always-failing bin/setup');

    // Force every `git commit` in this repo to fail from here on — a real git
    // failure injected at the exact point triage's quarantine step must
    // exercise (`git commit`), not a mocked GitRunner. `prepareWorktree` wires
    // `core.hooksPath` to `.pipeline/git-hooks/` (the attribution-hook seam),
    // which shadows `.git/hooks/` for the remainder of this process — the
    // failing hook must be installed at the path that's actually active.
    await mkdir(join(dir, '.pipeline', 'git-hooks'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'git-hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', 'utf-8');
    await chmod(join(dir, '.pipeline', 'git-hooks', 'pre-commit'), 0o755);

    await writeFile(join(dir, 'README.md'), '# base\nuncommitted mess\n');
    await writeFile(join(dir, 'stray.txt'), 'stray\n');
    const statusBefore = await git('status', '--porcelain');
    const readmeBefore = await readFile(join(dir, 'README.md'), 'utf-8');

    const run = makeRunFeature(baseDeps());
    const out = await run({ slug: 'feat-quarantine-fails' } as BacklogItem);

    expect(await git('status', '--porcelain')).toBe(statusBefore); // byte-for-byte untouched
    expect(await readFile(join(dir, 'README.md'), 'utf-8')).toBe(readmeBefore);
    expect(
      await gitOrNull('rev-parse', '--verify', 'refs/heads/wip/setup-quarantine-feat-quarantine-fails'),
    ).toBeNull();

    expect(out.status).toBe('error'); // errors + parks exactly as today

    const halt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf-8');
    expect(halt).toMatch(/preservation failure|quarantine commit/i);
  });

  it('TS-2 negative: a pre-existing quarantine branch is refreshed (force-moved to the new tip); the old tip stays reachable via reflog and the refresh is logged', async () => {
    await initRepo();
    await writeSetupFailNTimes(1);
    await commitAll('add bin/setup (fails once, then passes)');

    // Prior rotation's quarantine ref, pointing at an old (different) commit.
    await git('branch', 'wip/setup-quarantine-feat-quarantine-refresh');
    const oldTip = await git('rev-parse', 'wip/setup-quarantine-feat-quarantine-refresh');

    await writeFile(join(dir, 'README.md'), '# base\nnew WIP\n');
    await writeFile(join(dir, 'new-file.txt'), 'new\n');

    const log: string[] = [];
    const run = makeRunFeature(baseDeps({ log: (m) => log.push(m) }));
    await run({ slug: 'feat-quarantine-refresh' } as BacklogItem);

    const newTip = await gitOrNull('rev-parse', 'wip/setup-quarantine-feat-quarantine-refresh');
    expect(newTip).not.toBe(oldTip); // moved to the new quarantine commit
    expect(await gitOrNull('cat-file', '-e', oldTip)).not.toBeNull(); // old tip still reachable
    expect(
      log.some((l) => /refresh/i.test(l) && l.includes('wip/setup-quarantine-feat-quarantine-refresh')),
    ).toBe(true);
  });

  it('TS-2 negative: the post-quarantine retry ALSO fails (committed breakage) ⇒ exactly one fix-session dispatch follows, never a second mechanical retry', async () => {
    await initRepo();
    await writeSetupAlwaysFails('STILL_BROKEN_AFTER_RESET');
    await commitAll('add always-failing bin/setup');

    await writeFile(join(dir, 'README.md'), '# base\nmess\n');
    await writeFile(join(dir, 'mess.txt'), 'mess\n');

    const fixSession = vi.fn(async () => ({ attempted: true }));
    const run = makeRunFeature(baseDeps({ dispatchFixSession: fixSession }));
    await run({ slug: 'feat-retry-fails' } as BacklogItem);

    expect(fixSession).toHaveBeenCalledTimes(1);
  });

  // Note: "dirty tree whose bin/setup passes ⇒ no quarantine, untouched,
  // resumability preserved" is intentionally NOT duplicated here — it is
  // already today's behavior (prepareWorktree never inspects tree
  // dirtiness), asserts zero NEW behavior, and is the Task 8 unit-level
  // "zero-touch guarantees" test's job (§3a: no acceptance spec for
  // already-satisfied, single-path behavior).

  // ── TS-3: committed breakage gets exactly one mechanically-verified fix-session ──

  it('TS-3 happy: clean-HEAD setup failure ⇒ exactly one fix-session dispatched whose prompt carries the setup output tail; the engine re-verifies (re-run setup + clean tree) before dispatch proceeds', async () => {
    await initRepo();
    await writeSetupAlwaysFails('TAIL_MARKER_XYZ');
    await commitAll('add broken bin/setup (clean HEAD, committed breakage)');

    // Simulate a real fix-session: it diagnoses the broken bin/setup and
    // commits a fix, which is why the engine's post-dispatch re-run of
    // `runPrepare` succeeds.
    const fixSession = vi.fn(async (...args: unknown[]) => {
      await writeSetupScript('#!/usr/bin/env bash\necho "fixed"\nexit 0\n');
      await commitAll('fix-session: repair bin/setup');
      return { attempted: true, seen: args };
    });
    let conductorCalls = 0;
    const run = makeRunFeature(
      baseDeps({
        dispatchFixSession: fixSession,
        runConductor: async () => {
          conductorCalls++;
        },
      }),
    );

    const out = await run({ slug: 'feat-fix-happy' } as BacklogItem);

    expect(fixSession).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fixSession.mock.calls[0])).toContain('TAIL_MARKER_XYZ');
    expect(conductorCalls).toBe(1);
    expect(out.status).toBe('done');
  });

  it('TS-3 negative (a): fix-session claims success but bin/setup still fails ⇒ the claim is ignored, outcome is contract failure, HALT path taken — never a second dispatch', async () => {
    await initRepo();
    await writeSetupAlwaysFails('NEVER_FIXED_MARKER');
    await commitAll('add broken bin/setup');

    const fixSession = vi.fn(async () => ({ attempted: true, claimedSuccess: true }));
    const run = makeRunFeature(baseDeps({ dispatchFixSession: fixSession }));
    const out = await run({ slug: 'feat-fix-claim-ignored' } as BacklogItem);

    expect(fixSession).toHaveBeenCalledTimes(1);
    expect(out.status).toBe('error');
    const halt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf-8');
    expect(halt).toMatch(/contract|setup-still-failing/i);
  });

  it('TS-3 negative (b): fix-session leaves the tree dirty (setup passes, half-fix uncommitted) ⇒ contract fails (an unverifiable half-fix is not a pass), dirty paths named in the HALT', async () => {
    await initRepo();
    await writeSetupPassesOnlyIfFileExists('fixed.txt');
    await commitAll('add setup requiring fixed.txt');

    const fixSession = vi.fn(async () => {
      // A half-fix: writes the file setup needs, but never commits it.
      await writeFile(join(dir, 'fixed.txt'), 'half fix, never committed\n');
      return { attempted: true };
    });
    const run = makeRunFeature(baseDeps({ dispatchFixSession: fixSession }));
    const out = await run({ slug: 'feat-fix-dirty' } as BacklogItem);

    expect(fixSession).toHaveBeenCalledTimes(1);
    expect(out.status).toBe('error');
    const halt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf-8');
    expect(halt).toContain('fixed.txt');
  });

  it('TS-3 negative (c): the fix-session dispatch itself throws ⇒ routed to HALT as a contract failure — never an unhandled throw, never a second dispatch in this rotation', async () => {
    await initRepo();
    await writeSetupAlwaysFails('THROW_CASE_MARKER');
    await commitAll('add broken bin/setup');

    const fixSession = vi.fn(async () => {
      throw new Error('provider spawn failure');
    });
    const run = makeRunFeature(baseDeps({ dispatchFixSession: fixSession }));

    await expect(run({ slug: 'feat-fix-throws' } as BacklogItem)).resolves.toMatchObject({
      status: 'error',
    });
    expect(fixSession).toHaveBeenCalledTimes(1);
  });

  // Note: "a feature already HALTed by a failed fix-session may run one new
  // fix-session on the NEXT rotation after an operator clear" is a
  // cross-rotation semantic implied by the per-call, no-persistent-state
  // design of `makeRunFeature` (each invocation IS one rotation) — asserting
  // it independently would duplicate Task 13's per-rotation dispatch-count
  // coverage rather than exercise new acceptance-visible behavior.

  // ── TS-4: triage failure HALTs with full evidence, never a silent discard ──

  it('TS-4 happy: triage exhausted (quarantine + retry, then fix-session contract failure) ⇒ HALT names the setup output tail, the quarantine ref, and the contract outcome; park semantics unchanged', async () => {
    await initRepo();
    await writeSetupFailNTimes(999_999); // never passes, even after the reset retry
    await commitAll('add always-failing bin/setup');

    await writeFile(join(dir, 'README.md'), '# base\ndirty\n');
    await writeFile(join(dir, 'extra.txt'), 'extra\n');

    const fixSession = vi.fn(async () => ({ attempted: true, claimedSuccess: true }));
    let teardownKeep: boolean | undefined;
    const run = makeRunFeature(
      baseDeps({
        dispatchFixSession: fixSession,
        teardownWorktree: async (_wt, keep) => {
          teardownKeep = keep;
        },
      }),
    );
    const out = await run({ slug: 'feat-exhausted' } as BacklogItem);

    expect(out.status).toBe('error');
    expect(teardownKeep).toBe(true); // kept for human inspection, identical to today's error-park

    const halt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf-8');
    expect(halt).toContain('wip/setup-quarantine-feat-exhausted');
    expect(halt).toMatch(/contract/i);
  });

  it('TS-4 negative: clean-HEAD triage exhaustion (no quarantine was ever taken) ⇒ the HALT explicitly states no quarantine ref exists', async () => {
    await initRepo();
    await writeSetupAlwaysFails('CLEAN_HEAD_MARKER');
    await commitAll('add broken bin/setup'); // clean tree throughout — nothing to quarantine

    const fixSession = vi.fn(async () => ({ attempted: true, claimedSuccess: true }));
    const run = makeRunFeature(baseDeps({ dispatchFixSession: fixSession }));
    await run({ slug: 'feat-clean-halt' } as BacklogItem);

    const halt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf-8');
    expect(halt).toMatch(/no quarantine ref exists/i);
  });

  it('TS-4 negative: the diagnostic HALT write itself failing still parks the feature as an error, and the write failure is logged — never converting a failed triage into a dispatch', async () => {
    await initRepo();
    await writeSetupAlwaysFails('HALT_WRITE_FAIL_CASE');
    await commitAll('add broken bin/setup');

    // Make `.pipeline` unwritable: pre-create it as a FILE, not a directory,
    // so `mkdir(.pipeline, {recursive:true})` and the HALT write both fail.
    await writeFile(join(dir, '.pipeline'), 'blocking file, not a directory\n', 'utf-8');

    const log: string[] = [];
    const run = makeRunFeature(baseDeps({ log: (m) => log.push(m) }));
    const out = await run({ slug: 'feat-halt-write-fails' } as BacklogItem);

    expect(out.status).toBe('error'); // still parks as an error
    expect(log.some((l) => /halt/i.test(l) && /(fail|error)/i.test(l))).toBe(true);
  });

  // ── TS-5: the resuming agent is told about quarantined WIP ──

  describe('TS-5: quarantine surfaced to the resuming build session', () => {
    let wt: string;

    beforeEach(async () => {
      wt = await mkdtemp(join(tmpdir(), 'setup-triage-build-session-'));
    });
    afterEach(async () => {
      await rm(wt, { recursive: true, force: true });
    });

    function makeProvider(): LLMProvider {
      return {
        invoke: vi.fn().mockResolvedValue({ success: true, output: 'done', exitCode: 0 }),
        invokeInteractive: vi.fn().mockResolvedValue(undefined),
      };
    }

    it('TS-5 happy: a quarantine ref exists ⇒ the build session context names the ref, the preserved paths, and states recovery is deliberate (inspect/cherry-pick/discard, never blind-merge)', async () => {
      await writeQuarantineSentinel(wt, 'wip/setup-quarantine-feat-q', ['README.md', 'scratch.txt']);

      const provider = makeProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', wt, {
        pipelineDir: join(wt, '.pipeline'),
      });

      await runner.run('build', {} as ConductState);

      const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const seen = `${opts.systemPrompt ?? ''}\n${opts.prompt ?? ''}`;
      expect(seen).toContain('wip/setup-quarantine-feat-q');
      expect(seen).toContain('README.md');
      expect(seen).toMatch(/deliberate|inspect.*(cherry-pick|discard)/i);
    });

    it('TS-5 negative: the quarantine branch was deleted between rotations (external actor) ⇒ the notice states the ref is missing rather than failing the dispatch', async () => {
      await writeQuarantineSentinel(wt, 'wip/setup-quarantine-feat-missing', ['README.md']);
      // The sentinel exists, but no git repo/ref backs it here — resolving the
      // ref (as the surfacing code must, to report accurately) fails.

      const provider = makeProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', wt, {
        pipelineDir: join(wt, '.pipeline'),
      });

      await expect(runner.run('build', {} as ConductState)).resolves.toBeDefined(); // dispatch never fails
      const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const seen = `${opts.systemPrompt ?? ''}\n${opts.prompt ?? ''}`;
      expect(seen).toMatch(/ref is missing|no longer exists|no longer present|ref not found/i);
    });
  });
});
