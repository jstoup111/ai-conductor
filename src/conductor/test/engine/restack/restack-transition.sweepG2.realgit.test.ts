import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CHILD_REGION_STEPS, parseChildId, type ChildId } from '../../../src/engine/child-context.js';
import { resolveActiveChild } from '../../../src/engine/child-cursor.js';
import { readVerdict, writeVerdict, type GateVerdict } from '../../../src/engine/gate-verdicts.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { createSweepRepository, removeAll, sealStack, type SweepRepository } from './restack-sweepG2-fixture.js';

const cleanup: string[] = [];
const passed: GateVerdict = { satisfied: true, checkedAt: 1, reason: 'passed' };

afterEach(async () => {
  await removeAll(cleanup);
});

async function writeJson(repo: string, path: string, value: unknown): Promise<void> {
  await mkdir(join(repo, path, '..'), { recursive: true });
  await writeFile(join(repo, path), JSON.stringify(value));
}

/** Durable judge identities bound to `judgedHead`, in the flat and the given child store. */
async function seedJudgedEvidence(repo: string, judgedHead: string, child: ChildId): Promise<void> {
  for (const store of ['.pipeline', `.pipeline/children/${child}`]) {
    await writeJson(repo, `${store}/build-review.json`, { codeStamp: judgedHead, lapId: `lap-${child}` });
    await writeJson(repo, `${store}/test-suite-evidence.json`, { outcome: 'PASS', provenanceHeadSha: judgedHead });
  }
  await writeJson(repo, `.pipeline/children/${child}/conduct-state.json`, { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' });
  for (const gate of CHILD_REGION_STEPS) await writeVerdict(repo, gate, passed, child);
}

function recordingGit(repo: string): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const native = makeGitRunner(repo);
  return { calls, git: async (args, options) => { calls.push([...args]); return native(args, options); } };
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

/** Three positions: closed child 1, closed child 2, and the checked-out active leaf. */
async function repairableStack(): Promise<SweepRepository & { oldLeaf: string }> {
  const subject = await createSweepRepository('restack-transition-sweep-', cleanup);
  await subject.write('.docs/stories/demo.md', 'Story\n');
  await subject.write('docs/notes.md', 'notes\n');
  await subject.git(['add', '.docs/stories/demo.md', 'docs/notes.md']);
  await subject.commit('base', 'src/base.ts', 'export const base = 1;\n');
  await subject.git(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await subject.commit('C1', 'src/one.ts', 'export const one = 1;\n');
  await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await subject.git(['checkout', '-qb', 'feat/c2/demo']);
  const c2 = await subject.commit('C2', 'src/two.ts', 'export const two = 2;\n');
  await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
  const oldLeaf = await subject.commit('L1', 'src/leaf.ts', 'export const leaf = 3;\n');
  await sealStack(subject.repo);
  return { ...subject, oldLeaf };
}

describe('restack verdict transition sweep (real local Git)', () => {
  // Covers: S11.5, S11.6, task:18
  it('invalidates the whole-feature and leaf gates whose inputs a feature-repair commit X touches while the default is unchanged, and keeps them passed when X touches no gate input', async () => {
    const leaf = parseChildId(3)!;
    const outcomes: Record<string, Record<string, boolean | undefined>> = {};
    for (const [scenario, path, content] of [
      ['inputs', '.docs/stories/demo.md', 'Story, repaired\n'],
      ['outside', 'docs/notes.md', 'notes, repaired\n'],
    ] as const) {
      const subject = await repairableStack();
      const defaultTip = await subject.rev('main');
      await writeJson(subject.repo, '.pipeline/conduct-state.json', { coverage_binding: 'done' });
      await writeJson(subject.repo, '.pipeline/coverage-binding-code-stamp.json', { codeStamp: subject.oldLeaf, runId: 'run-1' });
      await writeVerdict(subject.repo, 'coverage_binding', passed);
      await seedJudgedEvidence(subject.repo, subject.oldLeaf, leaf);
      await subject.git(['checkout', '-q', 'feat/c1/demo']);
      await subject.commit('X', path, content);
      if (scenario === 'inputs') await subject.commit('X code', 'src/one.ts', 'export const one = 10;\n');
      await subject.git(['checkout', '-q', 'feat/daemon-demo']);

      await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo) }))
        .resolves.toMatchObject({ kind: 'applied' });

      expect(await subject.rev('main')).toBe(defaultTip);
      outcomes[scenario] = {
        coverage_binding: (await readVerdict(subject.repo, 'coverage_binding'))?.satisfied,
        build_review: (await readVerdict(subject.repo, 'build_review', leaf))?.satisfied,
        ...(scenario === 'inputs' ? { test_suite: (await readVerdict(subject.repo, 'test_suite', leaf))?.satisfied } : {}),
      };
    }

    // The path-scoped gates follow X's paths alone, with the default unmoved.
    // (test_suite's aggregate proof is tree-exact and is not path-scoped, so
    // only its invalidation is asserted here.)
    expect(outcomes).toEqual({
      inputs: { coverage_binding: false, build_review: false, test_suite: false },
      outside: { coverage_binding: true, build_review: true },
    });
  });

  // Covers: S11.8, task:18
  it('re-judges a feature repair against the unchanged old default tip and never fetches origin/main', async () => {
    const subject = await repairableStack();
    const oldDefault = await subject.rev('main');
    await writeJson(subject.repo, '.pipeline/conduct-state.json', {});
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    const repaired = await subject.commit('X', 'src/one.ts', 'export const one = 10;\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    const boundary = recordingGit(subject.repo);

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: boundary.git }))
      .resolves.toMatchObject({ kind: 'applied' });

    const newLeaf = await subject.rev('feat/daemon-demo');
    expect(await subject.rev('main')).toBe(oldDefault);
    expect(boundary.calls.filter((args) => args.includes('fetch') || args.includes('ls-remote') || args.includes('origin/main'))).toEqual([]);
    // Whole-feature tuple: B = merge-base(old c1, old default), O = old default.
    expect(boundary.calls).toContainEqual(['merge-base', repaired, oldDefault]);
    expect((await readVerdict(subject.repo, 'rebase'))?.rebaseOperation).toMatchObject({
      cause: 'feature-repair',
      replay: { preRebaseHead: subject.oldLeaf, mergeBase: oldDefault, target: oldDefault, completedHead: newLeaf },
    });
  });

  // Covers: S11.3, S11.9, task:18
  it('leaves closed child 1 verdicts and closure byte-identical, reports its would-invalidate gates, and never reselects child 1', async () => {
    const subject = await createSweepRepository('restack-closed-transition-sweep-', cleanup);
    await subject.commit('base', 'src/base.ts', 'export const base = 1;\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const c1 = await subject.commit('C1', 'src/one.ts', 'export const one = 1;\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    await subject.commit('C2', 'src/two.ts', 'export const two = 2;\n');
    await subject.git(['checkout', '-q', 'main']);
    const advanced = await subject.commit('upstream code', 'src/upstream.ts', 'export const upstream = 1;\n');
    await subject.git(['checkout', '-q', 'feat/c2/demo']);
    await sealStack(subject.repo);
    const closedChild = parseChildId(1)!;
    await writeJson(subject.repo, '.pipeline/children/1/conduct-state.json', { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' });
    await writeJson(subject.repo, '.pipeline/children/1/build-review.json', { codeStamp: c1, lapId: 'lap-1' });
    await writeJson(subject.repo, '.pipeline/children/1/test-suite-evidence.json', { outcome: 'PASS', provenanceHeadSha: c1 });
    for (const gate of CHILD_REGION_STEPS) await writeVerdict(subject.repo, gate, passed, closedChild);
    const cursorBefore = await resolveActiveChild(subject.repo, 'demo');
    expect(cursorBefore).toMatchObject({ kind: 'active', child: 2, position: 2 });
    const before = await snapshot(join(subject.repo, '.pipeline', 'children', '1'));
    const events = new ConductorEventEmitter();
    const applied: Array<{ child: number; wouldInvalidate: string[] }> = [];
    events.on('restack_applied', (event) => { applied.push(event as unknown as { child: number; wouldInvalidate: string[] }); });

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, events, git: makeGitRunner(subject.repo) }))
      .resolves.toMatchObject({ kind: 'applied' });

    // The closed child moved, but its stores are untouched.
    expect(await subject.rev('refs/conductor/demo/closed/c1')).not.toBe(c1);
    expect(await subject.rev('refs/conductor/demo/closed/c1')).toBe(await subject.rev('feat/c1/demo'));
    expect(await snapshot(join(subject.repo, '.pipeline', 'children', '1'))).toEqual(before);
    const childOne = applied.find((event) => event.child === 1);
    expect(childOne?.wouldInvalidate).toEqual(['test_suite']);
    // Continuing the feature selects only child 2's region; every gate of
    // child 1, including those it would invalidate, stays passed and closed.
    expect(await resolveActiveChild(subject.repo, 'demo')).toEqual(cursorBefore);
    for (const gate of CHILD_REGION_STEPS) {
      expect(await readVerdict(subject.repo, gate, closedChild)).toEqual(passed);
    }
  });
});
