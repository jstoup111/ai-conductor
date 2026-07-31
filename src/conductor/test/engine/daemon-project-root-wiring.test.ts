import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveDaemonProjectRoot } from '../../src/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
  temporaryDirectories.length = 0;
});

describe('daemon project-root wiring', () => {
  it('anchors daemon state at the repository root when launched from a nested package', async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'daemon-project-root-'));
    temporaryDirectories.push(repositoryRoot);
    execFileSync('git', ['init', '-q', repositoryRoot]);

    const nestedPackage = join(repositoryRoot, 'src', 'conductor');
    await mkdir(nestedPackage, { recursive: true });

    await expect(resolveDaemonProjectRoot(nestedPackage)).resolves.toBe(repositoryRoot);
  });

  it('uses the resolved root for both supervised and direct daemon launches', async () => {
    const indexSource = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8');

    expect(indexSource).toMatch(
      /const projectRoot = await resolveDaemonProjectRoot\(process\.cwd\(\)\);\s+const code = await dispatchDaemonSupervisor\(daemonSupervisorCmd, \{ cwd: projectRoot \}\);/,
    );
    expect(indexSource).toMatch(
      /const projectRoot = await resolveDaemonProjectRoot\(process\.cwd\(\)\);\s+const daemonModeOptions = await buildDaemonModeOptions\(projectRoot, daemonCmd\);/,
    );
  });
});
