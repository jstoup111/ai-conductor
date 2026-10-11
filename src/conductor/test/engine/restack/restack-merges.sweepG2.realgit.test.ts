import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';

import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { EventPersister } from '../../../src/engine/event-persister.js';
import { classifyReplayMerge, makeGitRunner, planFlattenedReplay } from '../../../src/engine/rebase.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { replayChildRange, type CommitterStamp } from '../../../src/engine/restack/restack-replay.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import {
  createSweepRepository,
  persistedEvents,
  removeAll,
  sealStack,
  type SweepRepository,
} from './restack-sweepG2-fixture.js';

const cleanup: string[] = [];
const stamp: CommitterStamp = { name: 'Restack Journal', email: 'journal@example.test', date: '2030-02-03T04:05:06Z' };
const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../src');

afterEach(async () => {
  await removeAll(cleanup);
});

async function revList(subject: SweepRepository, range: string): Promise<string[]> {
  return (await subject.git(['rev-list', '--reverse', range])).stdout.split('\n').filter(Boolean);
}

/** child 2 merges origin/main at D1; returns the stack ready for a base refresh. */
async function mergeBearingStack(kind: 'automatic' | 'hand-resolved', mainAfterMerge?: 'edit' | 'revert') {
  const subject = await createSweepRepository('restack-merges-sweep-', cleanup);
  await subject.commit('base', 'shared.txt', 'base\n');
  await subject.git(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await subject.commit('C1', 'c1.txt', 'c1\n');
  await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await subject.git(['checkout', '-qb', 'feat/c2/demo']);
  await subject.commit('child work', 'child.txt', 'child work\n');
  await subject.git(['checkout', '-q', 'main']);
  const d1 = await subject.commit('D1', 'shared.txt', 'D1\n');
  await subject.git(['checkout', '-q', 'feat/c2/demo']);
  if (kind === 'hand-resolved') {
    await subject.git(['merge', '--no-ff', '--no-commit', 'main']);
    await subject.write('shared.txt', 'hand resolution\n');
    await subject.git(['add', 'shared.txt']);
    await subject.git(['commit', '-qm', 'merge main with hand resolution']);
  } else {
    await subject.git(['merge', '--no-ff', '-m', 'merge main automatically', 'main']);
  }
  const merge = await subject.rev('HEAD');
  await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', merge]);
  await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
  await subject.commit('L1', 'leaf.txt', 'leaf\n');
  await subject.git(['checkout', '-q', 'main']);
  if (mainAfterMerge === 'edit') await subject.commit('D2', 'shared.txt', 'D2\n');
  else if (mainAfterMerge === 'revert') await subject.commit('revert D1', 'shared.txt', 'base\n');
  const newDefault = await subject.rev('HEAD');
  await subject.git(['checkout', '-q', 'feat/daemon-demo']);
  await sealStack(subject.repo);
  return { ...subject, d1, merge, newDefault };
}

describe('restack merge-bearing children sweep (real local Git)', () => {
  // Covers: S2.1, S2.3, task:12
  it('drops an automatic main merge whose D1 the parent carries and flattens an uncarried side merge into one commit with its first-parent change', async () => {
    // Automatic merge of origin/main at D1, new parent contains D1.
    const automatic = await createSweepRepository('restack-merges-auto-sweep-', cleanup);
    const base = await automatic.commit('base', 'shared.txt', 'base\n');
    await automatic.git(['checkout', '-qb', 'child']);
    const childWork = await automatic.commit('child work', 'child.txt', 'child work\n');
    await automatic.git(['checkout', '-q', 'main']);
    const d1 = await automatic.commit('D1', 'shared.txt', 'D1\n');
    await automatic.git(['checkout', '-q', 'child']);
    await automatic.git(['merge', '--no-ff', '-m', 'merge main automatically', 'main']);
    const automaticMerge = await automatic.rev('HEAD');
    const child = parseChildId(2)!;
    const dropped = await replayChildRange({ child, oldParent: base, oldTip: automaticMerge, kind: 'active' }, d1, stamp, makeGitRunner(automatic.repo));

    expect(dropped.rewrites.has(automaticMerge)).toBe(false);
    expect([...dropped.rewrites.keys()]).toEqual([childWork]);
    expect(await revList(automatic, `${d1}..${dropped.tip}`)).toEqual([dropped.rewrites.get(childWork)]);
    expect(dropped.audit.ancestryOnlyMerges).toEqual([automaticMerge]);

    // Side branch Q the new parent does not contain.
    const side = await createSweepRepository('restack-merges-side-sweep-', cleanup);
    const sideBase = await side.commit('base', 'shared.txt', 'base\n');
    await side.git(['checkout', '-qb', 'child']);
    await side.commit('child work', 'child.txt', 'child work\n');
    await side.git(['checkout', '-qb', 'side', sideBase]);
    await side.commit('side work', 'side.txt', 'side work\n');
    await side.git(['checkout', '-q', 'child']);
    await side.git(['merge', '--no-ff', '-m', 'merge side', 'side']);
    const sideMerge = await side.rev('HEAD');
    await side.git(['checkout', '-q', 'main']);
    const newParent = await side.commit('upstream advance', 'upstream.txt', 'upstream\n');
    const flattened = await replayChildRange({ child, oldParent: sideBase, oldTip: sideMerge, kind: 'active' }, newParent, stamp, makeGitRunner(side.repo));

    const replacement = flattened.rewrites.get(sideMerge);
    expect(replacement).toBeDefined();
    expect(await revList(side, `${newParent}..${flattened.tip}`)).toHaveLength(2);
    expect(flattened.tip).toBe(replacement);
    expect((await side.git(['rev-list', '--parents', '-n', '1', replacement!])).stdout.trim().split(' ')).toHaveLength(2);
    expect((await side.git(['diff', `${replacement}^`, replacement!])).stdout)
      .toBe((await side.git(['diff', `${sideMerge}^1`, sideMerge])).stdout);
    expect((await side.git(['show', '-s', '--format=%B', replacement!])).stdout).toContain(`Flattened-merge: ${sideMerge}`);
  });

  // Covers: S2.2, task:12
  it('replaces a hand-resolved D1 merge with one Flattened-merge commit carrying only the hand resolution and persists the merge audit', async () => {
    const subject = await mergeBearingStack('hand-resolved');
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await expect(runRestack({
        worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault, events, git: makeGitRunner(subject.repo),
      })).resolves.toMatchObject({ kind: 'applied' });
    } finally {
      persister.stop();
    }

    const newC1 = await subject.rev('feat/c1/demo');
    const childTwo = await revList(subject, `${newC1}..feat/c2/demo`);
    expect(childTwo).toHaveLength(2);
    const replacement = childTwo[1]!;
    expect((await subject.git(['rev-list', '--parents', '-n', '1', replacement])).stdout.trim().split(' ')).toHaveLength(2);
    expect((await subject.git(['diff', '--name-only', `${replacement}^`, replacement])).stdout).toBe('shared.txt\n');
    expect((await subject.git(['show', `${replacement}^:shared.txt`])).stdout).toBe('D1\n');
    expect((await subject.git(['show', `${replacement}:shared.txt`])).stdout).toBe('hand resolution\n');
    expect((await subject.git(['show', '-s', '--format=%B', replacement])).stdout).toContain(`Flattened-merge: ${subject.merge}`);
    const audits = (await persistedEvents(subject.repo)).filter((event) => event.type === 'rebase_merge_audit');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ sideLineageCount: 1 });
  });

  // Covers: S2.4, S2.5, task:12
  it("replays child 2 without conflict when main later edited D1 to D2 or reverted it, keeping main's later state", async () => {
    for (const [mainAfterMerge, expected] of [['edit', 'D2\n'], ['revert', 'base\n']] as const) {
      const subject = await mergeBearingStack('automatic', mainAfterMerge);
      const events = new ConductorEventEmitter();
      const conflicts: unknown[] = [];
      events.on('restack_conflict', (event) => { conflicts.push(event); });
      let resolverCalls = 0;

      await expect(runRestack({
        worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault, events,
        git: makeGitRunner(subject.repo),
        resolver: async () => { resolverCalls += 1; return { resolved: false, reason: 'must not be called' }; },
      })).resolves.toMatchObject({ kind: 'applied' });

      expect({ conflicts, resolverCalls }).toEqual({ conflicts: [], resolverCalls: 0 });
      expect((await subject.git(['show', 'feat/c2/demo:shared.txt'])).stdout).toBe(expected);
      expect((await subject.git(['show', 'feat/c2/demo:child.txt'])).stdout).toBe('child work\n');
      expect((await subject.git(['merge-base', '--is-ancestor', subject.newDefault, 'feat/c2/demo'])).stdout).toBe('');
    }
  });
});

