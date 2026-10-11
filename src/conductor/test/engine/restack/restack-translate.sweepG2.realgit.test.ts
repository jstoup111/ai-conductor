import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { EventPersister } from '../../../src/engine/event-persister.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import type { RestackResolver } from '../../../src/engine/restack/restack-resolver.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { createSweepRepository, persistedEvents, removeAll, sealStack, type SweepRepository } from './restack-sweepG2-fixture.js';

const execFile = promisify(execFileCallback);
const cleanup: string[] = [];

afterEach(async () => {
  await removeAll(cleanup);
});

async function writeJson(repo: string, path: string, value: unknown): Promise<void> {
  await mkdir(join(repo, path, '..'), { recursive: true });
  await writeFile(join(repo, path), JSON.stringify(value));
}

async function readJson<T = Record<string, unknown>>(repo: string, path: string): Promise<T> {
  return JSON.parse(await readFile(join(repo, path), 'utf8')) as T;
}

async function snapshot(directory: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files[relative(directory, full)] = await readFile(full, 'utf8');
    }
  };
  await walk(directory);
  return files;
}

/** The commit on `branch` whose subject is `subject`. */
async function bySubject(subject: SweepRepository, branch: string, wanted: string): Promise<string> {
  const lines = (await subject.git(['log', branch, '--format=%H %s'])).stdout.split('\n');
  const line = lines.find((candidate) => candidate.slice(41) === wanted);
  if (!line) throw new Error(`no commit ${wanted} on ${branch}`);
  return line.slice(0, 40);
}

function fullShaKeys(map: Record<string, string>): string[] {
  return Object.keys(map).filter((key) => key.length === 40).sort();
}

