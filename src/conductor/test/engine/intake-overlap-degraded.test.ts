// Covers: task:13
import { describe, expect, it } from 'vitest';
import { collectOverlaps } from '../../src/engine/engineer/intake/overlap-preflight.js';
import { collectInFlightOverlaps, collectOpenIssueOverlaps } from '../../src/engine/engineer/intake/overlap-sources.js';
import { buildOverlapSources } from '../../src/engine/engineer/intake/overlap-preflight.js';
import { fileIntakeIssue } from '../../src/engine/engineer/intake/file-issue.js';
import { renderIntakeFileOutput } from '../../src/engine/engineer/intake/filing-output.js';
import { runOverlapPreflight } from '../../src/engine/engineer/intake/overlap-preflight.js';
import type { GitRunner } from '../../src/engine/rebase.js';
import type { GithubOperationRequest } from '../../src/engine/github-operations.js';

describe('degraded overlap collection', () => {
  it('turns failed independent reads into skip notes', async () => {
    const result = await collectOverlaps({ title: 't', body: 'src/a.ts', openIssues: async () => { throw new Error('timed out'); }, inFlight: async () => { throw new Error('no base'); } });
    expect(result.skipNotes).toEqual([{ part: 'open-issues', reason: 'timed out' }, { part: 'in-flight', reason: 'no base' }]);

    const operations: GithubOperationRequest[] = [];
    const filing = await fileIntakeIssue({ title: 't', body: 'src/a.ts', size: 'S', priority: 'low', interactive: false }, {
      overlap: { suggestions: async () => ({ shown: [], preAccepted: [], advisory: [], skipNotes: result.skipNotes }) },
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
    expect(operations.filter(({ operation }) => operation === 'issue.create')).toHaveLength(1);
    expect(filing.overlap).toMatchObject({
      kind: 'proceed',
      skipNotes: [{ part: 'open-issues', reason: 'timed out' }, { part: 'in-flight', reason: 'no base' }],
    });
    expect(renderIntakeFileOutput(filing).stdout).toContain('[intake-file] overlap: skipped open-issues — timed out');
  });

  it('keeps an independently found in-flight suggestion blocking while the open-issue read fails', async () => {
    const collected = await collectOverlaps({
      title: 't', body: 'src/a.ts',
      openIssues: async () => { throw new Error('timed out'); },
      inFlight: async () => ({ overlaps: [{ branch: 'feat/daemon-fix', issue: 'acme/app#1477', sharedPaths: ['src/a.ts'] }] }),
    });
    const decision = await runOverlapPreflight({ title: 't', body: 'src/a.ts', dependsOn: [], interactive: false }, { suggestions: async () => ({
      shown: collected.branchOverlaps.map(({ issue, sharedPaths }) => ({ issue: issue!, sharedPaths: [...sharedPaths] })),
      preAccepted: [], advisory: [], skipNotes: collected.skipNotes,
    }) });
    expect(decision).toMatchObject({
      kind: 'refused',
      undecided: [{ issue: 'acme/app#1477', sharedPaths: ['src/a.ts'] }],
      skipNotes: [{ part: 'open-issues', reason: 'timed out' }],
    });
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

  it('limits an over-returning open-issue lister to 500 comparisons and still files', async () => {
    const issues = Array.from({ length: 501 }, (_, index) => ({
      number: index + 1,
      body: index === 500 ? 'src/a.ts' : 'unrelated.md',
    }));
    const open = await collectOpenIssueOverlaps({
      gh: async () => ({ exitCode: 0, stdout: JSON.stringify(issues), stderr: '' }),
      cwd: '.', repository: 'acme/app', citedPaths: ['src/a.ts'], knownPaths: new Set(['src/a.ts']),
    });
    expect(open.skipNotes).toEqual(['partial comparison: reached 500-issue bound']);
    expect(open.overlaps).not.toContainEqual(expect.objectContaining({ issue: '#501' }));

    const operations: GithubOperationRequest[] = [];
    const result = await fileIntakeIssue({ title: 't', body: 'src/a.ts', size: 'S', priority: 'low', interactive: false }, {
      overlap: { suggestions: async () => ({ shown: open.overlaps.map(({ issue, sharedPaths }) => ({ issue, sharedPaths: [...sharedPaths] })), preAccepted: [], advisory: [], skipNotes: open.skipNotes.map((reason) => ({ part: 'open-issues', reason })) }) },
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
    expect(result.overlap).toMatchObject({ kind: 'proceed', skipNotes: [{ part: 'open-issues', reason: 'partial comparison: reached 500-issue bound' }] });
    expect(operations.filter(({ operation }) => operation === 'issue.create')).toHaveLength(1);
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

  it('records an in-flight skip note when ref enumeration returns a nonzero exit', async () => {
    let openIssueCalls = 0;
    const operations: GithubOperationRequest[] = [];
    const overlap = buildOverlapSources({
      cwd: '/target', repository: 'acme/app',
      gh: async (args) => {
        if (args[0] === 'issue' && args[1] === 'list') openIssueCalls++;
        return { exitCode: 0, stdout: '[]', stderr: '' };
      },
      resolveCheckout: async () => ({ kind: 'checkout', path: '/target' }),
      makeGit: () => async (args) => {
        if (args[0] === 'for-each-ref') return { exitCode: 1, stdout: '', stderr: 'refs unavailable' };
        return { exitCode: 0, stdout: '', stderr: '' };
      },
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

    expect(openIssueCalls).toBe(1);
    expect(operations.filter(({ operation }) => operation === 'issue.create')).toHaveLength(1);
    expect(result.overlap).toMatchObject({
      kind: 'proceed',
      skipNotes: [{ part: 'in-flight', reason: 'skipped in-flight branch enumeration: refs unavailable' }],
    });
    expect(renderIntakeFileOutput(result).stdout).toContain('[intake-file] overlap: skipped in-flight — skipped in-flight branch enumeration: refs unavailable');
  });
});
