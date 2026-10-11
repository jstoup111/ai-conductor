// Covers: task:19
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { applyRestackTransition } from '../../../src/engine/restack/restack-transition.js';
import { parseCommitSha, parseRefName } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => rm(repository, { recursive: true, force: true })));
});

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

async function fixture() {
  const repository = await mkdtemp(join(tmpdir(), 'restack-translate-'));
  repositories.push(repository);
  const git = (args: string[]) => execFile('git', args, { cwd: repository });
  const commit = async (message: string, file: string, contents: string) => {
    await writeFile(join(repository, file), contents);
    await git(['add', file]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack translation']);
  await writeFile(join(repository, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  const base = await commit('base', 'base.txt', 'base\n');

  await git(['checkout', '-qb', 'feat/c1/demo']);
  const oldChildOne = await commit('child one', 'one.txt', 'one\n');
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const oldChildTwo = await commit('child two', 'two.txt', 'two\n');

  await git(['checkout', '-q', 'main']);
  const advancedBase = await commit('advance base', 'advanced.txt', 'advanced\n');
  await git(['checkout', '-q', 'feat/c1/demo']);
  await git(['rebase', '-q', 'main']);
  const newChildOne = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['checkout', '-q', 'feat/c2/demo']);
  await git(['rebase', '-q', '--onto', newChildOne, oldChildOne]);
  const newChildTwo = (await git(['rev-parse', 'HEAD'])).stdout.trim();

  const childOne = parseChildId(1)!;
  const childTwo = parseChildId(2)!;
  const pipeline = join(repository, '.pipeline');
  const closedPipeline = join(pipeline, 'children', '1');
  const activePipeline = join(pipeline, 'children', '2');
  await mkdir(closedPipeline, { recursive: true });
  await mkdir(activePipeline, { recursive: true });
  await writeFile(join(pipeline, 'current-task'), 'T3\n');
  await writeFile(join(pipeline, 'task-evidence.json'), JSON.stringify({
    evidenceStamps: {
      T1: { sha: oldChildOne, citedShas: [oldChildOne, oldChildTwo], verdictAnchor: oldChildTwo },
    },
  }));
  await writeFile(join(pipeline, 'task-status.json'), JSON.stringify({
    tasks: [{ id: 'T1', status: 'completed', commit: oldChildOne.slice(0, 7) }, { id: 'T3', status: 'in_progress', commit: oldChildTwo }],
  }));
  await writeFile(join(pipeline, 'test-suite-evidence.json'), JSON.stringify({
    outcome: 'PASS', provenanceHeadSha: oldChildTwo, driftLedger: [{ headSha: oldChildOne }],
  }));
  await writeFile(join(closedPipeline, 'task-evidence.json'), JSON.stringify({
    evidenceStamps: { closed: { sha: oldChildOne } },
  }));
  await writeFile(join(activePipeline, 'task-evidence.json'), JSON.stringify({
    evidenceStamps: { active: { sha: oldChildTwo, verdictAnchor: oldChildTwo } },
  }));
  await writeFile(join(activePipeline, 'task-status.json'), JSON.stringify({
    tasks: [{ id: 'T3', status: 'in_progress', commit: oldChildTwo }],
  }));
  await writeFile(join(activePipeline, 'test-suite-evidence.json'), JSON.stringify({
    outcome: 'PASS', provenanceHeadSha: oldChildTwo,
  }));

  return {
    repository, base, advancedBase, oldChildOne, oldChildTwo, newChildOne, newChildTwo, childOne, childTwo,
  };
}

describe('restack translation', () => {
  it('uses each child range, translates the flat and active stores, and preserves closed state and current-task', async () => {
    const subject = await fixture();
    const pipeline = join(subject.repository, '.pipeline');
    const closedStore = join(pipeline, 'children', '1', 'task-evidence.json');
    const closedBefore = await readFile(closedStore, 'utf8');

    await applyRestackTransition({
      worktree: subject.repository,
      cause: 'base-refresh',
      newDefault: parseCommitSha(subject.advancedBase)!,
      activeChild: subject.childTwo,
      ranges: [
        { child: subject.childOne, oldParent: parseCommitSha(subject.base)!, oldTip: parseCommitSha(subject.oldChildOne)!, kind: 'closed' },
        { child: subject.childTwo, oldParent: parseCommitSha(subject.oldChildOne)!, oldTip: parseCommitSha(subject.oldChildTwo)!, kind: 'active' },
      ],
      moves: [
        { ref: parseRefName('refs/heads/feat/c1/demo')!, child: subject.childOne, oldSha: parseCommitSha(subject.oldChildOne)!, newSha: parseCommitSha(subject.newChildOne)! },
        { ref: parseRefName('refs/heads/feat/c2/demo')!, child: subject.childTwo, oldSha: parseCommitSha(subject.oldChildTwo)!, newSha: parseCommitSha(subject.newChildTwo)! },
      ],
      git: makeGitRunner(subject.repository),
    });

    const rewrites = await readJson(join(pipeline, 'rebase-rewrites.json'));
    expect(rewrites[subject.oldChildOne]).toBe(subject.newChildOne);
    expect(rewrites[subject.oldChildTwo]).toBe(subject.newChildTwo);
    expect(rewrites[subject.base]).toBeUndefined();
    expect(rewrites[subject.advancedBase]).toBeUndefined();

    const flatEvidence = await readJson(join(pipeline, 'task-evidence.json'));
    expect(flatEvidence.evidenceStamps).toMatchObject({
      T1: { sha: subject.newChildOne, citedShas: [subject.newChildOne, subject.newChildTwo], verdictAnchor: subject.newChildTwo },
    });
    const flatStatus = await readJson(join(pipeline, 'task-status.json'));
    expect(flatStatus.tasks).toMatchObject([
      { commit: subject.newChildOne.slice(0, 7) },
      { commit: subject.newChildTwo },
    ]);
    expect(await readJson(join(pipeline, 'test-suite-evidence.json'))).toMatchObject({
      provenanceHeadSha: subject.newChildTwo,
      driftLedger: [{ headSha: subject.newChildOne }],
    });

    const activeEvidence = await readJson(join(pipeline, 'children', '2', 'task-evidence.json'));
    expect(activeEvidence.evidenceStamps).toMatchObject({ active: { sha: subject.newChildTwo, verdictAnchor: subject.newChildTwo } });
    expect(await readJson(join(pipeline, 'children', '2', 'task-status.json'))).toMatchObject({ tasks: [{ commit: subject.newChildTwo }] });
    expect(await readJson(join(pipeline, 'children', '2', 'test-suite-evidence.json'))).toMatchObject({ provenanceHeadSha: subject.newChildTwo });
    await expect(readFile(closedStore, 'utf8')).resolves.toBe(closedBefore);
    await expect(readFile(join(pipeline, 'current-task'), 'utf8')).resolves.toBe('T3\n');
  });
});
