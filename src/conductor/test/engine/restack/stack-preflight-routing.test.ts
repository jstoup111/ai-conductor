// Covers: task:rem-prd-audit-W9
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rename, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, readRepairMarker } from '../../../src/engine/routing/route-record-store.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => { await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'stack-preflight-routing-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, value: string) => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), value);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routing@example.test']);
  await git(['config', 'user.name', 'Stack preflight routing']);
  await commit('base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closed = await commit('closed child', 'child.txt', 'child\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closed]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n  route_whole_feature_fixes: true\n');
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { a: 1, b: 2 }, titles: ['child', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  return { repo, git };
}

describe('stack preflight routing', () => {
  it('defers a due base refresh for an admitted round before reconciliation navigates to build', async () => {
    const subject = await fixture();
    const child = parseChildId(1)!;
    const roundId = parseRoundId('r1')!;
    const created = await createRouteRecord(subject.repo, 'demo', {
      roundId,
      sealedAuthored: 1,
      kind: 'audit',
      items: [{ findingId: 'finding', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] }],
      allocation: { [child]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1\n'] } },
    });
    if (created.kind !== 'created') throw new Error(created.kind);
    await expect(admitRound(subject.repo, 'demo', created.record, child)).resolves.toMatchObject({ kind: 'admitted' });
    expect(await readRepairMarker(subject.repo, 'demo')).toMatchObject({ kind: 'marker', marker: { roundId, host: child } });
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    const consumed: string[] = [];
    events.on('restack_refused', (event) => { refusals.push(event); });

    await expect(runStackPreflight({
      worktree: subject.repo,
      slug: 'demo',
      baseRefreshDue: true,
      consumeRekick: async () => { consumed.push('consume'); },
      events,
      git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'navigate-leaf-to-build', roundId: 'r1', host: 1 });

    expect(refusals).toHaveLength(1);
    expect(refusals).toEqual([expect.objectContaining({ type: 'restack_refused', reason: 'deferred-base-refresh' })]);
    expect(consumed).toEqual([]);
  });
});
