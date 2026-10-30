import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';

import { detectStackRoundsCommand, dispatchStackRoundsIfDetected } from '../../src/cli.js';

// Covers: task:2
const execFileP = promisify(execFile);
const argv = (...args: string[]) => ['node', 'ai-conductor', 'stack', 'rounds', ...args];

describe('stack rounds command detection', () => {
  it('accepts inspect form', () => {
    expect(detectStackRoundsCommand(argv('--slug', 'demo')))
      .toEqual({ kind: 'stack-rounds-inspect', slug: 'demo' });
  });

  it.each([
    ['slug-close-reason', argv('--slug', 'demo', '--close', 'r4', '--reason', 'stale audit')],
    ['slug-reason-close', argv('--slug', 'demo', '--reason', 'stale audit', '--close', 'r4')],
    ['close-slug-reason', argv('--close', 'r4', '--slug', 'demo', '--reason', 'stale audit')],
    ['close-reason-slug', argv('--close', 'r4', '--reason', 'stale audit', '--slug', 'demo')],
    ['reason-slug-close', argv('--reason', 'stale audit', '--slug', 'demo', '--close', 'r4')],
    ['reason-close-slug', argv('--reason', 'stale audit', '--close', 'r4', '--slug', 'demo')],
  ])('accepts close form in %s order', (_name, closeArgv) => {
    expect(detectStackRoundsCommand(closeArgv))
      .toEqual({ kind: 'stack-rounds-close', slug: 'demo', roundId: 'r4', reason: 'stale audit' });
  });

  it.each([
    ['unknown flag', argv('--slug', 'demo', '--unknown', 'value')],
    ['repeated slug', argv('--slug', 'demo', '--slug', 'again')],
    ['close without reason', argv('--slug', 'demo', '--close', 'r4')],
    ['reason without close', argv('--slug', 'demo', '--reason', 'stale')],
    ['slash in slug', argv('--slug', 'a/b')],
    ['dot slug', argv('--slug', '.')],
    ['dot-dot slug', argv('--slug', '..')],
    ['missing slug', argv('--close', 'r4', '--reason', 'stale')],
  ])('rejects %s before dispatching or changing conductor refs', async (_name, rejectedArgv) => {
    const root = await mkdtemp(join(tmpdir(), 'stack-rounds-detect-'));
    try {
      await execFileP('git', ['init', '--quiet'], { cwd: root });
      const refsBefore = (await execFileP('git', ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/'], { cwd: root })).stdout;
      const dispatch = vi.fn(async () => 0);

      await expect(dispatchStackRoundsIfDetected(rejectedArgv, dispatch)).resolves.toBeNull();

      expect(dispatch).not.toHaveBeenCalled();
      await expect(execFileP('git', ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/'], { cwd: root }))
        .resolves.toMatchObject({ stdout: refsBefore });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
