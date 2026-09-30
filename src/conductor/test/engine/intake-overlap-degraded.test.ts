// Covers: task:13
import { describe, expect, it } from 'vitest';
import { collectOverlaps } from '../../src/engine/engineer/intake/overlap-preflight.js';
import { collectInFlightOverlaps, collectOpenIssueOverlaps } from '../../src/engine/engineer/intake/overlap-sources.js';
import { buildOverlapSources } from '../../src/engine/engineer/intake/overlap-preflight.js';
import { fileIntakeIssue } from '../../src/engine/engineer/intake/file-issue.js';
import { renderIntakeFileOutput } from '../../src/engine/engineer/intake/filing-output.js';
import type { GitRunner } from '../../src/engine/rebase.js';
import type { GithubOperationRequest } from '../../src/engine/github-operations.js';

describe('degraded overlap collection', () => {
  it('turns failed independent reads into skip notes', async () => {
    const result = await collectOverlaps({ title: 't', body: 'src/a.ts', openIssues: async () => { throw new Error('timed out'); }, inFlight: async () => { throw new Error('no base'); } });
    expect(result.skipNotes).toEqual([{ part: 'open-issues', reason: 'timed out' }, { part: 'in-flight', reason: 'no base' }]);
  });

  it('reports bounded source comparisons as partial', async () => {
    const issues = Array.from({ length: 500 }, (_, index) => ({ number: index + 1, body: 'src/a.ts' }));
    const open = await collectOpenIssueOverlaps({
      gh: async () => ({ exitCode: 0, stdout: JSON.stringify(issues), stderr: '' }),
      cwd: '.', repository: 'acme/app', citedPaths: ['src/a.ts'], knownPaths: new Set(['src/a.ts']),
    });
    expect(open.skipNotes).toEqual(['partial comparison: reached 500-issue bound']);

    let diffs = 0;
    const branches = Array.from({ length: 101 }, (_, index) => `feat/daemon-${index}`);
    const git: GitRunner = async (args) => {
      if (args[0] === 'for-each-ref') return { exitCode: 0, stdout: branches.join('\n'), stderr: '' };
      if (args[0] === 'rev-list') return { exitCode: 0, stdout: '1', stderr: '' };
      if (args[0] === 'cat-file') return { exitCode: 1, stdout: '', stderr: '' };
      if (args[0] === 'log') return { exitCode: 0, stdout: '1', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'base', stderr: '' };
      if (args[0] === 'diff') { diffs++; return { exitCode: 0, stdout: '', stderr: '' }; }
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const inFlight = await collectInFlightOverlaps({ git, baseRef: 'main', citedPaths: ['src/a.ts'] });
    expect(inFlight.skipNotes).toContain('partial comparison: reached 100-branch bound');
    expect(diffs).toBe(100);
  });

  it('files normally when the production collectors both fail', async () => {
    const operations: GithubOperationRequest[] = [];
    const overlap = buildOverlapSources({
      cwd: '/no-checkout', repository: 'acme/app',
      gh: async () => { throw new Error('gh unavailable'); },
      registryReader: { listProjects: async () => { throw new Error('bad registry'); }, getProject: async () => undefined },
    });
    const result = await fileIntakeIssue({ title: 't', body: 'src/a.ts', size: 'S', priority: 'low', interactive: false }, {
      overlap: { suggestions: overlap },
      creation: {
        authority: { resolveActor: async () => ({ resolved: true as const, id: 'alice' }), intent: { kind: 'explicit-intake', repository: 'acme/app' } },
        operations: { run: async (request) => {
          operations.push(request);
          return request.operation === 'issue.create'
            ? { created: { repository: 'acme/app', kind: 'issue' as const, number: 1 } }
            : {};
        } },
      },
    });
    expect(operations.map(({ operation }) => operation)).toEqual(['issue.create', 'issue.label.add', 'issue.label.add']);
    expect(result.overlap?.kind).toBe('proceed');
    expect(renderIntakeFileOutput(result).stdout).toContain('[intake-file] overlap: skipped open-issues');
    expect(renderIntakeFileOutput(result).stdout).toContain('[intake-file] overlap: skipped in-flight');
  });
});