function callsNamed(source: ts.SourceFile, name: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) calls.push(node);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return calls;
}

function enclosingFunction(node: ts.Node): string | undefined {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
  }
  return undefined;
}

function modeOf(call: ts.CallExpression): string | undefined {
  const mode = call.arguments[3];
  return mode && ts.isStringLiteral(mode) ? mode.text : undefined;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat();
}

describe('classifyReplayMerge is the shared merge classifier (sweep)', () => {
  // Covers: S2.1, task:12
  it('is the only merge classifier: performRebase reaches it in n1 mode through planFlattenedReplay and replayChildRange calls it in stacked mode', async () => {
    const calls: { module: string; fn: string | undefined; mode: string | undefined }[] = [];
    const classifiers: string[] = [];
    for (const path of await sourceFiles(sourceRoot)) {
      const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
      const module = relative(sourceRoot, path);
      for (const call of callsNamed(source, 'classifyReplayMerge')) calls.push({ module, fn: enclosingFunction(call), mode: modeOf(call) });
      // A merge classifier compares a merge's tree with its first parent's.
      const text = source.getFullText();
      if (/\^1\^\{tree\}/.test(text)) classifiers.push(module);
    }

    expect(calls).toEqual(expect.arrayContaining([
      { module: 'engine/rebase.ts', fn: 'planFlattenedReplay', mode: 'n1' },
      { module: 'engine/restack/restack-replay.ts', fn: 'replayChildRange', mode: 'stacked' },
    ]));
    // N=1 never asks for the stacked three-class rule; stacked mode stays inside the restack engine.
    expect(calls.filter((call) => call.module === 'engine/rebase.ts')).toEqual([{ module: 'engine/rebase.ts', fn: 'planFlattenedReplay', mode: 'n1' }]);
    expect(calls.filter((call) => call.mode === 'stacked').every((call) => call.module.startsWith('engine/restack/'))).toBe(true);
    expect(calls.every((call) => call.mode === 'n1' || call.mode === 'stacked')).toBe(true);
    // Only classifyReplayMerge (rebase.ts) and the replay's empty-commit check read a first-parent tree.
    expect(classifiers.sort()).toEqual(['engine/rebase.ts', 'engine/restack/restack-replay.ts']);
    const rebaseSource = await readFile(join(sourceRoot, 'engine/rebase.ts'), 'utf8');
    expect(rebaseSource.match(/\^1\^\{tree\}/g)).toHaveLength(1);

    const rebase = ts.createSourceFile('rebase.ts', rebaseSource, ts.ScriptTarget.Latest, true);
    expect(callsNamed(rebase, 'startFeatureReplay').map(enclosingFunction)).toContain('performRebase');
    expect(callsNamed(rebase, 'planFlattenedReplay').map(enclosingFunction)).toEqual(['startFeatureReplay']);
  });

  // Covers: S2.1, task:12
  it('keeps the N=1 two-class flattening of a branch that merged origin/main while stacked mode alone drops it', async () => {
    const subject = await createSweepRepository('restack-merges-n1-sweep-', cleanup);
    const base = await subject.commit('base', 'shared.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feature']);
    const work = await subject.commit('feature work', 'feature.txt', 'feature\n');
    await subject.git(['checkout', '-q', 'main']);
    const d1 = await subject.commit('D1', 'shared.txt', 'D1\n');
    await subject.git(['checkout', '-q', 'feature']);
    await subject.git(['merge', '--no-ff', '-m', 'merge origin/main', 'main']);
    const merge = await subject.rev('HEAD');
    const git = makeGitRunner(subject.repo);

    const plan = await planFlattenedReplay(git, base);

    // The established two-class result: tree(M) differs from tree(M^1), so M flattens.
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries[0]).toEqual({ kind: 'ordinary', sha: work });
    expect(plan.entries[1]).toMatchObject({ kind: 'flattened', mergeSha: merge, firstParent: work, subject: 'merge origin/main' });
    expect(plan.audit).toEqual({ flattenedMerges: [merge], ancestryOnlyMerges: [], sideLineageCount: 1 });
    expect(plan.pairs).toEqual([{ from: merge, to: plan.entries[1]!.sha }]);
    const flattened = plan.entries[1]!.sha;
    expect((await subject.git(['rev-parse', `${flattened}^{tree}`])).stdout).toBe((await subject.git(['rev-parse', `${merge}^{tree}`])).stdout);
    expect((await subject.git(['rev-list', '--parents', '-n', '1', flattened])).stdout.trim()).toBe(`${flattened} ${work}`);
    expect((await subject.git(['show', '-s', '--format=%B', flattened])).stdout).toContain(`Flattened-merge: ${merge}`);

    // The same merge under the stacked rule is ancestry-only (Q=D1 carried, tree is automatic).
    await expect(classifyReplayMerge(git, merge, d1, 'n1')).resolves.toMatchObject({ kind: 'flattened' });
    await expect(classifyReplayMerge(git, merge, d1, 'stacked')).resolves.toMatchObject({ kind: 'ancestry-only' });
  });
});
