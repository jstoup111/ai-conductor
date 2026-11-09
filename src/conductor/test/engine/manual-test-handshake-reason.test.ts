// Covers: task:5
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const dirs: string[] = [];

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'manual-test-handshake-'));
  dirs.push(dir);
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  return dir;
}

function handshakeFor(projectRoot: string) {
  const conductor = new Conductor({
    projectRoot,
    stateFilePath: join(projectRoot, '.pipeline', 'state.json'),
    stepRunner: { run: vi.fn() } as never,
    events: new ConductorEventEmitter(),
  });
  return (conductor as unknown as {
    verdictDispatchHandshake: (
      step: StepName,
      runId: string,
      startedAt: number,
    ) => Promise<{
      done: false;
      routeClass: 'absent';
      retrySignal?: string;
      reason: string;
    } | undefined>;
  }).verdictDispatchHandshake.bind(conductor);
}

async function writeRunStamp(dir: string, runId: string): Promise<void> {
  await writeFile(
    join(dir, '.pipeline', 'manual-test-code-stamp.json'),
    JSON.stringify({ runId }) + '\n',
    'utf8',
  );
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('manual_test current-output handshake reason', () => {
  it('reports that this attempt wrote no results when this-run results predate dispatch', async () => {
    const dir = await fixtureDir();
    const resultsPath = join(dir, '.pipeline', 'manual-test-results.md');
    const lastWritten = new Date(Date.now() - 60 * 60 * 1000);
    await writeFile(resultsPath, '## Attempt 1\n', 'utf8');
    await utimes(resultsPath, lastWritten, lastWritten);
    await writeRunStamp(dir, 'current-run');

    const result = await handshakeFor(dir)('manual_test', 'current-run', Date.now());

    expect(result).toMatchObject({ done: false, routeClass: 'absent' });
    expect(result?.reason).toMatch(/^no results written this attempt/);
    expect(result?.reason).toContain('.pipeline/manual-test-results.md');
    expect(result?.reason).toContain(lastWritten.toISOString());
    expect(result?.reason).not.toContain('stale');
    expect(result?.reason).not.toContain('expected run id');
  });

  it('reports that this attempt wrote no results when the results file is missing', async () => {
    const dir = await fixtureDir();
    await writeRunStamp(dir, 'current-run');

    const result = await handshakeFor(dir)('manual_test', 'current-run', Date.now());

    expect(result).toMatchObject({ done: false, routeClass: 'absent' });
    expect(result?.reason).toMatch(/^no results written this attempt/);
    expect(result?.reason).toContain('.pipeline/manual-test-results.md is missing');
  });

  it('retains identity mismatch facets when stale results belong to another run', async () => {
    const dir = await fixtureDir();
    const resultsPath = join(dir, '.pipeline', 'manual-test-results.md');
    const lastWritten = new Date(Date.now() - 60 * 60 * 1000);
    await writeFile(resultsPath, '## Attempt 1\n', 'utf8');
    await utimes(resultsPath, lastWritten, lastWritten);
    await writeRunStamp(dir, 'other-run');

    const result = await handshakeFor(dir)('manual_test', 'current-run', Date.now());

    expect(result).toMatchObject({
      done: false,
      routeClass: 'absent',
      retrySignal: 'stale-run-identity',
    });
    expect(result?.reason).toMatch(/^no results written this attempt/);
    expect(result?.reason).toContain('.pipeline/manual-test-results.md');
    expect(result?.reason).toContain(lastWritten.toISOString());
    expect(result?.reason).toContain('expected run id current-run');
    expect(result?.reason).toContain('found run id other-run');
  });

  it('accepts fresh results stamped for this run', async () => {
    const dir = await fixtureDir();
    const dispatchStartedAt = Date.now();
    await writeFile(join(dir, '.pipeline', 'manual-test-results.md'), '## Attempt 1\n', 'utf8');
    await writeRunStamp(dir, 'current-run');

    await expect(handshakeFor(dir)('manual_test', 'current-run', dispatchStartedAt)).resolves.toBeUndefined();
  });
});
