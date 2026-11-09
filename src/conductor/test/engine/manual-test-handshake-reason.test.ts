// Covers: task:5
// Covers: task:6
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
      dispatchOutput?: string,
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

  it('appends a whitespace-normalized agent blocker when no results were written', async () => {
    const dir = await fixtureDir();
    await writeRunStamp(dir, 'current-run');

    const result = await handshakeFor(dir)(
      'manual_test',
      'current-run',
      Date.now(),
      'Manual testing is blocked:\n\n  the app   would not start',
    );

    expect(result?.reason).toContain(
      'agent reported: "Manual testing is blocked: the app would not start"',
    );
  });

  it('appends only the last 600 characters of a long agent blocker', async () => {
    const dir = await fixtureDir();
    const dispatchOutput = Array.from({ length: 2_000 }, (_, index) => String(index % 10)).join('');
    await writeRunStamp(dir, 'current-run');

    const result = await handshakeFor(dir)('manual_test', 'current-run', Date.now(), dispatchOutput);

    expect(result?.reason).toMatch(new RegExp(`agent reported: "…${dispatchOutput.slice(-600)}"$`));
  });

  it.each([undefined, '   '])('reports no final message when no results were written (%j)', async (dispatchOutput) => {
    const dir = await fixtureDir();
    await writeRunStamp(dir, 'current-run');

    const result = await handshakeFor(dir)('manual_test', 'current-run', Date.now(), dispatchOutput);

    expect(result?.reason).toContain('the agent gave no final message');
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

  it('does not append an agent blocker when fresh this-run FAIL results were written', async () => {
    const dir = await fixtureDir();
    const dispatchStartedAt = Date.now();
    await writeFile(
      join(dir, '.pipeline', 'manual-test-results.md'),
      '| Criterion | Result | Evidence |\n| --- | --- | --- |\n| App launches | FAIL | blocked |\n',
      'utf8',
    );
    await writeRunStamp(dir, 'current-run');

    await expect(
      handshakeFor(dir)(
        'manual_test',
        'current-run',
        dispatchStartedAt,
        'Manual testing is blocked: the app would not start',
      ),
    ).resolves.toBeUndefined();
  });
});
