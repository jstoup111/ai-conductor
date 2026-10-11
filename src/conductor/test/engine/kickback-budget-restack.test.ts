// Covers: task:31.2
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { detectKickbackBudgetCommand } from '../../src/cli.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import {
  cascadeUpdateLines,
  readCascadeCounts,
  updateCascadeLimit,
} from '../../src/engine/restack/cascade-cap.js';

const execFile = promisify(execFileCallback);
const repos: string[] = [];

function child(value: number) {
  const parsed = parseChildId(value);
  if (parsed === undefined) throw new Error('invalid child fixture');
  return parsed;
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'kickback-budget-restack-'));
  repos.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q']);
  const update = await cascadeUpdateLines(repo, 'demo', [child(1)], { git: makeGitRunner(repo) });
  if (update.kind !== 'lines') throw new Error(update.detail);
  await makeGitRunner(repo)(['update-ref', '--stdin'], { input: ['start', ...update.lines, 'prepare', 'commit', ''].join('\n') });
  return repo;
}

afterEach(async () => { await Promise.all(repos.splice(0).map((repo) => rm(repo, { recursive: true, force: true }))); });

describe('restack kickback budget storage', () => {
  it('accepts the explicit restack child recovery command', () => {
    expect(detectKickbackBudgetCommand([
      'node', 'conduct', 'kickback-budget', 'raise', '--feature', 'demo', '--gate', 'restack',
      '--child', '1', '--by', '2', '--rationale', 'repair the stopped cascade',
    ])).toMatchObject({ action: 'raise', gate: 'restack', child: '1', by: 2 });
  });

  it('raises only the selected child limit and refuses a stale CAS', async () => {
    const repo = await fixture();
    const before = await readCascadeCounts(repo, 'demo');
    expect(before.kind).toBe('counts');
    if (before.kind !== 'counts') return;

    await expect(updateCascadeLimit(repo, 'demo', child(1), before.blob, (state) => ({
      version: 1,
      counts: state.counts,
      limits: { ...(state.limits ?? {}), 1: 5 },
    }))).resolves.toMatchObject({ kind: 'updated', counts: { counts: { 1: 1 }, limits: { 1: 5 } } });
    await expect(updateCascadeLimit(repo, 'demo', child(1), before.blob, (state) => ({
      version: 1,
      counts: state.counts,
      limits: { ...(state.limits ?? {}), 1: 7 },
    }))).resolves.toEqual({ kind: 'stale' });
    await expect(readCascadeCounts(repo, 'demo')).resolves.toMatchObject({ kind: 'counts', counts: { counts: { 1: 1 }, limits: { 1: 5 } } });
  });

  it('resets only the selected cascade count while preserving its raised limit', async () => {
    const repo = await fixture();
    const before = await readCascadeCounts(repo, 'demo');
    if (before.kind !== 'counts') throw new Error('unreadable fixture');
    await updateCascadeLimit(repo, 'demo', child(1), before.blob, (state) => ({
      version: 1,
      counts: { ...state.counts, 1: 0 },
      limits: { ...(state.limits ?? {}), 1: 5 },
    }));
    await expect(readCascadeCounts(repo, 'demo')).resolves.toMatchObject({
      kind: 'counts', counts: { counts: { 1: 0 }, limits: { 1: 5 } },
    });
  });
});
