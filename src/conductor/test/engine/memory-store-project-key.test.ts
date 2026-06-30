/**
 * Unit tests for `projectKey` cross-project isolation (A12).
 *
 * These are focused unit tests that pin the key derivation contract beyond
 * what the acceptance spec can verify in isolation — specifically that different
 * origin URLs always produce distinct keys (collision avoidance), and that the
 * hash output is filesystem-safe (hex only, bounded length).
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { projectKey } from '../../src/engine/memory-store.js';

const execFile = promisify(execFileCb);

async function makeRepo(base: string, name: string, originUrl: string): Promise<string> {
  const repoPath = join(base, name);
  await mkdir(repoPath, { recursive: true });
  const git = (args: string[]) => execFile('git', args, { cwd: repoPath });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'test@test.com']);
  await git(['config', 'user.name', 'Test']);
  await git(['remote', 'add', 'origin', originUrl]);
  await writeFile(join(repoPath, 'README.md'), `# ${name}\n`);
  await git(['add', 'README.md']);
  await git(['commit', '-q', '-m', 'init']);
  return repoPath;
}

describe('projectKey — cross-project isolation (A12)', () => {
  it('two repos with different origin URLs produce different keys', async () => {
    const base = await mkdtemp(join(tmpdir(), 'pk-iso-'));
    try {
      const alpha = await makeRepo(base, 'alpha', 'https://example.com/alpha.git');
      const beta = await makeRepo(base, 'beta', 'https://example.com/beta.git');

      const ka = await projectKey(alpha);
      const kb = await projectKey(beta);

      expect(ka).not.toBe(kb);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('the key is a hex string of bounded length (filesystem-safe)', async () => {
    const base = await mkdtemp(join(tmpdir(), 'pk-fmt-'));
    try {
      const repo = await makeRepo(base, 'proj', 'https://example.com/proj.git');
      const key = await projectKey(repo);

      expect(key).toMatch(/^[0-9a-f]+$/);
      expect(key.length).toBeLessThanOrEqual(64); // sha256 max is 64 hex chars
      expect(key.length).toBeGreaterThan(0);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('the same project always produces the same key (deterministic)', async () => {
    const base = await mkdtemp(join(tmpdir(), 'pk-det-'));
    try {
      const repo = await makeRepo(base, 'stable', 'https://example.com/stable.git');

      const k1 = await projectKey(repo);
      const k2 = await projectKey(repo);

      expect(k1).toBe(k2);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
