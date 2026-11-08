import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { openSpecPr } from '../../../src/engine/engineer/handoff.js';
import type { HandoffDeps } from '../../../src/engine/engineer/handoff.js';
import type { TargetRepo } from '../../../src/engine/engineer/target.js';
import { dispatchEngineer } from '../../../src/engine/engineer-cli.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';

const REPOSITORY = 'acme/widget';
const BRANCH = 'spec/ready-existing';
const PR_URL = `https://github.com/${REPOSITORY}/pull/42`;
const execFile = promisify(execFileCb);

let root: string;

function target(): TargetRepo {
  return { name: 'widget', canonicalPath: root, remote: `https://github.com/${REPOSITORY}.git` };
}

function publication(calls: Array<{ operation: string; payload?: unknown }>): NonNullable<HandoffDeps['publication']> {
  const run = async (request: { operation: string; payload?: unknown }) => {
    calls.push({ operation: request.operation, payload: request.payload });
    if (request.operation === 'pull-request.create') {
      return { created: { repository: REPOSITORY, kind: 'pull-request' as const, number: 42 } };
    }
    return {};
  };
  const mutation = {
    provenance: {
      repository: REPOSITORY,
      defaultBranch: 'main',
      specBranch: BRANCH,
      featureMarker: '.docs/intake/ready-existing.md',
      publication: 'initial' as const,
    },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true as const, id: 'owner' }),
      provenanceDiscovery: {
        readCommittedRecords: async () => [{ path: '.docs/intake/ready-existing.md', content: 'Owner: owner\n' }],
      },
    },
  };
  return {
    repository: REPOSITORY,
    remote: {
      cwd: root,
      config: async () => ({ stdout: `https://github.com/${REPOSITORY}.git` }),
      runRemoteGit: async () => ({ stdout: '', stderr: '' }),
      mutation,
    },
    operations: { run },
    presentation: () => ({ run }),
  };
}

