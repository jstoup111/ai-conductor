// Covers: task:20
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { collectOverlaps } from '../../src/engine/engineer/intake/overlap-preflight.js';
import type { RegistryReader } from '../../src/engine/registry.js';

const fixtureRoots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function createFixture(paths: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(process.env.AI_CONDUCTOR_TEST_TMP_ROOT!, 'intake-overlap-known-paths-'));
  fixtureRoots.push(root);
  const repo = join(root, 'repo');
  git(root, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test User');
  for (const path of paths) await writeFile(join(repo, path), 'export const fixture = true;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  return repo;
}

function registry(repo: string): RegistryReader {
  return {
    listProjects: async () => [{
      schemaVersion: 1,
      name: 'fixture',
      path: repo,
      remote: 'https://github.com/acme/app.git',
      status: 'registered',
      registeredAt: '2026-09-30T00:00:00.000Z',
    }],
    getProject: async () => undefined,
  };
}

async function collect(repo: string, title: string, body: string, issueBody: string) {
  return collectOverlaps({
    title,
    body,
    cwd: join(repo, '..', 'caller'),
    repository: 'acme/app',
    registryReader: registry(repo),
    gh: async () => ({ exitCode: 0, stdout: JSON.stringify([{ number: 2, body: issueBody }]), stderr: '' }),
  });
}

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('known-path filtered intake evidence', () => {
  it('drops a path absent from the target base tree and every compared branch before issue comparison', async () => {
    const repo = await createFixture(['helper.ts']);

    const result = await collect(repo, 'gone path', 'Evidence: lib/gone.rb', 'Also lib/gone.rb');

    expect(result.citedPaths).toEqual([]);
    expect(result.issueOverlaps).toEqual([]);
  });

  it('uses exact known paths, never a near-identical filename, for both intake and open issue evidence', async () => {
    const repo = await createFixture(['helper.ts', 'helperx.ts']);

    const result = await collect(repo, 'helper evidence', 'helper.ts', 'helperx.ts');

    expect(result.citedPaths).toEqual(['helper.ts']);
    expect(result.issueOverlaps).toEqual([]);
  });
});
