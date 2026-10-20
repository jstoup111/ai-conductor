// Covers: task:rem-as-built-rem-v3-production-git-stdin
import { describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  blobs: new Map<string, string>(),
  refs: new Map<string, string>(),
  stdin: [] as string[],
}));

// setup.ts imports engine modules before this file's mock is registered.
vi.hoisted(() => { vi.resetModules(); });
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn((_file, args: string[], _options, callback) => {
      let input: string | undefined;
      const child = { stdin: { end: (value: unknown) => { input = String(value); boundary.stdin.push(input); } } };
      if (args[0] === 'hash-object' && args.includes('--stdin')) {
        queueMicrotask(() => {
          if (typeof input !== 'string') {
            callback(new Error('hash-object requires stdin'), '', '');
            return;
          }
          const blob = 'a'.repeat(40);
          boundary.blobs.set(blob, input);
          callback(null, `${blob}\n`, '');
        });
        return child;
      }
      if (args[0] === 'update-ref') {
        const [, ref, next, expected] = args;
        const current = boundary.refs.get(ref!) ?? '0'.repeat(40);
        queueMicrotask(() => {
          if (current !== expected) callback(new Error('compare-and-swap failed'), '', '');
          else {
            boundary.refs.set(ref!, next!);
            callback(null, '', '');
          }
        });
        return child;
      }
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    }),
  };
});

import { makeProductionGit } from '../../src/engine/pr-labels.js';
import type { GitRunner as PublicationRecordGitRunner } from '../../src/engine/rebase.js';
import { publicationRefFor, writePublicationRecord, type PublicationRecord } from '../../src/engine/stack-publication-record.js';

describe('production git stdin transport', () => {
  it('persists a publication record through the production child process', async () => {
    const noRealExec = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    try {
      const productionGit = makeProductionGit();
      const git: PublicationRecordGitRunner = async (args, options) => {
        const result = await productionGit(args, {
          cwd: '/fixture',
          ...(options?.input === undefined ? {} : { input: options.input }),
        });
        return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: '' };
      };
      const record: PublicationRecord = { version: 1, members: [] };

      await expect(writePublicationRecord('/fixture', 'entry', undefined, record, { git })).resolves.toEqual({ kind: 'updated' });

      expect(boundary.stdin).toEqual([JSON.stringify(record)]);
      expect(boundary.blobs.get('a'.repeat(40))).toBe(JSON.stringify(record));
      expect(boundary.refs.get(publicationRefFor('entry'))).toBe('a'.repeat(40));
    } finally {
      if (noRealExec === undefined) delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      else process.env.AI_CONDUCTOR_NO_REAL_EXEC = noRealExec;
    }
  });
});
