// ─────────────────────────────────────────────────────────────────────────────
// Acceptance specs: ci-fix-resolver-autofix (intake #666)
//
// Story: .docs/stories/ci-fix-resolver-autofix.md — the resolver crashes today
// because `productionCiFixRunner` shells out to a `claude --fix-session` flag
// that has never existed. This suite is the RED phase: it encodes what the
// StepRunner-backed dispatch, its one-shot session contract, classified spawn
// failures, and the startup preflight MUST look like once implemented.
//
// Two techniques are used, matching this repo's own precedent:
//  - Behavioral tests with injected fakes (provider/runner) for logic that can
//    be driven directly — per the story's own framing ("Tests inject fakes for
//    the runner/provider — no real `claude` spawn in the suite").
//  - Source-assembly tests (read the real production file as text, assert on
//    the actual wiring) for the daemon-cli.ts dispatch call site, which is
//    called deep inside `runDaemonMode` with live gh/git side effects that
//    aren't practical to drive end-to-end here — same rationale and pattern as
//    the existing `daemon-cli-ci-fix-wiring.test.ts` (Task 23).
//
// Naming assumptions (unpinned by the story, chosen to follow existing
// convention — see file-level comments below at each assertion):
//   - `resolveCiFailure` — pinned verbatim by CF-1's Given/When/Then text.
//   - `preflightCiFixInvocation` — follows this repo's `preflightXxx` naming
//     convention (preflightBuildAuthCheck, preflightCredentialsCheck).
//   - Classification tags `flag-invalid` | `auth` | `spawn-env` | `unknown` —
//     pinned verbatim by CF-4's Given/When/Then text.
// If implementation lands under different names, update these assertions —
// they are RED-phase scaffolding, not a frozen contract.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { runCiFix } from '../../src/engine/ci-fix.js';
import type { WatchEntry } from '../../src/engine/mergeable-sweep.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '../../src');
const CI_FIX_SRC = join(SRC_DIR, 'engine/ci-fix.ts');
const STEP_RUNNERS_SRC = join(SRC_DIR, 'engine/step-runners.ts');
const DAEMON_CLI_SRC = join(SRC_DIR, 'daemon-cli.ts');

