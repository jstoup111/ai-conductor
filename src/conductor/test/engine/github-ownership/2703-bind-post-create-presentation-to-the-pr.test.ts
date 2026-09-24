// Covers: #2703 — post-create PR writes (Refs/Closes, labels) are refused as
// `invalid-target` when they reuse a context bound to the repository or the
// branch ref. These tests run the REAL owner gate (createGuardedGithubOperationRunner
// → authorizeGithubMutation); only the gh/git process boundary is faked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openSpecPr } from '../../../src/engine/engineer/handoff.js';
import { initialSpecPublication } from '../../../src/engine/engineer-cli.js';
import { bindMutationToPullRequest } from '../../../src/engine/ship-draft-pr.js';
import { executeGithubOperation } from '../../../src/engine/github-operations.js';
import {
  createGuardedGithubOperationRunner,
  type GithubMutationExecutionContext,
} from '../../../src/engine/tracker-client.js';

const REPOSITORY = 'acme/specs';
const BRANCH = 'spec/owned-feature';
const MARKER = '.docs/intake/owned-feature.md';
const PR_NUMBER = 42;
const PR_URL = `https://github.com/${REPOSITORY}/pull/${PR_NUMBER}`;

function mutation(
  target: GithubMutationExecutionContext['provenance']['target'],
  owner = 'alice',
): GithubMutationExecutionContext {
  return {
    provenance: {
      repository: REPOSITORY,
      defaultBranch: BRANCH,
      specBranch: BRANCH,
      featureMarker: MARKER,
      publication: 'initial',
      target,
    },
    dependencies: {
      resolveMachineOwner: vi.fn().mockResolvedValue({ resolved: true, id: owner }),
      provenanceDiscovery: {
        readCommittedRecords: vi.fn().mockResolvedValue([{ path: MARKER, content: 'Owner: alice\n' }]),
      },
    },
  };
}

function prEdit(body: string) {
  return {
    operation: 'pull-request.edit' as const,
    repository: REPOSITORY,
    resource: { kind: 'pull-request' as const, number: PR_NUMBER },
    context: { actor: 'test' },
    payload: { body },
  };
}

describe('bindMutationToPullRequest (#2703)', () => {
  it('a repository- or ref-bound context is refused for a PR edit, the PR-bound one executes', async () => {
    const gh = vi.fn().mockResolvedValue({ stdout: '' });
    const repositoryBound = mutation({ repository: REPOSITORY, kind: 'repository' });
    const refBound = mutation({ repository: REPOSITORY, kind: 'remote-ref', ref: `refs/heads/${BRANCH}` });

    for (const context of [repositoryBound, refBound]) {
      const refused = await executeGithubOperation(
        prEdit('body\n\nRefs acme/intake#7'),
        createGuardedGithubOperationRunner(gh, { cwd: '/fixture', mutation: context }),
      );
      expect(refused).toMatchObject({ kind: 'refused', reason: 'invalid-target' });
    }
    expect(gh).not.toHaveBeenCalled();

    const bound = bindMutationToPullRequest(refBound, PR_URL);
    expect(bound?.provenance.target).toEqual({ repository: REPOSITORY, kind: 'pull-request', number: PR_NUMBER });
    const executed = await executeGithubOperation(
      prEdit('body\n\nCloses acme/intake#7'),
      createGuardedGithubOperationRunner(gh, { cwd: '/fixture', mutation: bound! }),
    );
    expect(executed.kind).toBe('executed');
    expect(gh).toHaveBeenCalledWith(
      ['pr', 'edit', String(PR_NUMBER), '-R', REPOSITORY, '--body', 'body\n\nCloses acme/intake#7'],
      { cwd: '/fixture' },
    );
  });

  it('keeps the owner gate: a foreign owner is still refused through the PR-bound context', async () => {
    const gh = vi.fn().mockResolvedValue({ stdout: '' });
    const bound = bindMutationToPullRequest(mutation({ repository: REPOSITORY, kind: 'repository' }, 'bob'), PR_URL);
    const result = await executeGithubOperation(
      prEdit('x'),
      createGuardedGithubOperationRunner(gh, { cwd: '/fixture', mutation: bound! }),
    );
    expect(result).toMatchObject({ kind: 'refused', reason: 'other-owner' });
    expect(gh).not.toHaveBeenCalled();
  });

  it('never binds a PR outside the provenance repository or a non-PR URL', () => {
    const context = mutation({ repository: REPOSITORY, kind: 'repository' });
    expect(bindMutationToPullRequest(context, 'https://github.com/other/repo/pull/42')).toBeUndefined();
    expect(bindMutationToPullRequest(context, `https://github.com/${REPOSITORY}/issues/42`)).toBeUndefined();
  });
});

describe('composer handoff post-create writes through the production publication (#2703)', () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'handoff-2703-'));
    await mkdir(join(home, '.ai-conductor'), { recursive: true });
    await writeFile(join(home, '.ai-conductor', 'config.yml'), 'spec_owner: alice\n', 'utf8');
    await mkdir(join(home, 'repo', '.github'), { recursive: true });
    await writeFile(join(home, 'repo', '.github', 'pull_request_template.md'), 'Release-Disposition: no-note\n', 'utf8');
    previousHome = process.env.HOME;
    process.env.HOME = home;
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  });

  it('adds the Refs line and mirrors the issue priority label onto the created spec PR', async () => {
    const cwd = join(home, 'repo');
    const ghCalls: string[][] = [];
    const gh = async (args: string[]) => {
      ghCalls.push(args);
      if (args[0] === 'pr' && args[1] === 'create') return { stdout: `${PR_URL}\n` };
      if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ body: 'spec body\n\nRelease-Disposition: no-note', url: PR_URL }) };
      if (args[0] === 'api' && args.some((a) => a.includes('/issues/7/labels'))) {
        return { stdout: JSON.stringify([{ name: 'priority: high' }]) };
      }
      return { stdout: '' };
    };
    const git = async (args: string[]) => {
      if (args[0] === 'show') return { stdout: 'Owner: alice\n' };
      if (args[0] === 'config' || (args[0] === 'remote' && args[1] === 'get-url')) {
        return { stdout: `https://github.com/${REPOSITORY}.git\n` };
      }
      return { stdout: '' };
    };
    const target = { name: 'specs', canonicalPath: cwd, remote: `https://github.com/${REPOSITORY}.git` };
    const log = vi.fn();

    const result = await openSpecPr(target, BRANCH, {
      runner: async (args) => ({ ...(await gh(args)), stderr: '' }),
      gitRunner: git,
      worktreePath: cwd,
      ledgerOpts: { engineerDir: home },
      sourceRef: 'acme/intake#7',
      log,
      publication: initialSpecPublication(target, BRANCH, cwd, gh, git),
    });

    expect(result).toEqual({ kind: 'pr-opened', url: PR_URL });
    const edit = ghCalls.find((args) => args[0] === 'pr' && args[1] === 'edit' && args.includes('--body'));
    expect(edit?.[edit.indexOf('--body') + 1]).toMatch(/\n\nRefs acme\/intake#7$/);
    expect(ghCalls.some((args) => args.join(' ').includes('priority: high') && !args.includes('--jq'))).toBe(true);
    expect(log.mock.calls.flat().join('\n')).not.toMatch(/refused/);
  });
});
