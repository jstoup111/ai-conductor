import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectFinishRecordCommand,
  dispatchFinishRecordGuide,
  dispatchFinishRecord,
  FINISH_RECORD_USAGE,
  type FinishRecordRunners,
} from '../../src/engine/finish-record-cli.js';

describe('engine/finish-record-cli', () => {
  describe('detectFinishRecordCommand', () => {
    const argv = (...rest: string[]) => ['node', 'conduct', ...rest];

    it('detects `finish-record --choice pr --pr-url <url> --pipeline-dir <dir>`', () => {
      expect(
        detectFinishRecordCommand(
          argv(
            'finish-record',
            '--choice',
            'pr',
            '--pr-url',
            'https://github.com/org/repo/pull/1',
            '--pipeline-dir',
            '/abs/pipeline',
          ),
        ),
      ).toEqual({
        kind: 'record',
        choice: 'pr',
        prUrl: 'https://github.com/org/repo/pull/1',
        pipelineDir: '/abs/pipeline',
      });
    });

    it('detects `finish-record --choice keep --pipeline-dir <dir>` without a pr-url', () => {
      expect(
        detectFinishRecordCommand(
          argv('finish-record', '--choice', 'keep', '--pipeline-dir', '/abs/pipeline'),
        ),
      ).toEqual({
        kind: 'record',
        choice: 'keep',
        pipelineDir: '/abs/pipeline',
      });
    });

    it('returns null for an unrelated subcommand', () => {
      expect(detectFinishRecordCommand(argv('shipped-record', '--slug', 'x', '--pr', 'y'))).toBe(
        null,
      );
    });

    it('returns guide for no flags at all', () => {
      expect(detectFinishRecordCommand(argv('finish-record'))).toEqual({ kind: 'guide' });
    });

    it('returns guide for --choice merge-local (unsupported choice)', () => {
      expect(
        detectFinishRecordCommand(
          argv('finish-record', '--choice', 'merge-local', '--pipeline-dir', '/abs/pipeline'),
        ),
      ).toEqual({ kind: 'guide' });
    });

    it('returns guide for --choice discard (unsupported choice)', () => {
      expect(
        detectFinishRecordCommand(
          argv('finish-record', '--choice', 'discard', '--pipeline-dir', '/abs/pipeline'),
        ),
      ).toEqual({ kind: 'guide' });
    });

    it('returns guide for --choice pr without --pr-url', () => {
      expect(
        detectFinishRecordCommand(
          argv('finish-record', '--choice', 'pr', '--pipeline-dir', '/abs/pipeline'),
        ),
      ).toEqual({ kind: 'guide' });
    });

    it('returns guide when a flag value is itself another flag (--pr-url --pipeline-dir)', () => {
      expect(
        detectFinishRecordCommand(
          argv(
            'finish-record',
            '--choice',
            'pr',
            '--pr-url',
            '--pipeline-dir',
            '/abs/pipeline',
          ),
        ),
      ).toEqual({ kind: 'guide' });
    });

    it('returns guide for --choice keep --pr-url <url> (contradiction)', () => {
      expect(
        detectFinishRecordCommand(
          argv(
            'finish-record',
            '--choice',
            'keep',
            '--pr-url',
            'https://github.com/org/repo/pull/1',
            '--pipeline-dir',
            '/abs/pipeline',
          ),
        ),
      ).toEqual({ kind: 'guide' });
    });
  });

  describe('dispatchFinishRecordGuide', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('exits 1 and prints usage naming both accepted choices and all flags', () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const code = dispatchFinishRecordGuide({ kind: 'guide' });
      expect(code).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(FINISH_RECORD_USAGE);
      expect(FINISH_RECORD_USAGE).toContain('pr');
      expect(FINISH_RECORD_USAGE).toContain('keep');
      expect(FINISH_RECORD_USAGE).toContain('--choice');
      expect(FINISH_RECORD_USAGE).toContain('--pr-url');
      expect(FINISH_RECORD_USAGE).toContain('--pipeline-dir');
    });
  });

  describe('dispatchFinishRecord — absolute pipeline-dir guard', () => {
    let scratchParent: string;
    let existingAbsDir: string;
    let spyRunners: FinishRecordRunners & { calls: string[] };

    beforeEach(async () => {
      scratchParent = await mkdtemp(join(tmpdir(), 'finish-record-guard-'));
      existingAbsDir = await mkdtemp(join(scratchParent, 'pipeline-'));
      const calls: string[] = [];
      spyRunners = {
        calls,
        runGh: vi.fn(async (args: string[]) => {
          calls.push(`gh:${args.join(' ')}`);
          return undefined;
        }),
        runGit: vi.fn(async (args: string[]) => {
          calls.push(`git:${args.join(' ')}`);
          return undefined;
        }),
      };
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await rm(scratchParent, { recursive: true, force: true });
    });

    it('refuses a relative --pipeline-dir (.pipeline): exit !=0, no writes, no spawns, stderr says absolute required', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const code = await dispatchFinishRecord(
        { kind: 'record', choice: 'keep', pipelineDir: '.pipeline' },
        scratchParent,
        spyRunners,
      );
      expect(code).not.toBe(0);
      expect(spyRunners.calls).toEqual([]);
      expect(errSpy.mock.calls.flat().join(' ')).toMatch(/absolute/i);
    });

    it('refuses a relative --pipeline-dir (../other/.pipeline): exit !=0, no writes, no spawns, stderr says absolute required', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const code = await dispatchFinishRecord(
        { kind: 'record', choice: 'keep', pipelineDir: '../other/.pipeline' },
        scratchParent,
        spyRunners,
      );
      expect(code).not.toBe(0);
      expect(spyRunners.calls).toEqual([]);
      expect(errSpy.mock.calls.flat().join(' ')).toMatch(/absolute/i);
    });

    it('refuses a non-existent absolute --pipeline-dir: exit !=0, no mkdir, no spawns', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const missing = join(scratchParent, 'does-not-exist');
      const code = await dispatchFinishRecord(
        { kind: 'record', choice: 'keep', pipelineDir: missing },
        scratchParent,
        spyRunners,
      );
      expect(code).not.toBe(0);
      expect(spyRunners.calls).toEqual([]);
      await expect(readdir(scratchParent)).resolves.not.toContain('does-not-exist');
      expect(errSpy).toHaveBeenCalled();
    });

    it('accepts an existing absolute --pipeline-dir and does not refuse on the guard', async () => {
      const code = await dispatchFinishRecord(
        { kind: 'record', choice: 'keep', pipelineDir: existingAbsDir },
        scratchParent,
        spyRunners,
      );
      expect(code).toBe(0);
    });
  });
});