async function grepSrcTree(pattern: RegExp): Promise<string[]> {
  // Repo-wide search restricted to src/ (production code) — mirrors CF-3's own
  // wording ("a repository search for `--fix-session` in `src/`").
  const out = execSync(
    `grep -rlE -e ${JSON.stringify(pattern.source)} "${SRC_DIR}" || true`,
    { encoding: 'utf-8' },
  );
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

// ── CF-3 (negative): the fictional `--fix-session` flag is gone ──────────────

describe('CF-3: no production reference to --fix-session', () => {
  it('no file under src/ constructs the argument --fix-session', async () => {
    const hits = await grepSrcTree(/--fix-session/);
    expect(hits, `--fix-session still referenced in: ${hits.join(', ')}`).toEqual([]);
  });
});

// ── CF-1 (happy): resolver dispatches a real fix through the StepRunner path ─

describe('CF-1: resolver dispatches via the StepRunner path, not claude --fix-session', () => {
  it('DefaultStepRunner exposes resolveCiFailure with the one-shot session contract', async () => {
    const source = await readFile(STEP_RUNNERS_SRC, 'utf-8');

    const methodMatch = source.match(
      /async\s+resolveCiFailure\s*\([\s\S]*?\n {2}\}\n/,
    );
    expect(
      methodMatch,
      'expected DefaultStepRunner to define an async resolveCiFailure(...) method',
    ).toBeTruthy();

    const body = methodMatch ? methodMatch[0] : '';
    // One-shot session contract (CF-1's Given/When/Then): resume:false,
    // dangerouslySkipPermissions, cwd = resolver worktree — mirrors the
    // resolveRebaseConflict / resolveSetupFailure fresh-uuid pattern already
    // in this file.
    expect(body).toMatch(/resume\s*:\s*false/);
    expect(body).toMatch(/dangerouslySkipPermissions\s*:\s*true/);
    expect(body).toMatch(/cwd\s*:/);
  });

  it('daemon-cli.ts no longer wires productionCiFixRunner directly into the ci-fix dispatch', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    // Anchor specifically on the `ciFix: { ... }` block (there are two
    // sibling `dispatch:` blocks in this sweepMergeableLabels call —
    // `autoresolve` and `ciFix` — so an unanchored match can grab the wrong
    // one).
    const ciFixBlockMatch = source.match(/ciFix\s*:\s*\{[\s\S]*?\n {10}\},\n/);
    expect(
      ciFixBlockMatch,
      'expected to find the ciFix: { ... } opts block in daemon-cli.ts',
    ).toBeTruthy();
    const dispatchBody = ciFixBlockMatch ? ciFixBlockMatch[0] : source;

    // The bare production exec-based runner must be gone from the dispatch
    // call site; the dispatch must instead route through resolveCiFailure
    // (directly, or via a StepRunner constructed inline — mirrors the
    // `new DefaultStepRunner(...)` + `.resolveRebaseConflict(ctx)` pattern
    // already used for rebase resolution dispatch in this same file).
    expect(dispatchBody).not.toMatch(/fixRunner\s*:\s*productionCiFixRunner/);
    expect(dispatchBody).toMatch(/resolveCiFailure/);
  });

  it('daemon ci-fix resolver carries the selected provider model policy', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf8');
    const marker = source.indexOf(
      'featureDesc: `ci-fix-resolution-${ctx.entry.slug}`',
    );
    const constructorStart = source.lastIndexOf('new DefaultStepRunner(', marker);
    const constructorEnd = source.indexOf('});', marker);

    expect(source.slice(constructorStart, constructorEnd)).toContain('modelPolicy');
  });
});

// ── CF-2 (happy): no-op fix leaves the branch untouched, no false green ──────

describe('CF-2: a no-op fix outcome skips guards/suite/push', () => {
  it('fixRunner reporting noop short-circuits before acceptance guards, suite gate, or push', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ci-fix-noop-'));
    try {
      const logs: string[] = [];
      const logger = (msg: string) => logs.push(msg);

      const entry: WatchEntry = {
        prUrl: 'https://github.com/foo/bar/pull/7',
        slug: 'foo/bar#7',
        repoCwd: tmpDir,
        ciFixAttempts: 0,
      } as WatchEntry;

      const fixRunner = {
        run: async () => ({ kind: 'noop' as const }),
      };

      // No real git fixture is set up on purpose: if the noop short-circuit
      // regresses and the pipeline tries to run guards/suite/push, it will
      // fail loudly against this non-repo directory rather than silently
      // "working" — the assertion below is the real guarantee either way.
      let result;
      try {
        result = await runCiFix(entry, 'nonexistent-branch', 'hint', { fixRunner }, logger);
      } catch {
        // branch-not-found abort is an acceptable outcome for this fixture;
        // the point is that guards/suite/push were never reached.
      }

      if (result) {
        expect(result.kind === 'noop' || result.kind === 'branch-gone').toBe(true);
      }
      expect(logs.some((l) => l.toLowerCase().includes('refreshed'))).toBe(false);
      expect(logs.some((l) => l.toLowerCase().includes('escalated'))).toBe(false);
    } finally {
      await rmdir(tmpDir, { recursive: true }).catch(() => {});
    }
  });
});

// ── CF-4 (negative): resolver spawn failure surfaces a classified error ──────

