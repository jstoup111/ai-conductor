// Covers: task:3, task:4, task:5, task:6

import { describe, expect, it } from 'vitest';
import type { GithubOperationRequest, GithubOperationRunner } from '../../../../src/engine/github-operations.js';
import type { GhRunner } from '../../../../src/engine/tracker-client.js';
import { applyIssueEventSync } from '../../../../src/engine/engineer/intake/issue-event-sync.js';

const REPOSITORY = 'acme/app';

function opened(body: string) {
  return {
    action: 'opened',
    repository: { full_name: REPOSITORY },
    issue: { number: 20, body },
    sender: { login: 'intake-operator' },
  };
}

function edited(body: string) {
  return {
    ...opened(body),
    action: 'edited',
  };
}

function formBody(): string {
  return [
    '### Priority', '', 'high', '',
    '### Size', '', 'M', '',
    '### Depends on', '', '#10', '',
    '### Observed', '', 'This is blocked by #12.',
  ].join('\n');
}

function makeDeps(existingTargets: readonly number[] = [], options: {
  readonly missingTargets?: readonly number[];
  readonly networkError?: string;
  readonly dependencyRefusal?: 'explicit-authorization-required' | 'cycle-rejection';
} = {}) {
  const requests: GithubOperationRequest[] = [];
  const labels: string[] = [];
  const linkedTargets = new Set(existingTargets);
  const gh: GhRunner = async (args) => {
    if (options.networkError) throw new Error(options.networkError);
    const path = args.find((arg) => arg.includes('/dependencies/blocked_by'));
    if (path && !args.includes('POST')) {
      return {
        stdout: JSON.stringify([...linkedTargets].map((number) => ({
          number,
          repository_url: `https://api.github.com/repos/${REPOSITORY}`,
        }))),
      };
    }
    const issue = args.find((arg) => /^repos\/acme\/app\/issues\/\d+$/.test(arg));
    if (issue) {
      const number = Number(issue.split('/').at(-1));
      if (options.missingTargets?.includes(number)) return { stdout: '{}' };
      return { stdout: JSON.stringify({ id: 1_000_000 + number }) };
    }
    return { stdout: '{}' };
  };
  const operations: GithubOperationRunner = {
    async run(request) {
      requests.push(request);
      if (request.operation === 'intake.issue.label.add') {
        labels.push((request.payload as { label: string }).label);
      }
      if (request.operation === 'intake.issue.dependency.add') {
        if (options.dependencyRefusal) return { kind: 'refused', reason: options.dependencyRefusal };
        linkedTargets.add((request.payload as { dependency: { number: number } }).dependency.number);
      }
      return {};
    },
  };

  return {
    deps: { gh, operations, actor: 'intake-operator', cwd: '/repo' },
    requests,
    labels,
    linkedTargets,
  };
}

function dependencyTargets(requests: readonly GithubOperationRequest[]): string[] {
  const writes = requests
    .filter((request) => request.operation === 'intake.issue.dependency.add')
    .map((request) => {
      expect(request.target).toEqual({ repository: REPOSITORY, kind: 'issue', number: 20 });
      const payload = request.payload as { dependency: { repository: string; number: number } };
      return `${payload.dependency.repository}#${payload.dependency.number}`;
    });
  return writes;
}

