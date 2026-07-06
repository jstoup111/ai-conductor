// Unit: github-issues adapter — report() cwd resolution (#290).
// The adapter must NEVER consult process.cwd() when choosing the working
// directory for a `gh` call. cwd must come from (1) the poll-cache, (2) a
// registry lookup, or (3) os.homedir() — and every candidate must be
// existsSync-checked before use. gh calls always pass -R <owner/repo>, so any
// existing directory is a sufficient cwd.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGithubIssuesAdapter, type GhRunner } from '../../../../src/engine/engineer/intake/github-issues.js';
import { createLedger } from '../../../../src/engine/engineer/intake/ledger.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gh-cwd-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeRecordingGh(): { gh: GhRunner; cwds: string[] } {
  const cwds: string[] = [];
  const gh: GhRunner = async (_args, opts) => {
    cwds.push(opts.cwd);
    return { stdout: '' };
  };
  return { gh, cwds };
}

describe('report() cwd resolution (#290)', () => {
  it('resolves cwd from the registry (no prior poll) and never uses process.cwd()', async () => {
    const repoPath = join(dir, 'o-a');
    await mkdir(repoPath, { recursive: true });
    const otherCwd = join(dir, 'definitely-not-the-real-cwd');

    const { gh, cwds } = makeRecordingGh();
    const registry = { list: async () => [{ name: 'o/a', path: repoPath }] };
    const ledger = createLedger(join(dir, 'ledger.json'));
    const adapter = createGithubIssuesAdapter({ gh, registry, ledger });

    // No poll() call first — the poll-cache is empty, forcing a registry lookup.
    await adapter.report('o/a#1', 'done', { prUrl: 'https://x/pr/9' });

    expect(cwds.length).toBeGreaterThan(0);
    for (const cwd of cwds) {
      expect(cwd).toBe(repoPath);
      expect(existsSync(cwd)).toBe(true);
      expect(cwd).not.toBe(process.cwd());
      expect(cwd).not.toBe(otherCwd);
    }
  });

  it('falls back to os.homedir() when the registry has no matching, existing path', async () => {
    const { homedir } = await import('node:os');
    const { gh, cwds } = makeRecordingGh();
    const registry = { list: async () => [{ name: 'o/a', path: join(dir, 'does-not-exist') }] };
    const ledger = createLedger(join(dir, 'ledger.json'));
    const adapter = createGithubIssuesAdapter({ gh, registry, ledger });

    await adapter.report('o/a#1', 'done', { prUrl: 'https://x/pr/9' });

    expect(cwds.length).toBeGreaterThan(0);
    for (const cwd of cwds) {
      expect(cwd).toBe(homedir());
      expect(existsSync(cwd)).toBe(true);
    }
  });

  it('regression: process.cwd() deleted out from under the daemon does not crash write-back (#290)', async () => {
    const repoPath = join(dir, 'o-a');
    await mkdir(repoPath, { recursive: true });
    const deletedDir = await mkdtemp(join(tmpdir(), 'gh-cwd-deleted-'));

    const originalCwd = process.cwd();
    process.chdir(deletedDir);
    await rm(deletedDir, { recursive: true, force: true });

    try {
      const { gh, cwds } = makeRecordingGh();
      const registry = { list: async () => [{ name: 'o/a', path: repoPath }] };
      const ledger = createLedger(join(dir, 'ledger.json'));
      const adapter = createGithubIssuesAdapter({ gh, registry, ledger });

      await expect(
        adapter.report('o/a#1', 'done', { prUrl: 'https://x/pr/9' })
      ).resolves.not.toThrow();

      expect(cwds.length).toBeGreaterThan(0);
      for (const cwd of cwds) {
        expect(existsSync(cwd)).toBe(true);
        expect(cwd).toBe(repoPath);
      }
    } finally {
      process.chdir(originalCwd);
    }
  });
});
