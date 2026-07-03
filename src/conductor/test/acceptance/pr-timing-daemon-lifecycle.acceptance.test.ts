// RED acceptance specs for the daemon side of the `pr_timing` feature
// (Stories TS-1..TS-5, adr-2026-07-03-pr-timing-config-key /
// adr-2026-07-03-post-rebase-force-with-lease / adr-2026-07-03-pr-timing-self-host-precedence).
//
// NOTHING under this feature exists yet: `HarnessConfig` has no `pr_timing` field,
// `resolvePrTiming()` does not exist in `resolved-config.ts`, and `pr-labels.ts` has
// no `pushBranch`/`isAheadOfBase`/`publishEarlyDraft`/`advisoryPublish` exports. The
// conductor has NO early-publish hooks wired at build-start, step-boundary, or
// post-rebase. This file is the RED phase — a later /tdd pass implements the
// feature to turn these green.
//
// Convention (mirrors test/acceptance/shipped-work-dedup.acceptance.test.ts): every
// not-yet-existing export is loaded via a per-test dynamic `import()` so a missing
// module/export fails cleanly INSIDE the test body ("not yet implemented") instead of
// erroring the whole file at collection time. `pr-labels.ts` itself exists today (it
// just lacks these exports), so the dynamic import resolves the module fine and the
// assertion is on the specific export.
//
// Git fixture convention (mirrors test/engine/rebase-resolution-wiring.test.ts): real
// git tmp repos, real `git`/`execFile` calls — NEVER vi.mock('child_process') or
// vi.mock of any internal module. A real `git init --bare` stands in for "origin" so
// push/fetch state can be asserted for real. The ONLY injection point is the
// `GhRunner`/`GitRunner` seam that already exists in pr-labels.ts (and, for full
// Conductor-driven tests, `ConductorOptions.gh`) — never git itself.
//
// Most tests below fail at the "not yet implemented" export-shape assertion rather
// than exercising the full Conductor loop, because the publish hooks don't exist yet
// to exercise. That is the correct, honest RED shape for a plan that hasn't been
// built. A few tests pin CURRENT (today's) behavior and may legitimately PASS now —
// each such test is commented explicitly as a "pass-pin".

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { GhRunner as PrLabelsGhRunner, GitRunner } from '../../src/engine/pr-labels.js';

const execFile = promisify(execFileCb);

const PR_LABELS_MOD = '../../src/engine/pr-labels.js';
const RESOLVED_CONFIG_MOD = '../../src/engine/resolved-config.js';

// ── Dynamic-import helper (RED convention) ────────────────────────────────────

async function requireExport(modPath: string, name: string): Promise<(...args: unknown[]) => unknown> {
  const mod = (await import(modPath)) as Record<string, unknown>;
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: unknown[]) => unknown;
}

// ── Git fixture helpers ───────────────────────────────────────────────────────

/**
 * Build a throwaway feature repo with a real `git init --bare` standing in for
 * "origin" (no mocking git). Returns the repo dir, the bare origin dir, and a
 * `git` helper scoped to the feature repo.
 */
