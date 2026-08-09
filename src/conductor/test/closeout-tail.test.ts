import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CloseoutTailReader } from '../src/engine/closeout-tail.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, {
      recursive: true,
      force: true,
    })),
  );
});

async function createProjectRoot(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'closeout-tail-'));
  directories.push(projectRoot);
  return projectRoot;
}

describe('CloseoutTailReader', () => {
  it('treats an absent sibling ledger as no new events', async () => {
    const reader = new CloseoutTailReader(await createProjectRoot());

    await expect(reader.read()).resolves.toEqual([]);
  });

  it('emits complete lines once and retains a partial trailing record until it ends in a newline', async () => {
    const projectRoot = await createProjectRoot();
    const ledger = join(projectRoot, '.pipeline/pipeline-events.jsonl');
    const completed = {
      type: 'pipeline_closeout',
      obligation: 'evaluator',
      startedAt: 100,
      endedAt: 140,
      ts: 140,
    } as const;
    const partial = {
      type: 'pipeline_closeout',
      obligation: 'summary',
      startedAt: 150,
      endedAt: 180,
      ts: 180,
    } as const;
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(
      ledger,
      `${JSON.stringify(completed)}\n${JSON.stringify(partial)}`,
      { encoding: 'utf8', flush: true },
    );
    const reader = new CloseoutTailReader(projectRoot);

    await expect(reader.read()).resolves.toEqual([completed]);
    await expect(reader.read()).resolves.toEqual([]);

    await appendFile(ledger, '\n', 'utf8');

    await expect(reader.read()).resolves.toEqual([partial]);
    await expect(reader.read()).resolves.toEqual([]);
  });
});
