// Covers: task:18
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { readVerdict, writeVerdict } from '../../../src/engine/gate-verdicts.js';
import { applyRestackTransition } from '../../../src/engine/restack/restack-transition.js';
import { parseCommitSha, parseRefName } from '../../../src/engine/restack/restack-types.js';
import { readState } from '../../../src/engine/state.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function sha(value: string) {
  return parseCommitSha(value.repeat(40).slice(0, 40))!;
}

function move(child: ReturnType<typeof parseChildId> & {}) {
  return {
    ref: parseRefName(`refs/heads/stack/${child}`)!,
    child,
    oldSha: sha('c'),
    newSha: sha('d'),
  };
}

describe('applyRestackTransition', () => {
  it('keeps an unchanged active child region gate in its child store and never writes a flat region verdict', async () => {
    const root = await mkdtemp(join(tmpdir(), 'restack-transition-'));
    directories.push(root);
    const child = parseChildId(2)!;
    await mkdir(join(root, '.pipeline', 'children', '2'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'children', '2', 'conduct-state.json'), JSON.stringify({ build_review: 'done' }));
    await writeVerdict(root, 'build_review', { satisfied: true, checkedAt: 1, reason: 'approved' }, child);

    const git = async (args: string[]) => {
      if (args[0] === 'diff') return { exitCode: 0, stdout: '', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: `${sha('b')}\n`, stderr: '' };
      if (args[0] === 'rev-parse') return { exitCode: 0, stdout: `${sha('a')}\n`, stderr: '' };
      if (args[0] === 'merge-tree') return { exitCode: 0, stdout: `${sha('a')}\n`, stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await applyRestackTransition({
      worktree: root,
      cause: 'base-refresh',
      oldDefault: sha('b'),
      newDefault: sha('b'),
      activeChild: child,
      ranges: [{ child, oldParent: sha('b'), oldTip: sha('c'), kind: 'active' }],
      moves: [move(child)],
      git,
    });

    expect(await readVerdict(root, 'build_review', child)).toMatchObject({ satisfied: true });
    expect(await readVerdict(root, 'build_review')).toBeNull();
  });

  it('does not let an active-child tuple replace a whole-feature verdict', async () => {
    const root = await mkdtemp(join(tmpdir(), 'restack-transition-'));
    directories.push(root);
    const child = parseChildId(2)!;
    await mkdir(join(root, '.pipeline', 'children', '2'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'children', '2', 'conduct-state.json'), JSON.stringify({ build_review: 'done' }));
    await writeVerdict(root, 'build_review', { satisfied: true, checkedAt: 1, reason: 'approved' }, child);
    await writeVerdict(root, 'coverage_binding', { satisfied: true, checkedAt: 1, reason: 'whole feature approved' });

    const git = async (args: string[]) => {
      if (args[0] === 'diff') return { exitCode: 0, stdout: 'src/child.ts\n', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: `${sha('b')}\n`, stderr: '' };
      if (args[0] === 'rev-parse' || args[0] === 'merge-tree') return { exitCode: 0, stdout: `${sha('a')}\n`, stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await applyRestackTransition({
      worktree: root,
      cause: 'base-refresh',
      oldDefault: sha('b'),
      newDefault: sha('b'),
      activeChild: child,
      ranges: [{ child, oldParent: sha('b'), oldTip: sha('c'), kind: 'active' }],
      moves: [move(child)],
      git,
    });

    expect(await readVerdict(root, 'coverage_binding')).toEqual({
      satisfied: true,
      checkedAt: 1,
      reason: 'whole feature approved',
    });
    expect(await readVerdict(root, 'rebase')).toBeNull();
  });

  it('takes active-child build-review provenance from that child store, never flat evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'restack-transition-'));
    directories.push(root);
    const child = parseChildId(2)!;
    await mkdir(join(root, '.pipeline', 'children', '2'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'children', '2', 'conduct-state.json'), JSON.stringify({ build_review: 'done' }));
    await writeFile(join(root, '.pipeline', 'children', '2', 'build-review.json'), JSON.stringify({
      codeStamp: sha('a'),
      lapId: 'child-review',
    }));
    // A flat artifact must never be accepted as the active child review's
    // provenance. Its deliberately incomplete shape would fail identity
    // validation if the projection accidentally read it.
    await writeFile(join(root, '.pipeline', 'build-review.json'), JSON.stringify({ lapId: 'whole-feature-review' }));
    await writeVerdict(root, 'build_review', { satisfied: true, checkedAt: 1, reason: 'approved' }, child);

    const git = async (args: string[]) => {
      if (args[0] === 'diff') {
        const range = args.slice(2).join(' ');
        if (range === `${sha('c')} ${sha('d')}`) return { exitCode: 0, stdout: 'src/upstream.ts\n', stderr: '' };
        if (range === `${sha('b')} ${sha('c')}` || range === `${sha('b')} HEAD`) {
          return { exitCode: 0, stdout: 'src/child.ts\n', stderr: '' };
        }
        if (range === `${sha('a')} ${sha('c')}`) return { exitCode: 0, stdout: 'src/upstream.ts\n', stderr: '' };
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: `${sha('b')}\n`, stderr: '' };
      if (args[0] === 'rev-parse' || args[0] === 'merge-tree') return { exitCode: 0, stdout: `${sha('e')}\n`, stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await applyRestackTransition({
      worktree: root,
      cause: 'base-refresh',
      oldDefault: sha('b'),
      newDefault: sha('b'),
      activeChild: child,
      ranges: [{ child, oldParent: sha('b'), oldTip: sha('c'), kind: 'active' }],
      moves: [move(child)],
      git,
    });

    expect(await readVerdict(root, 'build_review', child)).toMatchObject({ satisfied: true });
    expect(await readVerdict(root, 'build_review')).toBeNull();
  });

  it('reopens the leaf child state when the whole-stack tuple invalidates its region gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'restack-transition-'));
    directories.push(root);
    const leaf = parseChildId(1)!;
    await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({}));
    await writeFile(join(root, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({ build_review: 'done' }));
    await writeVerdict(root, 'build_review', { satisfied: true, checkedAt: 1, reason: 'approved' }, leaf);

    const git = async (args: string[]) => {
      if (args[0] === 'diff') return { exitCode: 0, stdout: 'src/child.ts\n', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: `${sha('b')}\n`, stderr: '' };
      if (args[0] === 'merge-tree') return { exitCode: 0, stdout: `${sha('e')}\n`, stderr: '' };
      if (args[0] === 'rev-parse') return { exitCode: 0, stdout: `${sha('f')}\n`, stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await applyRestackTransition({
      worktree: root,
      cause: 'base-refresh',
      oldDefault: sha('b'),
      newDefault: sha('b'),
      activeChild: parseChildId(2)!,
      ranges: [{ child: leaf, oldParent: sha('b'), oldTip: sha('c'), kind: 'leaf-active' }],
      moves: [move(leaf)],
      git,
    });

    const leafState = await readState(join(root, '.pipeline', 'children', '1', 'conduct-state.json'));
    expect(leafState.ok).toBe(true);
    if (!leafState.ok) throw new Error(leafState.error.message);
    expect(leafState.value).toMatchObject({ build_review: 'pending' });
    expect(await readVerdict(root, 'rebase')).toMatchObject({ satisfied: true });
  });

  it('preserves a closed child build review when an unchanged replay overlaps its paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'restack-transition-'));
    directories.push(root);
    const closed = parseChildId(1)!;
    await writeVerdict(root, 'test_suite', { satisfied: true, checkedAt: 1, reason: 'passed' }, closed);
    await writeVerdict(root, 'build_review', { satisfied: true, checkedAt: 1, reason: 'passed' }, closed);

    const git = async (args: string[]) => {
      if (args[0] === 'diff') {
        return {
          exitCode: 0,
          stdout: 'src/child.ts\n',
          stderr: '',
        };
      }
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: `${sha('b')}\n`, stderr: '' };
      if (args[0] === 'rev-parse' || args[0] === 'merge-tree') return { exitCode: 0, stdout: `${sha('a')}\n`, stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const result = await applyRestackTransition({
      worktree: root,
      cause: 'base-refresh',
      oldDefault: sha('b'),
      newDefault: sha('b'),
      activeChild: parseChildId(2)!,
      ranges: [{ child: closed, oldParent: sha('b'), oldTip: sha('c'), kind: 'closed' }],
      moves: [move(closed)],
      git,
    });

    expect(result.wouldInvalidate.get(closed)).toEqual(['test_suite']);
    expect(await readVerdict(root, 'build_review', closed)).toMatchObject({ satisfied: true });
  });

  it('passes declared document inputs to the whole-stack selective policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'restack-transition-'));
    directories.push(root);
    const leaf = parseChildId(1)!;
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await mkdir(join(root, '.docs', 'stories'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'conduct-state.json'), '{}');
    await writeFile(join(root, '.docs', 'stories', 'demo.md'), 'Story\n');
    await writeVerdict(root, 'coverage_binding', { satisfied: true, checkedAt: 1, reason: 'approved' });

    const git = async (args: string[]) => {
      if (args[0] === 'diff') return { exitCode: 0, stdout: '.docs/stories/demo.md\n', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: `${sha('b')}\n`, stderr: '' };
      if (args[0] === 'rev-parse' || args[0] === 'merge-tree') return { exitCode: 0, stdout: `${sha('a')}\n`, stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await applyRestackTransition({
      worktree: root,
      cause: 'base-refresh',
      oldDefault: sha('b'),
      newDefault: sha('b'),
      activeChild: leaf,
      ranges: [{ child: leaf, oldParent: sha('b'), oldTip: sha('c'), kind: 'leaf-active' }],
      moves: [move(leaf)],
      git,
    });

    expect(await readVerdict(root, 'coverage_binding')).toMatchObject({
      satisfied: false,
      kickback: { from: 'rebase' },
    });
  });

  it('uses the unchanged default supplied by a feature repair for the whole-feature tuple without fetching origin/main', async () => {
    const root = await mkdtemp(join(tmpdir(), 'restack-transition-'));
    directories.push(root);
    const leaf = parseChildId(1)!;
    const oldDefault = sha('a');
    const calls: string[][] = [];
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'conduct-state.json'), '{}');

    const git = async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'diff') return { exitCode: 0, stdout: 'src/child.ts\n', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: `${oldDefault}\n`, stderr: '' };
      if (args[0] === 'rev-parse' || args[0] === 'merge-tree') return { exitCode: 0, stdout: `${sha('e')}\n`, stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await applyRestackTransition({
      worktree: root,
      cause: 'feature-repair',
      oldDefault,
      newDefault: oldDefault,
      activeChild: leaf,
      ranges: [{ child: leaf, oldParent: oldDefault, oldTip: sha('c'), kind: 'leaf-active' }],
      moves: [move(leaf)],
      git,
    });

    expect(calls).toContainEqual(['merge-base', sha('c'), oldDefault]);
    expect(calls.some((args) => args[0] === 'fetch' && args.includes('origin/main'))).toBe(false);
  });
});
