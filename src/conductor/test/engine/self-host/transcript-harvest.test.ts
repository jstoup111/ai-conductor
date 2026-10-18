// Covers: task:4, task:5, task:6
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { emitTranscriptHarvest, harvestThenRemove, harvestTranscripts, transcriptCapture } from '../../../src/engine/self-host/transcript-harvest.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

describe('transcriptCapture', () => {
  it('projects an auxiliary dispatch label to the persisted event member field only', async () => {
    const events = new ConductorEventEmitter();
    const emitted: unknown[] = [];
    events.on('provider_transcripts_captured', (event) => { emitted.push(event); });

    await emitTranscriptHarvest(events, {
      owner: { kind: 'configured-group-member', parentGroup: 'build_review', member: 'rubric-a' },
      runId: 'run', attempt: 1, auxiliaryMember: 'security', provider: 'codex',
      path: '.pipeline/transcripts/rubric-a/run-a1-security-codex', interrupted: false,
    }, { kind: 'captured', files: 1, bytes: 2, skipped: [], omittedLines: 0 });

    expect(emitted).toEqual([expect.objectContaining({
      member: 'security',
      owner: { kind: 'configured-group-member', parentGroup: 'build_review', member: 'rubric-a' },
    })]);
  });

  it.each([
    ['a/b', 'a%002Fb'],
    ['..', '%002E%002E'],
  ])('encodes configured owner member %s as one transcript directory', (member, encoded) => {
    const root = '/worktree';
    const capture = transcriptCapture({
      worktreeRoot: root,
      owner: { kind: 'configured-group-member', parentGroup: 'build_review', member },
      runId: 'run', attempt: 1, provider: 'codex',
    });
    const transcripts = resolve(root, '.pipeline', 'transcripts');

    expect(relative(transcripts, dirname(resolve(capture.destination))).split(sep)).toStrictEqual([encoded]);
  });

  it('keeps path-safe configured owner member directories unchanged', () => {
    expect(transcriptCapture({
      worktreeRoot: '/worktree',
      owner: { kind: 'configured-group-member', parentGroup: 'build_review', member: 'rubric-a' },
      runId: 'run', attempt: 1, provider: 'codex',
    }).path).toBe(join('.pipeline', 'transcripts', 'rubric-a', 'run-a1-codex'));
  });

  it.each(['../../escape', 'a/b', 'a/../../escape'])('keeps a member capture beneath its step directory', (member) => {
    const root = '/worktree';
    const capture = transcriptCapture({
      worktreeRoot: root, step: 'build_review', runId: 'run', attempt: 1, auxiliaryMember: member, provider: 'codex',
    });
    const stepDirectory = resolve(root, '.pipeline', 'transcripts', 'build_review');

    expect(relative(stepDirectory, resolve(capture.destination))).not.toMatch(/^\.\.(?:[/\\]|$)/);
  });

  it('keeps ordinary member capture names stable', () => {
    expect(transcriptCapture({
      worktreeRoot: '/worktree', step: 'build_review', runId: 'run', attempt: 1, auxiliaryMember: 'rubric-a', provider: 'codex',
    }).path).toBe(join('.pipeline', 'transcripts', 'build_review', 'run-a1-rubric-a-codex'));
  });

  it('encodes distinct unsafe members into distinct single-segment capture names', () => {
    const root = '/worktree';
    const slash = transcriptCapture({
      worktreeRoot: root, step: 'build_review', runId: 'run', attempt: 1, auxiliaryMember: 'a/b', provider: 'codex',
    });
    const question = transcriptCapture({
      worktreeRoot: root, step: 'build_review', runId: 'run', attempt: 1, auxiliaryMember: 'a?b', provider: 'codex',
    });
    const stepDirectory = resolve(root, '.pipeline', 'transcripts', 'build_review');

    expect(slash.path).not.toBe(question.path);
    for (const capture of [slash, question]) {
      expect(relative(stepDirectory, resolve(capture.destination))).not.toMatch(/[/\\]/);
    }
  });
});

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

  it('resolves a destination write error as a failed harvest without throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'transcript-harvest-write-error-'));
    const home = join(root, 'home');
    const destination = join(root, 'destination');
    await mkdir(join(home, 'projects', 'w'), { recursive: true });
    await writeFile(join(home, 'projects', 'w', 's.jsonl'), '{"message":"first"}\n');

    try {
      await expect(harvestTranscripts({
        home,
        globs: ['projects/**/*.jsonl'],
        destination,
        knownSecrets: [],
        fs: {
          lstat,
          mkdir,
          readdir,
          readFile,
          writeFile: async () => { throw Object.assign(new Error('destination is read-only'), { code: 'EACCES' }); },
          rm,
        },
      } as Parameters<typeof harvestTranscripts>[0])).resolves.toMatchObject({
        kind: 'failed',
        error: 'destination is read-only',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips a matched transcript that vanishes between walk and read while capturing the others', async () => {
    const root = await mkdtemp(join(tmpdir(), 'transcript-harvest-vanished-source-'));
    const home = join(root, 'home');
    const destination = join(root, 'destination');
    const vanished = join(home, 'projects', 'w', 'gone.jsonl');
    await mkdir(join(home, 'projects', 'w'), { recursive: true });
    await Promise.all([
      writeFile(vanished, '{"message":"gone"}\n'),
      writeFile(join(home, 'projects', 'w', 'kept.jsonl'), '{"message":"kept"}\n'),
    ]);

    try {
      const result = await harvestTranscripts({
        home,
        globs: ['projects/**/*.jsonl'],
        destination,
        knownSecrets: [],
        fs: {
          lstat,
          mkdir,
          readdir,
          readFile: async (path: Parameters<typeof readFile>[0], options: Parameters<typeof readFile>[1]) => {
            if (path === vanished) throw Object.assign(new Error('vanished'), { code: 'ENOENT' });
            return readFile(path, options);
          },
          writeFile,
          rm,
        },
      } as Parameters<typeof harvestTranscripts>[0]);

      expect(result).toStrictEqual({
        kind: 'captured',
        files: 1,
        bytes: 19,
        skipped: ['projects/w/gone.jsonl'],
        omittedLines: 0,
      });
      await expect(readFile(join(destination, 'projects', 'w', 'kept.jsonl'), 'utf8')).resolves.toBe('{"message":"kept"}\n');
      await expect(access(join(destination, 'projects', 'w', 'gone.jsonl'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('removes the partial destination when the second transcript write fails with ENOSPC', async () => {
    const root = await mkdtemp(join(tmpdir(), 'transcript-harvest-enospc-'));
    const home = join(root, 'home');
    const destination = join(root, 'destination');
    await mkdir(join(home, 'projects', 'w'), { recursive: true });
    await Promise.all([
      writeFile(join(home, 'projects', 'w', 'a.jsonl'), '{"message":"first"}\n'),
      writeFile(join(home, 'projects', 'w', 'b.jsonl'), '{"message":"second"}\n'),
    ]);
    let writes = 0;

    try {
      const result = await harvestTranscripts({
        home,
        globs: ['projects/**/*.jsonl'],
        destination,
        knownSecrets: [],
        fs: {
          lstat,
          mkdir,
          readdir,
          readFile,
          writeFile: async (path: Parameters<typeof writeFile>[0], data: Parameters<typeof writeFile>[1]) => {
            writes += 1;
            if (writes === 2) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
            await writeFile(path, data);
          },
          rm,
        },
      } as Parameters<typeof harvestTranscripts>[0]);

      expect(result).toMatchObject({ kind: 'failed', error: 'disk full' });
      await expect(access(destination)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails and removes the partial destination when a target transcript already exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'transcript-harvest-collision-'));
    const home = join(root, 'home');
    const destination = join(root, 'destination');
    await mkdir(join(home, 'projects', 'w'), { recursive: true });
    await mkdir(join(destination, 'projects', 'w'), { recursive: true });
    await Promise.all([
      writeFile(join(home, 'projects', 'w', 's.jsonl'), '{"message":"source"}\n'),
      writeFile(join(destination, 'projects', 'w', 's.jsonl'), '{"message":"existing"}\n'),
    ]);

    try {
      await expect(harvestTranscripts({
        home, globs: ['projects/**/*.jsonl'], destination, knownSecrets: [],
      })).resolves.toMatchObject({ kind: 'failed', error: 'transcript destination already exists: projects/w/s.jsonl' });
      await expect(access(destination)).rejects.toThrow();
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
