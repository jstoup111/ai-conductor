import { describe, expect, it, vi } from 'vitest';

describe('shipment reconciliation GitHub Actions adapter', () => {
  it('translates the complete reconciliation operation surface through the supplied authenticated client', async () => {
    const calls: Array<{ operation: string; input: unknown }> = [];
    const client = {
      rest: {
        pulls: {
          get: vi.fn(async (input: unknown) => {
            calls.push({ operation: 'pulls.get', input });
            const pullNumber = (input as { pull_number: number }).pull_number;
            return pullNumber === 916
              ? { data: { number: 916, html_url: 'https://github.com/acme/conductor/pull/916', merged: true, merge_commit_sha: 'merged-sha', head: { sha: 'implementation-head' } } }
              : { data: { number: 1000, html_url: 'https://github.com/acme/conductor/pull/1000', head: { sha: 'repair-head' } } };
          }),
          listFiles: vi.fn(async (input: unknown) => {
            calls.push({ operation: 'pulls.listFiles', input });
            return { data: [{ filename: '.docs/plans/durable-shipped-records.md', status: 'added' }, { filename: 'src/conductor/index.ts', status: 'modified' }] };
          }),
          list: vi.fn(async (input: unknown) => {
            calls.push({ operation: 'pulls.list', input });
            return { data: [] };
          }),
          create: vi.fn(async (input: unknown) => {
            calls.push({ operation: 'pulls.create', input });
            return { data: { number: 1000, html_url: 'https://github.com/acme/conductor/pull/1000', head: { sha: 'repair-head' } } };
          }),
        },
        repos: {
          getBranch: vi.fn(async (input: unknown) => {
            calls.push({ operation: 'repos.getBranch', input });
            return { data: { name: 'shipment-repair/916/durable-shipped-records', commit: { sha: 'repair-head' } } };
          }),
          createCommitStatus: vi.fn(async (input: unknown) => {
            calls.push({ operation: 'repos.createCommitStatus', input });
            return { data: { state: 'success', context: 'shipped-record' } };
          }),
        },
      },
    };
    const modulePath = ['../../src/engine', 'shipment-reconcile-action.js'].join('/');
    const loaded = await import(modulePath).catch(() => null) as null | {
      createShipmentReconcileGithubAdapter?: (input: { owner: string; repo: string; client: typeof client }) => {
        getImplementationPullRequest(input: { pullNumber: number }): Promise<unknown>;
        listImplementationPullRequestFiles(input: { pullNumber: number }): Promise<unknown>;
        getRepairBranch(input: { branch: string }): Promise<unknown>;
        findOrCreateRepairPullRequest(input: { branch: string; base: string; title: string; body: string }): Promise<unknown>;
        getPullRequestHead(input: { pullNumber: number }): Promise<unknown>;
        postCommitStatus(input: { sha: string; state: string; context: string; description: string }): Promise<unknown>;
      };
    };

    let outputs: unknown = null;
    if (loaded?.createShipmentReconcileGithubAdapter) {
      const adapter = loaded.createShipmentReconcileGithubAdapter({ owner: 'acme', repo: 'conductor', client });
      outputs = {
        implementation: await adapter.getImplementationPullRequest({ pullNumber: 916 }),
        files: await adapter.listImplementationPullRequestFiles({ pullNumber: 916 }),
        branch: await adapter.getRepairBranch({ branch: 'shipment-repair/916/durable-shipped-records' }),
        repairPullRequest: await adapter.findOrCreateRepairPullRequest({ branch: 'shipment-repair/916/durable-shipped-records', base: 'main', title: 'Repair shipment record', body: 'Record-only repair for #916' }),
        repairHead: await adapter.getPullRequestHead({ pullNumber: 1000 }),
        status: await adapter.postCommitStatus({ sha: 'repair-head', state: 'success', context: 'shipped-record', description: 'durable shipment evidence valid on repair head' }),
      };
    }

    expect({ outputs, calls }).toEqual({
      outputs: {
        implementation: { number: 916, url: 'https://github.com/acme/conductor/pull/916', merged: true, mergeCommitSha: 'merged-sha', headSha: 'implementation-head' },
        files: [{ path: '.docs/plans/durable-shipped-records.md', status: 'added' }, { path: 'src/conductor/index.ts', status: 'modified' }],
        branch: { name: 'shipment-repair/916/durable-shipped-records', headSha: 'repair-head' },
        repairPullRequest: { number: 1000, url: 'https://github.com/acme/conductor/pull/1000' },
        repairHead: 'repair-head',
        status: { state: 'success', context: 'shipped-record' },
      },
      calls: [
        { operation: 'pulls.get', input: { owner: 'acme', repo: 'conductor', pull_number: 916 } },
        { operation: 'pulls.listFiles', input: { owner: 'acme', repo: 'conductor', pull_number: 916, per_page: 100 } },
        { operation: 'repos.getBranch', input: { owner: 'acme', repo: 'conductor', branch: 'shipment-repair/916/durable-shipped-records' } },
        { operation: 'pulls.list', input: { owner: 'acme', repo: 'conductor', state: 'open', base: 'main', head: 'acme:shipment-repair/916/durable-shipped-records', per_page: 100 } },
        { operation: 'pulls.create', input: { owner: 'acme', repo: 'conductor', head: 'shipment-repair/916/durable-shipped-records', base: 'main', title: 'Repair shipment record', body: 'Record-only repair for #916' } },
        { operation: 'pulls.get', input: { owner: 'acme', repo: 'conductor', pull_number: 1000 } },
        { operation: 'repos.createCommitStatus', input: { owner: 'acme', repo: 'conductor', sha: 'repair-head', state: 'success', context: 'shipped-record', description: 'durable shipment evidence valid on repair head' } },
      ],
    });
  });
});
