// Covers: task:7
import { describe, expect, it } from 'vitest';

import {
  createGithubTrackerClient,
  GithubTrackerOperationRefusalError,
  type EffectMarkerTrackerClient,
  type GhRunner,
  type GithubMutationExecutionContext,
} from '../../../src/engine/tracker-client.js';

type GuardedTrackerFactory = (
  runner: GhRunner,
  options: { readonly mutation: GithubMutationExecutionContext; readonly repository: string },
) => EffectMarkerTrackerClient;

function fakeTerminal(): {
  readonly runner: GhRunner;
  readonly calls: Array<{ readonly args: string[]; readonly opts: { readonly cwd: string } }>;
} {
  const calls: Array<{ args: string[]; opts: { cwd: string } }> = [];
  return {
    runner: async (args, opts) => {
      calls.push({ args, opts });
      if (args[0] === 'api' && args[1] === 'repos/acme/foreign/issues/42') {
        return { stdout: JSON.stringify({ labels: [{ name: 'foreign-read' }] }) };
      }
      return { stdout: 'https://github.com/acme/owned/issues/18\n' };
    },
    calls,
  };
}

function mutationRepository(args: readonly string[]): string | null {
  const flag = args.findIndex((arg) => arg === '-R' || arg === '--repo');
  if (flag >= 0) return args[flag + 1] ?? null;
  return /^repos\/([^/]+\/[^/]+)\/issues\//.exec(args.find((arg) => arg.startsWith('repos/')) ?? '')?.[1] ?? null;
}

function isIssueMutation(args: readonly string[]): boolean {
  return (args[0] === 'issue' && ['comment', 'create', 'edit', 'close'].includes(args[1] ?? ''))
    || (args[0] === 'api' && args.includes('--method'));
}

describe('engine/tracker-client — issue operations use guarded requests', () => {
  it('executes the owned issue mutation suite, refuses foreign mutation effects, and retains foreign reads without authorization', async () => {
    const terminal = fakeTerminal();
    const authorizationChecks: string[] = [];
    const client = (createGithubTrackerClient as unknown as GuardedTrackerFactory)(terminal.runner, {
      mutation: {
        provenance: {
          repository: 'acme/owned',
          defaultBranch: 'main',
          specBranch: 'spec/owned',
          featureMarker: '.docs/specs/owned.md',
          publication: 'initial',
        },
        dependencies: {
          resolveMachineOwner: async () => {
            authorizationChecks.push('identity');
            return { resolved: true, id: 'alice' };
          },
          provenanceDiscovery: {
            readCommittedRecords: async () => {
              authorizationChecks.push('provenance');
              return [{ path: '.docs/specs/owned.md', content: 'Owner: alice\n' }];
            },
          },
        },
      },
      repository: 'acme/owned',
    });

    await client.commentOnIssue('acme/owned', 17, 'owned comment', '/fixture');
    await client.createIssue({ title: 'Owned issue', body: 'owned body' }, '/fixture');
    await client.upsertIssueBody('acme/owned', '17', 'owned body', '/fixture');
    await client.upsertIssueComment('acme/owned', '17', 'owned upsert', '/fixture');
    await client.closeIssue('acme/owned', '17', '/fixture');
    await client.addIssueLabel('acme/owned', 17, 'owned-label', '/fixture');
    await client.removeIssueLabel('acme/owned', 17, 'owned-label', '/fixture');
    await client.addIssueDependency!('acme/owned', 17, { repo: 'acme/foreign', number: 99 }, '/fixture');
    await client.removeIssueDependency!('acme/owned', 17, { repo: 'acme/foreign', number: 99 }, '/fixture');

    const foreignLabels = await client.getIssueLabels('acme/foreign', 42, '/fixture');
    const foreignMutations: Array<Promise<unknown>> = [
      client.commentOnIssue('acme/foreign', 42, 'foreign comment', '/fixture'),
      client.createIssue({ title: 'Foreign issue', body: 'foreign body', repo: 'acme/foreign' }, '/fixture'),
      client.upsertIssueBody('acme/foreign', '42', 'foreign body', '/fixture'),
      client.upsertIssueComment('acme/foreign', '42', 'foreign upsert', '/fixture'),
      client.closeIssue('acme/foreign', '42', '/fixture'),
      client.addIssueLabel('acme/foreign', 42, 'foreign-label', '/fixture'),
      client.removeIssueLabel('acme/foreign', 42, 'foreign-label', '/fixture'),
      client.addIssueDependency!('acme/foreign', 42, { repo: 'acme/owned', number: 17 }, '/fixture'),
      client.removeIssueDependency!('acme/foreign', 42, { repo: 'acme/owned', number: 17 }, '/fixture'),
    ];
    await Promise.all(foreignMutations.map(async (mutation) => {
      await expect(mutation).rejects.toBeInstanceOf(GithubTrackerOperationRefusalError);
    }));

    expect({
      foreignLabels,
      authorizationChecks,
      terminalMutationRepositories: terminal.calls
        .filter(({ args }) => isIssueMutation(args))
        .map(({ args }) => mutationRepository(args)),
    }).toEqual({
      foreignLabels: ['foreign-read'],
      authorizationChecks: [
        'identity', 'provenance',
        'identity', 'provenance',
        'identity', 'provenance',
        'identity', 'provenance',
        'identity', 'provenance',
        'identity', 'provenance',
        'identity', 'provenance',
        'identity', 'provenance',
        'identity', 'provenance',
      ],
      terminalMutationRepositories: [
        'acme/owned',
        'acme/owned',
        'acme/owned',
        'acme/owned',
        'acme/owned',
        'acme/owned',
        'acme/owned',
        'acme/owned',
        'acme/owned',
      ],
    });
  });
});
