// Covers: task:9, task:10

import { describe, expect, it } from 'vitest';
import type { GitRunner } from '../../../src/engine/rebase.js';
import type { GhRunner } from '../../../src/engine/tracker-client.js';
import { computeLandDependencyProposals, decideLandDependencies } from '../../../src/engine/engineer/land-dependency-gate.js';

const SOURCE = 'owner/repo#536';
const PLAN = `### Task 1: change
**Files likely touched:**
- src/shared.ts — changed here
`;

function recordingGh({
  body = 'Depends on #520.',
  blockedBy = [],
  openIssues = [],
  fail,
  branchState = 'OPEN',
}: {
  body?: string;
  blockedBy?: unknown[];
  openIssues?: unknown[];
  fail?: 'body' | 'blocked-by' | 'open-issues' | 'rate-limit';
  branchState?: 'OPEN' | 'CLOSED';
} = {}): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push(args);
    const joined = args.join(' ');
    if (fail === 'rate-limit') throw new Error('GitHub API rate limit exceeded');
    if (fail === 'body' && joined.includes('issue view 536')) throw new Error('network unavailable');
    if (fail === 'blocked-by' && joined.includes('dependencies/blocked_by')) throw new Error('network unavailable');
    if (fail === 'open-issues' && joined.includes('issue list')) throw new Error('network unavailable');
    if (joined.includes('issue view 536')) return { stdout: JSON.stringify({ body }) };
    if (joined.includes('dependencies/blocked_by')) return { stdout: JSON.stringify(blockedBy) };
    if (joined.includes('issue list')) return { stdout: JSON.stringify(openIssues) };
    if (joined.includes('--json state')) return { stdout: branchState };
    throw new Error(`unexpected gh invocation: ${joined}`);
  };
  return { gh, calls };
}

function recordingGit({ marker = true }: { marker?: boolean } = {}): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    if (args[0] === 'for-each-ref') return { exitCode: 0, stdout: 'feat/daemon-feature\nfeat/daemon-markerless\n', stderr: '' };
    if (args[0] === 'rev-list') return { exitCode: 0, stdout: '1\n', stderr: '' };
    if (args[0] === 'cat-file') return { exitCode: 1, stdout: '', stderr: '' };
    if (args[0] === 'log') return { exitCode: 0, stdout: '10\n', stderr: '' };
    if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'base\n', stderr: '' };
    if (args[0] === 'diff') return { exitCode: 0, stdout: 'src/shared.ts\n', stderr: '' };
    if (args[0] === 'show') {
      if (args[1]?.startsWith('feat/daemon-feature:')) {
        return marker
          ? { exitCode: 0, stdout: 'Source-Ref: owner/repo#610\n', stderr: '' }
          : { exitCode: 1, stdout: '', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    }
    throw new Error(`unexpected git invocation: ${args.join(' ')}`);
  };
  return { git, calls };
}

describe('computeLandDependencyProposals', () => {
  it('proposes a declared but unlinked dependency from the source issue raw body', async () => {
    const { gh } = recordingGh();
    const { git } = recordingGit();

    await expect(computeLandDependencyProposals({ sourceRef: SOURCE, planText: PLAN, gh, git, cwd: '/target', baseRef: 'main' }))
      .resolves.toMatchObject({
        kind: 'computed',
        proposals: expect.arrayContaining([{ target: 'owner/repo#520', source: 'declared' }]),
      });
  });

  it('proposes open issue and intake-marked branch overlaps on plan paths', async () => {
    const { gh } = recordingGh({
      body: '',
      openIssues: [{ number: 600, body: 'Touches src/shared.ts.' }],
    });
    const { git } = recordingGit();

    await expect(computeLandDependencyProposals({ sourceRef: SOURCE, planText: PLAN, gh, git, cwd: '/target', baseRef: 'main' }))
      .resolves.toMatchObject({
        kind: 'computed',
        proposals: expect.arrayContaining([
          { target: 'owner/repo#600', source: 'overlap' },
          { target: 'owner/repo#610', source: 'overlap' },
        ]),
      });
  });

  it('keeps already-linked declarations satisfied and filters non-linkable overlap candidates into advisory', async () => {
    const { gh } = recordingGh({
      body: 'Depends on #520. Related to #521.',
      blockedBy: [{ number: 520, repository_url: 'https://api.github.com/repos/owner/repo' }],
      openIssues: [{ number: 536, body: 'Touches src/shared.ts.' }],
      branchState: 'CLOSED',
    });
    const { git } = recordingGit();

    const result = await computeLandDependencyProposals({ sourceRef: SOURCE, planText: PLAN, gh, git, cwd: '/target', baseRef: 'main' });

    expect(result).toMatchObject({ kind: 'computed', satisfied: ['owner/repo#520'] });
    if (result.kind === 'computed') {
      expect(result.proposals).toEqual([]);
      expect(result.advisory).toEqual(expect.arrayContaining([
        expect.objectContaining({ branch: 'feat/daemon-feature' }),
        expect.objectContaining({ branch: 'feat/daemon-markerless' }),
        expect.objectContaining({ target: SOURCE, reason: 'self' }),
      ]));
    }
  });

  it('keeps a marker-less in-flight branch advisory rather than proposing it', async () => {
    const { gh } = recordingGh({ body: '' });
    const { git } = recordingGit({ marker: false });

    const result = await computeLandDependencyProposals({ sourceRef: SOURCE, planText: PLAN, gh, git, cwd: '/target', baseRef: 'main' });

    expect(result).toMatchObject({ kind: 'computed' });
    if (result.kind === 'computed') {
      expect(result.proposals).toEqual([]);
      expect(result.advisory).toEqual(expect.arrayContaining([
        expect.objectContaining({ branch: 'feat/daemon-feature' }),
        expect.objectContaining({ branch: 'feat/daemon-markerless' }),
      ]));
    }
  });

  it.each([
    ['source body', 'body'],
    ['source blocked_by', 'blocked-by'],
    ['open-issue overlap listing', 'open-issues'],
    ['rate limit', 'rate-limit'],
  ] as const)('fails closed when the %s tracker read is unavailable', async (_name, fail) => {
    const { gh } = recordingGh({ fail });
    const { git } = recordingGit();

    const result = await computeLandDependencyProposals({ sourceRef: SOURCE, planText: PLAN, gh, git, cwd: '/target', baseRef: 'main' });

    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.cause).toMatch(fail === 'rate-limit' ? /rate limit/i : /network unavailable/i);
    }
  });
});