function deps(input: {
  calls: Array<{ operation: string; payload?: unknown }>;
  existing: { url: string; isDraft: boolean } | undefined;
  failReady?: boolean;
}): HandoffDeps {
  const ops = publication(input.calls);
  return {
    publication: {
      ...ops,
      presentation: (_url) => ({
        run: async (request) => {
          input.calls.push({ operation: request.operation, payload: request.payload });
          if (request.operation === 'pull-request.ready' && input.failReady) {
            throw new Error('ready failed');
          }
          return {};
        },
      }),
    },
    gitRunner: async (args) => ({
      stdout: args[0] === 'show' && args[1] === '-s'
        ? 'Landed spec title\n\nLanded body\n'
        : '',
      stderr: '',
    }),
    runner: async (args) => {
      if (args[0] === 'pr' && args[1] === 'view' && args[2] === BRANCH) {
        return { stdout: JSON.stringify(input.existing ?? {}), stderr: '' };
      }
      return { stdout: JSON.stringify({ body: '' }), stderr: '' };
    },
    findExistingSpecPr: async () => input.existing,
    worktreePath: root,
    sourceRef: 'acme/widget#7',
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'handoff-ready-existing-'));
  await mkdir(join(root, '.github'), { recursive: true });
  await writeFile(join(root, '.github', 'pull_request_template.md'), 'Release-Disposition: no-note\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('openSpecPr — existing draft handoff (Task 8)', () => {
  it('pushes, presents, and readies the existing draft without creating another PR', async () => {
    const calls: Array<{ operation: string; payload?: unknown }> = [];

    await expect(openSpecPr(target(), BRANCH, deps({
      calls,
      existing: { url: PR_URL, isDraft: true },
    }))).resolves.toEqual({ kind: 'pr-opened', url: PR_URL });

    expect(calls).toEqual([
      {
        operation: 'pull-request.edit',
        payload: {
          title: 'Landed spec title',
          body: [
            'Landed spec title',
            '',
            'Landed body',
            '',
            '## Release metadata',
            '',
            'Release-Disposition: no-note',
            '',
            '## Migration',
            '',
            'none',
            '',
            'Refs acme/widget#7',
          ].join('\n'),
        },
      },
      { operation: 'pull-request.ready', payload: undefined },
    ]);
  });

  it('creates exactly one PR only when branch lookup finds none', async () => {
    const calls: Array<{ operation: string; payload?: unknown }> = [];

    await expect(openSpecPr(target(), BRANCH, deps({ calls, existing: undefined }))).resolves.toEqual({
      kind: 'pr-opened',
      url: PR_URL,
    });

    expect(calls.filter((call) => call.operation === 'pull-request.create')).toHaveLength(1);
    expect(calls.filter((call) => call.operation === 'pull-request.ready')).toHaveLength(0);
  });

  it('leaves the draft retryable when ready fails, then finishes it without creating a duplicate', async () => {
    const calls: Array<{ operation: string; payload?: unknown }> = [];

    await expect(openSpecPr(target(), BRANCH, deps({
      calls,
      existing: { url: PR_URL, isDraft: true },
      failReady: true,
    }))).rejects.toThrow('ready failed');
    await expect(openSpecPr(target(), BRANCH, deps({
      calls,
      existing: { url: PR_URL, isDraft: true },
    }))).resolves.toEqual({ kind: 'pr-opened', url: PR_URL });

    expect(calls.filter((call) => call.operation === 'pull-request.create')).toHaveLength(0);
    expect(calls.filter((call) => call.operation === 'pull-request.ready')).toHaveLength(2);
  });

  it('recognizes an already-ready retry without another PR mutation', async () => {
    const calls: Array<{ operation: string; payload?: unknown }> = [];

    await expect(openSpecPr(target(), BRANCH, deps({
      calls,
      existing: { url: PR_URL, isDraft: false },
    }))).resolves.toMatchObject({ kind: 'pr-opened', url: PR_URL, alreadyDelivered: true });

    expect(calls).toEqual([]);
  });

  it('compose handoff reports the readied PR, records done, labels/comments once, and wakes the daemon once', async () => {
    const registryPath = join(root, 'registry.json');
    const engineerDir = join(root, 'engineer');
    const git = async (args: string[], cwd = root) => execFile('git', args, { cwd });
    await git(['init', '-b', 'main', '-q']);
    await git(['config', 'user.email', 'test@example.com']);
    await git(['config', 'user.name', 'Test']);
    await writeFile(join(root, 'README.md'), '# widget\n');
    await git(['add', 'README.md']);
    await git(['commit', '-m', 'initial']);
    await mkdir(engineerDir, { recursive: true });
    await writeFile(registryPath, JSON.stringify([{
      schemaVersion: 1, name: 'widget', path: root, remote: `https://github.com/${REPOSITORY}.git`, status: 'registered', registeredAt: '2026-01-01T00:00:00.000Z',
    }]));
    const worktree = (await createEngineerWorktree(root, 'ready existing')).worktreePath;
    await mkdir(join(worktree, '.github'), { recursive: true });
    await writeFile(join(worktree, '.github', 'pull_request_template.md'), 'Release-Disposition: no-note\n');
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'acme/widget#7' });
    await ledger.transition('github-issues', 'acme/widget#7', 'claimed', {});

    const mutations: Array<{ operation: string; payload?: unknown }> = [];
    const ghCalls: string[][] = [];
    const output: string[] = [];
    const gh = async (args: string[]) => {
      ghCalls.push([...args]);
      if (args[0] === 'pr' && args[1] === 'view' && args[2] === BRANCH) {
        return { stdout: JSON.stringify({ url: PR_URL, isDraft: true }) };
      }
      if (args[0] === 'issue' && args[1] === 'view') {
        return { stdout: JSON.stringify({ assignees: [{ login: 'owner' }] }) };
      }
      return { stdout: '{}' };
    };
    const launches: string[] = [];
    const code = await dispatchEngineer({
      kind: 'handoff', project: 'widget', branch: BRANCH, worktree, sourceRef: 'acme/widget#7',
    }, {
      registryPath,
      engineerDir,
      gh: gh as never,
      git: async (args) => ({ stdout: args[0] === 'show' ? 'Landed spec title\n\nLanded body\n' : '', stderr: '' }),
      handoffPublication: publication(mutations),
      intakeResolveActor: async () => ({ resolved: true, id: 'owner' }),
      ensureRunningLaunch: async () => { launches.push('wake'); },
      print: (message) => { output.push(message); },
      printErr: () => {},
    });

    expect(code).toBe(0);
    expect(output).toEqual([JSON.stringify({ kind: 'pr-opened', url: PR_URL })]);
    expect(await ledger.get('github-issues', 'acme/widget#7')).toMatchObject({ status: 'done', prUrl: PR_URL, branch: BRANCH });
    expect(mutations.map((mutation) => mutation.operation)).toEqual(['pull-request.edit', 'pull-request.ready']);
    expect(ghCalls.filter((args) => args[0] === 'issue' && args[1] === 'comment')).toHaveLength(1);
    expect(ghCalls.filter((args) => args[0] === 'api' && args.includes('POST'))).toHaveLength(1);
    expect(launches).toEqual(['wake']);
  });
});
