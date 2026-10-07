/**
 * Tests for daemon-halt-pr-operations.ts — identity-module adoption and the
 * leaf-exists guard for child heads (#2940 task 7).
 *
 * `createDaemonHaltPrOperations` remains synchronous; the only new public
 * symbol is `leafRefExists`, the local/origin `show-ref` probe used to decide
 * whether a child branch's canonical parent leaf still exists.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureCreateGuarded = vi.hoisted(() => vi.fn());

vi.mock('../../src/engine/tracker-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/tracker-client.js')>();
  return {
    ...actual,
    createGuardedGithubOperationRunner: (
      transport: Parameters<typeof actual.createGuardedGithubOperationRunner>[0],
      options: Parameters<typeof actual.createGuardedGithubOperationRunner>[1],
    ) => {
      captureCreateGuarded(transport, options);
      return actual.createGuardedGithubOperationRunner(transport, options);
    },
  };
});

import { createDaemonHaltPrOperations, leafRefExists } from '../../src/engine/daemon-halt-pr-operations.js';
import { executeGithubOperation } from '../../src/engine/github-operations.js';
import { reconcileHaltPrs, type HaltPrReconciliationTarget } from '../../src/engine/halt-pr-reconciliation.js';
import type { GitRunner } from '../../src/engine/rebase.js';
import type { GhRunner } from '../../src/engine/tracker-client.js';
import type { OwnerResolution } from '../../src/engine/owner-gate/identity.js';

const PROJECT_ROOT = '/fixture';
const REPO = 'acme/widgets';
const NEEDS_REMEDIATION_BODY_MARKER = '<!-- conductor:needs-remediation -->';

function pr(number: number, headRefName?: string): HaltPrReconciliationTarget {
  return {
    number,
    url: `https://github.com/${REPO}/pull/${number}`,
    headRefName,
  };
}

function makeOperations(
  git: GitRunner,
  gh: GhRunner,
  resolveMachineOwner: () => Promise<OwnerResolution> = async () => ({ resolved: true, id: 'alice' }),
) {
  return createDaemonHaltPrOperations({
    projectRoot: PROJECT_ROOT,
    baseBranch: 'main',
    gh,
    git,
    resolveMachineOwner,
  });
}

describe('leafRefExists', () => {
  it('returns present after only the local head probe exits 0', async () => {
    const calls: string[][] = [];
    const git: GitRunner = async (args) => {
      calls.push([...args]);
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await expect(leafRefExists(git, 'x')).resolves.toBe('present');
    expect(calls).toEqual([
      ['show-ref', '--verify', '--quiet', 'refs/heads/feat/daemon-x'],
    ]);
  });

  it('falls back to the origin remote-tracking ref when the local head is absent', async () => {
    const calls: string[][] = [];
    const git: GitRunner = async (args) => {
      calls.push([...args]);
      const ref = args[3] ?? '';
      return { exitCode: ref === 'refs/remotes/origin/feat/daemon-x' ? 0 : 1, stdout: '', stderr: '' };
    };

    await expect(leafRefExists(git, 'x')).resolves.toBe('present');
    expect(calls).toEqual([
      ['show-ref', '--verify', '--quiet', 'refs/heads/feat/daemon-x'],
      ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/feat/daemon-x'],
    ]);
  });

  it('returns absent when neither ref exits 0', async () => {
    let calls = 0;
    const git: GitRunner = async () => {
      calls += 1;
      return { exitCode: 1, stdout: '', stderr: '' };
    };

    await expect(leafRefExists(git, 'x')).resolves.toBe('absent');
    expect(calls).toBe(2);
  });

  it('returns error when a probe throws instead of returning a result', async () => {
    const git: GitRunner = async () => {
      throw new Error('spawn failed');
    };

    await expect(leafRefExists(git, 'x')).resolves.toBe('error');
  });
});

describe('createDaemonHaltPrOperations parity', () => {
  const git: GitRunner = async () => ({ exitCode: 1, stdout: '', stderr: '' });
  const gh: GhRunner = async () => ({ stdout: '' });

  const cases: Array<
    | { head: string; featureMarker: string; specBranch: string }
    | { head: string }
  > = [
    { head: 'feat/daemon-x', featureMarker: '.docs/intake/x.md', specBranch: 'feat/daemon-x' },
    { head: 'feat/daemon-a/b', featureMarker: '.docs/intake/a/b.md', specBranch: 'feat/daemon-a/b' },
    { head: 'main' },
    { head: 'hotfix/y' },
    { head: 'feat/daemon-' },
  ];

  for (const c of cases) {
    it(`resolves head "${c.head}" field for field as today`, () => {
      captureCreateGuarded.mockClear();
      const operations = makeOperations(git, gh);
      const runner = operations(pr(1, c.head));

      if (!('featureMarker' in c)) {
        expect(runner).toBeUndefined();
        expect(captureCreateGuarded).not.toHaveBeenCalled();
        return;
      }

      expect(runner).toBeDefined();
      expect(captureCreateGuarded).toHaveBeenCalledTimes(1);
      expect(captureCreateGuarded.mock.calls[0][1]).toMatchObject({
        mutation: {
          provenance: {
            featureMarker: c.featureMarker,
            specBranch: c.specBranch,
          },
        },
      });
    });
  }
});

describe('createDaemonHaltPrOperations child heads', () => {
  beforeEach(() => {
    captureCreateGuarded.mockClear();
  });

  it('delegates to the guard after the local leaf probe exits 0', async () => {
    const ghCalls: string[][] = [];
    const gitCalls: string[][] = [];
    const gh: GhRunner = async (args) => {
      ghCalls.push([...args]);
      return { stdout: '' };
    };
    const git: GitRunner = async (args) => {
      gitCalls.push([...args]);
      if (args[0] === 'show-ref') return { exitCode: 0, stdout: '', stderr: '' };
      if (args[0] === 'show') return { exitCode: 0, stdout: 'Owner: alice\n', stderr: '' };
      return { exitCode: 1, stdout: '', stderr: '' };
    };

    const operations = makeOperations(git, gh);
    const runner = operations(pr(7, 'feat/c1/x'));
    if (!runner) throw new Error('expected a child PR to receive a guarded runner');

    expect(captureCreateGuarded.mock.calls[0][1]).toMatchObject({
      mutation: {
        provenance: {
          featureMarker: '.docs/intake/x.md',
          specBranch: 'feat/c1/x',
        },
      },
    });

    const result = await executeGithubOperation(
      {
        operation: 'pull-request.draft',
        repository: REPO,
        resource: { kind: 'pull-request', number: 7 },
        context: { actor: 'daemon-halt-reconciliation' },
      },
      runner,
    );

    expect(result).toMatchObject({ kind: 'executed' });
    expect(gitCalls.map((c) => c.join(' '))).toEqual([
      'show-ref --verify --quiet refs/heads/feat/daemon-x',
      'show main:.docs/intake/x.md',
    ]);
    expect(ghCalls).toHaveLength(1);
    expect(ghCalls[0]).toEqual(['pr', 'ready', '7', '-R', REPO, '--undo']);
  });

  it('refuses invalid-target without invoking gh when neither leaf ref exists', async () => {
    const ghCalls: string[][] = [];
    const gitCalls: string[][] = [];
    const gh: GhRunner = async (args) => {
      ghCalls.push([...args]);
      return { stdout: '' };
    };
    const git: GitRunner = async (args) => {
      gitCalls.push([...args]);
      return { exitCode: 1, stdout: '', stderr: '' };
    };

    const operations = makeOperations(git, gh);
    const runner = operations(pr(8, 'feat/c1/x'));
    if (!runner) throw new Error('expected a child PR to receive a guarded runner');

    const result = await executeGithubOperation(
      {
        operation: 'pull-request.draft',
        repository: REPO,
        resource: { kind: 'pull-request', number: 8 },
        context: { actor: 'daemon-halt-reconciliation' },
      },
      runner,
    );

    expect(result).toMatchObject({ kind: 'refused', reason: 'invalid-target' });
    expect(gitCalls.map((c) => c.join(' '))).toEqual([
      'show-ref --verify --quiet refs/heads/feat/daemon-x',
      'show-ref --verify --quiet refs/remotes/origin/feat/daemon-x',
    ]);
    expect(ghCalls).toHaveLength(0);
  });

  it('refuses invalid-target without invoking gh when the leaf probe throws', async () => {
    const ghCalls: string[][] = [];
    const gh: GhRunner = async (args) => {
      ghCalls.push([...args]);
      return { stdout: '' };
    };
    const git: GitRunner = async () => {
      throw new Error('spawn failed');
    };

    const operations = makeOperations(git, gh);
    const runner = operations(pr(9, 'feat/c1/x'));
    if (!runner) throw new Error('expected a child PR to receive a guarded runner');

    const result = await executeGithubOperation(
      {
        operation: 'pull-request.draft',
        repository: REPO,
        resource: { kind: 'pull-request', number: 9 },
        context: { actor: 'daemon-halt-reconciliation' },
      },
      runner,
    );

    expect(result).toMatchObject({ kind: 'refused', reason: 'invalid-target' });
    expect(ghCalls).toHaveLength(0);
  });
});

describe('reconcileHaltPrs integration', () => {
  interface FakeReconcilePr {
    number: number;
    url: string;
    headRefName?: string;
    isDraft: boolean;
    labels: string[];
    body: string;
  }

  function makeReconcileGh(prs: FakeReconcilePr[]) {
    const calls: string[][] = [];
    const byNumber = new Map(prs.map((p) => [p.number, p]));
    const byUrl = new Map(prs.map((p) => [p.url, p]));

    const gh: GhRunner = async (args) => {
      calls.push([...args]);

      if (args[0] === 'pr' && args[1] === 'list') {
        return {
          stdout: JSON.stringify(
            prs.map((p) => ({
              number: p.number,
              url: p.url,
              body: p.body,
              isDraft: p.isDraft,
              labels: p.labels.map((name) => ({ name })),
              headRefName: p.headRefName,
            })),
          ),
        };
      }

      if (args[0] === 'pr' && args[1] === 'view') {
        const url = args[2] ?? '';
        const p = byUrl.get(url);
        if (!p) throw new Error(`unknown PR view ${url}`);
        return {
          stdout: JSON.stringify({
            isDraft: p.isDraft,
            labels: p.labels.map((name) => ({ name })),
            body: p.body,
          }),
        };
      }

      // Guarded write: `gh pr ready <number> -R <repo> [--undo]`.
      if (args[0] === 'pr' && args[1] === 'ready') {
        const number = Number(args[2]);
        const p = byNumber.get(number);
        if (!p) throw new Error(`unknown PR ready ${number}`);
        p.isDraft = args.includes('--undo');
        return { stdout: '' };
      }

      // Guarded write: `gh api --method POST repos/o/r/issues/N/labels -f labels[]=name`.
      if (args[0] === 'api' && args[2] === 'POST' && /\/labels$/.test(args[3] ?? '')) {
        const number = Number((args[3] ?? '').match(/issues\/(\d+)\/labels/)?.[1]);
        const p = byNumber.get(number);
        if (!p) throw new Error(`unknown PR label add ${number}`);
        const label = (args[5] ?? '').replace(/^labels\[\]=/, '');
        if (label && !p.labels.includes(label)) p.labels.push(label);
        return { stdout: '' };
      }

      return { stdout: '' };
    };

    return {
      gh,
      calls,
      get: (number: number) => byNumber.get(number),
    };
  }

  it('refuses a leading child PR while still healing the following leaf PR', async () => {
    const child: FakeReconcilePr = {
      number: 100,
      url: `https://github.com/${REPO}/pull/100`,
      headRefName: 'feat/c1/x',
      isDraft: false,
      labels: [],
      body: `Halt body.\n\n${NEEDS_REMEDIATION_BODY_MARKER}`,
    };
    const leafPr: FakeReconcilePr = {
      number: 200,
      url: `https://github.com/${REPO}/pull/200`,
      headRefName: 'feat/daemon-y',
      isDraft: false,
      labels: [],
      body: `Halt body.\n\n${NEEDS_REMEDIATION_BODY_MARKER}`,
    };

    const { gh, calls: ghCalls, get } = makeReconcileGh([child, leafPr]);

    // Shipped-record probe: nothing shipped anywhere, so the sweep never clears.
    const runGit = async () => {
      throw new Error('fatal: path does not exist');
    };

    // operations.git: child leaf `x` absent; leaf `y` is committed and owned.
    const opsGitCalls: string[][] = [];
    const opsGit: GitRunner = async (args) => {
      opsGitCalls.push([...args]);
      if (args[0] === 'show-ref') return { exitCode: 1, stdout: '', stderr: '' };
      if (args[0] === 'show') return { exitCode: 0, stdout: 'Owner: alice\n', stderr: '' };
      return { exitCode: 1, stdout: '', stderr: '' };
    };

    const operations = makeOperations(opsGit, gh);

    await reconcileHaltPrs({
      projectRoot: PROJECT_ROOT,
      runGh: gh,
      runGit,
      operations,
    });

    // The child stays unhealed; the leaf PR is healed draft + labeled.
    expect(get(100)!.isDraft).toBe(false);
    expect(get(100)!.labels).toEqual([]);
    expect(get(200)!.isDraft).toBe(true);
    expect(get(200)!.labels).toContain('needs-remediation');

    // The child's two leaf probes ran first; the leaf's committed-owner read followed.
    expect(opsGitCalls.map((c) => c.join(' '))).toEqual([
      'show-ref --verify --quiet refs/heads/feat/daemon-x',
      'show-ref --verify --quiet refs/remotes/origin/feat/daemon-x',
      'show main:.docs/intake/y.md',
      'show main:.docs/intake/y.md',
    ]);

    // Exactly one guarded draft and one guarded label write, both for the leaf.
    const draftCalls = ghCalls.filter((c) => c[0] === 'pr' && c[1] === 'ready');
    expect(draftCalls).toHaveLength(1);
    expect(draftCalls[0]).toEqual(['pr', 'ready', '200', '-R', REPO, '--undo']);

    const labelCalls = ghCalls.filter((c) => c[0] === 'api' && c[2] === 'POST' && /\/labels$/.test(c[3] ?? ''));
    expect(labelCalls).toHaveLength(1);
    expect(labelCalls[0][3]).toBe(`repos/${REPO}/issues/200/labels`);
  });
});