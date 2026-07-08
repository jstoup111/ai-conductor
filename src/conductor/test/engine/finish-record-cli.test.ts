import { describe, it, expect } from 'vitest';
import { detectFinishRecordCommand } from '../../src/engine/finish-record-cli.js';

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
  });
});
