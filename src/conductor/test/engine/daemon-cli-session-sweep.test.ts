import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePipelineForDaemonDispatch } from '../../src/engine/daemon-dispatch-preparation.js';

describe('daemon dispatch pipeline preparation', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('preserves the durable run id across restart and redispatch sweeps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-run-id-'));
    tempDirs.push(root);
    const pipelineDir = join(root, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    await writeFile(join(pipelineDir, 'conduct-session-id'), 'stable-run-id');
    await writeFile(join(pipelineDir, 'session-created'), '1');

    await preparePipelineForDaemonDispatch(pipelineDir);
    await writeFile(join(pipelineDir, 'session-created'), '1');
    await preparePipelineForDaemonDispatch(pipelineDir);

    expect({
      runId: await readFile(
        join(pipelineDir, 'conduct-session-id'),
        'utf-8',
      ).catch(() => null),
      providerMarkerExists: existsSync(join(pipelineDir, 'session-created')),
    }).toEqual({
      runId: 'stable-run-id',
      providerMarkerExists: false,
    });
  });
});
