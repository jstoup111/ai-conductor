// Covers: task:5
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listExecutorRecords,
  removeExecutorRecord,
  sweepExecutorRecordsOnBoot,
  writeExecutorRecord,
} from '../../src/engine/executor-records.js';

const engineDir = '/fixtures/dist-versions/v1';
const startedAt = '2026-10-19T12:00:00.000Z';

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'executor-records-'));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

function executorRecord(pid: number, version = 'v1') {
  return {
    pid,
    engineDir,
    engineVersionId: version,
    startedAt,
  };
}

function recordPath(slug: string): string {
  return join(repoRoot, '.daemon', 'executors', `${slug}.json`);
}

describe('executor reference records', () => {
  it('atomically publishes and removes the four-field record', async () => {
    const first = executorRecord(101);
    const replacement = executorRecord(202, 'v2');

    await writeExecutorRecord(repoRoot, 'feature-a', first);
    await writeExecutorRecord(repoRoot, 'feature-a', replacement);

    expect(JSON.parse(await readFile(recordPath('feature-a'), 'utf8'))).toEqual(replacement);
    expect(await readdir(join(repoRoot, '.daemon', 'executors'))).toEqual(['feature-a.json']);

    await removeExecutorRecord(repoRoot, 'feature-a');

    await expect(readFile(recordPath('feature-a'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps a corrupt sibling visible as a typed unreadable record', async () => {
    await writeExecutorRecord(repoRoot, 'healthy', executorRecord(101));
    await mkdir(join(repoRoot, '.daemon', 'executors'), { recursive: true });
    await writeFile(recordPath('corrupt'), '{not json', 'utf8');

    await expect(listExecutorRecords(repoRoot)).resolves.toEqual([
      { kind: 'unreadable', slug: 'corrupt' },
      { kind: 'record', slug: 'healthy', record: executorRecord(101) },
    ]);
  });

  it('sweeps dead records and only terminates a live pid after its executor command matches', async () => {
    await writeExecutorRecord(repoRoot, 'dead', executorRecord(101));
    await writeExecutorRecord(repoRoot, 'matching', executorRecord(202));
    await writeExecutorRecord(repoRoot, 'foreign', executorRecord(303));
    const processCalls: string[] = [];
    const isPidAlive = vi.fn((pid: number) => pid !== 101);
    const readCommandLine = vi.fn(async (pid: number) => {
      processCalls.push(`read:${pid}`);
      if (pid === 202) return `node ${engineDir}/index.js executor-child`;
      return 'node /usr/local/bin/unrelated-worker';
    });
    const kill = vi.fn(async (pid: number, _signal: NodeJS.Signals) => {
      processCalls.push(`kill:${pid}`);
    });

    await sweepExecutorRecordsOnBoot(repoRoot, { isPidAlive, readCommandLine, kill });

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(202, 'SIGTERM');
    expect(readCommandLine).toHaveBeenCalledWith(202);
    expect(readCommandLine).toHaveBeenCalledWith(303);
    expect(processCalls.indexOf('read:202')).toBeLessThan(processCalls.indexOf('kill:202'));
    await expect(listExecutorRecords(repoRoot)).resolves.toEqual([]);
  });
});
