/**
 * Covers: S1.3, S3.2, task:10
 *
 * Drives the real halt writer and halt-clear watcher through local Git. The
 * observer clone has no path to the daemon worktree; its only authority is the
 * pushed feature branch. Git is the behavior under test, and no third-party
 * service is contacted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { watchHaltCleared } from '../../src/engine/daemon-deps.js';
import { writeHaltMarker } from '../../src/engine/halt-marker.js';
import { writePhaseMarker } from '../../src/engine/phase-marker.js';

const execFile = promisify(execFileCallback);
const SLUG = 'halt-record-pickup';
const BRANCH = `feat/${SLUG}`;
const RECORD_PATH = `.docs/halted/${SLUG}.md`;
const HALT_REASON = 'build review needs an operator decision\nmissing acceptance evidence\n';

describe('committed halt record operator pickup', () => {
  let root: string;
  let remote: string;
  let worktreeBase: string;
  let worktree: string;
  let pickup: string;
  let dispose: (() => void) | undefined;

  async function git(args: string[], cwd = worktree): Promise<string> {
    const result = await execFile('git', args, { cwd });
    return result.stdout.trim();
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-record-pickup-'));
    remote = join(root, 'origin.git');
    worktreeBase = join(root, 'worktrees');
    worktree = join(worktreeBase, SLUG);
    pickup = join(root, 'operator-clone');

    await execFile('git', ['init', '--bare', '-q', '-b', 'main', remote]);
    await execFile('git', ['init', '-q', '-b', 'main', worktree]);
    await git(['config', 'user.email', 'acceptance@example.com']);
    await git(['config', 'user.name', 'Acceptance Test']);
    await git(['config', 'commit.gpgsign', 'false']);
    await writeFile(join(worktree, 'README.md'), 'fixture\n');
    await git(['add', 'README.md']);
    await git(['commit', '-q', '-m', 'fixture base']);
    await git(['remote', 'add', 'origin', remote]);
    await git(['push', '-q', '-u', 'origin', 'main']);
    await git(['checkout', '-q', '-b', BRANCH]);
    await git(['push', '-q', '-u', 'origin', BRANCH]);

    await mkdir(join(worktree, '.pipeline'), { recursive: true });
    await writeFile(
      join(worktree, '.pipeline', 'conduct-state.json'),
      `${JSON.stringify({ feature_desc: SLUG, last_step: 'build' }, null, 2)}\n`,
    );
    writePhaseMarker(worktree, { step: 'build', phase: 'BUILD', allow: [] });
  });

  afterEach(async () => {
    dispose?.();
    await rm(root, { recursive: true, force: true });
  });

  it('reads the halt from a branch-only clone and observes its resolution after fetch', async () => {
    await expect(
      writeHaltMarker(worktree, HALT_REASON, 'needs-human'),
    ).resolves.toEqual({ status: 'written' });

    await execFile('git', ['clone', '-q', '--branch', BRANCH, remote, pickup]);
    const haltedRecord = await readFile(join(pickup, RECORD_PATH), 'utf8');

    expect(haltedRecord).toContain(SLUG);
    expect(haltedRecord).toContain('Status: halted');
    expect(haltedRecord).toContain('needs-human');
    expect(haltedRecord).toContain('build');
    expect(haltedRecord).toContain('BUILD');
    expect(haltedRecord).toContain(HALT_REASON.trim());

    let cleared = false;
    dispose = watchHaltCleared(worktreeBase, SLUG, () => {
      cleared = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await unlink(join(worktree, '.pipeline', 'HALT'));
    await vi.waitFor(() => expect(cleared).toBe(true), { timeout: 2_000 });

    await git(['fetch', '-q', 'origin'], pickup);
    const resolvedRecord = await git(
      ['show', `origin/${BRANCH}:${RECORD_PATH}`],
      pickup,
    );
    expect(resolvedRecord).toContain('Status: resolved');
    expect(resolvedRecord).toContain('operator');
    expect(resolvedRecord).toContain(HALT_REASON.trim());
    expect(resolvedRecord).toContain('needs-human');
    expect(resolvedRecord).toContain('build');
  });
});
