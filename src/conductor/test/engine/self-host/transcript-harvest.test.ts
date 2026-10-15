// Covers: task:4, task:5
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
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

  it('skips an allowlisted transcript that is a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'transcript-harvest-symlink-file-'));
    const home = join(root, 'home');
    const destination = join(root, 'destination');
    const outside = join(root, 'outside.jsonl');
    await mkdir(join(home, 'projects', 'w'), { recursive: true });
    await writeFile(outside, '{"token":"outside-secret"}\n');
    await symlink(outside, join(home, 'projects', 'w', 'link.jsonl'));

    try {
      const result = await harvestTranscripts({
        home,
        globs: ['projects/**/*.jsonl'],
        destination,
        knownSecrets: [],
      });

      expect({ result, files: await readdir(destination, { recursive: true }) }).toStrictEqual({
        result: { kind: 'captured', files: 0, bytes: 0, skipped: ['projects/w/link.jsonl'], omittedLines: 0 },
        files: [],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not descend into a symlinked directory while harvesting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'transcript-harvest-symlink-directory-'));
    const home = join(root, 'home');
    const destination = join(root, 'destination');
    const outside = join(root, 'outside');
    await mkdir(home);
    await mkdir(outside);
    await writeFile(join(outside, 'x.jsonl'), '{"token":"outside-secret"}\n');
    await symlink(outside, join(home, 'sessions'));

    try {
      const result = await harvestTranscripts({
        home,
        globs: ['sessions/**/*.jsonl'],
        destination,
        knownSecrets: [],
      });

      expect({ result, files: await readdir(destination, { recursive: true }) }).toStrictEqual({
        result: { kind: 'captured', files: 0, bytes: 0, skipped: [], omittedLines: 0 },
        files: [],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('omits only a transcript line whose sanitizer throws', async () => {
    const root = await mkdtemp(join(tmpdir(), 'transcript-harvest-unsanitizable-line-'));
    const home = join(root, 'home');
    const destination = join(root, 'destination');
    await mkdir(join(home, 'projects', 'w'), { recursive: true });
    await writeFile(join(home, 'projects', 'w', 's.jsonl'), 'safe\nsecret=unredactable\nalso-safe\n');

    try {
      const result = await harvestTranscripts({
        home,
        globs: ['projects/**/*.jsonl'],
        destination,
        knownSecrets: [],
        sanitizeLine: (line: string) => {
          if (line === 'secret=unredactable') throw new Error('sanitizer fault');
          return `sanitized:${line}`;
        },
      });

      expect({
        result,
        content: await readFile(join(destination, 'projects', 'w', 's.jsonl'), 'utf8'),
      }).toStrictEqual({
        result: { kind: 'captured', files: 1, bytes: 45, skipped: [], omittedLines: 1 },
        content: 'sanitized:safe\nsanitized:also-safe\nsanitized:',
      });
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
