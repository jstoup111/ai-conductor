// Covers: task:16
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CodexProvider } from '../../src/execution/codex-provider.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const smokeCapability = 'credentialed:codex';
const available = (() => { try { execFileSync('which', ['codex'], { stdio: 'pipe' }); return Boolean(process.env.CODEX_API_KEY); } catch { return false; } })();

describe.skipIf(!available)('Codex git guard live smoke', () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  it('puts the materialized guard first on PATH and refuses forced clean', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'codex-git-guard-'));
    roots.push(worktree);
    await initTestRepo(worktree);
    await prepareWorktree(worktree);

    const result = await new CodexProvider().invoke({
      cwd: worktree,
      sessionId: 'git-guard-codex-smoke',
      resume: false,
      prompt: 'Run `command -v git`, then run `git clean -f`. Reply with the command output in order, with no commentary.',
    });

    const lines = result.output.trim().split('\n');
    expect(lines[0]).toBe(join(worktree, '.pipeline', 'bin', 'git'));
    expect(result.output).toContain('ai-conductor git guard: refused');
  });
});
