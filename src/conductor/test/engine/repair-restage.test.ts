// Covers: task:12
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { admitAndRestageRepair } from '../../src/engine/repair-restage.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';

describe('admitAndRestageRepair', () => {
  let dir: string;
  let planPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'repair-restage-test-'));
    planPath = join(dir, '.docs/plans/active.md');
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(planPath, [
      '# Plan',
      '',
      '### Task 1: Bound repair',
      '',
      '### Task 2: Unrelated work',
      '',
    ].join('\n'));
    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({
      tasks: [
        { id: '1', status: 'completed' },
        { id: '2', status: 'completed' },
      ],
    }));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('records coverage_binding authority, restages only bound rows, and charges its gate once across replay', async () => {
    const input = {
      projectRoot: dir,
      planPath,
      taskIds: ['1'],
      findingIds: ['amendment-1'],
      sourceAuthority: 'coverage_binding',
      instruction: 'Reconcile the contradicted task with the approved amendment.',
      gates: ['coverage_binding'],
    };

    const admitted = await admitAndRestageRepair(input);

    expect(admitted).toMatchObject({ kind: 'restaged', replayed: false });
    expect(admitted.kind === 'restaged' && admitted.obligation.source).toMatchObject({
      findingId: 'amendment-1',
      authority: 'coverage_binding',
    });
    await expect(readTaskStatuses(dir)).resolves.toEqual({ '1': 'pending', '2': 'completed' });
    await expect(readKickbackLedger(dir)).resolves.toMatchObject({
      gates: { coverage_binding: { laps: 1 } },
    });

    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({
      tasks: [{ id: '1', status: 'completed' }, { id: '2', status: 'completed' }],
    }));
    const replayed = await admitAndRestageRepair(input);

    expect(replayed).toMatchObject({ kind: 'restaged', replayed: true });
    await expect(readTaskStatuses(dir)).resolves.toEqual({ '1': 'pending', '2': 'completed' });
    await expect(readKickbackLedger(dir)).resolves.toMatchObject({
      gates: { coverage_binding: { laps: 1 } },
    });
  });

  it('does not replay a different coverage-binding claim that binds the same task on the same HEAD', async () => {
    const shared = {
      projectRoot: dir,
      planPath,
      taskIds: ['1'],
      sourceAuthority: 'coverage_binding',
      instruction: 'Reconcile the contradicted task with the approved amendment.',
      gates: ['coverage_binding'],
    };

    const first = await admitAndRestageRepair({ ...shared, findingIds: ['claim-digest-a'] });
    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({
      tasks: [{ id: '1', status: 'completed' }, { id: '2', status: 'completed' }],
    }));
    const second = await admitAndRestageRepair({ ...shared, findingIds: ['claim-digest-b'] });

    expect(first).toMatchObject({ kind: 'restaged', replayed: false });
    expect(second).toMatchObject({ kind: 'restaged', replayed: false });
    await expect(readTaskStatuses(dir)).resolves.toEqual({ '1': 'pending', '2': 'completed' });
    await expect(readKickbackLedger(dir)).resolves.toMatchObject({
      gates: { coverage_binding: { laps: 2 } },
    });
  });
});

async function readTaskStatuses(projectRoot: string): Promise<Record<string, string | undefined>> {
  const file = JSON.parse(await readFile(join(projectRoot, '.pipeline/task-status.json'), 'utf8')) as {
    tasks: Array<{ id: string; status?: string }>;
  };
  return Object.fromEntries(file.tasks.map((task) => [task.id, task.status]));
}
