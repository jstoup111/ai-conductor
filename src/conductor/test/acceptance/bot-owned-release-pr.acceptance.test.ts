/**
 * RED acceptance specs for the bot-owned release PR.
 *
 * Stories: .docs/stories/changelog-unreleased-is-a-shared-write-target-conf.md
 * Plan:    .docs/plans/changelog-unreleased-is-a-shared-write-target-conf.md
 * Track:   technical — no PRD/FR coverage table applies.
 *
 * These specs exercise the three production action entry points named by the
 * approved plan. Git and GitHub are faithful in-memory fakes; no network,
 * ambient credentials, shell evaluation, or real repository mutation occurs.
 * Pure parsing, semver ordering, waiver matrices, workflow YAML structure,
 * update-channel identity, FINISH cleanup, and generic rebase behavior remain
 * unit-covered by Tasks 1-8 and 12-19. This file owns the cross-operation
 * flows: validate -> collect -> render -> upsert; retry/stale reconciliation;
 * approve -> tag -> release; and the one-time transition lifecycle.
 *
 * The modules do not exist at RED time. They are dynamically imported inside
 * each test so Vitest executes the specs and reports assertion failures rather
 * than failing collection/type-checking on a missing static import.
 */

import { describe, expect, it } from 'vitest';

type Action = (input: Record<string, unknown>) => Promise<Record<string, unknown>>;

async function loadAction(modulePath: string, exportName: string): Promise<Action> {
  const mod = (await import(modulePath)) as Record<string, unknown>;
  const action = mod[exportName];
  if (typeof action !== 'function') {
    throw new Error(`expected export "${exportName}" to be a function (not yet implemented)`);
  }
  return action as Action;
}

const NOTE_BODY = [
  'Release-Disposition: note',
  'Release-Category: Changed',
  'Release-Semver: minor',
  'Release-Note: Keep `$(touch /tmp/pwned)` and ${{ secrets.TOKEN }} inert; see [docs](https://example.test).',
].join('\n');

const NO_NOTE_BODY = 'Release-Disposition: no-note';

interface PullRequest {
  number: number;
  merged: boolean;
  head: string;
  base: string;
  author: string;
  body: string;
  mergeSha: string;
}

function implementationPr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 41,
    merged: true,
    head: 'feat/metadata',
    base: 'main',
    author: 'maintainer',
    body: NOTE_BODY,
    mergeSha: 'merge-41',
    ...overrides,
  };
}

class FakeGithub {
  pages: PullRequest[][] = [];
  openReleasePr: PullRequest | undefined;
  checks: Array<Record<string, unknown>> = [];
  createdPrs: Array<Record<string, unknown>> = [];
  updatedPrs: Array<Record<string, unknown>> = [];
  releases: Array<Record<string, unknown>> = [];
  failCreatePr = false;
  failCreateRelease = false;

  async listMergedPullRequests(page: number): Promise<{ items: PullRequest[]; hasNextPage: boolean }> {
    return { items: this.pages[page - 1] ?? [], hasNextPage: page < this.pages.length };
  }

  async findOpenReleasePullRequest(): Promise<PullRequest | undefined> {
    return this.openReleasePr;
  }

  async publishCheck(input: Record<string, unknown>): Promise<void> {
    this.checks.push(input);
  }

  async createPullRequest(input: Record<string, unknown>): Promise<{ number: number }> {
    if (this.failCreatePr) throw new Error('simulated PR creation failure');
    this.createdPrs.push(input);
    return { number: 900 };
  }

  async updatePullRequest(input: Record<string, unknown>): Promise<void> {
    this.updatedPrs.push(input);
  }

  async createRelease(input: Record<string, unknown>): Promise<void> {
    if (this.failCreateRelease) throw new Error('simulated release creation failure');
    this.releases.push(input);
  }
}

class FakeGit {
  mainHeads = ['main-1'];
  pushes: Array<Record<string, unknown>> = [];
  tags: Array<Record<string, unknown>> = [];
  branchFiles = new Map<string, Record<string, string>>();
  existingTags = new Map<string, string>();

  async latestTag(): Promise<string> {
    return 'v0.99.17';
  }

  async mainHead(): Promise<string> {
    return this.mainHeads.length > 1 ? this.mainHeads.shift()! : this.mainHeads[0]!;
  }

  async mergeRange(): Promise<string[]> {
    return ['merge-41', 'merge-42'];
  }

  async readBranchFiles(branch: string): Promise<Record<string, string> | undefined> {
    return this.branchFiles.get(branch);
  }

  async pushGeneratedBranch(input: Record<string, unknown>): Promise<void> {
    this.pushes.push(input);
    const branch = String(input.branch);
    this.branchFiles.set(branch, input.files as Record<string, string>);
  }

  async tagTarget(tag: string): Promise<string | undefined> {
    return this.existingTags.get(tag);
  }

