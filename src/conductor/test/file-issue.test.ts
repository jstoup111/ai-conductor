// Covers: task:3
// Unit coverage for the intake creation transaction's terminal adapter.
// GitHub is faked at the GhRunner boundary; fileIntakeIssue receives only the
// creation-scoped authority and registered-operation runner.

import { describe, expect, it } from 'vitest';

import {
  createIntakeFilingOperations,
  fileIntakeIssue,
} from '../src/engine/engineer/intake/file-issue.js';
import type { GhRunner } from '../src/engine/tracker-client.js';

function makeFakeGh(opts: {
  failIssueCreate?: boolean;
  failLabelApply?: boolean;
  failDependencyPostFor?: number;
  failDependencyReadFor?: number;
} = {}) {
  const calls: string[][] = [];
  const run: GhRunner = async (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'create') {
      if (opts.failIssueCreate) throw new Error('simulated issue-create failure');
      const repo = args[args.indexOf('-R') + 1] ?? 'acme/app';
      return { stdout: `https://github.com/${repo}/issues/300\n` };
    }
    if (args.some((arg) => arg.endsWith('/labels'))) {
      if (opts.failLabelApply) throw new Error('simulated label-apply outage');
      return { stdout: '{}' };
    }
    if (args.some((arg) => arg.includes('/dependencies/blocked_by'))) {
      const failedDependencyPost = opts.failDependencyPostFor;
      if (failedDependencyPost !== undefined
        && args.some((arg) => arg === `issue_id=${1_000_000 + failedDependencyPost}`)) {
        throw new Error('HTTP 422 dependency rejected');
      }
      return { stdout: '{}' };
    }
    if (args.some((arg) => /^repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(arg))) {
      if (args.some((arg) => arg.endsWith(`/issues/${opts.failDependencyReadFor}`))) {
        throw new Error('dependency id read failed');
      }
      const issueNumber = Number(args.find((arg) => /^repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(arg))!.split('/').at(-1));
      return { stdout: JSON.stringify({ id: 1_000_000 + issueNumber }) };
    }
    return { stdout: '{}' };
  };
  return { calls, run };
}

function creation(gh: GhRunner, repository = 'acme/app') {
  const authority = {
    resolveActor: async () => ({ resolved: true as const, id: 'alice' }),
    intent: { kind: 'explicit-intake' as const, repository },
  };
  return {
    authority,
    operations: createIntakeFilingOperations(gh, '.', authority),
  };
}

describe('fileIntakeIssue — creation-scoped terminal adapter', () => {
  it('creates through the registered creation operation, not a tracker fallback', async () => {
    const gh = makeFakeGh();

    const result = await fileIntakeIssue({
      title: 'Something broke', body: 'Observed X, expected Y', size: 'L', priority: 'critical',
    }, { creation: creation(gh.run) });

    expect(result).toMatchObject({ ok: true, issueUrl: 'https://github.com/acme/app/issues/300' });
    expect(gh.calls[0]).toEqual([
      'issue', 'create', '-R', 'acme/app', '--title', 'Something broke', '--body', 'Observed X, expected Y',
    ]);
  });

  it('uses an explicit repository as both creation intent and terminal target', async () => {
    const gh = makeFakeGh();

    await fileIntakeIssue({
      title: 'Cross-repo report', body: 'body', size: 'S', priority: 'low', repo: 'acme/other-repo',
    }, { creation: creation(gh.run, 'acme/other-repo') });

    expect(gh.calls[0]).toContain('acme/other-repo');
  });

  it('applies size and priority only after a successful canonical creation', async () => {
    const gh = makeFakeGh();

    await fileIntakeIssue({ title: 'Has labels', body: 'body', size: 'M', priority: 'medium' }, {
      creation: creation(gh.run),
    });

    expect(gh.calls.filter((args) => args.some((arg) => arg.endsWith('/labels')))).toEqual([
      expect.arrayContaining(['repos/acme/app/issues/300/labels', 'labels[]=priority: medium']),
      expect.arrayContaining(['repos/acme/app/issues/300/labels', 'labels[]=size: M']),
    ]);
  });

  it('reports a creation transport failure without attempting metadata', async () => {
    const gh = makeFakeGh({ failIssueCreate: true });

    const result = await fileIntakeIssue({ title: 'Fails', body: 'body', size: 'S', priority: 'low' }, {
      creation: creation(gh.run),
    });

    expect(result).toMatchObject({ ok: false, issueUrl: '', warnings: [expect.stringContaining('simulated issue-create failure')] });
    expect(gh.calls).toHaveLength(1);
  });

  it('closes its creation-scoped guarded runner after filing, so it cannot mutate the created issue later', async () => {
    const gh = makeFakeGh();
    const scoped = creation(gh.run);

    await fileIntakeIssue({ title: 'One transaction', body: 'body', size: 'S', priority: 'low' }, {
      creation: scoped,
    });
    const before = gh.calls.length;

    await expect(scoped.operations.run({
      operation: 'issue.label.add', access: 'feature-write',
      target: { repository: 'acme/app', kind: 'issue', number: 300 },
      context: { actor: 'alice' }, payload: { label: 'later-write' },
    })).resolves.toEqual({ kind: 'refused', reason: 'explicit-authorization-required' });

    expect(gh.calls).toHaveLength(before);
  });

  it('reports a rejected dependency POST as unlinked without failing the filing', async () => {
    const gh = makeFakeGh({ failDependencyPostFor: 43 });

    const result = await fileIntakeIssue({
      title: 'Partial links', body: 'body', size: 'S', priority: 'low',
      dependsOn: ['acme/app#42', 'acme/app#43'],
    }, { creation: creation(gh.run) });

    expect(result.ok).toBe(true);
    expect(result.issueUrl).toBe('https://github.com/acme/app/issues/300');
    expect(result.linked).toEqual(['acme/app#42']);
    expect(result.unlinked).toEqual([
      { ref: 'acme/app#43', reason: 'HTTP 422 dependency rejected' },
    ]);
  });

  it('reports a failed dependency id read as unlinked while retaining successful links', async () => {
    const gh = makeFakeGh({ failDependencyReadFor: 43 });

    const result = await fileIntakeIssue({
      title: 'Partial links', body: 'body', size: 'S', priority: 'low',
      dependsOn: ['acme/app#42', 'acme/app#43'],
    }, { creation: creation(gh.run) });

    expect(result.ok).toBe(true);
    expect(result.linked).toEqual(['acme/app#42']);
    expect(result.unlinked).toEqual([
      { ref: 'acme/app#43', reason: expect.stringContaining('dependency id read failed') },
    ]);
  });

  it('returns no unlinked dependencies when every dependency link succeeds', async () => {
    const gh = makeFakeGh();

    const result = await fileIntakeIssue({
      title: 'All links', body: 'body', size: 'S', priority: 'low', dependsOn: ['acme/app#42'],
    }, { creation: creation(gh.run) });

    expect(result.unlinked).toEqual([]);
  });
});
