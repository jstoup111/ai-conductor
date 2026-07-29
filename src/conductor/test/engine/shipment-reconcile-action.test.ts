import { describe, expect, it, vi } from 'vitest';

describe('shipment reconciliation GitHub Actions adapter', () => {
  it('dispatches merged pull request shipment evidence with the authenticated Actions client', async () => {
    const info = vi.fn();
    const error = vi.fn();
    const dispatches: unknown[] = [];
    const dispatchShipmentEvidence = vi.fn(async (command: unknown, cwd: string, runners: { runGh: unknown; report(message: string): void }) => {
      dispatches.push({ command, cwd, runGh: typeof runners.runGh });
      runners.report('reconciled');
      return 0;
    });
    const modulePath = ['../../src/engine', 'shipment-reconcile-action.js'].join('/');
    const loaded = await import(modulePath).catch(() => null) as null | {
      runShipmentReconcileAction?: (
        input: {
          github: object;
          context: {
            repo: { owner: string; repo: string };
            payload: { pull_request: { number: number; html_url: string; merged_at: string } };
          };
          core: { info(message: string): void; error(message: string): void };
          workspace: string;
        },
        deps: { dispatchShipmentEvidence: typeof dispatchShipmentEvidence },
      ) => Promise<unknown>;
    };

    await loaded?.runShipmentReconcileAction?.({
      github: {},
      context: {
        repo: { owner: 'acme', repo: 'conductor' },
        payload: {
          pull_request: {
            number: 916,
            html_url: 'https://github.com/acme/conductor/pull/916',
            merged_at: '2026-07-29T14:25:30Z',
          },
        },
      },
      core: { info, error },
      workspace: '/repo',
    }, { dispatchShipmentEvidence });

    expect({ dispatches, info: info.mock.calls, error: error.mock.calls }).toEqual({
      dispatches: [{
        command: { kind: 'reconcile', pr: 'https://github.com/acme/conductor/pull/916', shipped: '2026-07-29' },
        cwd: '/repo',
        runGh: 'function',
      }],
      info: [['reconciled']],
      error: [],
    });
  });

  it('translates every post-merge gh argv shape through the semantic adapter', async () => {
    const semanticCalls: Array<{ operation: string; input: unknown }> = [];
    const adapter = {
      getPullRequestMetadata: vi.fn(async (input: unknown) => {
        semanticCalls.push({ operation: 'getPullRequestMetadata', input });
        return { url: 'https://github.com/acme/conductor/pull/916', body: 'Implementation body', headSha: 'implementation-head' };
      }),
      listImplementationPullRequestFiles: vi.fn(async (input: unknown) => {
        semanticCalls.push({ operation: 'listImplementationPullRequestFiles', input });
        return [{ path: '.docs/plans/durable-shipped-records.md', status: 'added' }];
      }),
      getRepairBranch: vi.fn(async (input: unknown) => {
        semanticCalls.push({ operation: 'getRepairBranch', input });
        return { name: 'shipment-repair/916/durable-shipped-records', headSha: 'repair-head' };
      }),
      listRepairPullRequests: vi.fn(async (input: unknown) => {
        semanticCalls.push({ operation: 'listRepairPullRequests', input });
        return [];
      }),
      createRepairPullRequest: vi.fn(async (input: unknown) => {
        semanticCalls.push({ operation: 'createRepairPullRequest', input });
        return { url: 'https://github.com/acme/conductor/pull/1000', number: 1000 };
      }),
      getPullRequestHead: vi.fn(async (input: unknown) => {
        semanticCalls.push({ operation: 'getPullRequestHead', input });
        return 'repair-head';
      }),
      postCommitStatus: vi.fn(async (input: unknown) => {
        semanticCalls.push({ operation: 'postCommitStatus', input });
        return undefined;
      }),
    };
    const modulePath = ['../../src/engine', 'shipment-reconcile-action.js'].join('/');
    const loaded = await import(modulePath).catch(() => null) as null | {
      createShipmentReconcileGhRunner?: (input: {
        adapter: typeof adapter;
        implementationPullRequest: { url: string; number: number };
      }) => (args: string[], options: { cwd: string }) => Promise<{ stdout: string }>;
    };
    const runner = loaded?.createShipmentReconcileGhRunner?.({
      adapter,
      implementationPullRequest: { url: 'https://github.com/acme/conductor/pull/916', number: 916 },
    });
    const branch = 'shipment-repair/916/durable-shipped-records';
    const repairUrl = 'https://github.com/acme/conductor/pull/1000';
    const title = 'Repair shipment record';
    const body = 'Record-only repair for #916';
    const description = 'durable shipment evidence valid on repair head';
    const argv = [
      ['pr', 'view', 'https://github.com/acme/conductor/pull/916', '--json', 'url,body,files,headRefOid'],
      ['api', `repos/acme/conductor/git/ref/heads/${branch}`],
      ['pr', 'list', '--head', branch, '--base', 'main', '--state', 'open', '--json', 'url', '--limit', '1'],
      ['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body', body],
      ['pr', 'view', repairUrl, '--json', 'url,headRefOid'],
      ['api', '--method', 'POST', 'repos/acme/conductor/statuses/repair-head', '-f', 'state=success', '-f', 'context=shipped-record', '-f', `description=${description}`],
    ];
    let stdout: unknown = null;
    if (runner) {
      const outputs: unknown[] = [];
      for (const args of argv) {
        const value = (await runner(args, { cwd: '/repo' })).stdout.trim();
        outputs.push(args[0] === 'pr' && args[1] === 'create' ? value : JSON.parse(value) as unknown);
      }
      stdout = outputs;
    }

    expect({ stdout, semanticCalls }).toEqual({
      stdout: [
        { url: 'https://github.com/acme/conductor/pull/916', body: 'Implementation body', files: [{ path: '.docs/plans/durable-shipped-records.md' }], headRefOid: 'implementation-head' },
        { ref: `refs/heads/${branch}`, object: { sha: 'repair-head' } },
        [],
        repairUrl,
        { url: repairUrl, headRefOid: 'repair-head' },
        {},
      ],
      semanticCalls: [
        { operation: 'getPullRequestMetadata', input: { pullNumber: 916 } },
        { operation: 'listImplementationPullRequestFiles', input: { pullNumber: 916 } },
        { operation: 'getRepairBranch', input: { branch } },
        { operation: 'listRepairPullRequests', input: { branch, base: 'main', state: 'open', limit: 1 } },
        { operation: 'createRepairPullRequest', input: { branch, base: 'main', title, body } },
        { operation: 'getPullRequestHead', input: { pullNumber: 1000 } },
        { operation: 'postCommitStatus', input: { sha: 'repair-head', state: 'success', context: 'shipped-record', description } },
      ],
    });
  });

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
