// Covers: task:2
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readTaskDigests,
  recordTaskDigests,
} from '../../src/engine/task-digests.js';

const temporaryDirectories: string[] = [];

async function createProjectRoot(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'task-digests-'));
  temporaryDirectories.push(projectRoot);
  await mkdir(join(projectRoot, '.pipeline'));
  return projectRoot;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('task digests', () => {
  it('round-trips one plan digest map without changing sibling repair state', async () => {
    const projectRoot = await createProjectRoot();
    const statePath = join(projectRoot, '.pipeline', 'engine-state.json');
    const repairObligations = {
      version: 1,
      records: { repair: { preserved: true } },
      currentByPlan: {},
      admissionsByPlan: {},
    };
    await writeFile(statePath, JSON.stringify({ repairObligations }, null, 2));

    await recordTaskDigests(projectRoot, '.docs/plans/current.md', {
      '1': 'v1:sha256:first',
      '2': 'v1:sha256:second',
    });

    await expect(readTaskDigests(projectRoot, '.docs/plans/current.md')).resolves.toEqual({
      kind: 'present',
      digests: { '1': 'v1:sha256:first', '2': 'v1:sha256:second' },
    });
    await expect(readFile(statePath, 'utf8')).resolves.toSatisfy((raw) => {
      expect(JSON.parse(raw).repairObligations).toEqual(repairObligations);
      return true;
    });
  });

  it('distinguishes absent task digests from incompatible stored sections', async () => {
    const projectRoot = await createProjectRoot();
    const statePath = join(projectRoot, '.pipeline', 'engine-state.json');

    await expect(readTaskDigests(projectRoot, '.docs/plans/current.md')).resolves.toEqual({
      kind: 'absent',
    });

    await writeFile(statePath, JSON.stringify({ taskDigests: { version: 2, byPlan: {} } }));
    await expect(readTaskDigests(projectRoot, '.docs/plans/current.md')).resolves.toMatchObject({
      kind: 'incompatible',
      message: expect.any(String),
    });

    await writeFile(statePath, JSON.stringify({
      taskDigests: { version: 1, byPlan: { '.docs/plans/current.md': { '1': 1 } } },
    }));
    await expect(readTaskDigests(projectRoot, '.docs/plans/current.md')).resolves.toMatchObject({
      kind: 'incompatible',
      message: expect.any(String),
    });
  });

  it('serializes concurrent digest writes for distinct plans', async () => {
    const projectRoot = await createProjectRoot();

    await Promise.all([
      recordTaskDigests(projectRoot, '.docs/plans/first.md', { '1': 'v1:sha256:first' }),
      recordTaskDigests(projectRoot, '.docs/plans/second.md', { '2': 'v1:sha256:second' }),
    ]);

    await expect(readTaskDigests(projectRoot, '.docs/plans/first.md')).resolves.toEqual({
      kind: 'present', digests: { '1': 'v1:sha256:first' },
    });
    await expect(readTaskDigests(projectRoot, '.docs/plans/second.md')).resolves.toEqual({
      kind: 'present', digests: { '2': 'v1:sha256:second' },
    });
  });
});
