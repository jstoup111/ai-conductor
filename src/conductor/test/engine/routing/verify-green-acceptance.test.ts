// Covers: task:207
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { checkStepCompletion } from '../../../src/engine/artifacts.js';
import type { GitRunner } from '../../../src/engine/rebase.js';
import { verifyGreenAcceptance } from '../../../src/engine/routing/host-region-entry.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';

const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(marker?: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'verify-green-'));
  roots.push(root);
  const childDir = join(root, '.pipeline', 'children', '1');
  await mkdir(childDir, { recursive: true });
  await writeFile(join(childDir, 'acceptance-specs-run.json'), JSON.stringify({ command: 'test-child', cwd: '.', targetSpecs: ['spec.test.ts'] }));
  if (marker !== undefined) await writeFile(join(childDir, 'acceptance-specs-red.json'), JSON.stringify(marker));
  const git: GitRunner = vi.fn(async (args) => {
    if (args[0] === 'rev-parse' && args.at(-1) === 'HEAD') return { exitCode: 0, stdout: 'a'.repeat(40), stderr: '' };
    return { exitCode: 1, stdout: '', stderr: '' };
  });
  return { root, childDir, git };
}

describe('routed acceptance verify-green', () => {
  it('runs the child contract without a marker or close-time red ref and records the host tip', async () => {
    const subject = await fixture();
    const exec = vi.fn(async () => ({ executed: 1, passed: 1, failed: 0, skipped: 0, errors: 0 }));

    await expect(verifyGreenAcceptance({ worktree: subject.root, slug: 'demo', roundId, host: child, exec, git: subject.git }))
      .resolves.toEqual({ kind: 'verified', headSha: 'a'.repeat(40) });
    expect(exec).toHaveBeenCalledWith('test-child', subject.root);
    await expect(readFile(join(subject.childDir, 'acceptance-verify-green.json'), 'utf8').then(JSON.parse))
      .resolves.toMatchObject({ roundId: 'r1', host: 1, headSha: 'a'.repeat(40), done: true });
    await expect(checkStepCompletion(subject.root, 'acceptance_specs', {
      routedVerifyGreen: { roundId: 'r1', host: child, headSha: 'a'.repeat(40) },
    })).resolves.toEqual({ done: true, viaException: false });
  });

  it.each([
    ['a failing spec', { executed: 1, passed: 0, failed: 1, skipped: 0, errors: 0 }],
    ['a skipped spec', { executed: 1, passed: 1, failed: 0, skipped: 1, errors: 0 }],
    ['an errored spec', { executed: 1, passed: 1, failed: 0, skipped: 0, errors: 1 }],
    ['no executed specs', { executed: 0, passed: 0, failed: 0, skipped: 0, errors: 0 }],
  ])('refuses %s without writing a result', async (_name, result) => {
    const subject = await fixture();
    await expect(verifyGreenAcceptance({ worktree: subject.root, slug: 'demo', roundId, host: child, git: subject.git, exec: async () => result }))
      .resolves.toMatchObject({ kind: 'refused', reason: expect.stringContaining('every spec to pass') });
  });
});