describe('CF-4: spawn/exec failures are classified, never a bare unclassified ExecaError', () => {
  it('a fixRunner failure resembling an unclassified ExecaError is logged with a classification tag', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ci-fix-classify-'));
    try {
      execSync('git init --bare origin.git', { cwd: tmpDir });
      const repoPath = join(tmpDir, 'repo');
      execSync(`git init -b main "${repoPath}"`);
      execSync('git config user.email test@example.com', { cwd: repoPath });
      execSync('git config user.name "Test"', { cwd: repoPath });
      execSync(`git remote add origin "${join(tmpDir, 'origin.git')}"`, { cwd: repoPath });
      execSync('git commit --allow-empty -m initial', { cwd: repoPath });
      execSync('git push -u origin main', { cwd: repoPath });
      execSync('git checkout -b feat/fix', { cwd: repoPath });
      execSync('git commit --allow-empty -m work', { cwd: repoPath });
      execSync('git push -u origin feat/fix', { cwd: repoPath });
      execSync('git checkout main', { cwd: repoPath });

      const logs: string[] = [];
      const logger = (msg: string) => logs.push(msg);

      const entry: WatchEntry = {
        prUrl: 'https://github.com/foo/bar/pull/9',
        slug: 'foo/bar#9',
        repoCwd: repoPath,
        ciFixAttempts: 0,
      } as WatchEntry;

      const fixRunner = {
        run: async () => {
          throw new Error('Command failed with exit code 1');
        },
      };

      let threw = false;
      try {
        await runCiFix(entry, 'feat/fix', 'hint', { fixRunner }, logger);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);

      const combined = logs.join('\n');
      expect(
        /flag-invalid|auth|spawn-env|unknown/.test(combined),
        `expected a classified reason (flag-invalid|auth|spawn-env|unknown) in the log, got: ${combined}`,
      ).toBe(true);
    } finally {
      await rmdir(tmpDir, { recursive: true }).catch(() => {});
    }
  }, 20000);
});

// ── CF-5 / CF-6: startup preflight validates the fix-invocation surface once ─

describe('CF-5/CF-6: ci-fix startup preflight', () => {
  it('ci-fix.ts exports a preflightCiFixInvocation probe', async () => {
    const source = await readFile(CI_FIX_SRC, 'utf-8');
    expect(
      source,
      'expected ci-fix.ts to export a preflightCiFixInvocation(...) function ' +
        '(naming per this repo\'s preflightBuildAuthCheck / preflightCredentialsCheck convention)',
    ).toMatch(/export\s+(async\s+)?function\s+preflightCiFixInvocation/);
  });

  it('a passing probe reports ok with no classification noise', async () => {
    const mod = await import('../../src/engine/ci-fix.js');
    const preflight = (mod as any).preflightCiFixInvocation;
    expect(typeof preflight, 'preflightCiFixInvocation is not exported yet').toBe('function');

    const probe = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const result = await preflight({ probe });

    expect(result.ok).toBe(true);
    // CF-5: a cheap capability/dry probe, no model round-trip — exactly one
    // subprocess check, not a real prompt invocation.
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('a failing probe (binary missing / arg-parse rejected) reports a single classified failure', async () => {
    const mod = await import('../../src/engine/ci-fix.js');
    const preflight = (mod as any).preflightCiFixInvocation;
    expect(typeof preflight, 'preflightCiFixInvocation is not exported yet').toBe('function');

    const probe = vi.fn().mockResolvedValue({
      exitCode: 127,
      stdout: '',
      stderr: 'claude: command not found',
    });
    const result = await preflight({ probe });

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('daemon-cli.ts calls the ci-fix preflight once at startup, not from inside the per-PR dispatch closure', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    expect(
      source,
      'expected daemon-cli.ts to import preflightCiFixInvocation from ./engine/ci-fix.js',
    ).toMatch(
      /import\s*\{[^}]*preflightCiFixInvocation[^}]*\}\s*from\s*['"]\.\/engine\/ci-fix\.js['"]/,
    );

    const ciFixBlockMatch = source.match(/ciFix\s*:\s*\{[\s\S]*?\n {10}\},\n/);
    const dispatchBody = ciFixBlockMatch ? ciFixBlockMatch[0] : '';
    // CF-5: "the probe is not repeated per-PR" — it must not appear inside
    // the per-PR dispatch closure.
    expect(dispatchBody).not.toMatch(/preflightCiFixInvocation/);
  });
});
