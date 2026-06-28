import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseSha,
  readBaseSha,
  readPersistedBaseSha,
  writePersistedBaseSha,
  LAST_BASE_SHA_PATH,
} from '../../src/engine/daemon-sha.js';
import type { GitRunner, GitResult } from '../../src/engine/rebase.js';

const SHA = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function fakeGit(
  script: Array<{ match: string[]; result: Partial<GitResult> }>,
): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    for (const entry of script) {
      if (entry.match.every((tok, i) => args[i] === tok)) {
        return {
          exitCode: entry.result.exitCode ?? 0,
          stdout: entry.result.stdout ?? '',
          stderr: entry.result.stderr ?? '',
        };
      }
    }
    return { exitCode: 1, stdout: '', stderr: '' };
  };
  return { git, calls };
}

describe('engine/daemon-sha — parseSha (FR-11)', () => {
  it('returns the 40-hex SHA, trimming trailing newline/space', () => {
    expect(parseSha(`${SHA}\n`)).toBe(SHA);
    expect(parseSha(`  ${SHA}  `)).toBe(SHA);
    expect(parseSha(SHA)).toBe(SHA);
  });

  it('returns null for empty / whitespace', () => {
    expect(parseSha('')).toBeNull();
    expect(parseSha('   \n')).toBeNull();
    expect(parseSha(null)).toBeNull();
    expect(parseSha(undefined)).toBeNull();
  });

  it('returns null for a branch name or non-hex garbage', () => {
    expect(parseSha('main')).toBeNull();
    expect(parseSha('origin/main')).toBeNull();
    expect(parseSha('z'.repeat(40))).toBeNull(); // 40 chars but not hex
  });

  it('returns null for a too-short or too-long SHA', () => {
    expect(parseSha('a'.repeat(39))).toBeNull();
    expect(parseSha('a'.repeat(41))).toBeNull();
    expect(parseSha('abc123')).toBeNull();
  });
});

describe('engine/daemon-sha — readBaseSha (FR-4)', () => {
  it('runs git rev-parse <ref> and returns the parsed SHA', async () => {
    const { git, calls } = fakeGit([
      { match: ['rev-parse', 'origin/main'], result: { stdout: `${SHA}\n` } },
    ]);
    expect(await readBaseSha(git, 'origin/main')).toBe(SHA);
    expect(calls).toContainEqual(['rev-parse', 'origin/main']);
  });

  it('returns null when rev-parse fails (unresolved ref / offline)', async () => {
    const { git } = fakeGit([
      { match: ['rev-parse', 'origin/main'], result: { exitCode: 128, stderr: 'unknown revision' } },
    ]);
    expect(await readBaseSha(git, 'origin/main')).toBeNull();
  });

  it('returns null when rev-parse yields a non-SHA (e.g. ambiguous output)', async () => {
    const { git } = fakeGit([
      { match: ['rev-parse', 'main'], result: { stdout: 'main\n' } },
    ]);
    expect(await readBaseSha(git, 'main')).toBeNull();
  });
});

describe('engine/daemon-sha — persist round-trip (FR-4/FR-11)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-sha-'));
  });
  afterEach(async () => {
    await chmod(join(dir, LAST_BASE_SHA_PATH), 0o644).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });

  it('writes then reads back the exact SHA', async () => {
    await writePersistedBaseSha(dir, SHA);
    expect(await readPersistedBaseSha(dir)).toBe(SHA);
    // File literally holds the SHA (with trailing newline).
    const raw = await readFile(join(dir, LAST_BASE_SHA_PATH), 'utf-8');
    expect(raw.trim()).toBe(SHA);
  });

  it('overwrites a prior value', async () => {
    await writePersistedBaseSha(dir, SHA);
    await writePersistedBaseSha(dir, SHA_B);
    expect(await readPersistedBaseSha(dir)).toBe(SHA_B);
  });

  it('absent file → null (first-run path)', async () => {
    expect(await readPersistedBaseSha(dir)).toBeNull();
  });

  it('empty file → null (absent, not a differing SHA)', async () => {
    await mkdir(join(dir, '.daemon'), { recursive: true });
    await writeFile(join(dir, LAST_BASE_SHA_PATH), '', 'utf-8');
    expect(await readPersistedBaseSha(dir)).toBeNull();
  });

  it('garbage / non-40-hex content → null', async () => {
    await mkdir(join(dir, '.daemon'), { recursive: true });
    await writeFile(join(dir, LAST_BASE_SHA_PATH), 'not-a-sha\n', 'utf-8');
    expect(await readPersistedBaseSha(dir)).toBeNull();
    await writeFile(join(dir, LAST_BASE_SHA_PATH), '   \n', 'utf-8');
    expect(await readPersistedBaseSha(dir)).toBeNull();
  });

  it('a failed write is swallowed (logged), not thrown', async () => {
    const logs: string[] = [];
    // Point at a path whose parent is a FILE, so mkdir/writeFile fail.
    const notADir = join(dir, 'afile');
    await writeFile(notADir, 'x', 'utf-8');
    await expect(
      writePersistedBaseSha(notADir, SHA, (m) => logs.push(m)),
    ).resolves.toBeUndefined();
    expect(logs.some((l) => /last-base-sha/.test(l))).toBe(true);
  });
});
