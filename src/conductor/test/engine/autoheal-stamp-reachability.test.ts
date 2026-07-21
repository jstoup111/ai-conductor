import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for stampShaReachable (Task 1, sidecar-stamp-reachability-guard).
//
// Extraction step: factor the reachable-ancestor check (resolveThroughMap +
// `git rev-parse --verify <sha>^{commit}` + `git merge-base --is-ancestor`)
// already inline in deriveCompletionInternal's satisfied-by path into a
// standalone helper, so the pin branch (Task 2) can reuse it.
//
// Acceptance criteria:
// 1. A sha that is an ancestor of HEAD resolves to itself
// 2. A sha absent from the repo resolves to null
// 3. A sha that exists in the repo but is off-branch (not an ancestor of HEAD)
//    resolves to null
// ─────────────────────────────────────────────────────────────────────────────

async function loadAutoheal() {
  return import('../../src/engine/autoheal.js');
}

let tmpDir: string;
let gitDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'autoheal-stamp-reachability-'));
  gitDir = tmpDir;

  await execa('git', ['init', '-b', 'main'], { cwd: gitDir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: gitDir });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: gitDir });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('stampShaReachable', () => {
  it('returns the sha when it is a reachable ancestor of HEAD', async () => {
    const mod = await loadAutoheal();

    // Build A <- B <- HEAD
    await writeFile(join(gitDir, 'a.txt'), 'a\n');
    await execa('git', ['add', 'a.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'commit A'], { cwd: gitDir });

    await writeFile(join(gitDir, 'b.txt'), 'b\n');
    await execa('git', ['add', 'b.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'commit B'], { cwd: gitDir });
    const bSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir })).stdout.trim();

    await writeFile(join(gitDir, 'c.txt'), 'c\n');
    await execa('git', ['add', 'c.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'HEAD commit'], { cwd: gitDir });

    const result = await mod.stampShaReachable(gitDir, bSha, {});
    expect(result).toBe(bSha);
  });

  it('returns null for a sha absent from the repo', async () => {
    const mod = await loadAutoheal();

    await writeFile(join(gitDir, 'a.txt'), 'a\n');
    await execa('git', ['add', 'a.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'commit A'], { cwd: gitDir });

    const nonexistentSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const result = await mod.stampShaReachable(gitDir, nonexistentSha, {});
    expect(result).toBeNull();
  });

  it('returns null for a sha that exists but is not an ancestor of HEAD', async () => {
    const mod = await loadAutoheal();

    // Base commit
    await writeFile(join(gitDir, 'base.txt'), 'base\n');
    await execa('git', ['add', 'base.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'base commit'], { cwd: gitDir });

    // Off-branch commit on a side branch
    await execa('git', ['checkout', '-b', 'side'], { cwd: gitDir });
    await writeFile(join(gitDir, 'side.txt'), 'side\n');
    await execa('git', ['add', 'side.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'off-branch commit'], { cwd: gitDir });
    const offBranchSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir })).stdout.trim();

    // Back to main, HEAD does not include the side commit
    await execa('git', ['checkout', 'main'], { cwd: gitDir });
    await writeFile(join(gitDir, 'main2.txt'), 'main2\n');
    await execa('git', ['add', 'main2.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'main commit 2'], { cwd: gitDir });

    const result = await mod.stampShaReachable(gitDir, offBranchSha, {});
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2: gate the empty-matchingCommits pin branch with stampShaReachable.
// A sidecar stamp citing a sha that is absent from HEAD (no rebase
// translation) must demote the task instead of pinning it completed forever
// (issue #766).
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveCompletion pin-branch reachability gate', () => {
  it('demotes a task whose sidecar stamp cites an unreachable commit', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    await writeFile(join(gitDir, 'a.txt'), 'a\n');
    await execa('git', ['add', 'a.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'commit A'], { cwd: gitDir });

    const planPath = join(gitDir, 'plan.md');
    await writeFile(planPath, '### Task T: Demoted task\n\n`a.txt`\n');

    // No commit in the commits list carries a `Task: T` trailer.
    const commits = await autoheal.listCommitsWithTrailers(gitDir);

    const unreachableSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const evidence = await createTaskEvidence(gitDir);
    evidence.evidenceStamps.set('T', { sha: unreachableSha, form: 'trailer' });

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    expect(result['T'].completed).toBe(false);
    expect(result['T'].status).not.toBe('completed');
    expect(typeof result['T'].auditEntry).toBe('string');
    expect(result['T'].auditEntry!.length).toBeGreaterThan(0);
    expect(result['T'].auditEntry).toContain(unreachableSha.slice(0, 7));
  });
});
