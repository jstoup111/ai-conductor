// Covers: task:4
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { harvestThenRemove, harvestTranscripts } from '../../../src/engine/self-host/transcript-harvest.js';

describe('harvestTranscripts', () => {
  it('copies only allowlisted transcripts at their home-relative paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'transcript-harvest-'));
    const home = join(root, 'home');
    const destination = join(root, 'destination');
    const harness = join(root, 'harness');
    await mkdir(join(home, 'projects', 'w', 's', 'subagents'), { recursive: true });
    await mkdir(harness);
    await Promise.all([
      writeFile(join(home, 'projects', 'w', 's.jsonl'), '{"message":"first"}\n'),
      writeFile(join(home, 'projects', 'w', 's', 'subagents', 'a.jsonl'), '{"message":"second"}\n'),
      writeFile(join(home, 'projects', 'w', 'notes.txt'), 'not a transcript'),
      writeFile(join(home, 'auth.json'), '{"token":"secret"}'),
      writeFile(join(home, '.claude.json'), '{"settings":true}'),
      writeFile(join(home, 'settings.json'), '{"settings":true}'),
      symlink(harness, join(home, 'skills')),
      symlink(harness, join(home, 'hooks')),
    ]);

    try {
      const result = await harvestTranscripts({
        home,
        globs: ['projects/**/*.jsonl'],
        destination,
        knownSecrets: [],
      });

      expect({
        result,
        files: await readdir(destination, { recursive: true }),
      }).toStrictEqual({
        result: { kind: 'captured', files: 2, bytes: 41, skipped: [], omittedLines: 0 },
        files: ['projects', 'projects/w', 'projects/w/s', 'projects/w/s.jsonl', 'projects/w/s/subagents', 'projects/w/s/subagents/a.jsonl'],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records an empty capture when the provider home has no allowlisted transcript', async () => {
    const root = await mkdtemp(join(tmpdir(), 'transcript-harvest-empty-'));
    const home = join(root, 'home');
    const destination = join(root, 'destination');
    await mkdir(home);
    await writeFile(join(home, 'auth.json'), '{"token":"secret"}');

    try {
      await expect(harvestTranscripts({
        home,
        globs: ['projects/**/*.jsonl'],
        destination,
        knownSecrets: [],
      })).resolves.toStrictEqual({ kind: 'captured', files: 0, bytes: 0, skipped: [], omittedLines: 0 });
      await expect(readdir(destination)).resolves.toStrictEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports harvest results before removing the provider home', async () => {
    const calls: string[] = [];

    await harvestThenRemove({
      harvest: async () => {
        calls.push('harvest');
        return { kind: 'captured' as const };
      },
      report: (result) => { calls.push(`report:${result.kind}`); },
      remove: async () => { calls.push('remove'); },
    });

    expect(calls).toStrictEqual(['harvest', 'report:captured', 'remove']);
  });

  it('removes the provider home when harvest rejects', async () => {
    const calls: string[] = [];

    await expect(harvestThenRemove({
      harvest: async () => {
        calls.push('harvest');
        throw new Error('harvest fault');
      },
      report: () => { calls.push('report'); },
      remove: async () => { calls.push('remove'); },
    })).rejects.toThrow('harvest fault');

    expect(calls).toStrictEqual(['harvest', 'remove']);
  });
});