  async createAnnotatedTag(input: Record<string, unknown>): Promise<void> {
    this.tags.push(input);
    this.existingTags.set(String(input.tag), String(input.target));
  }
}

const releaseConfig = {
  branch: 'release/pending',
  base: 'main',
  appLogin: 'release-app[bot]',
};

describe('TI-1/TI-2 — required disposition survives validation and release rendering', () => {
  it('normalizes valid note/no-note PRs while keeping hostile note text inert', async () => {
    const check = await loadAction(
      '../../src/engine/release-metadata-check-action.js',
      'runReleaseMetadataCheckAction',
    );
    const github = new FakeGithub();

    const note = await check({ event: { pullRequest: implementationPr() }, github });
    const noNote = await check({
      event: { pullRequest: implementationPr({ number: 42, body: NO_NOTE_BODY }) },
      github,
    });

    expect(note).toMatchObject({
      disposition: 'note',
      category: 'Changed',
      semver: 'minor',
    });
    expect(String(note.note)).toContain('$(touch /tmp/pwned)');
    expect(String(note.note)).toContain('${{ secrets.TOKEN }}');
    expect(noNote).toMatchObject({ disposition: 'no-note' });
    expect(github.checks).toHaveLength(2);
  });

  it.each([
    ['', 'disposition'],
    ['Release-Disposition: no-note\nRelease-Semver: patch', 'semver'],
    ['Release-Disposition: note\nRelease-Category: Unknown\nRelease-Semver: patch\nRelease-Note: x', 'category'],
    ['Release-Disposition: note\nRelease-Category: Fixed\nRelease-Semver: sideways\nRelease-Note: x', 'semver'],
  ])('fails closed for invalid metadata and emits no normalized result: %s', async (body, field) => {
    const check = await loadAction(
      '../../src/engine/release-metadata-check-action.js',
      'runReleaseMetadataCheckAction',
    );
    const github = new FakeGithub();

    await expect(check({ event: { pullRequest: implementationPr({ body }) }, github })).rejects.toThrow(
      new RegExp(field, 'i'),
    );
    expect(github.checks.at(-1)).toMatchObject({ conclusion: 'failure' });
  });
});

