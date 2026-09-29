// Covers: task:8
//
// CLI boundary coverage: invoke the real source entry point from a consumer
// project, while keeping its filesystem isolated in a temporary local repo.

import { afterEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function runWithConstraint(projectVersion?: string) {
  const root = await mkdtemp(join(tmpdir(), 'cli-harness-version-gate-'));
  roots.push(root);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), 'harness_version: "^99.0.0"\n');
  if (projectVersion) await writeFile(join(root, 'VERSION'), `${projectVersion}\n`);

  return execa(
    process.execPath,
    ['--import', 'tsx', join(process.cwd(), 'src', 'index.ts'), 'inline', 'test feature'],
    { cwd: root, reject: false, all: true },
  );
}

describe('CLI harness version gate', () => {
  it.each([undefined, '99.0.0'])('rejects ^99.0.0 even when the project VERSION is %s', async (projectVersion) => {
    const result = await runWithConstraint(projectVersion);

    expect({ exitCode: result.exitCode, output: result.all }).toEqual({
      exitCode: 1,
      output: expect.stringMatching(/Config error: Harness version.*does not satisfy constraint \^99\.0\.0/is),
    });
  });
});
