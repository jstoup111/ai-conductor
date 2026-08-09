/**
 * RED acceptance specs for #1254.
 *
 * Stories: `.docs/stories/codex-lacks-preventive-hook-parity-protected-artif.md`
 * ADR: `.docs/decisions/adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts.md`
 *
 * These specs drive the production boundaries that can prevent the original
 * failure: `prepareWorktree` followed by a real `git commit`, the public
 * `plan-protected-targets` command, and `Conductor.planRemediation`. Local Git
 * is real because staged-index and hook semantics are the behavior under test.
 * No third-party service is called.
 *
 * The approved ADR and conflict resolution scope the commit gate to BUILD and
 * SHIP. The accepted story also contains one stale contradictory no-marker
 * criterion; this suite follows the approved lifecycle decision and leaves
 * DECIDE/no-marker behavior to lower-layer phase-scoping tests.
 */

import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import {
  detectPlanProtectedTargetsCommand,
  planProtectedTargetsCommand,
} from '../../src/cli.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';

const execFile = promisify(execFileCb);
const roots: string[] = [];

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

afterEach(async () => {
  while (roots.length > 0) {
    await rm(roots.pop()!, { recursive: true, force: true });
  }
});

async function git(repo: string, ...args: string[]): Promise<GitResult> {
  try {
    const result = await execFile('git', ['-C', repo, ...args]);
    return { code: 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    const result = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: result.code ?? 1,
      stdout: (result.stdout ?? '').trim(),
      stderr: (result.stderr ?? '').trim(),
    };
  }
}

async function writeRepoFile(repo: string, path: string, content: string): Promise<void> {
  const destination = join(repo, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, 'utf8');
}

async function preparedRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'protected-artifact-prevention-'));
  roots.push(repo);
  await git(repo, 'init', '-q', '-b', 'main');
  await git(repo, 'config', 'user.email', 'acceptance@example.com');
  await git(repo, 'config', 'user.name', 'Acceptance');
  await git(repo, 'config', 'commit.gpgsign', 'false');
  await writeRepoFile(repo, 'src/base.ts', 'export const base = true;\n');
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-qm', 'fixture base');
  await prepareWorktree(repo);
  await writeRepoFile(
    repo,
    '.pipeline/phase-active',
    'step: build\nphase: BUILD\nwritten: 2026-08-09T00:00:00.000Z\nallow: .docs/release-waivers/\n',
  );
  return repo;
}

describe('Stories 1-3: the prepared-worktree commit boundary prevents protected mutations', () => {
  it('refuses a foreign protected artifact, preserves HEAD, and emits the DECIDE amendment route', async () => {
    const repo = await preparedRepo();
    const path = '.docs/specs/2026-07-04-operator-park.md';
    await writeRepoFile(repo, path, '# unauthorized BUILD amendment\n');
    await git(repo, 'add', path);
    const before = (await git(repo, 'rev-parse', 'HEAD')).stdout;

    const commit = await git(repo, 'commit', '-m', 'test: forbidden protected mutation');

    expect(commit.code).toBe(1);
    expect((await git(repo, 'rev-parse', 'HEAD')).stdout).toBe(before);
    expect(commit.stderr).toContain(path);
    expect(commit.stderr).toMatch(/DECIDE/);
    expect(commit.stderr).toMatch(/amend/i);
  });

  it('refuses every protected DECIDE directory and does not let an allowlisted path launder the commit', async () => {
    const repo = await preparedRepo();
    const protectedPaths = [
      '.docs/architecture/other-feature.md',
      '.docs/decisions/adr-other-feature.md',
      '.docs/plans/other-feature.md',
      '.docs/stories/other-feature.md',
      '.docs/specs/other-feature.md',
    ];
    await Promise.all([
      ...protectedPaths.map((path) => writeRepoFile(repo, path, 'foreign\n')),
      writeRepoFile(repo, '.docs/release-waivers/allowed.md', 'allowed\n'),
    ]);
    await git(repo, 'add', '.docs');

    const commit = await git(repo, 'commit', '-m', 'test: mixed protected mutation');

    expect(commit.code).toBe(1);
    for (const path of protectedPaths) expect(commit.stderr).toContain(path);
  });

  it('requires an allow prefix before permitting a protected artifact', async () => {
    const repo = await preparedRepo();
    const path = '.docs/specs/other.md';
    await writeRepoFile(repo, path, 'protected control\n');
    await git(repo, 'add', path);

    const denied = await git(repo, 'commit', '-m', 'test: unallowlisted protected control');
    expect(denied.code).toBe(1);
    expect(denied.stderr).toContain(path);

    await writeRepoFile(
      repo,
      '.pipeline/phase-active',
      'step: build\nphase: BUILD\nwritten: 2026-08-09T00:00:00.000Z\nallow: .docs/specs/\n',
    );
    expect((await git(repo, 'commit', '-m', 'test: allowlisted protected control')).code).toBe(0);
  });

  it('honors the engine bypass while an ordinary source-only commit remains permitted', async () => {
    const repo = await preparedRepo();
    const protectedPath = '.docs/specs/other-feature.md';
    await writeRepoFile(repo, protectedPath, 'engine-owned change\n');
    await git(repo, 'add', protectedPath);

    const denied = await git(repo, 'commit', '-m', 'test: foreign artifact without engine bypass');
    expect(denied.code).toBe(1);
    expect(denied.stderr).toContain(protectedPath);

    const engineCommit = await execFile(
      'git',
      ['-C', repo, 'commit', '-m', 'test: engine bookkeeping'],
      { env: { ...process.env, CONDUCT_ENGINE_COMMIT: '1' } },
    );
    expect(engineCommit.stderr).not.toMatch(/refus/i);

    await writeRepoFile(repo, 'src/base.ts', 'export const base = false;\n');
    await git(repo, 'add', 'src/base.ts');
    expect((await git(repo, 'commit', '-m', 'test: ordinary source change')).code).toBe(0);
  });

  it('chains an otherwise-permitted commit to the repository-owned pre-commit hook', async () => {
    const repo = await preparedRepo();
    const commonDir = (await git(repo, 'rev-parse', '--git-common-dir')).stdout;
    const commonRoot = commonDir.startsWith('/') ? commonDir : join(repo, commonDir);
    const hookPath = join(commonRoot, 'hooks', 'pre-commit');
    await mkdir(dirname(hookPath), { recursive: true });
    await writeFile(hookPath, '#!/usr/bin/env bash\necho repository-hook-refusal >&2\nexit 23\n', {
      mode: 0o755,
    });
    await writeRepoFile(repo, 'src/base.ts', 'export const base = false;\n');
    await git(repo, 'add', 'src/base.ts');

    const commit = await git(repo, 'commit', '-m', 'test: chained repository hook');

    // Git reports hook rejection with its own non-zero status rather than
    // preserving the chained hook's exit code; the repository hook's output
    // proves that the chain itself ran.
    expect(commit.code).not.toBe(0);
    expect(commit.stderr).toContain('repository-hook-refusal');
  });
});

