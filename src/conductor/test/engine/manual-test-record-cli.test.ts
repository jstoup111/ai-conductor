import { describe, it, expect, vi } from 'vitest';
import {
  detectManualTestRecordCommand,
  dispatchManualTestRecord,
  type ManualTestRecordRunners,
} from '../../src/engine/manual-test-record-cli.js';
import { MANUAL_TEST_SKIP_SENTINEL } from '../../src/engine/artifacts.js';

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

  describe('dispatchManualTestRecord — skip mode', () => {
    const makeFakeFs = (initialContent?: string) => {
      const files = new Map<string, string>();
      const dirs = new Set<string>();
      if (initialContent !== undefined) {
        files.set('/abs/pipeline/manual-test-results.md', initialContent);
      }
      const runners: ManualTestRecordRunners = {
        readFile: vi.fn(async (path: string) => {
          if (!files.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          return files.get(path)!;
        }),
        mkdir: vi.fn(async (path: string) => {
          dirs.add(path);
        }),
        writeFile: vi.fn(async (path: string, contents: string) => {
          files.set(path, contents);
        }),
        rename: vi.fn(async (from: string, to: string) => {
          const contents = files.get(from);
          if (contents === undefined) throw new Error(`rename: no such temp file ${from}`);
          files.delete(from);
          files.set(to, contents);
        }),
        rm: vi.fn(async (path: string) => {
          files.delete(path);
        }),
      };
      return { runners, files };
    };

    it('writes an Attempt 1 section with the skip sentinel and a human-readable SKIPPED line when the results file is missing', async () => {
      const { runners, files } = makeFakeFs(undefined);
      const code = await dispatchManualTestRecord(
        { kind: 'skip', reason: 'no endpoint/UI stories in this feature', pipelineDir: '/abs/pipeline' },
        '/abs',
        runners,
      );
      expect(code).toBe(0);
      const written = files.get('/abs/pipeline/manual-test-results.md');
      expect(written).toBeDefined();
      expect(written).toContain('## Attempt 1');
      expect(written).toContain(MANUAL_TEST_SKIP_SENTINEL);
      expect(written).toMatch(/\*\*Result:\*\*\s*SKIPPED\s*—\s*no endpoint\/UI stories in this feature/);
    });

    it('writes an Attempt 1 section when the results file exists but is empty', async () => {
      const { runners, files } = makeFakeFs('');
      const code = await dispatchManualTestRecord(
        { kind: 'skip', reason: 'auto mode', pipelineDir: '/abs/pipeline' },
        '/abs',
        runners,
      );
      expect(code).toBe(0);
      const written = files.get('/abs/pipeline/manual-test-results.md');
      expect(written).toContain('## Attempt 1');
      expect(written).toContain(MANUAL_TEST_SKIP_SENTINEL);
    });

    it('appends an Attempt 2 section after an existing Attempt 1, preserving prior content', async () => {
      const priorContent = '## Attempt 1\n\n| Story | Result |\n| --- | --- |\n| S1 | PASS |\n';
      const { runners, files } = makeFakeFs(priorContent);
      const code = await dispatchManualTestRecord(
        { kind: 'skip', reason: 'auto mode retry', pipelineDir: '/abs/pipeline' },
        '/abs',
        runners,
      );
      expect(code).toBe(0);
      const written = files.get('/abs/pipeline/manual-test-results.md')!;
      expect(written).toContain('## Attempt 1');
      expect(written).toContain('## Attempt 2');
      expect(written).toContain(MANUAL_TEST_SKIP_SENTINEL);
      expect(written).toContain('S1 | PASS');
    });

    it('writes atomically: to a temp file, then rename() over the target — no direct writeFile to the final path', async () => {
      const { runners } = makeFakeFs(undefined);
      const code = await dispatchManualTestRecord(
        { kind: 'skip', reason: 'auto mode', pipelineDir: '/abs/pipeline' },
        '/abs',
        runners,
      );
      expect(code).toBe(0);
      expect(runners.writeFile).toHaveBeenCalledTimes(1);
      const [writtenPath] = (runners.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(writtenPath).not.toBe('/abs/pipeline/manual-test-results.md');
      expect(runners.rename).toHaveBeenCalledWith(
        writtenPath,
        '/abs/pipeline/manual-test-results.md',
      );
    });

    it('fails closed when writeFile throws: returns non-zero, never renames, temp file cleaned up', async () => {
      const { runners, files } = makeFakeFs(undefined);
      (runners.writeFile as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        throw new Error('EACCES: permission denied (simulated)');
      });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const code = await dispatchManualTestRecord(
        { kind: 'skip', reason: 'auto mode', pipelineDir: '/abs/pipeline' },
        '/abs',
        runners,
      );
      expect(code).not.toBe(0);
      expect(runners.rename).not.toHaveBeenCalled();
      expect(files.has('/abs/pipeline/manual-test-results.md')).toBe(false);
      expect(errSpy.mock.calls.flat().join(' ')).toMatch(/failed to write/i);
      errSpy.mockRestore();
    });

    it('fails closed when rename throws: returns non-zero, results file left untouched', async () => {
      const { runners, files } = makeFakeFs('## Attempt 1\n\nsome prior content\n');
      (runners.rename as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        throw new Error('EPERM: rename failed (simulated)');
      });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const before = files.get('/abs/pipeline/manual-test-results.md');
      const code = await dispatchManualTestRecord(
        { kind: 'skip', reason: 'auto mode', pipelineDir: '/abs/pipeline' },
        '/abs',
        runners,
      );
      expect(code).not.toBe(0);
      expect(files.get('/abs/pipeline/manual-test-results.md')).toBe(before);
      expect(errSpy.mock.calls.flat().join(' ')).toMatch(/failed to write/i);
      errSpy.mockRestore();
    });
  });

  describe('dispatchManualTestRecord — results mode', () => {
    const makeFakeFs = (initialContent?: string, extraFiles?: Record<string, string>) => {
      const files = new Map<string, string>();
      const dirs = new Set<string>();
      if (initialContent !== undefined) {
        files.set('/abs/pipeline/manual-test-results.md', initialContent);
      }
      for (const [path, content] of Object.entries(extraFiles ?? {})) {
        files.set(path, content);
      }
      const runners: ManualTestRecordRunners = {
        readFile: vi.fn(async (path: string) => {
          if (!files.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          return files.get(path)!;
        }),
        mkdir: vi.fn(async (path: string) => {
          dirs.add(path);
        }),
        writeFile: vi.fn(async (path: string, contents: string) => {
          files.set(path, contents);
        }),
        rename: vi.fn(async (from: string, to: string) => {
          const contents = files.get(from);
          if (contents === undefined) throw new Error(`rename: no such temp file ${from}`);
          files.delete(from);
          files.set(to, contents);
        }),
        rm: vi.fn(async (path: string) => {
          files.delete(path);
        }),
        readStdin: vi.fn(async () => ''),
      };
      return { runners, files };
    };

    it('reads results content from the given path and writes an Attempt 1 section verbatim', async () => {
      const { runners, files } = makeFakeFs(undefined, {
        '/abs/results-input.md': '| Story | Result |\n| --- | --- |\n| S1 | PASS |\n',
      });
      const code = await dispatchManualTestRecord(
        { kind: 'results', resultsPath: '/abs/results-input.md', pipelineDir: '/abs/pipeline' },
        '/abs',
        runners,
      );
      expect(code).toBe(0);
      const written = files.get('/abs/pipeline/manual-test-results.md');
      expect(written).toBeDefined();
      expect(written).toContain('## Attempt 1');
      expect(written).toContain('| S1 | PASS |');
    });

    it('reads results content from stdin when resultsPath is "-"', async () => {
      const { runners, files } = makeFakeFs(undefined);
      (runners.readStdin as ReturnType<typeof vi.fn>).mockResolvedValue(
        '| Story | Result |\n| --- | --- |\n| S2 | FAIL |\n',
      );
      const code = await dispatchManualTestRecord(
        { kind: 'results', resultsPath: '-', pipelineDir: '/abs/pipeline' },
        '/abs',
        runners,
      );
      expect(code).toBe(0);
      expect(runners.readStdin).toHaveBeenCalled();
      const written = files.get('/abs/pipeline/manual-test-results.md');
      expect(written).toContain('## Attempt 1');
      expect(written).toContain('| S2 | FAIL |');
    });

    it('appends an Attempt 2 section after an existing Attempt 1, preserving prior content', async () => {
      const priorContent = '## Attempt 1\n\n**Result:** SKIPPED — auto mode\n';
      const { runners, files } = makeFakeFs(priorContent, {
        '/abs/results-input.md': '| Story | Result |\n| --- | --- |\n| S1 | PASS |\n',
      });
      const code = await dispatchManualTestRecord(
        { kind: 'results', resultsPath: '/abs/results-input.md', pipelineDir: '/abs/pipeline' },
        '/abs',
        runners,
      );
      expect(code).toBe(0);
      const written = files.get('/abs/pipeline/manual-test-results.md')!;
      expect(written).toContain('## Attempt 1');
      expect(written).toContain('## Attempt 2');
      expect(written).toContain('SKIPPED — auto mode');
      expect(written).toContain('| S1 | PASS |');
    });

    it('fails closed when the results path cannot be read', async () => {
      const { runners, files } = makeFakeFs(undefined);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const code = await dispatchManualTestRecord(
        { kind: 'results', resultsPath: '/abs/missing.md', pipelineDir: '/abs/pipeline' },
        '/abs',
        runners,
      );
      expect(code).not.toBe(0);
      expect(files.has('/abs/pipeline/manual-test-results.md')).toBe(false);
      errSpy.mockRestore();
    });
  });
});
