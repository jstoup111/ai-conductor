// Unit tests for the loop body (routing → gate → authoring → PR) in runEngineerMode.
// Phase 9.3, Task 34.
//
// These tests cover the per-idea loop body that is implemented in task 34.
// They are focused unit tests with scripted IO, fake provider, and fake gh —
// mirroring the acceptance helpers but smaller.
//
// Required coverage (with falsifiable assertions):
//   1. confirm path: increments ideasProcessed and pushes authored.
//   2. decline path: ZERO writes (HEAD unmoved, no spec branch, gh called 0 times).
//   3. redirect-to-unknown: prints not-registered message AND gh=0, no branch.
//   4. per-idea failure isolation: forced failure on idea 1 doesn't abort session;
//      a following valid idea still processes and exits cleanly.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readAuthoredKeys } from '../../../src/engine/engineer/authored-ledger.js';

const exec = promisify(execFileCb);

// Dynamic import so a missing module surfaces as the test's own RED failure.
async function loadLoop(): Promise<{ runEngineerMode: (...args: any[]) => Promise<any> }> {
  return import('../../../src/engine/engineer/loop.js') as Promise<{
    runEngineerMode: (...args: any[]) => Promise<any>;
  }>;
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Scripted IO: yields queued lines then null (EOF). Captures output. */
function scriptedIo(lines: string[]) {
  const queue = [...lines];
  const out: string[] = [];
  return {
    out,
    text: () => out.join('\n'),
    io: {
      prompt: async (): Promise<string | null> => (queue.length ? queue.shift()! : null),
      print: (s: string) => out.push(s),
    },
  };
}

/** Provider stub: routing returns a candidate, authoring returns success. */
function makeProvider(opts: { routeTo?: string; throws?: boolean } = {}) {
  const calls: { cwd?: string; prompt: string }[] = [];
  const provider = {
    async invoke(o: any): Promise<any> {
      calls.push({ cwd: o.cwd, prompt: String(o.prompt ?? '') });
      if (opts.throws) throw new Error('provider forced failure');
      const prompt = String(o.prompt ?? '');
      // Routing: no cwd, prompt matches routing pattern
      if (/route|candidate|which project/i.test(prompt) && !o.cwd) {
        const body = JSON.stringify([
          { name: opts.routeTo ?? 'alpha', score: 0.9, rationale: 'match' },
        ]);
        return { ok: true, output: body };
      }
      // Authoring: has cwd
      if (o.cwd) {
        return { ok: true, output: 'DECIDE complete', authored: true };
      }
      return { ok: true, output: '' };
    },
    async invokeInteractive() {},
  };
  return { provider, calls };
}

/** Provider stub that throws on first call then succeeds on subsequent calls. */
function makeFailFirstProvider(routeTo: string) {
  let callCount = 0;
  const calls: { cwd?: string; prompt: string }[] = [];
  const provider = {
    async invoke(o: any): Promise<any> {
      calls.push({ cwd: o.cwd, prompt: String(o.prompt ?? '') });
      callCount++;
      if (callCount === 1) throw new Error('provider forced failure on idea 1');
      const prompt = String(o.prompt ?? '');
      if (/route|candidate|which project/i.test(prompt) && !o.cwd) {
        const body = JSON.stringify([{ name: routeTo, score: 0.9, rationale: 'match' }]);
        return { ok: true, output: body };
      }
      if (o.cwd) {
        return { ok: true, output: 'DECIDE complete', authored: true };
      }
      return { ok: true, output: '' };
    },
    async invokeInteractive() {},
  };
  return { provider, calls };
}

/** gh stub: records all calls, returns a PR URL on `pr create`. */
function makeGh(prUrl = 'https://example.invalid/x/pull/1') {
  const calls: string[][] = [];
  const gh = async (args: string[], _opts: { cwd: string }) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'create') return { stdout: prUrl };
    return { stdout: '' };
  };
  return { gh, calls };
}

