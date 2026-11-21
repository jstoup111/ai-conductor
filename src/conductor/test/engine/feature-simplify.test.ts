// Covers: task:1, task:2, task:4
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkStepCompletion, type CompletionContext } from '../../src/engine/artifacts.js';
import { buildRetryHint, isNoTaskProgressBuildStall } from '../../src/engine/conductor.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { FEATURE_SIMPLIFY_REQUIRED_PREFIX, recordsCleanFeatureSimplify } from '../../src/engine/feature-simplify.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from './slice-topology-fixture.js';

const filesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

const FEATURE_RECORD = '.pipeline/audit-trail/feature-simplification.md';
const CHILD_2_RECORD = '.pipeline/audit-trail/child-2-simplification.md';

describe('BUILD completion requires a CLEAN whole-feature simplify record', () => {
  let root: string;
  const child2 = parseChildId(2)!;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'feature-simplify-'));
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await mkdir(join(root, '.pipeline', 'audit-trail'), { recursive: true });
    await writeFile(
      join(root, '.docs', 'plans', 'feature.md'),
      ['### Task T1: First', '### Task T2: Second'].join('\n'),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeStatus(rows: Array<{ id: string; status: string }>): Promise<void> {
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: rows }));
  }

  async function resolved(): Promise<void> {
    await writeStatus([
      { id: 'T1', status: 'completed' },
      { id: 'T2', status: 'completed' },
    ]);
  }

  async function writeRecord(path: string, verdict: string): Promise<void> {
    await writeFile(join(root, path), `# Simplification\n\n| # | Category |\n\n## Verdict: ${verdict}\n`);
  }

  function context(extra: CompletionContext = {}): CompletionContext {
    return { projectRoot: root, planPath: join(root, '.docs', 'plans', 'feature.md'), ...extra };
  }

  it('completes a resolved build whose feature record is CLEAN', async () => {
    await resolved();
    await writeRecord(FEATURE_RECORD, 'CLEAN');

    await expect(checkStepCompletion(root, 'build', context())).resolves.toEqual({ done: true });
  });

  it('withholds a resolved build with no record and no build-review verdict, naming the feature record', async () => {
    await resolved();

    const result = await checkStepCompletion(root, 'build', context());
    expect(result.done).toBe(false);
    expect(result.reason?.startsWith(FEATURE_SIMPLIFY_REQUIRED_PREFIX)).toBe(true);
    expect(result.reason).toContain(FEATURE_RECORD);
  });

  it('withholds a resolved build whose record ends SIMPLIFY_REQUIRED', async () => {
    await resolved();
    await writeRecord(FEATURE_RECORD, 'SIMPLIFY_REQUIRED');

    const result = await checkStepCompletion(root, 'build', context());
    expect(result.done).toBe(false);
    expect(result.reason?.startsWith(FEATURE_SIMPLIFY_REQUIRED_PREFIX)).toBe(true);
    expect(result.reason).toContain(FEATURE_RECORD);
  });

  it('gates an active stacked child on its own child record', async () => {
    await writeSliceTopologyFixture(
      root,
      {
        version: 1,
        slug: 'feature',
        runId: 'feature-simplify-test',
        status: 'done',
        entries: [],
        sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: ['first', 'second'] },
      },
      filesystem,
    );
    await resolved();
    // A CLEAN feature-level record does not satisfy a child.
    await writeRecord(FEATURE_RECORD, 'CLEAN');

    const missing = await checkStepCompletion(root, 'build', context({ activeChild: child2 }));
    expect(missing.done).toBe(false);
    expect(missing.reason?.startsWith(FEATURE_SIMPLIFY_REQUIRED_PREFIX)).toBe(true);
    expect(missing.reason).toContain(CHILD_2_RECORD);

    await writeRecord(CHILD_2_RECORD, 'CLEAN');
    await expect(checkStepCompletion(root, 'build', context({ activeChild: child2 }))).resolves.toEqual({ done: true });
  });

  it('treats a feature whose build-review verdict already exists as past its first completion', async () => {
    await resolved();
    await writeFile(join(root, '.pipeline', 'build-review.json'), '{}');

    await expect(checkStepCompletion(root, 'build', context())).resolves.toEqual({ done: true });

    await writeRecord(FEATURE_RECORD, 'CLEAN');
    await expect(checkStepCompletion(root, 'build', context())).resolves.toEqual({ done: true });
  });

  it('keeps an unresolved task reason ahead of the simplify floor', async () => {
    await writeStatus([
      { id: 'T1', status: 'completed' },
      { id: 'T2', status: 'pending' },
    ]);

    const result = await checkStepCompletion(root, 'build', context());
    expect(result.done).toBe(false);
    expect(result.reason).toContain('T2');
    expect(result.reason).not.toContain('whole-feature simplify');
  });

  it('keeps the uncommitted-path reason ahead of the simplify floor', async () => {
    await resolved();

    const result = await checkStepCompletion(
      root,
      'build',
      context({
        worktreeStatus: async () => ' M src/a.ts\n',
      }),
    );
    expect(result.done).toBe(false);
    expect(result.missing).toBe('uncommitted');
    expect(result.reason).not.toContain('whole-feature simplify');
  });

  it('steers the retry to a whole-feature simplify pass over base...HEAD', async () => {
    await resolved();
    const result = await checkStepCompletion(root, 'build', context());

    const hint = buildRetryHint('build', result.reason);
    expect(hint).toContain('`simplify` workflow');
    expect(hint).toContain('whole-feature mode');
    expect(hint).toContain('base...HEAD');
    expect(hint).toContain(FEATURE_RECORD);
    expect(hint).toContain('## Verdict: CLEAN');
  });

  it('exempts the simplify miss from the no-task-progress stall but not a pending-task miss', async () => {
    await resolved();
    const result = await checkStepCompletion(root, 'build', context());
    const counts = { attempt: 2, resolvedTasksBefore: 2, resolvedTasksAfter: 2, headMovedThisAttempt: false };

    expect(isNoTaskProgressBuildStall({ ...counts, completionReason: result.reason })).toBe(false);
    expect(
      isNoTaskProgressBuildStall({
        ...counts,
        completionReason: '1/3 tasks pending/not completed: 2',
      }),
    ).toBe(true);
  });
});

describe('recordsCleanFeatureSimplify', () => {
  it('accepts a CLEAN verdict line with or without trailing counts and rejects other verdicts', () => {
    expect(recordsCleanFeatureSimplify('# x\n\n## Verdict: CLEAN\n')).toBe(true);
    expect(recordsCleanFeatureSimplify('## Verdict: CLEAN (0 must-fix, 2 advisory)')).toBe(true);
    expect(recordsCleanFeatureSimplify('## Verdict: SIMPLIFY_REQUIRED\n')).toBe(false);
    expect(recordsCleanFeatureSimplify('## Verdict: CLEANUP_PENDING\n')).toBe(false);
    expect(recordsCleanFeatureSimplify('text ## Verdict: CLEAN\n')).toBe(false);
  });
});