describe('Story 4: preventive hook wiring is required', () => {
  it('materializes an executable pre-commit hook in the configured worktree hook path', async () => {
    const repo = await preparedRepo();
    const hooksPath = (await git(repo, 'config', '--worktree', 'core.hooksPath')).stdout;
    const hookRoot = hooksPath.startsWith('/') ? hooksPath : join(repo, hooksPath);
    const hook = join(hookRoot, 'pre-commit');

    await expect(readFile(hook, 'utf8')).resolves.toMatch(/protected/i);
    expect((await stat(hook)).mode & 0o777).toBe(0o755);
  });
});

describe('Story 5: the public plan gate rejects ambiguous protected references', () => {
  it('rejects a task with no Files declaration and names the required declaration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'protected-plan-command-'));
    roots.push(root);
    const planPath = join(root, 'feature-a.md');
    await writeFile(
      planPath,
      [
        '# Implementation Plan',
        '',
        '### Task 16: fix the build',
        '',
        'Amend `.docs/specs/2026-07-04-operator-park.md:37` before continuing.',
        '',
      ].join('\n'),
      'utf8',
    );
    const command = detectPlanProtectedTargetsCommand([
      'node',
      'conduct-ts',
      'plan-protected-targets',
      planPath,
    ]);
    const output: string[] = [];

    expect(command).not.toBeNull();
    await expect(planProtectedTargetsCommand(command!, { print: (line) => output.push(line) })).resolves.toBe(1);
    expect(output.join('\n')).toContain('.docs/specs/2026-07-04-operator-park.md');
    expect(output.join('\n')).toMatch(/Files/);
  });
});

describe('Story 6: remediation cannot route a foreign protected artifact back to BUILD', () => {
  it('redirects a rationale-only protected target before appending build tasks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'protected-remediation-route-'));
    roots.push(root);
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const planPath = join(root, '.docs', 'plans', 'feature-a.md');
    await writeFile(planPath, '# Implementation Plan\n', 'utf8');
    await writeFile(
      join(root, '.pipeline', 'engine-state.json'),
      JSON.stringify({ activePlanPath: planPath }),
      'utf8',
    );
    const runner: StepRunner = {
      run: async () => {
        await writeFile(
          join(root, '.pipeline', 'remediation.json'),
          JSON.stringify({
            dispositions: [
              {
                id: 'protected-rationale',
                disposition: 'build',
                category: null,
                rationale: 'Amend .docs/specs/other-feature.md to resolve the gap.',
                tasks: [{ id: 'repair-source', title: 'Update src/engine/worker.ts' }],
              },
            ],
          }),
          'utf8',
        );
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      maxRetries: 1,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        context: string,
        source: { source: string; evidenceFile: string },
      ) => Promise<{ kind: string; target?: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature-a' } as ConductState,
      ALL_STEPS,
      'acceptance fixture',
      { source: 'prd-audit', evidenceFile: '.pipeline/prd-audit.md' },
    );

    expect(outcome.kind).toBe('halt');
    expect(outcome.target).not.toBe('build');
    expect(await readFile(planPath, 'utf8')).not.toContain('repair-source');
  });
});