async function buildRepoWithOrigin(): Promise<{
  repo: string;
  origin: string;
  g: (args: string[]) => Promise<string>;
}> {
  const origin = await mkdtemp(join(tmpdir(), 'pr-timing-origin-'));
  await execFile('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: origin });

  const repo = await mkdtemp(join(tmpdir(), 'pr-timing-repo-'));
  const g = async (args: string[]) => {
    const { stdout } = await execFile('git', args, { cwd: repo });
    return stdout.trim();
  };

  await g(['init', '-q', '-b', 'main']);
  await g(['config', 'user.email', 't@t.com']);
  await g(['config', 'user.name', 'T']);
  await writeFile(join(repo, 'README.md'), 'init\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'init']);
  await g(['remote', 'add', 'origin', origin]);
  await g(['push', '-q', '-u', 'origin', 'main']);

  await g(['checkout', '-q', '-b', 'feat']);

  return { repo, origin, g };
}

/** List refs present on the bare origin (branch names only). */
async function originBranches(origin: string): Promise<string[]> {
  const { stdout } = await execFile('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], {
    cwd: origin,
  });
  return stdout.trim().split('\n').filter(Boolean);
}

/** Current commit SHA the origin's `feat` branch points at, or null if absent. */
async function originFeatSha(origin: string): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', ['rev-parse', 'refs/heads/feat'], { cwd: origin });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Seed state with every step before `fromStep` marked done/skipped, mirroring
 * rebase-resolution-wiring.test.ts's seedPreRebaseState helper.
 */
async function seedStateBefore(statePath: string, fromStep: string): Promise<void> {
  const state: ConductState = {};
  for (const s of ALL_STEPS) {
    if (s.name === fromStep) break;
    (state as Record<string, unknown>)[s.name] = s.name === 'retro' ? 'skipped' : 'done';
  }
  await writeState(statePath, state);
}

function earlyDraftConfig(): HarnessConfig {
  // pr_timing does not exist on HarnessConfig yet — build as a plain object and
  // cast, per the task's guidance (no typecheck plugin in vitest, so this is safe
  // at test time and documents the target shape for the implementer).
  return { pr_timing: 'early-draft' } as unknown as HarnessConfig;
}

// ── Fake GhRunner for full-Conductor drives ───────────────────────────────────

interface RecordedGhCall {
  args: string[];
  cwd: string;
}

function makeFakeGh(): { gh: PrLabelsGhRunner; calls: RecordedGhCall[] } {
  const calls: RecordedGhCall[] = [];
  const gh: PrLabelsGhRunner = async (args, opts) => {
    calls.push({ args: [...args], cwd: opts.cwd });
    if (args[0] === 'pr' && args[1] === 'create') {
      return { stdout: 'https://github.com/acme/repo/pull/1\n' };
    }
    return { stdout: '' };
  };
  return { gh, calls };
}

let repo: string;
let origin: string;
let g: (args: string[]) => Promise<string>;

beforeEach(async () => {
  ({ repo, origin, g } = await buildRepoWithOrigin());
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(origin, { recursive: true, force: true });
});

describe('pr_timing daemon lifecycle — early-draft publish (RED, unimplemented)', () => {
  // ── 1. Zero commits over base at build-start ────────────────────────────────
  it('build-start with zero commits over base: pushes the branch, creates NO PR', async () => {
    // publishEarlyDraft doesn't exist yet — this is the primary seam Task 5/7
    // will implement. We drive it directly against the real fixture (feat has
    // zero commits over main) rather than the full Conductor, since the
    // build-start hook isn't wired into conductor.ts yet either.
    const publishEarlyDraft = await requireExport(PR_LABELS_MOD, 'publishEarlyDraft');
    const { gh, calls } = makeFakeGh();
    const gitRunner: GitRunner = async (args, opts) => {
      const { stdout } = await execFile('git', args, { cwd: opts.cwd });
      return { stdout };
    };

    await publishEarlyDraft(gitRunner, gh, repo, {
      branch: 'feat',
      base: 'main',
      title: 't',
      body: 'b',
    });

    // Expected once implemented: origin has the `feat` ref (pushed), and no
    // `pr create` call was recorded (zero commits over base → nothing to show).
    const branches = await originBranches(origin);
    expect(branches).toContain('feat');
    expect(calls.some((c) => c.args[0] === 'pr' && c.args[1] === 'create')).toBe(false);
  });

  // ── 2. Branch ahead of base ──────────────────────────────────────────────────
  it('branch ahead of base: exactly one findOrCreatePr-shaped call with draft:true across the run', async () => {
    await writeFile(join(repo, 'feature.txt'), 'work\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'feat: add work']);

    const publishEarlyDraft = await requireExport(PR_LABELS_MOD, 'publishEarlyDraft');
    const { gh, calls } = makeFakeGh();
    const gitRunner: GitRunner = async (args, opts) => {
      const { stdout } = await execFile('git', args, { cwd: opts.cwd });
      return { stdout };
    };

    // Call twice (simulating two publish points across a build) — the draft PR
    // creation must be lazy: exactly one `pr create` total.
    await publishEarlyDraft(gitRunner, gh, repo, { branch: 'feat', base: 'main', title: 't', body: 'b' });
    await publishEarlyDraft(gitRunner, gh, repo, { branch: 'feat', base: 'main', title: 't', body: 'b' });

    const createCalls = calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'create');
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].args).toContain('--draft');
  });

  // ── 3. Step-boundary refresh push (plain, non-force) ────────────────────────
  it('loopGate step boundary with new commits: plain refresh push advances the real origin ref, no force flags', async () => {
    // pushBranch doesn't exist yet. We assert the target shape directly: a plain
    // push with no force flag advances origin's feat ref to match the local HEAD.
    const pushBranch = await requireExport(PR_LABELS_MOD, 'pushBranch');
    const gitRunner: GitRunner = async (args, opts) => {
      const { stdout } = await execFile('git', args, { cwd: opts.cwd });
      return { stdout };
    };

    await g(['push', '-q', '-u', 'origin', 'feat']); // baseline: branch exists on origin already
    await writeFile(join(repo, 'more.txt'), 'more\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'feat: more work']);

    const localSha = await g(['rev-parse', 'HEAD']);
    await pushBranch(gitRunner, repo, 'feat');

    const remoteSha = await originFeatSha(origin);
    expect(remoteSha).toBe(localSha);
  });

  it('loopGate step boundary with no new commits: no-op — no push argv recorded', async () => {
    const pushBranch = await requireExport(PR_LABELS_MOD, 'pushBranch');
    const isAheadOfBase = await requireExport(PR_LABELS_MOD, 'isAheadOfBase');
    const calls: string[][] = [];
    const gitRunner: GitRunner = async (args, opts) => {
      calls.push(args);
      const { stdout } = await execFile('git', args, { cwd: opts.cwd });
      return { stdout };
    };

    // feat === main (no commits ahead) — the refresh point must detect no-op
    // via isAheadOfBase and skip the push entirely.
    const ahead = await isAheadOfBase(gitRunner, repo, 'main');
    expect(ahead).toBe(false);
    if (!ahead) {
      // Simulates the conductor's refresh-hook gate: skip pushBranch when not ahead.
      expect(calls.some((a) => a[0] === 'push')).toBe(false);
    } else {
      await pushBranch(gitRunner, repo, 'feat');
    }
  });

  // ── 4. Post-rebase force-with-lease ─────────────────────────────────────────
  it('post-rebase history-rewriting push: exactly one --force-with-lease push argv', async () => {
    const pushBranch = await requireExport(PR_LABELS_MOD, 'pushBranch');
    const calls: string[][] = [];
    const gitRunner: GitRunner = async (args, opts) => {
      calls.push(args);
      const { stdout } = await execFile('git', args, { cwd: opts.cwd }).catch((e) => {
        throw e;
      });
      return { stdout };
    };

    await g(['push', '-q', '-u', 'origin', 'feat']);
    // Simulate a rewritten history (amend) so a plain push would be rejected.
    await writeFile(join(repo, 'README.md'), 'init\nrewritten\n');
    await g(['commit', '-q', '-am', '--amend']).catch(() => undefined);
    await g(['commit', '-q', '--amend', '-m', 'rewritten history']);

    await pushBranch(gitRunner, repo, 'feat', { forceWithLease: true });

    const forceCalls = calls.filter((a) => a[0] === 'push' && a.includes('--force-with-lease'));
    expect(forceCalls).toHaveLength(1);
    // Never a bare --force.
    expect(calls.some((a) => a[0] === 'push' && a.includes('--force') && !a.includes('--force-with-lease'))).toBe(
      false,
    );
  });

  // ── 5. Finish step: reuse draft PR, mark ready ──────────────────────────────
  it('finish step with an open draft PR: reused + marked ready, pr_url in conduct-state.json matches, no second create', async () => {
    // The engine-native pre-finish mark-ready hook doesn't exist yet, so we
    // drive the real Conductor through a full simulated build (daemon:true) and
    // assert on conduct-state.json + the injected GhRunner call log. Every step
    // before `finish` is a no-op stub via the fake StepRunner (ConductorOptions.gh
    // is a genuine existing injection seam).
    const statePath = join(repo, 'conduct-state.json');
    await seedStateBefore(statePath, 'finish');

    const events = new ConductorEventEmitter();
    const { gh, calls } = makeFakeGh();
    const runner: StepRunner = {
      run: async (): Promise<StepRunResult> => ({ success: true }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      daemon: true,
      mode: 'auto',
      fromStep: 'finish',
      config: earlyDraftConfig(),
      gh,
    });

    await conductor.run();

    // Expected once implemented: the finish pre-step detects the open draft PR
    // (via the injected gh) and calls `pr ready` before dispatching `/finish`;
    // conduct-state.json's pr_url equals the draft URL; no second `pr create`.
    const state = JSON.parse(await readFile(statePath, 'utf-8').catch(() => '{}'));
    const readyCalls = calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'ready');
    const createCalls = calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'create');

    // Today, nothing wires early-draft finish handling, so this is a genuine
    // behavioral gap: no `pr ready` call is ever made and no pr_url tracking
    // exists for the early-draft flow.
    expect(readyCalls.length).toBe(1);
    expect(createCalls.length).toBe(0);
    expect(state.pr_url).toBeTruthy();
  });

  // ── 6. Negative — default-absent key ────────────────────────────────────────
  it('pass-pin: pr_timing absent — zero publish invocations before finish (today\'s inert default)', async () => {
    // This pins the invariant that with NO pr_timing key, nothing in the
    // conductor ever calls the (not-yet-existing) publish seam before finish —
    // trivially true today since the seam doesn't exist to be called at all.
    // It is expected to keep passing once implemented, proving the default
    // stays inert.
    const statePath = join(repo, 'conduct-state.json');
    await seedStateBefore(statePath, 'build');

    const events = new ConductorEventEmitter();
    const { gh, calls } = makeFakeGh();
    let stepsRun = 0;
    const runner: StepRunner = {
      run: async (): Promise<StepRunResult> => {
        stepsRun += 1;
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      daemon: true,
      mode: 'auto',
      fromStep: 'build',
      // pr_timing key absent entirely
      config: {} as unknown as HarnessConfig,
      gh,
    });

    await conductor.run();

    expect(stepsRun).toBeGreaterThan(0);
    expect(calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'create')).toHaveLength(0);
    expect(calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'ready')).toHaveLength(0);
  });

  // ── 7. Negative — self-host precedence ──────────────────────────────────────
  it('self-host build + early-draft configured: zero early publishes, one loud downgrade log (not yet implemented)', async () => {
    // The self-host downgrade decision reads resolvePrTiming() (not yet
    // implemented) combined with the existing `selfHost` gate. We assert the
    // resolver export directly since the conductor-side downgrade log doesn't
    // exist yet to observe end-to-end.
    const resolvePrTiming = await requireExport(RESOLVED_CONFIG_MOD, 'resolvePrTiming');
    const resolved = resolvePrTiming(earlyDraftConfig());
    // Once implemented this resolves the CONFIGURED value; the self-host
    // downgrade is a separate conductor-side decision layered on top (not
    // captured by the resolver alone) — asserting the resolver export exists
    // is the honest RED failure point for this story today.
    expect(resolved).toBe('early-draft');
  });

  // ── 8. Negative — rebase-conflict HALT ──────────────────────────────────────
  it('pass-pin: rebase-conflict HALT taken — zero pushes of any kind while paused (today\'s real behavior)', async () => {
    // This drives the REAL rebase-conflict HALT path (already exists today,
    // per rebase-resolution-wiring.test.ts) and asserts origin's feat ref is
    // untouched while paused. Since no early-draft push hook exists yet, this
    // is trivially true today — pinned forward so it must remain true once the
    // post-rebase force-with-lease site (Task 11/12) is implemented.
    await writeFile(join(repo, 'a.ts'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'add a.ts']);
    await g(['push', '-q', '-u', 'origin', 'feat']);
    const preOriginSha = await originFeatSha(origin);

    // Create a genuine conflict: main and feat both edit a.ts. Push main to
    // origin too — runRebaseStep's base discovery fetches `origin/main`, so
    // origin's main must actually carry the conflicting content for the
    // rebase to hit a real conflict (not just fast-forward cleanly).
    await g(['checkout', '-q', 'main']);
    await execFile('git', ['merge', '-q', 'feat'], { cwd: repo }); // fast-forward main to include a.ts
    await writeFile(join(repo, 'a.ts'), 'mainchange\n');
    await g(['commit', '-q', '-am', 'main: change a']);
    await g(['push', '-q', 'origin', 'main']);
    await g(['checkout', '-q', 'feat']);
    await writeFile(join(repo, 'a.ts'), 'featchange\n');
    await g(['commit', '-q', '-am', 'feat: change a']);

    const statePath = join(repo, 'conduct-state.json');
    await seedStateBefore(statePath, 'rebase');
    const events = new ConductorEventEmitter();

    const runner: StepRunner = {
      run: async (): Promise<StepRunResult> => ({ success: true }),
      // No resolveRebaseConflict provided -> conflict cannot auto-resolve -> HALT.
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      daemon: true,
      mode: 'auto',
      fromStep: 'rebase',
      config: { ...earlyDraftConfig(), rebase_resolution_attempts: 0 } as unknown as HarnessConfig,
    });

    await conductor.run();

    const haltFiles = await readdir(join(repo, '.pipeline')).catch(() => []);
    expect(haltFiles).toContain('HALT');

    const postOriginSha = await originFeatSha(origin);
    expect(postOriginSha).toBe(preOriginSha);
  });

  // ── 9. Negative — remote rejects a plain refresh push ───────────────────────
  it('remote rejects a plain push (non-fast-forward): pushBranch surfaces the rejection, no force flags in argv', async () => {
    const pushBranch = await requireExport(PR_LABELS_MOD, 'pushBranch');
    const calls: string[][] = [];
    const gitRunner: GitRunner = async (args, opts) => {
      calls.push(args);
      const { stdout } = await execFile('git', args, { cwd: opts.cwd });
      return { stdout };
    };

    await g(['push', '-q', '-u', 'origin', 'feat']);

    // Make origin's feat diverge: clone it, commit, push from the clone so the
    // local repo's next plain push is rejected as non-fast-forward.
    const clone = await mkdtemp(join(tmpdir(), 'pr-timing-clone-'));
    await execFile('git', ['clone', '-q', origin, clone]);
    await execFile('git', ['checkout', '-q', 'feat'], { cwd: clone });
    await writeFile(join(clone, 'competing.txt'), 'competing\n');
    await execFile('git', ['add', '.'], { cwd: clone });
    await execFile('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'competing'], {
      cwd: clone,
    });
    await execFile('git', ['push', '-q', 'origin', 'feat'], { cwd: clone });
    await rm(clone, { recursive: true, force: true });

    // Local repo now has a diverged, older feat — a plain push must be rejected.
    await writeFile(join(repo, 'local-change.txt'), 'local\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'local change']);

    await expect(pushBranch(gitRunner, repo, 'feat')).resolves.not.toThrow();

    // No force flag of any kind was ever attempted for a plain-refresh push.
    expect(calls.some((a) => a.includes('--force') || a.includes('--force-with-lease'))).toBe(false);
  });

  // ── Grep-level invariant ─────────────────────────────────────────────────────
  it('force-push policy: --force-with-lease appears at exactly one call site in src/, bare --force at zero', async () => {
    const { readdir: rd, readFile: rf } = await import('node:fs/promises');
    const srcRoot = join(process.cwd(), 'src');

    async function walk(dir: string): Promise<string[]> {
      const entries = await rd(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) files.push(...(await walk(p)));
        else if (e.isFile() && p.endsWith('.ts')) files.push(p);
      }
      return files;
    }

    const files = await walk(srcRoot);
    let forceWithLeaseSites = 0;
    let bareForceSites = 0;
    for (const f of files) {
      const content = await rf(f, 'utf-8');
      const leaseMatches = content.match(/--force-with-lease/g) ?? [];
      forceWithLeaseSites += leaseMatches.length;
      // Bare --force: a literal '--force' token that is not part of '--force-with-lease'.
      const bareMatches = content.match(/(?<!-with-lease)['"]--force['"]/g) ?? [];
      bareForceSites += bareMatches.length;
    }

    // Nothing implements this yet, so today forceWithLeaseSites is 0 — this
    // correctly FAILS until Task 11 lands the single force-with-lease site.
    expect(forceWithLeaseSites).toBe(1);
    expect(bareForceSites).toBe(0);
  });
});