/** Initialize a git repo with at least one commit. */
async function initRepo(dir: string, withRemote = true): Promise<void> {
  await mkdir(dir, { recursive: true });
  await exec('git', ['init', '-b', 'main'], { cwd: dir });
  await exec('git', ['config', 'user.email', 't@t.test'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await writeFile(join(dir, 'README.md'), '# repo\n');
  await exec('git', ['add', '.'], { cwd: dir });
  await exec('git', ['commit', '-m', 'init'], { cwd: dir });
  if (withRemote) {
    await exec('git', ['remote', 'add', 'origin', 'https://example.invalid/x.git'], { cwd: dir });
    await exec('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir });
    await exec('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/heads/main'], { cwd: dir });
  }
}

function project(path: string, name: string, remote?: string) {
  return {
    schemaVersion: 1,
    name,
    path,
    remote,
    status: 'registered',
    registeredAt: '2026-06-25T00:00:00.000Z',
  };
}

// ── temp dir scaffolding ──────────────────────────────────────────────────────

let workDir: string;
let registryPath: string;
let engineerDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'loop-intake-test-'));
  registryPath = join(workDir, 'registry.json');
  engineerDir = join(workDir, 'engineer');
  await mkdir(engineerDir, { recursive: true });
  savedEnv.AI_CONDUCTOR_REGISTRY = process.env.AI_CONDUCTOR_REGISTRY;
  savedEnv.AI_CONDUCTOR_ENGINEER_DIR = process.env.AI_CONDUCTOR_ENGINEER_DIR;
  process.env.AI_CONDUCTOR_REGISTRY = registryPath;
  process.env.AI_CONDUCTOR_ENGINEER_DIR = engineerDir;
});

afterEach(async () => {
  process.env.AI_CONDUCTOR_REGISTRY = savedEnv.AI_CONDUCTOR_REGISTRY;
  process.env.AI_CONDUCTOR_ENGINEER_DIR = savedEnv.AI_CONDUCTOR_ENGINEER_DIR;
  await rm(workDir, { recursive: true, force: true });
});