describe('restack evidence translation sweep (real local Git)', () => {
  // Covers: S11.4, S5.4, task:19
  it('maps each moved child range, translates flat and active stores including the RED proof, keeps closed stores byte-identical, and preserves current-task', async () => {
    const subject = await createSweepRepository('restack-translate-sweep-', cleanup);
    const base = await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const c1a = await subject.commit('C1a', 'one-a.txt', 'one a\n');
    const c1b = await subject.commit('C1b', 'one-b.txt', 'one b\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1b]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const red = await subject.commit('C2 RED spec', 'two.spec.txt', 'red\n');
    const c2b = await subject.commit('C2 implementation', 'two.txt', 'green\n');
    await subject.git(['checkout', '-q', 'main']);
    const advanced = await subject.commit('advance', 'advance.txt', 'advance\n');
    await subject.git(['checkout', '-q', 'feat/c2/demo']);
    await sealStack(subject.repo);
    // Flat stores.
    await writeJson(subject.repo, '.pipeline/task-evidence.json', { evidenceStamps: {
      T1: { sha: c1b, citedShas: [c1a, red], verdictAnchor: c2b },
      RED: { sha: red, citedShas: [red] },
    } });
    await writeJson(subject.repo, '.pipeline/task-status.json', { tasks: [
      { id: 'T1', status: 'completed', commit: c1b.slice(0, 7) },
      { id: 'T3', status: 'in_progress', commit: c2b },
    ] });
    await writeJson(subject.repo, '.pipeline/test-suite-evidence.json', { outcome: 'PASS', provenanceHeadSha: c2b, driftLedger: [{ headSha: c1b }] });
    await writeFile(join(subject.repo, '.pipeline', 'current-task'), 'T3\n');
    // Active child 2's stores.
    await writeJson(subject.repo, '.pipeline/children/2/task-evidence.json', { evidenceStamps: { RED: { sha: red }, T3: { sha: c2b, verdictAnchor: c2b } } });
    await writeJson(subject.repo, '.pipeline/children/2/task-status.json', { tasks: [{ id: 'T3', status: 'in_progress', commit: c2b }] });
    await writeJson(subject.repo, '.pipeline/children/2/test-suite-evidence.json', { outcome: 'PASS', provenanceHeadSha: c2b });
    // Closed child 1's stores.
    await writeJson(subject.repo, '.pipeline/children/1/task-evidence.json', { evidenceStamps: { T1: { sha: c1b, citedShas: [c1a] } } });
    await writeJson(subject.repo, '.pipeline/children/1/task-status.json', { tasks: [{ id: 'T1', status: 'completed', commit: c1b }] });
    await writeJson(subject.repo, '.pipeline/children/1/test-suite-evidence.json', { outcome: 'PASS', provenanceHeadSha: c1b });
    const closedBefore = await snapshot(join(subject.repo, '.pipeline', 'children', '1'));

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, git: makeGitRunner(subject.repo) }))
      .resolves.toMatchObject({ kind: 'applied' });

    const moved = {
      [c1a]: await bySubject(subject, 'feat/c1/demo', 'C1a'),
      [c1b]: await bySubject(subject, 'feat/c1/demo', 'C1b'),
      [red]: await bySubject(subject, 'feat/c2/demo', 'C2 RED spec'),
      [c2b]: await bySubject(subject, 'feat/c2/demo', 'C2 implementation'),
    };
    for (const [from, to] of Object.entries(moved)) expect(to).not.toBe(from);
    const rewrites = await readJson<Record<string, string>>(subject.repo, '.pipeline/rebase-rewrites.json');
    // Exactly the commits of oldParent..oldTip for each moved child, by full SHA.
    expect(fullShaKeys(rewrites)).toEqual(Object.keys(moved).sort());
    for (const [from, to] of Object.entries(moved)) expect(rewrites[from]).toBe(to);
    expect(rewrites[base]).toBeUndefined();
    expect(rewrites[advanced]).toBeUndefined();

    expect(await readJson(subject.repo, '.pipeline/task-evidence.json')).toEqual({ evidenceStamps: {
      T1: { sha: moved[c1b], citedShas: [moved[c1a], moved[red]], verdictAnchor: moved[c2b] },
      RED: { sha: moved[red], citedShas: [moved[red]] },
    } });
    expect(await readJson(subject.repo, '.pipeline/task-status.json')).toEqual({ tasks: [
      { id: 'T1', status: 'completed', commit: moved[c1b]!.slice(0, 7) },
      { id: 'T3', status: 'in_progress', commit: moved[c2b] },
    ] });
    expect(await readJson(subject.repo, '.pipeline/test-suite-evidence.json')).toMatchObject({ provenanceHeadSha: moved[c2b], driftLedger: [{ headSha: moved[c1b] }] });
    expect(await readJson(subject.repo, '.pipeline/children/2/task-evidence.json')).toEqual({ evidenceStamps: { RED: { sha: moved[red] }, T3: { sha: moved[c2b], verdictAnchor: moved[c2b] } } });
    expect(await readJson(subject.repo, '.pipeline/children/2/task-status.json')).toEqual({ tasks: [{ id: 'T3', status: 'in_progress', commit: moved[c2b] }] });
    expect(await readJson(subject.repo, '.pipeline/children/2/test-suite-evidence.json')).toMatchObject({ provenanceHeadSha: moved[c2b] });
    expect(await snapshot(join(subject.repo, '.pipeline', 'children', '1'))).toEqual(closedBefore);
    // current-task still names T3, whose commit resolves through the map onto child 2.
    await expect(readFile(join(subject.repo, '.pipeline', 'current-task'), 'utf8')).resolves.toBe('T3\n');
    expect(rewrites[c2b]).toBe(await subject.rev('feat/c2/demo'));
    expect(await subject.rev('HEAD')).toBe(rewrites[c2b]);
  });

  // Covers: S11.4, task:19
  it('maps child 2 commits to the resolver\'s rewritten commits after a conflict hand-off', async () => {
    const subject = await createSweepRepository('restack-translate-resolver-sweep-', cleanup);
    await subject.commit('base', 'src/c.ts', 'one\ntwo\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const c1 = await subject.commit('C1', 'c1.txt', 'c1\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const prep = await subject.commit('C2 prep', 'prep.txt', 'prep\n');
    const conflicting = await subject.commit('C2', 'src/c.ts', 'one\nchild\n');
    await subject.git(['checkout', '-q', 'main']);
    const advanced = await subject.commit('main advance', 'src/c.ts', 'one\nmain\n');
    await subject.git(['checkout', '-q', 'feat/c2/demo']);
    await sealStack(subject.repo);
    await writeJson(subject.repo, '.pipeline/task-status.json', { tasks: [{ id: 'T2', status: 'in_progress', commit: conflicting }] });
    const resolver: RestackResolver = async (context) => {
      await writeFile(join(context.projectRoot, 'src', 'c.ts'), 'one\nresolved\n');
      const git = (args: string[]) => execFile('git', args, { cwd: context.projectRoot, env: { ...process.env, ...context.environment } });
      await git(['add', 'src/c.ts']);
      await git(['rebase', '--continue']);
      return { resolved: true };
    };

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, resolver, resolverCap: 1, git: makeGitRunner(subject.repo) }))
      .resolves.toMatchObject({ kind: 'applied' });

    const resolvedTip = await subject.rev('feat/c2/demo');
    expect((await subject.git(['show', `${resolvedTip}:src/c.ts`])).stdout).toBe('one\nresolved\n');
    const rewrites = await readJson<Record<string, string>>(subject.repo, '.pipeline/rebase-rewrites.json');
    expect(rewrites[conflicting]).toBe(resolvedTip);
    expect(rewrites[prep]).toBe(await subject.rev('feat/c2/demo^'));
    expect(await readJson(subject.repo, '.pipeline/task-status.json')).toEqual({ tasks: [{ id: 'T2', status: 'in_progress', commit: resolvedTip }] });
  });

  // Covers: S11.10, task:19
  it('records no child-1 or default-branch commit in rebase-rewrites.json after a feature repair that moves only child 2 and the leaf', async () => {
    const subject = await createSweepRepository('restack-translate-repair-sweep-', cleanup);
    const base = await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const c1 = await subject.commit('C1', 'one.txt', 'one\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const c2 = await subject.commit('C2', 'two.txt', 'two\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    const leaf = await subject.commit('L1', 'leaf.txt', 'leaf\n');
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    const repair = await subject.commit('repair', 'repair.txt', 'repair\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await sealStack(subject.repo);

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo) }))
      .resolves.toMatchObject({ kind: 'applied' });

    expect(await subject.rev('feat/c1/demo')).toBe(repair);
    const rewrites = await readJson<Record<string, string>>(subject.repo, '.pipeline/rebase-rewrites.json');
    expect(fullShaKeys(rewrites)).toEqual([c2, leaf].sort());
    for (const childOneOrDefault of [base, c1, repair]) {
      expect(Object.keys(rewrites).some((key) => childOneOrDefault.startsWith(key))).toBe(false);
    }
  });

  // Covers: S11.4, task:19
  it('runs translateAfterRebase with the exact leaf map: repair baselines move directly or to a successor, the memo is re-keyed and cited dropped commits are residue', async () => {
    const subject = await createSweepRepository('restack-translate-orchestration-sweep-', cleanup);
    await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const c1 = await subject.commit('C1', 'one.txt', 'one\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const c2 = await subject.commit('C2', 'two.txt', 'two\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    const dropped = await subject.commit('L1 carried upstream', 'carried.txt', 'carried\n');
    const kept = await subject.commit('L2', 'leaf.txt', 'leaf\n');
    await subject.git(['checkout', '-q', 'main']);
    await subject.git(['cherry-pick', dropped]);
    const advanced = await subject.rev('HEAD');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await sealStack(subject.repo);
    const obligation = (id: string, head: string) => ({
      id,
      planIdentity: '.docs/plans/demo.md',
      taskIds: ['1'],
      source: { findingId: id, authority: 'build_review', instruction: 'Repair.' },
      baseline: { head, tree: `${id}-tree`, resolvedTaskIds: [] },
      settlement: 'unsettled',
      tasks: { 1: { status: 'open' } },
    });
    await writeJson(subject.repo, '.pipeline/engine-state.json', { repairObligations: {
      version: 1,
      records: { direct: obligation('direct', kept), successor: obligation('successor', dropped) },
      currentByPlan: {},
      admissionsByPlan: {},
    } });
    await writeJson(subject.repo, '.pipeline/task-status.json', { tasks: [{ id: 'T9', status: 'in_progress', commit: kept }] });
    await writeJson(subject.repo, '.pipeline/task-evidence.json', { evidenceStamps: { T9: { sha: dropped } } });
    await writeJson(subject.repo, '.pipeline/attribution-memo.json', { key: `${kept}:T9`, result: JSON.stringify({ anchor: { head: kept }, results: [] }) });
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, events, git: makeGitRunner(subject.repo) }))
        .resolves.toMatchObject({ kind: 'applied' });
    } finally {
      persister.stop();
    }

    const newLeaf = await subject.rev('feat/daemon-demo');
    expect((await subject.git(['log', '--format=%s', `${advanced}..${newLeaf}`])).stdout).not.toContain('L1 carried upstream');
    const state = await readJson<{ repairObligations: { records: Record<string, { baseline: { head: string } }> } }>(subject.repo, '.pipeline/engine-state.json');
    expect(state.repairObligations.records.direct!.baseline.head).toBe(newLeaf);
    expect(state.repairObligations.records.successor!.baseline.head).toBe(newLeaf);
    const persisted = await persistedEvents(subject.repo);
    expect(persisted).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'repair_boundary_translated', obligationId: 'direct', from: kept, to: newLeaf, rule: 'direct' }),
      expect.objectContaining({ type: 'repair_boundary_translated', obligationId: 'successor', from: dropped, to: newLeaf, rule: 'successor' }),
    ]));
    const memo = await readJson<{ key: string; result: string }>(subject.repo, '.pipeline/attribution-memo.json');
    expect(memo.key).toBe(`${newLeaf}:T9`);
    expect(JSON.parse(memo.result)).toMatchObject({ anchor: { head: newLeaf } });
    const residue = persisted.filter((event) => event.type === 'rebase_citation_residue');
    expect(residue).toEqual([expect.objectContaining({
      residue: [expect.objectContaining({ sha: dropped, citingTaskIds: ['T9'] })],
    })]);
  });
});