describe('applyIssueEventSync', () => {
  it.each([
    ['This is blocked by #10.', ['acme/app#10']],
    ['Depends on: #10 / #11', ['acme/app#10', 'acme/app#11']],
    ['Gated on #10', ['acme/app#10']],
  ])('links declared prose from an opened non-form issue: %s', async (body, targets) => {
    const { deps, requests } = makeDeps();

    const report = await applyIssueEventSync(opened(body), deps);

    expect(dependencyTargets(requests)).toEqual(targets);
    expect(report.failures).toEqual([]);
  });

  it('unions form Depends-on and prose edges while retaining issue-form labels', async () => {
    const { deps, requests, labels } = makeDeps();

    const report = await applyIssueEventSync(opened(formBody()), deps);

    expect(dependencyTargets(requests)).toEqual(['acme/app#10', 'acme/app#12']);
    expect(labels).toEqual(expect.arrayContaining(['priority: high', 'size: M']));
    expect(report.labels).toMatchObject({ priorityLabel: 'priority: high', sizeLabel: 'size: M' });
  });

  it('reports an existing edge without posting it again', async () => {
    const { deps, requests } = makeDeps([10]);

    const report = await applyIssueEventSync(opened('blocked by #10'), deps);

    expect(dependencyTargets(requests)).toEqual([]);
    expect(report.links).toMatchObject([{ edge: { target: 'acme/app#10' }, status: 'already-present' }]);
    expect(report.failures).toEqual([]);
  });

  it('deduplicates repeated declarations and leaves unrelated or absent prose untouched', async () => {
    const duplicate = makeDeps();
    await applyIssueEventSync(opened('blocked by #10; then blocked by #10'), duplicate.deps);
    expect(dependencyTargets(duplicate.requests)).toEqual(['acme/app#10']);

    const noDeclaration = makeDeps();
    const report = await applyIssueEventSync(opened('No dependency is declared here.'), noDeclaration.deps);
    expect(dependencyTargets(noDeclaration.requests)).toEqual([]);
    expect(report.failures).toEqual([]);

    const related = makeDeps();
    await applyIssueEventSync(opened('blocked by #10 and related to #11'), related.deps);
    expect(dependencyTargets(related.requests)).toEqual(['acme/app#10']);
  });

  it.each([
    'related to #10',
    'see #10',
    'blocks #10',
    'blocker for #10',
    'blocked by other-owner/other-repo#10',
    'blocked by',
  ])('issues zero blocked_by writes for ambiguous, reverse, or cross-repo prose: %s', async (body) => {
    const { deps, requests } = makeDeps();

    await applyIssueEventSync(opened(body), deps);

    expect(dependencyTargets(requests)).toEqual([]);
  });

  it('never reverses blocked_by writes for reverse-direction prose', async () => {
    for (const body of ['blocks #10', 'blocker for #10']) {
      const { deps, requests } = makeDeps();

      await applyIssueEventSync(opened(body), deps);

      expect(dependencyTargets(requests)).not.toContain('acme/app#10');
      expect(requests.filter((request) => request.operation === 'intake.issue.dependency.add')).toEqual([]);
    }
  });

  it('makes no tracker write attempt for a self-referential opened issue', async () => {
    const { deps, requests } = makeDeps();

    await applyIssueEventSync(opened('blocked by #20'), deps);

    expect(requests).toEqual([]);
  });

  it('adds new edited declarations while retaining existing blocked_by links', async () => {
    const { deps, requests, linkedTargets } = makeDeps([10]);

    await applyIssueEventSync(edited('blocked by #10 and depends on #11'), deps);

    expect(dependencyTargets(requests)).toEqual(['acme/app#11']);
    expect([...linkedTargets].sort((left, right) => left - right)).toEqual([10, 11]);
    expect(requests.filter((request) => request.operation === 'intake.issue.dependency.remove')).toEqual([]);
  });

  it.each([
    ['removed declaration', 'No dependency is declared here.', [10]],
    ['replacement declaration', 'blocked by #12', [10, 12]],
  ])('never removes a prior link after an edited $s', async (_name, body, expectedTargets) => {
    const { deps, requests, linkedTargets } = makeDeps([10]);

    await applyIssueEventSync(edited(body), deps);

    expect(requests.filter((request) => request.operation === 'intake.issue.dependency.remove')).toEqual([]);
    expect([...linkedTargets].sort((left, right) => left - right)).toEqual(expectedTargets);
    if (body === 'blocked by #12') expect(dependencyTargets(requests)).toEqual(['acme/app#12']);
  });

  it('uses the current edited body as the declaration of record', async () => {
    const alreadyLinked = makeDeps([10]);
    await applyIssueEventSync(edited('blocked by #10'), alreadyLinked.deps);
    expect(dependencyTargets(alreadyLinked.requests)).toEqual([]);
    expect([...alreadyLinked.linkedTargets]).toEqual([10]);

    const restored = makeDeps();
    await applyIssueEventSync(edited('blocked by #10'), restored.deps);
    expect(dependencyTargets(restored.requests)).toEqual(['acme/app#10']);
    expect([...restored.linkedTargets]).toEqual([10]);
  });

  it('reports an unresolved target while retaining successful links and form labels', async () => {
    const { deps, requests, labels } = makeDeps([], { missingTargets: [99_999] });

    const report = await applyIssueEventSync(
      opened(formBody().replace('#10', '#10 / #99999')),
      deps,
    );

    expect(dependencyTargets(requests)).toEqual(['acme/app#10', 'acme/app#12']);
    expect(labels).toEqual(expect.arrayContaining(['priority: high', 'size: M']));
    expect(report.failures).toEqual([{
      target: 'acme/app#99999',
      reason: 'target issue could not be resolved',
    }]);
  });

  it('reports guarded cycle refusals without writing the rejected link', async () => {
    const { deps, requests, linkedTargets } = makeDeps([], { dependencyRefusal: 'cycle-rejection' });

    const report = await applyIssueEventSync(opened('blocked by #10'), deps);

    expect(dependencyTargets(requests)).toEqual(['acme/app#10']);
    expect(linkedTargets).toEqual(new Set());
    expect(report.links).toEqual([]);
    expect(report.failures).toEqual([{
      target: 'acme/app#10',
      reason: expect.stringContaining('cycle-rejection'),
    }]);
  });

  it('reports every network-failed target while still applying form labels', async () => {
    const { deps, requests, labels } = makeDeps([], { networkError: 'network unavailable' });

    const report = await applyIssueEventSync(opened(formBody()), deps);

    expect(dependencyTargets(requests)).toEqual([]);
    expect(labels).toEqual(expect.arrayContaining(['priority: high', 'size: M']));
    expect(report.failures).toEqual([
      { target: 'acme/app#10', reason: 'network unavailable' },
      { target: 'acme/app#12', reason: 'network unavailable' },
    ]);
  });

  it.each(['opened', 'edited'])(
    'reports fresh explicit-authorization-required refusal for a %s event',
    async (action) => {
      const { deps, requests, linkedTargets } = makeDeps([], { dependencyRefusal: 'explicit-authorization-required' });
      const event = action === 'edited' ? edited('blocked by #10') : opened('blocked by #10');

      const report = await applyIssueEventSync(event, deps);

      expect(dependencyTargets(requests)).toEqual(['acme/app#10']);
      expect(linkedTargets).toEqual(new Set());
      expect(report.links).toEqual([]);
      expect(report.failures).toEqual([{
        target: 'acme/app#10',
        reason: expect.stringContaining('explicit-authorization-required'),
      }]);
    },
  );
});
