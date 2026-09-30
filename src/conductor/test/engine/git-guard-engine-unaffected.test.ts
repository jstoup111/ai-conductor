// Covers: task:12
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Options as ExecaOptions } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { resolveRealGit } from '../../src/engine/git-guard.js';
import { GIT_GUARD_SCRIPT } from '../../src/engine/git-hook-assets.js';
import { auditShippedGithubInvocationBoundary } from '../../src/engine/github-invocation-audit.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { initTestRepo } from '../fixtures/git-repo.js';

describe('engine git guard boundary', () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  it('keeps provider PATH shadowing process-local while engine git keeps resolving the real executable', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'git-guard-engine-'));
    roots.push(worktree);
    await initTestRepo(worktree);
    await prepareWorktree(worktree);
    const before = await resolveRealGit();
    const spawns: Array<{ env?: NodeJS.ProcessEnv }> = [];
    const provider = new ClaudeProvider(undefined, ((_file: string, _args: string[], options: ExecaOptions) => {
      spawns.push({ env: options.env });
      return Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0, failed: false }) as any;
    }) as any);

    await provider.invoke({ cwd: worktree, sessionId: 'engine-git-guard', resume: false, prompt: 'noop' });
    const engineResult = await makeGitRunner(worktree)(['--version']);
    const after = await resolveRealGit();

    expect(spawns[0]?.env?.PATH).toContain(join(worktree, '.pipeline', 'bin'));
    expect(process.env.PATH).not.toMatch(/(?:^|:)[^:]*\/\.pipeline\/bin(?::|$)/);
    expect(engineResult.exitCode).toBe(0);
    expect(after).toBe(before);
  });

  it.each([
    ['ship-draft-pr lease push', ['push', '-u', 'origin', 'HEAD:refs/heads/feature/guarded', '--force-with-lease']],
    ['github-operation push', ['push', 'origin', 'HEAD:refs/heads/feature/guarded']],
    ['github-operation named remote delete', ['push', 'origin', '--delete', 'feature/guarded']],
    ['compose land add', ['add', '.docs']],
    ['compose land commit', ['commit', '-m', 'docs: land guarded spec']],
    ['compose handoff push', ['push', '-u', 'origin', 'HEAD:refs/heads/spec/guarded']],
    ['compose handoff worktree removal', ['worktree', 'remove', '--force', '/scratch/spec-guarded']],
  ])('passes %s through the materialized guard byte-identically', async (_name, argv) => {
    const worktree = await mkdtemp(join(tmpdir(), 'git-guard-inventory-'));
    roots.push(worktree);
    await initTestRepo(worktree);
    await prepareWorktree(worktree);
    const calls = join(worktree, 'real-git-calls');
    const realGit = join(worktree, 'recording-real-git');
    await writeFile(realGit, `#!/usr/bin/env bash\nprintf '%s\\0' "$@" >> ${JSON.stringify(calls)}\n`, 'utf8');
    await chmod(realGit, 0o755);
    await writeFile(join(worktree, '.pipeline', 'git-guard', 'real-git'), `${realGit}\n`, 'utf8');

    const guard = join(worktree, '.pipeline', 'bin', 'git');
    const result = spawnSync(guard, argv, { cwd: worktree, encoding: 'utf8' });
    const recorded = (await readFile(calls)).toString('utf8').split('\0').filter(Boolean);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('ai-conductor git guard: refused');
    expect(recorded.slice(-argv.length)).toEqual(argv);
  });

  it('does not attribute the guard assets themselves as GitHub invocation bypasses', () => {
    const findings = auditShippedGithubInvocationBoundary(resolve(__dirname, '../../..'));
    expect(findings.filter((finding) => finding.file === 'engine/git-hook-assets.ts' || finding.file === 'engine/git-guard.ts')).toEqual([]);
  });

  it('keeps the materialized script’s safe lease pass-through contract', () => {
    expect(GIT_GUARD_SCRIPT).toContain('exec "$real_git" "$@"');
    expect(GIT_GUARD_SCRIPT).toContain('git push --force-with-lease');
  });
});
