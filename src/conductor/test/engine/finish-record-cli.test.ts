import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

// Toggled by the "state-write fails" test to simulate an fs.writeFile
// failure for conduct-state.json specifically, without redefining the
// (non-configurable) ESM export directly.
let failStateWriteFor: string | null = null;

// `finish-record-cli.ts` imports from 'node:fs/promises'; `state.ts` (its
// writeState dependency) imports from the bare 'fs/promises' specifier. Both
// resolve to the same module at runtime but vi.mock keys by specifier
// string, so both must be mocked for the state-write-failure test to work
// regardless of which import style a given module uses. Note: vi.mock
// factories are hoisted above top-level variable declarations, so the
// wrapper logic must be inlined in each factory rather than shared via a
// helper function.
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    writeFile: async (path: unknown, ...rest: unknown[]) => {
      if (typeof path === 'string' && failStateWriteFor && path.endsWith(failStateWriteFor)) {
        throw new Error('EACCES: permission denied (simulated)');
      }
      return (actual.writeFile as (...a: unknown[]) => Promise<void>)(path, ...rest);
    },
  };
});
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    writeFile: async (path: unknown, ...rest: unknown[]) => {
      if (typeof path === 'string' && failStateWriteFor && path.endsWith(failStateWriteFor)) {
        throw new Error('EACCES: permission denied (simulated)');
      }
      return (actual.writeFile as (...a: unknown[]) => Promise<void>)(path, ...rest);
    },
  };
});

import {
  detectFinishRecordCommand,
  dispatchFinishRecordGuide,
  dispatchFinishRecord,
  FINISH_RECORD_USAGE,
  type FinishRecordRunners,
} from '../../src/engine/finish-record-cli.js';
import type { ShipmentEvidenceInput } from '../../src/engine/shipment-evidence.js';

