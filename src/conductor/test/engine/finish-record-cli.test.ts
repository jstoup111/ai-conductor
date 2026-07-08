import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  detectFinishRecordCommand,
  dispatchFinishRecordGuide,
  FINISH_RECORD_USAGE,
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
});