describe('decideLandDependencies', () => {
  const proposals = [
    { target: 'owner/repo#520', source: 'declared' as const },
    { target: 'owner/repo#600', source: 'overlap' as const },
  ];

  const computed = (targets = proposals) => ({
    kind: 'computed' as const,
    proposals: targets,
    satisfied: [],
    advisory: [],
  });

  it('proceeds with accepted and declined proposals after every proposal is decided', () => {
    expect(decideLandDependencies({
      sourceRef: SOURCE,
      proposalResult: {
        kind: 'computed',
        proposals: [
          { target: 'owner/repo#520', source: 'declared' },
          { target: 'owner/repo#600', source: 'overlap' },
        ],
        satisfied: [],
        advisory: [],
      },
      accepted: ['owner/repo#520'],
      declined: ['owner/repo#600'],
    })).toEqual({
      kind: 'proceed',
      accepted: ['owner/repo#520'],
      declined: ['owner/repo#600'],
      skipped: null,
    });
  });

  it('proceeds when all proposals are declined or no proposals need a decision', () => {
    expect(decideLandDependencies({
      sourceRef: SOURCE,
      proposalResult: computed(),
      accepted: [],
      declined: ['owner/repo#520', 'owner/repo#600'],
    })).toMatchObject({ kind: 'proceed', accepted: [], declined: ['owner/repo#520', 'owner/repo#600'] });

    expect(decideLandDependencies({
      sourceRef: SOURCE,
      proposalResult: computed([]),
      accepted: [],
      declined: [],
    })).toMatchObject({ kind: 'proceed', accepted: [], declined: [] });
  });

  it('refuses with actionable instructions when a proposal remains undecided', () => {
    const result = decideLandDependencies({
      sourceRef: SOURCE,
      proposalResult: computed(),
      accepted: ['owner/repo#520'],
      declined: [],
    });

    expect(result).toMatchObject({ kind: 'refused-undecided', undecided: ['owner/repo#600'] });
    if (result.kind !== 'refused-undecided') throw new Error('expected undecided dependency refusal');
    expect(result.message).toContain('--depends-on');
    expect(result.message).toContain('--decline-dependency');
  });

  it('rejects contradictory and never-proposed dependency decisions', () => {
    expect(decideLandDependencies({
      sourceRef: SOURCE,
      proposalResult: computed(),
      accepted: ['owner/repo#520'],
      declined: ['owner/repo#520'],
    })).toMatchObject({ kind: 'invalid', message: expect.stringContaining('owner/repo#520') });

    expect(decideLandDependencies({
      sourceRef: SOURCE,
      proposalResult: computed(),
      accepted: [],
      declined: ['owner/repo#777'],
    })).toMatchObject({ kind: 'invalid', message: expect.stringContaining('owner/repo#777') });
  });

  it('rejects decisions without a source ref and skips without a reason', () => {
    expect(decideLandDependencies({
      sourceRef: undefined,
      proposalResult: computed(),
      accepted: ['owner/repo#520'],
      declined: [],
    })).toMatchObject({ kind: 'invalid', message: expect.stringContaining('source-ref') });

    expect(decideLandDependencies({
      sourceRef: SOURCE,
      proposalResult: computed(),
      accepted: [],
      declined: [],
      skipReason: '',
    })).toMatchObject({ kind: 'invalid', message: expect.stringContaining('reason') });
  });

  it('proceeds with a recorded skip when proposal computation is unavailable', () => {
    expect(decideLandDependencies({
      sourceRef: SOURCE,
      proposalResult: { kind: 'unavailable', cause: 'GitHub outage' },
      accepted: [],
      declined: [],
      skipReason: 'GitHub outage',
    })).toEqual({
      kind: 'proceed',
      accepted: [],
      declined: [],
      skipped: { reason: 'GitHub outage' },
    });
  });

  it('refuses an unavailable check without a skip and notes an unused computed skip', () => {
    expect(decideLandDependencies({
      sourceRef: SOURCE,
      proposalResult: { kind: 'unavailable', cause: 'tracker unavailable' },
      accepted: [],
      declined: [],
    })).toMatchObject({
      kind: 'refused-unavailable',
      cause: 'tracker unavailable',
      message: expect.stringContaining('--skip-dependency-check'),
    });

    expect(decideLandDependencies({
      sourceRef: SOURCE,
      proposalResult: computed(),
      accepted: ['owner/repo#520'],
      declined: [],
      skipReason: 'GitHub outage',
    })).toMatchObject({
      kind: 'refused-undecided',
      undecided: ['owner/repo#600'],
      skipUnused: expect.stringContaining('GitHub outage'),
    });
  });
});