async function writeRegistry(records: unknown[]): Promise<void> {
  await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 1: confirm path — increments ideasProcessed and pushes authored
// ═════════════════════════════════════════════════════════════════════════════

describe('loop-intake: confirm path', () => {
  it('confirm ("y") → ideasProcessed=1, authored includes the target project', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo, true);
    await writeRegistry([project(repo, 'alpha', 'https://example.invalid/alpha.git')]);

    const { runEngineerMode } = await loadLoop();
    const { provider } = makeProvider({ routeTo: 'alpha' });
    const { gh } = makeGh('https://example.invalid/alpha/pull/42');
    const { io } = scriptedIo(['add csv export', 'y', 'exit']);

    const summary = await runEngineerMode({ provider, io, gh });

    // Confirm path: ideasProcessed must be 1.
    expect(summary.ideasProcessed).toBe(1);
    // authored array must contain the target project name.
    expect(summary.authored).toBeDefined();
    expect(summary.authored!.length).toBe(1);
    expect(summary.authored![0].project).toBe('alpha');
    // buildsRun must stay 0 — engineer never triggers a build.
    expect(summary.buildsRun ?? 0).toBe(0);
  });

  it('confirm path creates a spec/* branch in the target repo', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo, true);
    await writeRegistry([project(repo, 'alpha', 'https://example.invalid/alpha.git')]);

    const { runEngineerMode } = await loadLoop();
    const { provider } = makeProvider({ routeTo: 'alpha' });
    const { gh } = makeGh();
    const { io } = scriptedIo(['add widget', 'y', 'exit']);

    await runEngineerMode({ provider, io, gh });

    const branches = (await exec('git', ['branch', '--list', 'spec/*'], { cwd: repo })).stdout;
    expect(branches).toMatch(/spec\//);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Test 2: decline path — ZERO writes (falsifiable adversarial assertion)
// ═════════════════════════════════════════════════════════════════════════════

describe('loop-intake: decline path — zero writes', () => {
  it('decline ("n") → HEAD unmoved, no spec branch, gh called 0 times', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo, true);
    await writeRegistry([project(repo, 'alpha', 'https://example.invalid/alpha.git')]);

    const headBefore = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
    const branchesBefore = (await exec('git', ['branch', '--list'], { cwd: repo })).stdout;

    const { runEngineerMode } = await loadLoop();
    const { provider } = makeProvider({ routeTo: 'alpha' });
    const { gh, calls: ghCalls } = makeGh();
    const { io } = scriptedIo(['add feature to alpha', 'n', 'exit']);

    const summary = await runEngineerMode({ provider, io, gh });

    const headAfter = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
    const branchesAfter = (await exec('git', ['branch', '--list'], { cwd: repo })).stdout;

    // HEAD must not have moved — adversarial: if any git commit was made, this fails.
    expect(headAfter).toBe(headBefore);
    // No new branches — adversarial: any spec branch creation would fail this.
    expect(branchesAfter).toBe(branchesBefore);
    // gh was never called — adversarial: any PR machinery would fail this.
    expect(ghCalls.length).toBe(0);
    // ideasProcessed stays 0 on decline.
    expect(summary.ideasProcessed).toBe(0);
  });

  it('decline via "no" keyword → same zero-write guarantee', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo, true);
    await writeRegistry([project(repo, 'alpha', 'https://example.invalid/alpha.git')]);

    const headBefore = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();

    const { runEngineerMode } = await loadLoop();
    const { provider } = makeProvider({ routeTo: 'alpha' });
    const { gh, calls: ghCalls } = makeGh();
    // 'no' must also be treated as decline
    const { io } = scriptedIo(['another idea', 'no', 'exit']);

    const summary = await runEngineerMode({ provider, io, gh });

    const headAfter = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
    expect(headAfter).toBe(headBefore);
    expect(ghCalls.length).toBe(0);
    expect(summary.ideasProcessed).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Test 3: redirect-to-unknown — not-registered message, gh=0, no branch
// (falsifiable: must not silently proceed to authoring)
// ═════════════════════════════════════════════════════════════════════════════

describe('loop-intake: redirect to unknown project', () => {
  it('redirect <unknown> → prints not-registered message, gh=0, no spec branch', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo, true);
    await writeRegistry([project(repo, 'alpha', 'https://example.invalid/alpha.git')]);

    const headBefore = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();

    const { runEngineerMode } = await loadLoop();
    const { provider } = makeProvider({ routeTo: 'alpha' });
    const { gh, calls: ghCalls } = makeGh();
    // redirect to unknown 'nonesuch', then decline to exit the gate
    const { io, text } = scriptedIo(['some idea', 'redirect nonesuch', 'n', 'exit']);

    const summary = await runEngineerMode({ provider, io, gh });

    // Must print a message indicating 'nonesuch' is not registered.
    expect(text()).toMatch(/not (a )?registered|unknown project/i);
    // gh must not have been called — adversarial: any PR call would fail this.
    expect(ghCalls.length).toBe(0);
    // No spec branch created — adversarial.
    const headAfter = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
    expect(headAfter).toBe(headBefore);
    const branches = (await exec('git', ['branch', '--list', 'spec/*'], { cwd: repo })).stdout;
    expect(branches.trim()).toBe('');
    // Not counted as processed.
    expect(summary.ideasProcessed).toBe(0);
  });

  it('redirect to unknown re-prompts so a subsequent valid response still works', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo, true);
    await writeRegistry([project(repo, 'alpha', 'https://example.invalid/alpha.git')]);

    const { runEngineerMode } = await loadLoop();
    const { provider } = makeProvider({ routeTo: 'alpha' });
    const { gh } = makeGh('https://example.invalid/alpha/pull/1');
    // redirect unknown, then confirm valid target
    const { io, text } = scriptedIo(['some idea', 'redirect nonesuch', 'y', 'exit']);

    const summary = await runEngineerMode({ provider, io, gh });

    // After rejecting the unknown redirect, the gate re-prompts and accepts 'y'
    expect(text()).toMatch(/not (a )?registered|unknown project/i);
    // Session still processes the idea after re-prompt
    expect(summary.ideasProcessed).toBe(1);
    expect(summary.authored![0].project).toBe('alpha');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Test 4: per-idea failure isolation
// (falsifiable: the failure on idea 1 MUST NOT abort the session)
// ═════════════════════════════════════════════════════════════════════════════

describe('loop-intake: per-idea failure isolation', () => {
  it('provider throws on idea 1 → error printed, session continues, idea 2 processes cleanly', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo, true);
    await writeRegistry([project(repo, 'alpha', 'https://example.invalid/alpha.git')]);

    const { runEngineerMode } = await loadLoop();
    // First provider call (routing for idea 1) throws; subsequent calls succeed
    const { provider } = makeFailFirstProvider('alpha');
    const { gh } = makeGh('https://example.invalid/alpha/pull/1');
    // idea1 will fail; idea2 will succeed with confirm
    const { io, text } = scriptedIo(['idea one', 'idea two', 'y', 'exit']);

    const summary = await runEngineerMode({ provider, io, gh });

    // Session must NOT throw — it must return a summary.
    expect(summary).toBeDefined();
    // Idea 1's failure must be printed (not silently swallowed).
    expect(text()).toMatch(/error|fail|forced failure/i);
    // Idea 1 must NOT be counted as processed (failure isolation).
    // Idea 2 must be counted as processed (session continued).
    // ideasProcessed should be exactly 1 (idea2 succeeded).
    expect(summary.ideasProcessed).toBe(1);
    expect(summary.authored!.length).toBe(1);
    expect(summary.authored![0].project).toBe('alpha');
    // exitCode must be 0 — failure isolation means clean session exit.
    expect(summary.exitCode ?? 0).toBe(0);
  });

  it('gh runner throws on idea 1 → error printed, idea 1 NOT counted, session exits 0', async () => {
    const repo = join(workDir, 'alpha');
    await initRepo(repo, true);
    await writeRegistry([project(repo, 'alpha', 'https://example.invalid/alpha.git')]);

    const { runEngineerMode } = await loadLoop();
    const { provider } = makeProvider({ routeTo: 'alpha' });

    let ghCallCount = 0;
    const throwingGh = async (args: string[], _opts: { cwd: string }) => {
      ghCallCount++;
      throw new Error('gh: network failure (injected)');
    };

    const { io, text } = scriptedIo(['failing idea', 'y', 'exit']);

    // Must not throw — gh failure is per-idea, not session-fatal (when target has remote).
    // (handoff.ts throws for non-no-remote errors, which propagates to the loop body;
    //  the loop body catches per-idea and continues)
    let summary: any;
    try {
      summary = await runEngineerMode({ provider, io, gh: throwingGh });
    } catch {
      // If the gh error propagated despite per-idea isolation, this test fails.
      throw new Error('runEngineerMode must not throw on per-idea gh failure');
    }

    expect(summary.exitCode ?? 0).toBe(0);
    // The idea must NOT be counted (gh failed, so authoring did not complete).
    expect(summary.ideasProcessed).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Test 5 (ADR-006 / FR-12 correctness): no-remote path records authored-keys ledger
// Falsifiable: FAILS against current code (no ledger call on no-remote branch)
//              PASSES after fix (recordAuthoredKey added to no-remote branch)
// ═════════════════════════════════════════════════════════════════════════════

describe('loop-intake: no-remote path records authored-keys ledger (FR-12)', () => {
  it('no-remote project → authored-keys ledger contains (project, branch) entry after run', async () => {
    // Repo with NO remote — mirrors acceptance Scenario 4.3 / "local-only" project.
    const repo = join(workDir, 'local-only');
    await initRepo(repo, /* withRemote= */ false);
    await writeRegistry([project(repo, 'local-only')]); // no remote field

    const { runEngineerMode } = await loadLoop();
    const { provider } = makeProvider({ routeTo: 'local-only' });
    const { gh } = makeGh(); // gh stub present but should never be called for no-remote
    const { io, text } = scriptedIo(['offline feature idea', 'y', 'exit']);

    const summary = await runEngineerMode({ provider, io, gh, engineerDir });

    // 1. Non-fatal exit with skip message still printed (regression guard).
    expect(summary.exitCode ?? 0).toBe(0);
    expect(text()).toMatch(/no remote|PR (could not|skip)/i);

    // 2. Counter incremented (work was done — regression guard).
    expect(summary.ideasProcessed).toBe(1);
    expect(summary.authored).toBeDefined();
    expect(summary.authored!.length).toBe(1);
    expect(summary.authored![0].project).toBe('local-only');

    // 3. FALSIFIABLE: authored-keys ledger must contain the (project, branch) entry.
    // Against current code this fails because the no-remote else-branch never calls
    // recordAuthoredKey. After the fix (adding the call), this passes.
    const ledgerEntries = await readAuthoredKeys({ engineerDir });
    expect(ledgerEntries.length).toBeGreaterThan(0);
    const match = ledgerEntries.find((e) => e.project === 'local-only');
    expect(match).toBeDefined();
    // The feature key is the spec branch name (spec/<slug>) — assert it starts with 'spec/'.
    expect(match!.feature).toMatch(/^spec\//);
  });
});