const validEvidence = {
  kind: 'valid' as const,
  slug: 'feature',
  pr: 'https://github.com/org/repo/pull/1',
  recordPath: '.docs/shipped/feature.md',
  hash: 'hash',
  commit: 'candidate',
};

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
          return { stdout: '' };
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
      await writeFile(
        join(existingAbsDir, 'conduct-state.json'),
        JSON.stringify({ feature_desc: 'feature' }),
      );
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await rm(scratchParent, { recursive: true, force: true });
    });

    const snapshotDir = async (dir: string) => (await readdir(dir)).sort();

    it('binds the supplied PR URL and refuses a different GitHub PR identity before terminal writes', async () => {
      const requestedPr = 'https://github.com/org/repo/pull/1';
      const before = await snapshotDir(existingAbsDir);
      const runGh = vi.fn(async (_args: string[]) => ({
        stdout: JSON.stringify({
          url: 'https://github.com/org/repo/pull/2',
          headRefOid: 'b'.repeat(40),
        }),
      }));
      const runGit = vi.fn(async () => {
        throw new Error('git must not run after a mismatched PR binding');
      });

      const code = await dispatchFinishRecord(
        {
          kind: 'record',
          choice: 'pr',
          prUrl: requestedPr,
          pipelineDir: existingAbsDir,
        },
        scratchParent,
        { runGh, runGit },
      );

      expect({
        code,
        ghArgs: runGh.mock.calls[0]?.[0],
        gitCalls: runGit.mock.calls.length,
        entries: await snapshotDir(existingAbsDir),
      }).toEqual({
        code: 1,
        ghArgs: ['pr', 'view', requestedPr, '--json', 'url,headRefOid'],
        gitCalls: 0,
        entries: before,
      });
    });

    it('refuses when gh returns empty stdout: exit !=0, zero writes, pipeline dir unchanged', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const before = await snapshotDir(existingAbsDir);
      const runGh = vi.fn(async () => ({ stdout: '' }));
      const runGit = vi.fn(async () => ({ stdout: '' }));
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
        ['pr', 'view', 'https://github.com/org/repo/pull/1', '--json', 'url,headRefOid'],
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
      const runGit = vi.fn(async () => ({ stdout: '' }));
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

    it('passes normalized ancestry evidence when gh succeeds with a URL and push-evidence confirms HEAD is pushed', async () => {
      const runGh = vi.fn(async () => ({
        stdout: JSON.stringify({ url: 'https://github.com/org/repo/pull/1', headRefOid: 'candidate' }),
      }));
      const runGit = vi.fn(async (args: string[]) => {
        if (args[0] === 'rev-parse' && args.includes('@{u}')) {
          return { stdout: 'refs/remotes/origin/feat\n' };
        }
        if (args[0] === 'merge-base') {
          return { stdout: '' }; // exit 0 → is-ancestor → pushed
        }
        if (args[0] === 'rev-parse' && args.includes('HEAD')) {
          return { stdout: 'candidate\n' };
        }
        if (args[0] === 'rev-parse' && args.includes('--verify')) {
          return { stdout: 'candidate\n' };
        }
        if (args[0] === 'rev-parse' && args.includes('@{u}')) {
          return { stdout: 'upstream\n' };
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
        {
          runGh,
          runGit,
          evaluateEvidence: async (_input, dependencies) => {
            await expect(
              dependencies.gitRunner?.(['merge-base', '--is-ancestor', 'candidate', 'candidate']),
            ).resolves.toBe('true');
            await expect(
              dependencies.gitRunner?.(['rev-parse', '--verify', 'candidate']),
            ).resolves.toBe('candidate\n');
            return validEvidence;
          },
        },
      );
      expect(code).toBe(0);
      expect(runGh).toHaveBeenCalledWith(
        ['pr', 'view', 'https://github.com/org/repo/pull/1', '--json', 'url,headRefOid'],
        { cwd: dirname(existingAbsDir) },
      );
    });

    it('strips sanctioned worktree branch prefixes for durable evidence evaluation', async () => {
      const evaluateEvidence = vi.fn(async (_input: ShipmentEvidenceInput) => validEvidence);
      const runGh = vi.fn(async () => ({
        stdout: JSON.stringify({ url: 'https://github.com/org/repo/pull/1', headRefOid: 'candidate' }),
      }));
      const runGit = vi.fn(async (args: string[]) => {
        if (args[0] === 'rev-parse' && args.includes('@{u}')) {
          return { stdout: 'refs/remotes/origin/feat\n' };
        }
        if (args[0] === 'merge-base') {
          return { stdout: '' };
        }
        if (args[0] === 'rev-parse' && args.includes('HEAD')) {
          return { stdout: 'candidate\n' };
        }
        throw new Error(`unexpected git args: ${args.join(' ')}`);
      });

      for (const state of [
        {
          feature_desc: 'First-class Codex harness parity',
          worktree_branch: 'spec/first-class-codex-harness-parity-904',
        },
        {
          feature_desc: 'Codex harness parity follow-up',
          worktree_branch: 'feature/first-class-codex-harness-parity-904',
        },
      ]) {
        await writeFile(join(existingAbsDir, 'conduct-state.json'), JSON.stringify(state));
        await dispatchFinishRecord(
          {
            kind: 'record',
            choice: 'pr',
            prUrl: 'https://github.com/org/repo/pull/1',
            pipelineDir: existingAbsDir,
          },
          scratchParent,
          { runGh, runGit, evaluateEvidence },
        );
      }

      expect(evaluateEvidence.mock.calls.map(([input]) => input.slug)).toEqual([
        'first-class-codex-harness-parity-904',
        'first-class-codex-harness-parity-904',
      ]);
    });

    it('refuses when headPushedToUpstream returns false: exit !=0, zero writes', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const before = await snapshotDir(existingAbsDir);
      const runGh = vi.fn(async () => ({
        stdout: JSON.stringify({ url: 'https://github.com/org/repo/pull/1', headRefOid: 'candidate' }),
      }));
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
      const runGh = vi.fn(async () => ({
        stdout: JSON.stringify({ url: 'https://github.com/org/repo/pull/1', headRefOid: 'candidate' }),
      }));
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
      await writeFile(
        join(existingAbsDir, 'conduct-state.json'),
        JSON.stringify({ feature_desc: 'feature' }),
      );
      passingRunners = {
        runGh: vi.fn(async () => ({
          stdout: JSON.stringify({ url: 'https://github.com/org/repo/pull/1', headRefOid: 'candidate' }),
        })),
        runGit: vi.fn(async (args: string[]) => {
          if (args[0] === 'rev-parse' && args.includes('@{u}')) {
            return { stdout: 'refs/remotes/origin/feat\n' };
          }
          if (args[0] === 'merge-base') {
            return { stdout: '' };
          }
          if (args[0] === 'rev-parse' && args.includes('HEAD')) {
            return { stdout: 'candidate\n' };
          }
          if (args[0] === 'rev-parse' && args.includes('@{u}')) {
            return { stdout: 'upstream\n' };
          }
          throw new Error(`unexpected git args: ${args.join(' ')}`);
        }),
        evaluateEvidence: async () => validEvidence,
      };
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await rm(scratchParent, { recursive: true, force: true });
    });

    it('choice=pr refuses a strict-evidence refusal before state, finish-choice, or DONE writes', async () => {
      const before = await readdir(existingAbsDir);
      const code = await dispatchFinishRecord(
        {
          kind: 'record',
          choice: 'pr',
          prUrl: 'https://github.com/org/repo/pull/1',
          pipelineDir: existingAbsDir,
        },
        scratchParent,
        {
          ...passingRunners,
          evaluateEvidence: async () => ({
            kind: 'refusal',
            code: 'shipped-record-missing',
            expected: '.docs/shipped/feature.md',
            observed: null,
          }),
        },
      );

      expect([code, await readdir(existingAbsDir)]).toEqual([1, before]);
    });

    it('choice=pr treats an unavailable strict-evidence evaluation as an actionable refusal before terminal writes', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const before = await readdir(existingAbsDir);
      const code = await dispatchFinishRecord(
        {
          kind: 'record',
          choice: 'pr',
          prUrl: 'https://github.com/org/repo/pull/1',
          pipelineDir: existingAbsDir,
        },
        scratchParent,
        {
          ...passingRunners,
          evaluateEvidence: async () => {
            throw new Error('durable evidence service unavailable');
          },
        },
      );

      expect([code, await readdir(existingAbsDir), errSpy.mock.calls.flat().join(' ')]).toEqual([
        1,
        before,
        expect.stringMatching(/durable evidence.*unavailable.*refusing/i),
      ]);
    });

    it('choice=pr preserves pre-existing state fields and adds pr_url', async () => {
      const statePath = join(existingAbsDir, 'conduct-state.json');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(
        statePath,
        JSON.stringify({ feature: 'x', session_id: 'y', feature_desc: 'feature' }, null, 2) + '\n',
      );

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
        feature_desc: 'feature',
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

    it('choice=pr writes the engine-owned DONE terminal marker after verification', async () => {
      await dispatchFinishRecord(
        {
          kind: 'record',
          choice: 'pr',
          prUrl: 'https://github.com/org/repo/pull/1',
          pipelineDir: existingAbsDir,
        },
        scratchParent,
        passingRunners,
      );

      await expect(readFile(join(existingAbsDir, 'DONE'), 'utf-8')).resolves.toBeDefined();
    });

    it('choice=pr passes the stable feature slug to durable evidence evaluation', async () => {
      const statePath = join(existingAbsDir, 'conduct-state.json');
      await writeFile(
        statePath,
        JSON.stringify({
          feature_desc: 'Engineer handoff pushes spec branch before PR creation (#331)',
          worktree_branch: 'spec/engineer-handoff-pushes-spec-branch-331',
        }),
      );
      let observedSlug = '';
      const runners: FinishRecordRunners = {
        ...passingRunners,
        evaluateEvidence: async (input) => {
          observedSlug = input.slug;
          return validEvidence;
        },
      };

      await dispatchFinishRecord(
        {
          kind: 'record',
          choice: 'pr',
          prUrl: 'https://github.com/org/repo/pull/1',
          pipelineDir: existingAbsDir,
        },
        scratchParent,
        runners,
      );

      expect(observedSlug).toBe('engineer-handoff-pushes-spec-branch-331');
    });

    it('choice=pr rejects a malformed worktree branch before evidence or terminal writes', async () => {
      await writeFile(
        join(existingAbsDir, 'conduct-state.json'),
        JSON.stringify({
          feature_desc: 'Engineer handoff pushes spec branch before PR creation (#331)',
          worktree_branch: 'unknown/engineer-handoff-pushes-spec-branch-331',
        }),
      );
      let evaluateCalls = 0;
      const runners: FinishRecordRunners = {
        ...passingRunners,
        evaluateEvidence: async () => {
          evaluateCalls += 1;
          return validEvidence;
        },
      };

      const code = await dispatchFinishRecord(
        {
          kind: 'record',
          choice: 'pr',
          prUrl: 'https://github.com/org/repo/pull/1',
          pipelineDir: existingAbsDir,
        },
        scratchParent,
        runners,
      );

      expect({ code, evaluateCalls, entries: await readdir(existingAbsDir) }).toEqual({
        code: 1,
        evaluateCalls: 0,
        entries: ['conduct-state.json'],
      });
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
      expect(after).toContain('conduct-state.json');
      expect(JSON.parse(await readFile(join(existingAbsDir, 'conduct-state.json'), 'utf-8'))).toEqual({
        feature_desc: 'feature',
      });
    });
  });

  describe('dispatchFinishRecord — CONDUCT_DAEMON_AUTO_FINISH keep gate', () => {
    let scratchParent: string;
    let existingAbsDir: string;
    let previousEnv: string | undefined;

    beforeEach(async () => {
      scratchParent = await mkdtemp(join(tmpdir(), 'finish-record-auto-finish-'));
      existingAbsDir = await mkdtemp(join(scratchParent, 'pipeline-'));
      await writeFile(
        join(existingAbsDir, 'conduct-state.json'),
        JSON.stringify({ feature_desc: 'feature' }),
      );
      previousEnv = process.env.CONDUCT_DAEMON_AUTO_FINISH;
    });

    afterEach(async () => {
      if (previousEnv === undefined) delete process.env.CONDUCT_DAEMON_AUTO_FINISH;
      else process.env.CONDUCT_DAEMON_AUTO_FINISH = previousEnv;
      vi.restoreAllMocks();
      await rm(scratchParent, { recursive: true, force: true });
    });

    it('refuses choice=keep when a git remote is configured and the daemon-auto-finish marker is set', async () => {
      process.env.CONDUCT_DAEMON_AUTO_FINISH = '1';
      const runGit = vi.fn(async (args: string[]) => {
        if (args[0] === 'remote') return { stdout: 'origin\n' };
        throw new Error(`unexpected git args: ${args.join(' ')}`);
      });
      const runGh = vi.fn(async () => {
        throw new Error('runGh must not be called when refusing keep');
      });
      const code = await dispatchFinishRecord(
        { kind: 'record', choice: 'keep', pipelineDir: existingAbsDir },
        scratchParent,
        { runGit, runGh },
      );

      expect(code).toBe(1);
      expect(runGit).toHaveBeenCalledWith(['remote'], { cwd: dirname(existingAbsDir) });
      expect(runGh).not.toHaveBeenCalled();
      const after = await readdir(existingAbsDir);
      expect(after).not.toContain('finish-choice');
      expect(after).not.toContain('DONE');
    });

    it('allows choice=keep when the daemon-auto-finish marker is set but no git remote is configured', async () => {
      process.env.CONDUCT_DAEMON_AUTO_FINISH = '1';
      const runGit = vi.fn(async (args: string[]) => {
        if (args[0] === 'remote') return { stdout: '' };
        throw new Error(`unexpected git args: ${args.join(' ')}`);
      });
      const runGh = vi.fn(async () => {
        throw new Error('runGh must not be called for choice=keep');
      });
      const code = await dispatchFinishRecord(
        { kind: 'record', choice: 'keep', pipelineDir: existingAbsDir },
        scratchParent,
        { runGit, runGh },
      );

      expect(code).toBe(0);
      const marker = await readFile(join(existingAbsDir, 'finish-choice'), 'utf-8');
      expect(marker.trim()).toBe('keep');
    });

    it('allows choice=keep with a remote configured when the daemon-auto-finish marker is absent (interactive/default mode unaffected)', async () => {
      delete process.env.CONDUCT_DAEMON_AUTO_FINISH;
      const runGit = vi.fn(async () => {
        throw new Error('runGit must not be called for choice=keep outside auto-finish mode');
      });
      const runGh = vi.fn(async () => {
        throw new Error('runGh must not be called for choice=keep');
      });
      const code = await dispatchFinishRecord(
        { kind: 'record', choice: 'keep', pipelineDir: existingAbsDir },
        scratchParent,
        { runGit, runGh },
      );

      expect(code).toBe(0);
      expect(runGit).not.toHaveBeenCalled();
      const marker = await readFile(join(existingAbsDir, 'finish-choice'), 'utf-8');
      expect(marker.trim()).toBe('keep');
    });

    it('fails closed (refuses keep) when the remote check itself throws', async () => {
      process.env.CONDUCT_DAEMON_AUTO_FINISH = '1';
      const runGit = vi.fn(async () => {
        throw new Error('git not found');
      });
      const runGh = vi.fn(async () => {
        throw new Error('runGh must not be called when refusing keep');
      });
      const code = await dispatchFinishRecord(
        { kind: 'record', choice: 'keep', pipelineDir: existingAbsDir },
        scratchParent,
        { runGit, runGh },
      );

      expect(code).toBe(1);
      const after = await readdir(existingAbsDir);
      expect(after).not.toContain('finish-choice');
    });

    it('does not gate choice=pr (the gate only applies to choice=keep)', async () => {
      process.env.CONDUCT_DAEMON_AUTO_FINISH = '1';
      const runGit = vi.fn(async (args: string[]) => {
        if (args[0] === 'remote') return { stdout: 'origin\n' };
        if (args[0] === 'rev-parse' && args.includes('@{u}')) return { stdout: 'refs/remotes/origin/feat\n' };
        if (args[0] === 'merge-base') return { stdout: '' };
        if (args[0] === 'rev-parse' && args.includes('HEAD')) return { stdout: 'candidate\n' };
        throw new Error(`unexpected git args: ${args.join(' ')}`);
      });
      const runGh = vi.fn(async () => ({
        stdout: JSON.stringify({ url: 'https://github.com/org/repo/pull/1', headRefOid: 'candidate' }),
      }));
      const code = await dispatchFinishRecord(
        {
          kind: 'record',
          choice: 'pr',
          prUrl: 'https://github.com/org/repo/pull/1',
          pipelineDir: existingAbsDir,
        },
        scratchParent,
        { runGit, runGh, evaluateEvidence: async () => validEvidence },
      );

      expect(code).toBe(0);
      const marker = await readFile(join(existingAbsDir, 'finish-choice'), 'utf-8');
      expect(marker.trim()).toBe('pr');
    });
  });

  describe('dispatchFinishRecord — commit-point and corrupt-state refusals', () => {
    let scratchParent: string;
    let existingAbsDir: string;
    let passingRunners: FinishRecordRunners;

    beforeEach(async () => {
      scratchParent = await mkdtemp(join(tmpdir(), 'finish-record-commit-point-'));
      existingAbsDir = await mkdtemp(join(scratchParent, 'pipeline-'));
      await writeFile(
        join(existingAbsDir, 'conduct-state.json'),
        JSON.stringify({ feature_desc: 'feature' }),
      );
      passingRunners = {
        runGh: vi.fn(async () => ({
          stdout: JSON.stringify({ url: 'https://github.com/org/repo/pull/1', headRefOid: 'candidate' }),
        })),
        runGit: vi.fn(async (args: string[]) => {
          if (args[0] === 'rev-parse' && args.includes('@{u}')) {
            return { stdout: 'refs/remotes/origin/feat\n' };
          }
          if (args[0] === 'merge-base') {
            return { stdout: '' };
          }
          if (args[0] === 'rev-parse' && args.includes('HEAD')) {
            return { stdout: 'candidate\n' };
          }
          if (args[0] === 'rev-parse' && args.includes('@{u}')) {
            return { stdout: 'upstream\n' };
          }
          throw new Error(`unexpected git args: ${args.join(' ')}`);
        }),
        evaluateEvidence: async () => validEvidence,
      };
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      failStateWriteFor = null;
      await rm(scratchParent, { recursive: true, force: true });
    });

    it('refuses when state-write fails: exit !=0, finish-choice marker never written (commit-point protection)', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      failStateWriteFor = 'conduct-state.json';

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

      expect(code).not.toBe(0);
      const after = await readdir(existingAbsDir);
      expect(after).not.toContain('finish-choice');
      expect(errSpy.mock.calls.flat().join(' ')).toMatch(/state/i);
      failStateWriteFor = null;
    });

    it('refuses on corrupt JSON in existing state file: file left byte-identical, no marker written', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const statePath = join(existingAbsDir, 'conduct-state.json');
      const corrupt = '{ this is not valid json ';
      const { writeFile } = await import('node:fs/promises');
      await writeFile(statePath, corrupt, 'utf-8');

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

      expect(code).not.toBe(0);
      const rawAfter = await readFile(statePath, 'utf-8');
      expect(rawAfter).toBe(corrupt);
      const after = await readdir(existingAbsDir);
      expect(after).not.toContain('finish-choice');
      expect(errSpy.mock.calls.flat().join(' ')).toMatch(/corrupt|invalid json/i);
    });

    it('leaves a prior valid finish-choice from an earlier attempt untouched by a later refusal', async () => {
      const markerPath = join(existingAbsDir, 'finish-choice');
      const statePath = join(existingAbsDir, 'conduct-state.json');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(markerPath, 'keep\n', 'utf-8');
      const corrupt = '{ broken ';
      await writeFile(statePath, corrupt, 'utf-8');

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

      expect(code).not.toBe(0);
      const markerAfter = await readFile(markerPath, 'utf-8');
      expect(markerAfter).toBe('keep\n');
      const rawStateAfter = await readFile(statePath, 'utf-8');
      expect(rawStateAfter).toBe(corrupt);
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

  describe('index.ts CLI dispatch wiring', () => {
    it('detects `finish-record` (no flags) as a guide dispatch via the same detector index.ts uses', () => {
      expect(detectFinishRecordCommand(['node', 'conduct-ts', 'finish-record'])).toEqual({
        kind: 'guide',
      });
    });

    it('index.ts imports and dispatches detectFinishRecordCommand/dispatchFinishRecord adjacent to shipped-record', async () => {
      const src = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8');
      expect(src).toMatch(
        /import\s*\{\s*detectFinishRecordCommand,\s*dispatchFinishRecord,\s*makeProductionFinishRecordRunners,?\s*\}\s*from\s*['"]\.\/engine\/finish-record-cli\.js['"]/,
      );
      expect(src).toMatch(/detectFinishRecordCommand\(process\.argv\)/);
      expect(src).toMatch(
        /dispatchFinishRecord\(finishRecordCmd, process\.cwd\(\), makeProductionFinishRecordRunners\(\)\)/,
      );
    });
  });
});
