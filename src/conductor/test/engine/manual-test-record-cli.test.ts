import { describe, it, expect } from 'vitest';
import { detectManualTestRecordCommand } from '../../src/engine/manual-test-record-cli.js';

describe('engine/manual-test-record-cli', () => {
  describe('detectManualTestRecordCommand', () => {
    const argv = (...rest: string[]) => ['node', 'x', ...rest];

    it('detects `manual-test-record --skip --reason <r> --pipeline-dir <d>`', () => {
      expect(
        detectManualTestRecordCommand(
          argv('manual-test-record', '--skip', '--reason', 'r', '--pipeline-dir', 'd'),
        ),
      ).toEqual({ kind: 'skip', reason: 'r', pipelineDir: 'd' });
    });

    it('detects `manual-test-record --results <p> --pipeline-dir <d>`', () => {
      expect(
        detectManualTestRecordCommand(
          argv('manual-test-record', '--results', 'p', '--pipeline-dir', 'd'),
        ),
      ).toEqual({ kind: 'results', resultsPath: 'p', pipelineDir: 'd' });
    });

    it('returns null when argv[2] is not manual-test-record', () => {
      expect(detectManualTestRecordCommand(argv('finish-record', '--choice', 'pr'))).toBeNull();
    });

    it('returns {kind:"guide"} when required flags are missing', () => {
      expect(detectManualTestRecordCommand(argv('manual-test-record', '--skip'))).toEqual({
        kind: 'guide',
      });
      expect(
        detectManualTestRecordCommand(argv('manual-test-record', '--results', 'p')),
      ).toEqual({ kind: 'guide' });
    });

    it('returns {kind:"guide"} when both --skip and --results are present', () => {
      expect(
        detectManualTestRecordCommand(
          argv(
            'manual-test-record',
            '--skip',
            '--reason',
            'r',
            '--results',
            'p',
            '--pipeline-dir',
            'd',
          ),
        ),
      ).toEqual({ kind: 'guide' });
    });
  });
});
