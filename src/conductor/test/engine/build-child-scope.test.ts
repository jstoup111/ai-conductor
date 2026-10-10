// Covers: task:22
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStepCompletion } from '../../src/engine/artifacts.js';
import {
  writeCoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from '../../src/engine/coverage-binding-envelope.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { countResolvedTasks } from '../../src/engine/task-progress.js';
import { isNoTaskProgressBuildStall } from '../../src/engine/build-progress-watcher.js';

const filesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

describe('build child task scope', () => {
  let root: string;
  const child1 = parseChildId(1)!;
  const child2 = parseChildId(2)!;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'build-child-scope-'));
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await writeFile(join(root, '.docs', 'plans', 'feature.md'), [
      '### Task T1: First',
      '### Task T2: Second',
      '### Task T3: Third',
      '### Task T4: Fourth',
      '### Task rem-1: Remediation',
    ].join('\n'));
    await writeCoverageBindingEnvelope(root, {
      version: 1,
      slug: 'feature',
      runId: 'scope-test',
      status: 'done',
      entries: [],
      sliceMembership: {
        taskSlices: { T1: 1, T2: 1, T3: 2, T4: 2 },
        titles: ['first', 'second'],
      },
    }, filesystem);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeStatus(rows: Array<{ id: string; status: string }>): Promise<void> {
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: rows }));
  }

  function completionContext(child: typeof child1) {
    return {
      projectRoot: root,
      planPath: join(root, '.docs', 'plans', 'feature.md'),
      activeChild: child,
    };
  }

  it('completes child 1 without waiting for pending child 2 tasks', async () => {
    await writeStatus([
      { id: 'T1', status: 'completed' },
      { id: 'T2', status: 'completed' },
      { id: 'T3', status: 'pending' },
      { id: 'T4', status: 'pending' },
      { id: 'rem-1', status: 'pending' },
    ]);

    await expect(checkStepCompletion(root, 'build', completionContext(child1))).resolves.toEqual({ done: true });
  });

  it('names only unresolved child 1 work', async () => {
    await writeStatus([
      { id: 'T1', status: 'completed' },
      { id: 'T2', status: 'pending' },
      { id: 'T3', status: 'pending' },
      { id: 'T4', status: 'pending' },
      { id: 'rem-1', status: 'pending' },
    ]);

    const result = await checkStepCompletion(root, 'build', completionContext(child1));
    expect(result).toMatchObject({ done: false });
    expect(result.reason).toContain('T2');
    expect(result.reason).not.toContain('T3');
    expect(result.reason).not.toContain('T4');
  });

  it('counts only the active child for the no-task-progress stall floor', async () => {
    await writeStatus([
      { id: 'T1', status: 'completed' },
      { id: 'T2', status: 'completed' },
      { id: 'T3', status: 'pending' },
      { id: 'T4', status: 'pending' },
    ]);

    expect(await countResolvedTasks(root, child1)).toBe(2);
    expect(await countResolvedTasks(root, child2)).toBe(0);
    expect(isNoTaskProgressBuildStall({
      attempt: 2,
      resolvedTasksBefore: 0,
      resolvedTasksAfter: 0,
      headMovedThisAttempt: false,
      completionReason: '2/2 tasks pending/not completed: T3, T4',
    })).toBe(true);
    expect(isNoTaskProgressBuildStall({
      attempt: 2,
      resolvedTasksBefore: 0,
      resolvedTasksAfter: 0,
      headMovedThisAttempt: true,
      completionReason: '2/2 tasks pending/not completed: T3, T4',
    })).toBe(false);
  });

  it('includes remediation recorded to the active child and refuses an unowned remediation id', async () => {
    await writeStatus([
      { id: 'T1', status: 'completed' },
      { id: 'T2', status: 'completed' },
      { id: 'T3', status: 'completed' },
      { id: 'T4', status: 'completed' },
      { id: 'rem-1', status: 'pending' },
    ]);
    await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({
      appendedRemediationTaskIds: ['rem-1'],
      appendedRemediationTaskChildren: { 'rem-1': 2 },
    }));

    const pendingRemediation = await checkStepCompletion(root, 'build', completionContext(child2));
    expect(pendingRemediation.reason).toContain('rem-1');
    expect(await countResolvedTasks(root, child2)).toBe(2);

    await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({
      appendedRemediationTaskIds: ['rem-1'],
    }));
    const unownedRemediation = await checkStepCompletion(root, 'build', completionContext(child2));
    expect(unownedRemediation).toMatchObject({ done: false });
    expect(unownedRemediation.reason).toContain('rem-1 has no recorded child');
  });
});