describe('TI-3/TI-4/TI-5 — one complete, serialized, idempotent release PR', () => {
  it('collects every page, renders distinct candidates, creates once, then updates the same PR', async () => {
    const maintain = await loadAction(
      '../../src/engine/release-pr-action.js',
      'runReleasePrAction',
    );
    const github = new FakeGithub();
    const git = new FakeGit();
    github.pages = [
      [implementationPr()],
      [implementationPr({ number: 42, body: NOTE_BODY, mergeSha: 'merge-42' })],
    ];

    const first = await maintain({
      event: { action: 'closed', pullRequest: implementationPr() },
      github,
      git,
      appAuthenticated: true,
      config: releaseConfig,
    });

    expect(first).toMatchObject({ action: 'created', pullRequestNumber: 900 });
    expect(github.createdPrs).toHaveLength(1);
    expect(git.pushes).toHaveLength(1);
    const files = git.pushes[0]!.files as Record<string, string>;
    expect(files.CHANGELOG_MD.match(/Keep `\$\(touch/g)).toHaveLength(2);
    expect(files.VERSION).toBe('0.100.0\n');
    expect(files.CANDIDATE_AUDIT).toMatch(/#41[\s\S]*included/);
    expect(files.CANDIDATE_AUDIT).toMatch(/#42[\s\S]*included/);

    github.openReleasePr = implementationPr({
      number: 900,
      author: releaseConfig.appLogin,
      head: releaseConfig.branch,
    });
    const second = await maintain({
      event: { action: 'closed', pullRequest: implementationPr({ number: 42 }) },
      github,
      git,
      appAuthenticated: true,
      config: releaseConfig,
    });

    expect(second).toMatchObject({ action: 'updated', pullRequestNumber: 900 });
    expect(github.createdPrs).toHaveLength(1);
    expect(github.updatedPrs).toHaveLength(1);
  });

  it('rejects a stale main head before push and never overwrites newer evidence', async () => {
    const maintain = await loadAction(
      '../../src/engine/release-pr-action.js',
      'runReleasePrAction',
    );
    const github = new FakeGithub();
    const git = new FakeGit();
    github.pages = [[implementationPr(), implementationPr({ number: 42, mergeSha: 'merge-42' })]];
    git.mainHeads = ['main-before', 'main-after'];

    await expect(
      maintain({
        event: { action: 'closed', pullRequest: implementationPr() },
        github,
        git,
        appAuthenticated: true,
        config: releaseConfig,
        maxStaleRetries: 0,
      }),
    ).rejects.toThrow(/stale|main.*advanced/i);
    expect(git.pushes).toHaveLength(0);
    expect(github.createdPrs).toHaveLength(0);
  });

  it.each([
    [{ action: 'closed', pullRequest: implementationPr({ merged: false }) }, true, 'closed unmerged'],
    [{ action: 'closed', pullRequest: implementationPr({ head: releaseConfig.branch }) }, true, 'release PR recursion'],
    [{ action: 'closed', pullRequest: implementationPr() }, false, 'missing App credentials'],
  ])('does not mutate for %s', async (event, appAuthenticated, reason) => {
    const maintain = await loadAction(
      '../../src/engine/release-pr-action.js',
      'runReleasePrAction',
    );
    const github = new FakeGithub();
    const git = new FakeGit();
    github.pages = [[implementationPr(), implementationPr({ number: 42, mergeSha: 'merge-42' })]];

    const invocation = maintain({ event, github, git, appAuthenticated, config: releaseConfig });
    if (appAuthenticated) {
      await expect(invocation).resolves.toMatchObject({ action: 'noop', reason });
    } else {
      await expect(invocation).rejects.toThrow(/App|credential/i);
    }
    expect(git.pushes).toHaveLength(0);
  });
});

describe('TI-6 — only a proven release-PR merge publishes', () => {
  it('creates one annotated tag and GitHub Release, then recovers idempotently after a release failure', async () => {
    const publish = await loadAction(
      '../../src/engine/release-publisher-action.js',
      'runReleasePublisherAction',
    );
    const github = new FakeGithub();
    const git = new FakeGit();
    github.failCreateRelease = true;
    const event = {
      action: 'closed',
      pullRequest: implementationPr({
        number: 900,
        author: releaseConfig.appLogin,
        head: releaseConfig.branch,
        mergeSha: 'release-merge',
      }),
    };
    const approved = {
      version: '0.100.0',
      tag: 'v0.100.0',
      changelogSection: '## [0.100.0] - 2026-08-02\n\n### Changed\n- shipped (#41)',
      candidateAuditComplete: true,
    };

    await expect(publish({ event, approved, github, git, config: releaseConfig })).rejects.toThrow(
      /release creation failure/i,
    );
    expect(git.tags).toHaveLength(1);

    github.failCreateRelease = false;
    const recovered = await publish({ event, approved, github, git, config: releaseConfig });
    expect(recovered).toMatchObject({ action: 'published', recoveredExistingTag: true });
    expect(git.tags).toHaveLength(1);
    expect(github.releases).toHaveLength(1);
  });

  it.each([
    [implementationPr(), 'implementation PR'],
    [implementationPr({ number: 900, author: 'foreign[bot]', head: releaseConfig.branch }), 'foreign PR'],
    [implementationPr({ number: 900, author: releaseConfig.appLogin, head: 'release/foreign' }), 'foreign branch'],
  ])('rejects %s provenance before tag or release mutation', async (pullRequest, reason) => {
    const publish = await loadAction(
      '../../src/engine/release-publisher-action.js',
      'runReleasePublisherAction',
    );
    const github = new FakeGithub();
    const git = new FakeGit();

    await expect(
      publish({
        event: { action: 'closed', pullRequest },
        approved: { version: '0.100.0', candidateAuditComplete: true },
        github,
        git,
        config: releaseConfig,
      }),
    ).rejects.toThrow(new RegExp(reason, 'i'));
    expect(git.tags).toHaveLength(0);
    expect(github.releases).toHaveLength(0);
  });
});

describe('TI-7 — one-time audited backlog transition', () => {
  it('requires exhaustive operator-approved dispositions and refuses a second transition', async () => {
    const maintain = await loadAction(
      '../../src/engine/release-pr-action.js',
      'runReleasePrAction',
    );
    const github = new FakeGithub();
    const git = new FakeGit();
    github.pages = [[implementationPr(), implementationPr({ number: 42, mergeSha: 'merge-42' })]];
    const transition = {
      status: 'approved',
      legacyEntries: ['feature A', 'repair A'],
      dispositions: [
        { entry: 'feature A', disposition: 'included', note: 'Final feature A behavior' },
        { entry: 'repair A', disposition: 'consolidated', into: 'feature A' },
        { pullRequest: 41, disposition: 'included' },
        { pullRequest: 42, disposition: 'no-note' },
      ],
    };

    const first = await maintain({
      event: { type: 'transition' },
      transition,
      github,
      git,
      appAuthenticated: true,
      config: releaseConfig,
    });
    expect(first).toMatchObject({ action: 'created', transitionConsumed: true });
    expect(String((git.pushes[0]!.files as Record<string, string>).CANDIDATE_AUDIT)).toMatch(
      /feature A[\s\S]*repair A[\s\S]*#41[\s\S]*#42/,
    );

    await expect(
      maintain({
        event: { type: 'transition' },
        transition,
        github,
        git,
        appAuthenticated: true,
        config: releaseConfig,
      }),
    ).rejects.toThrow(/transition.*(complete|consumed|already)/i);
  });
});
