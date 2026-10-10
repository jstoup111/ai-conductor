// Covers: task:21
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { recordAppendedRemediationTaskIds } from '../../src/engine/artifacts.js';
import { parseChildId } from '../../src/engine/child-context.js';

const temporaryDirectories: string[] = [];

async function createProjectRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'remediation-task-child-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('remediation task child attribution', () => {
  it('records appended remediation ids beside their active child', async () => {
    const projectRoot = await createProjectRoot();
    const child = parseChildId(2);
    if (child === undefined) throw new Error('fixture child must be valid');

    await recordAppendedRemediationTaskIds(projectRoot, ['rem-1'], child);

    await expect(readFile(join(projectRoot, '.pipeline', 'engine-state.json'), 'utf8'))
      .resolves.toBe(`${JSON.stringify({
        appendedRemediationTaskIds: ['rem-1'],
        appendedRemediationTaskChildren: { 'rem-1': 2 },
      }, null, 2)}\n`);
  });

  it('preserves the legacy engine-state shape when no child is active', async () => {
    const projectRoot = await createProjectRoot();

    await recordAppendedRemediationTaskIds(projectRoot, ['rem-1']);

    await expect(readFile(join(projectRoot, '.pipeline', 'engine-state.json'), 'utf8'))
      .resolves.toBe(`${JSON.stringify({ appendedRemediationTaskIds: ['rem-1'] }, null, 2)}\n`);
  });
});
