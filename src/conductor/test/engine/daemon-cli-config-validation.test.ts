import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDaemonMode } from '../../src/daemon-cli.js';

const workDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(workDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('runDaemonMode configuration validation', () => {
  it('surfaces a non-missing config error before dispatch', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-config-validation-'));
    workDirs.push(projectRoot);
    await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
    await writeFile(
      join(projectRoot, '.ai-conductor', 'config.yml'),
      'llm_provider: []\n',
      'utf8',
    );
    const discover = vi.fn(async () => []);

    let errorMessage: string | undefined;
    try {
      await runDaemonMode({
        projectRoot,
        concurrency: 1,
        baseBranch: 'main',
        ensureFresh: async () => {},
        workSource: { discover },
        watch: false,
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect({ errorMessage, dispatchCount: discover.mock.calls.length }).toEqual({
      errorMessage: expect.stringMatching(/config.*llm_provider.*non-empty/i),
      dispatchCount: 0,
    });
  });
});
