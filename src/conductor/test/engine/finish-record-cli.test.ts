import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
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

  describe('dispatchFinishRecord — choice=pr PR-existence verification', () => {
    let scratchParent: string;
    let existingAbsDir: string;

    beforeEach(async () => {
      scratchParent = await mkdtemp(join(tmpdir(), 'finish-record-pr-'));
      existingAbsDir = await mkdtemp(join(scratchParent, 'pipeline-'));
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await rm(scratchParent, { recursive: true, force: true });
    });

    const snapshotDir = async (dir: string) => (await readdir(dir)).sort();

    it('refuses when gh returns empty stdout: exit !=0, zero writes, pipeline dir unchanged', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const before = await snapshotDir(existingAbsDir);
      const runGh = vi.fn(async () => ({ stdout: '' }));
      const runGit = vi.fn(async () => undefined);
      const code = await dispatchFinishRecord(
        {
          kind: 'record',
          choice: 'pr',
          prUrl: 'https://github.com/org/repo/pull/1',
          pipelineDir: existingAbsDir,
        },
        scratchParent,
        { runGh, runGit },
      );
      expect(code).not.toBe(0);
      expect(runGh).toHaveBeenCalledWith(
        ['pr', 'view', '--json', 'url', '-q', '.url'],
        { cwd: dirname(existingAbsDir) },
      );
      expect(errSpy.mock.calls.flat().join(' ')).toMatch(/gh pr view/i);
      await expect(snapshotDir(existingAbsDir)).resolves.toEqual(before);
    });

    it('refuses when gh throws ENOENT (spawn failure): exit !=0, no keep fallback, zero writes', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const before = await snapshotDir(existingAbsDir);
      const enoent = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
      const runGh = vi.fn(async () => {
        throw enoent;
      });
      const runGit = vi.fn(async () => undefined);
      const code = await dispatchFinishRecord(
        {
          kind: 'record',
          choice: 'pr',
          prUrl: 'https://github.com/org/repo/pull/1',
          pipelineDir: existingAbsDir,
        },
        scratchParent,
        { runGh, runGit },
      );
      expect(code).not.toBe(0);
      expect(errSpy.mock.calls.flat().join(' ')).toMatch(/gh pr view failed/i);
      expect(errSpy.mock.calls.flat().join(' ')).toMatch(/ENOENT/i);
      await expect(snapshotDir(existingAbsDir)).resolves.toEqual(before);
    });

    it('passes the guard when gh succeeds with a URL and push-evidence confirms HEAD is pushed', async () => {
      const runGh = vi.fn(async () => ({ stdout: 'https://github.com/org/repo/pull/1\n' }));
      const runGit = vi.fn(async (args: string[]) => {
        if (args[0] === 'rev-parse' && args.includes('@{u}')) {
          return { stdout: 'refs/remotes/origin/feat\n' };
        }
        if (args[0] === 'merge-base') {
          return { stdout: '' }; // exit 0 → is-ancestor → pushed
        }
        throw new Error(`unexpected git args: ${args.join(' ')}`);
      });
      const code = await dispatchFinishRecord(
        {
          kind: 'record',
          choice: 'pr',
          prUrl: 'https://github.com/org/repo/pull/1',
          pipelineDir: existingAbsDir,
        },
        scratchParent,
        { runGh, runGit },
      );
      expect(code).toBe(0);
      expect(runGh).toHaveBeenCalledWith(
        ['pr', 'view', '--json', 'url', '-q', '.url'],
        { cwd: dirname(existingAbsDir) },
      );
    });

    it('refuses when headPushedToUpstream returns false: exit !=0, zero writes', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const before = await snapshotDir(existingAbsDir);
      const runGh = vi.fn(async () => ({ stdout: 'https://github.com/org/repo/pull/1\n' }));
      const runGit = vi.fn(async (args: string[]) => {
        if (args[0] === 'rev-parse' && args.includes('@{u}')) {
          return { stdout: 'refs/remotes/origin/feat\n' };
        }
        if (args[0] === 'merge-base') {
          const notAncestor = Object.assign(new Error('not an ancestor'), { code: 1 });
          throw notAncestor;
        }
        throw new Error(`unexpected git args: ${args.join(' ')}`);
      });
      const code = await dispatchFinishRecord(
        {
          kind: 'record',
          choice: 'pr',
          prUrl: 'https://github.com/org/repo/pull/1',
          pipelineDir: existingAbsDir,
        },
        scratchParent,
        { runGh, runGit },
      );
      expect(code).not.toBe(0);
      expect(errSpy.mock.calls.flat().join(' ')).toMatch(/not.*verified as pushed|push-evidence/i);
      await expect(snapshotDir(existingAbsDir)).resolves.toEqual(before);
    });

    it('refuses when headPushedToUpstream returns null (indeterminate): exit !=0, zero writes', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const before = await snapshotDir(existingAbsDir);
      const runGh = vi.fn(async () => ({ stdout: 'https://github.com/org/repo/pull/1\n' }));
      const runGit = vi.fn(async () => {
        throw new Error('git not available');
      });
      const code = await dispatchFinishRecord(
        {
          kind: 'record',
          choice: 'pr',
          prUrl: 'https://github.com/org/repo/pull/1',
          pipelineDir: existingAbsDir,
        },
        scratchParent,
        { runGh, runGit },
      );
      expect(code).not.toBe(0);
      expect(errSpy.mock.calls.flat().join(' ')).toMatch(/not.*verified as pushed|push-evidence/i);
      await expect(snapshotDir(existingAbsDir)).resolves.toEqual(before);
    });
  });

  describe('dispatchFinishRecord — ordered marker writes preserve state (happy paths)', () => {
    let scratchParent: string;
    let existingAbsDir: string;
    let passingRunners: FinishRecordRunners;

    beforeEach(async () => {
      scratchParent = await mkdtemp(join(tmpdir(), 'finish-record-writes-'));
      existingAbsDir = await mkdtemp(join(scratchParent, 'pipeline-'));
      passingRunners = {
        runGh: vi.fn(async () => ({ stdout: 'https://github.com/org/repo/pull/1\n' })),
        runGit: vi.fn(async (args: string[]) => {
          if (args[0] === 'rev-parse' && args.includes('@{u}')) {
            return { stdout: 'refs/remotes/origin/feat\n' };
          }
          if (args[0] === 'merge-base') {
            return { stdout: '' };
          }
          throw new Error(`unexpected git args: ${args.join(' ')}`);
        }),
      };
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await rm(scratchParent, { recursive: true, force: true });
    });

    it('choice=pr preserves pre-existing state fields and adds pr_url', async () => {
      const statePath = join(existingAbsDir, 'conduct-state.json');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(statePath, JSON.stringify({ feature: 'x', session_id: 'y' }, null, 2) + '\n');

      const code = await dispatchFinishRecord(
        {
          kind: 'record',
          choice: 'pr',
          prUrl: 'https://github.com/org/repo/pull/1',
          pipelineDir: existingAbsDir,
        },
        scratchParent,
        passingRunners,
      );

      expect(code).toBe(0);
      const state = JSON.parse(await readFile(statePath, 'utf-8'));
      expect(state).toEqual({
        feature: 'x',
        session_id: 'y',
        pr_url: 'https://github.com/org/repo/pull/1',
      });
    });

    it('choice=pr writes finish-choice containing exactly the bare choice string', async () => {
      const code = await dispatchFinishRecord(
        {
          kind: 'record',
          choice: 'pr',
          prUrl: 'https://github.com/org/repo/pull/1',
          pipelineDir: existingAbsDir,
        },
        scratchParent,
        passingRunners,
      );

      expect(code).toBe(0);
      const marker = await readFile(join(existingAbsDir, 'finish-choice'), 'utf-8');
      expect(marker.trim()).toBe('pr');
    });

    it('choice=pr with no pre-existing state file creates one containing pr_url', async () => {
      const code = await dispatchFinishRecord(
        {
          kind: 'record',
          choice: 'pr',
          prUrl: 'https://github.com/org/repo/pull/1',
          pipelineDir: existingAbsDir,
        },
        scratchParent,
        passingRunners,
      );

      expect(code).toBe(0);
      const state = JSON.parse(
        await readFile(join(existingAbsDir, 'conduct-state.json'), 'utf-8'),
      );
      expect(state.pr_url).toBe('https://github.com/org/repo/pull/1');
    });

    it('choice=keep writes only the finish-choice marker (state.json untouched)', async () => {
      const spyRunners: FinishRecordRunners = {
        runGh: vi.fn(async () => {
          throw new Error('runGh must not be called for choice=keep');
        }),
        runGit: vi.fn(async () => {
          throw new Error('runGit must not be called for choice=keep');
        }),
      };
      const code = await dispatchFinishRecord(
        { kind: 'record', choice: 'keep', pipelineDir: existingAbsDir },
        scratchParent,
        spyRunners,
      );

      expect(code).toBe(0);
      const marker = await readFile(join(existingAbsDir, 'finish-choice'), 'utf-8');
      expect(marker.trim()).toBe('keep');
      const after = await readdir(existingAbsDir);
      expect(after).not.toContain('conduct-state.json');
    });
  });

  describe('dispatchFinishRecord — reuses push-evidence module (no local reimplementation)', () => {
    it('imports headPushedToUpstream from ./push-evidence.js instead of reimplementing merge-base logic', async () => {
      const src = await readFile(
        new URL('../../src/engine/finish-record-cli.ts', import.meta.url),
        'utf8',
      );
      expect(src).toMatch(/from ['"]\.\/push-evidence\.js['"]/);
      expect(src).toMatch(/headPushedToUpstream/);
    });
  });
});
