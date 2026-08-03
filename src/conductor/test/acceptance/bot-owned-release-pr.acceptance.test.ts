/**
 * Acceptance specs for the bot-owned release PR.
 *
 * Stories: .docs/stories/changelog-unreleased-is-a-shared-write-target-conf.md
 * Plan:    .docs/plans/changelog-unreleased-is-a-shared-write-target-conf.md
 * Track:   technical — no PRD/FR coverage table applies.
 *
 * This file owns the CROSS-OPERATION flows over the production seams the
 * approved plan named: validate -> collect -> render -> upsert; stale/partial
 * reconciliation; approve -> tag -> release; and the one-time transition
 * lifecycle. Per-module error matrices (parsing, pagination completeness,
 * semver ordering, waivers, workflow YAML, update channels) stay in the
 * focused engine tests for each module.
 *
 * Git and GitHub are faithful in-memory adapters. No network, ambient
 * credentials, shell evaluation, or real repository mutation occurs.
 */

import { describe, expect, it } from 'vitest';

import {
  collectReleaseCandidates,
  type ReleaseCandidatePullRequest,
} from '../../src/engine/release-candidates.js';
import { runReleaseMetadataCheckAction } from '../../src/engine/release-metadata-check-action.js';
import {
  runReleasePrAction,
  type ReleasePrGit,
  type ReleasePrGithub,
  type ReleasePullRequest,
} from '../../src/engine/release-pr-action.js';
import {
  runReleasePublisherAction,
  type MergedReleasePullRequest,
  type ReleasePublisherGit,
  type ReleasePublisherGithub,
} from '../../src/engine/release-publisher-action.js';
import { renderReleaseCandidate } from '../../src/engine/release-renderer.js';

const config = { branch: 'release/pending', base: 'main', appLogin: 'release-app[bot]' };

/** Hostile note text: shell syntax, a workflow expression, and a Markdown link. */
const HOSTILE_NOTE = 'Keep `$(touch /tmp/pwned)` and ${{ secrets.TOKEN }} inert; see [docs](https://example.test).';
const NOTE_BODY = [
  'Release-Disposition: note',
  'Release-Category: Changed',
  'Release-Semver: minor',
  `Release-Note: ${HOSTILE_NOTE}`,
].join('\n');
const NO_NOTE_BODY = 'Release-Disposition: no-note';

const CHANGELOG = '# Changelog\n\n## [Unreleased]\n\n## [1.2.3] - 2026-07-01\n\n### Added\n\n- Previously released entry.\n';

function mergedPr(overrides: Partial<ReleaseCandidatePullRequest> = {}): ReleaseCandidatePullRequest {
  return {
    number: 41,
    merged: true,
    mergedAt: '2026-08-01T00:00:00Z',
    mergeSha: 'merge-41',
    body: NOTE_BODY,
    ...overrides,
  };
}

/** Collect and render the pending set exactly as the maintainer workflow does. */
async function collectAndRender(pages: ReleaseCandidatePullRequest[][]) {
  const mergeCommits = pages.flat().map((pullRequest) => pullRequest.mergeSha);
  const collection = await collectReleaseCandidates({
    git: {
      latestTag: async () => 'v1.2.3',
      mergeRange: async () => mergeCommits,
    },
    github: {
      listMergedPullRequests: async (page: number) => ({
        items: pages[page - 1] ?? [],
        hasNextPage: page < pages.length,
        totalCount: pages.flat().length,
      }),
    },
  });
  const rendered = renderReleaseCandidate({
    currentVersion: '1.2.3',
    date: '2026-08-02',
    changelog: CHANGELOG,
    candidates: collection.candidates,
  });
  return {
    collection,
    rendered,
    generatedFiles: { 'CHANGELOG.md': rendered.changelog, VERSION: `${rendered.version}\n` },
    audit: collection.candidates.map(({ number, mergeSha, disposition }) => ({ number, mergeSha, disposition })),
  };
}

/** In-memory Git remote for the generated release branch. */
class FakeGit implements ReleasePrGit {
  mainHeads: string[] = ['main-1'];
  branchFiles = new Map<string, Record<string, string>>();
  baseFiles = new Map<string, string>();
  pushes: Array<{ branch: string; expectedBaseHead?: string; files: Record<string, string>; message: string }> = [];
  private branchHead = 0;

  async readBranchFiles(branch: string): Promise<Record<string, string> | undefined> {
    return this.branchFiles.get(branch);
  }

  async readBaseFile(_branch: string, path: string): Promise<string | undefined> {
    return this.baseFiles.get(path);
  }

  async readMainHead(): Promise<string> {
    return this.mainHeads.length > 1 ? this.mainHeads.shift()! : this.mainHeads[0]!;
  }

  async readBranchHead(): Promise<string> {
    return `release-head-${this.branchHead}`;
  }

  async pushGeneratedBranch(input: {
    branch: string;
    base: string;
    expectedBaseHead?: string;
    files: Record<string, string>;
    message: string;
  }): Promise<void> {
    this.pushes.push(input);
    this.branchFiles.set(input.branch, input.files);
    this.branchHead += 1;
  }
}

/** In-memory GitHub for the designated release PR. */
class FakeGithub implements ReleasePrGithub {
  openReleasePr: ReleasePullRequest | undefined;
  created: Array<{ head: string; base: string; title: string; body: string }> = [];
  updated: Array<{ number: number; title: string; body: string }> = [];
  readiness: Array<{ pullRequestNumber: number; head: string; summary: string }> = [];
  failCreatePullRequest = false;

  async findOpenReleasePullRequest(): Promise<ReleasePullRequest | undefined> {
    return this.openReleasePr;
  }

  async createPullRequest(input: { head: string; base: string; title: string; body: string }): Promise<{ number: number }> {
    if (this.failCreatePullRequest) throw new Error('simulated PR creation failure');
    this.created.push(input);
    return { number: 900 };
  }

  async updatePullRequest(input: { number: number; title: string; body: string }): Promise<void> {
    this.updated.push(input);
  }

  async publishReleaseReadiness(input: {
    pullRequestNumber: number;
    head: string;
    conclusion: 'success';
    summary: string;
  }): Promise<void> {
    this.readiness.push({ pullRequestNumber: input.pullRequestNumber, head: input.head, summary: input.summary });
  }
}

describe('TI-1/TI-2/TI-3/TI-5 — validate, collect, render, and maintain one release PR', () => {
  it('carries a hostile note inertly from PR metadata into one created release PR with head-bound readiness', async () => {
    const outputs = new Map<string, string>();
    await runReleaseMetadataCheckAction({
      github: {},
      context: { payload: { pull_request: { body: NOTE_BODY } } },
      core: { setOutput: (name, value) => void outputs.set(name, value) },
    });
    await runReleaseMetadataCheckAction({
      github: {},
      context: { payload: { pull_request: { body: NO_NOTE_BODY } } },
      core: { setOutput: (name, value) => void outputs.set(`no-note:${name}`, value) },
    });
    expect(JSON.parse(outputs.get('release-disposition')!)).toMatchObject({
      disposition: 'note',
      category: 'Changed',
      semver: 'minor',
      note: HOSTILE_NOTE,
    });
    expect(JSON.parse(outputs.get('no-note:release-disposition')!)).toEqual({ disposition: 'no-note' });

    // Two pages: one notable candidate, one explicit no-note candidate.
    const { collection, rendered, generatedFiles, audit } = await collectAndRender([
      [mergedPr()],
      [mergedPr({ number: 42, mergeSha: 'merge-42', mergedAt: '2026-08-01T01:00:00Z', body: NO_NOTE_BODY })],
    ]);
    expect(collection.completeness).toEqual({ status: 'complete' });
    expect(rendered.version).toBe('1.3.0');
    // The hostile text survives as inert data; the no-note candidate never reaches the reader.
    expect(rendered.changelog).toContain(HOSTILE_NOTE);
    expect(rendered.changelog).toContain('implementation PR #41');
    expect(rendered.changelog).not.toContain('#42');
    // Previously released history is retained.
    expect(rendered.changelog).toContain('## [1.2.3] - 2026-07-01');

    const git = new FakeGit();
    const github = new FakeGithub();
    const first = await runReleasePrAction({
      git,
      github,
      config,
      generatedFiles,
      title: `Release ${rendered.version}`,
      body: 'Automated release proposal.',
      expectedMainHead: 'main-1',
      audit,
    });

    expect(first).toMatchObject({ action: 'created', pullRequestNumber: 900, branchUpdated: true });
    expect(github.created).toHaveLength(1);
    expect(git.pushes).toHaveLength(1);
    expect(git.pushes[0]!.expectedBaseHead).toBe('main-1');
    expect(git.pushes[0]!.files.VERSION).toBe('1.3.0\n');
    // Every candidate appears exactly once in the audit, including the no-note one.
    expect(github.created[0]!.body).toMatch(/\|\s*#41\s*\|[^\n]*included/);
    expect(github.created[0]!.body).toMatch(/\|\s*#42\s*\|[^\n]*no-note/);
    // Readiness is bound to the exact generated-branch head that was just pushed.
    expect(github.readiness).toEqual([
      { pullRequestNumber: 900, head: 'release-head-1', summary: 'All 2 release candidates are accounted for.' },
    ]);
  });

  it('updates the same release PR on a later merge and stays content-idempotent for an unchanged range', async () => {
    const { generatedFiles, rendered, audit } = await collectAndRender([[mergedPr()]]);
    const git = new FakeGit();
    const github = new FakeGithub();
    const common = {
      git,
      github,
      config,
      generatedFiles,
      title: `Release ${rendered.version}`,
      body: 'Automated release proposal.',
      expectedMainHead: 'main-1',
      audit,
    };

    await runReleasePrAction(common);
    github.openReleasePr = { number: 900, author: config.appLogin, head: config.branch, base: config.base };

    const second = await runReleasePrAction(common);

    expect(second).toMatchObject({ action: 'updated', pullRequestNumber: 900, branchUpdated: false });
    expect(github.created).toHaveLength(1);
    expect(github.updated).toHaveLength(1);
    expect(git.pushes).toHaveLength(1);
  });

  it('fails closed without mutating anything when the open release PR is not the designated bot PR', async () => {
    const { generatedFiles, rendered, audit } = await collectAndRender([[mergedPr()]]);
    const git = new FakeGit();
    const github = new FakeGithub();
    github.openReleasePr = { number: 77, author: 'maintainer', head: 'feat/metadata', base: config.base };

    await expect(runReleasePrAction({
      git,
      github,
      config,
      generatedFiles,
      title: `Release ${rendered.version}`,
      body: 'Automated release proposal.',
      expectedMainHead: 'main-1',
      audit,
    })).rejects.toThrow(/owner does not match/i);

    expect(git.pushes).toEqual([]);
    expect(github.created).toEqual([]);
    expect(github.updated).toEqual([]);
  });
});

describe('TI-4 — stale and partially-failed maintenance cannot lose candidates', () => {
  it('rerenders once at the observed main head and pushes only the refreshed content', async () => {
    const stale = await collectAndRender([[mergedPr()]]);
    const fresh = await collectAndRender([
      [mergedPr()],
      [mergedPr({ number: 42, mergeSha: 'merge-42', mergedAt: '2026-08-01T02:00:00Z' })],
    ]);
    const git = new FakeGit();
    const github = new FakeGithub();
    git.mainHeads = ['main-2'];
    const rerenders: string[] = [];

    const result = await runReleasePrAction({
      git,
      github,
      config,
      generatedFiles: stale.generatedFiles,
      title: 'Release 1.3.0',
      body: 'Automated release proposal.',
      expectedMainHead: 'main-1',
      audit: fresh.audit,
      rerenderForCurrentMain: async (mainHead: string) => {
        rerenders.push(mainHead);
        return {
          expectedMainHead: mainHead,
          generatedFiles: fresh.generatedFiles,
          title: 'Release 1.3.0',
          body: 'Automated release proposal.',
        };
      },
    });

    expect(rerenders).toEqual(['main-2']);
    expect(git.pushes).toHaveLength(1);
    expect(git.pushes[0]!.expectedBaseHead).toBe('main-2');
    expect(git.pushes[0]!.files).toEqual(fresh.generatedFiles);
    expect(result).toMatchObject({ action: 'created', branchUpdated: true });
  });

  it('rejects a stale render outright when no rerender path is available', async () => {
    const { generatedFiles, audit } = await collectAndRender([[mergedPr()]]);
    const git = new FakeGit();
    const github = new FakeGithub();
    git.mainHeads = ['main-9'];

    await expect(runReleasePrAction({
      git,
      github,
      config,
      generatedFiles,
      title: 'Release 1.3.0',
      body: 'Automated release proposal.',
      expectedMainHead: 'main-1',
      audit,
    })).rejects.toThrow(/stale release render/i);

    expect(git.pushes).toEqual([]);
    expect(github.created).toEqual([]);
  });

  it('reconciles a branch-pushed, PR-failed run into one PR without a second push', async () => {
    const { generatedFiles, audit } = await collectAndRender([[mergedPr()]]);
    const git = new FakeGit();
    const github = new FakeGithub();
    const input = {
      git,
      github,
      config,
      generatedFiles,
      title: 'Release 1.3.0',
      body: 'Automated release proposal.',
      expectedMainHead: 'main-1',
      audit,
    };

    github.failCreatePullRequest = true;
    await expect(runReleasePrAction(input)).rejects.toThrow(/simulated PR creation failure/);
    expect(git.pushes).toHaveLength(1);

    github.failCreatePullRequest = false;
    const recovered = await runReleasePrAction(input);

    expect(recovered).toMatchObject({ action: 'created', pullRequestNumber: 900, branchUpdated: false });
    expect(git.pushes).toHaveLength(1);
    expect(github.created).toHaveLength(1);
  });

  it('refuses to overwrite a foreign edit on the release branch', async () => {
    const { generatedFiles, audit } = await collectAndRender([[mergedPr()]]);
    const git = new FakeGit();
    const github = new FakeGithub();
    git.branchFiles.set(config.branch, { ...generatedFiles, 'docs/handwritten.md': 'operator edit' });

    await expect(runReleasePrAction({
      git,
      github,
      config,
      generatedFiles,
      title: 'Release 1.3.0',
      body: 'Automated release proposal.',
      expectedMainHead: 'main-1',
      audit,
    })).rejects.toThrow(/foreign edits/i);

    expect(git.pushes).toEqual([]);
  });
});

describe('TI-6 — only a proven release-PR merge publishes', () => {
  const releaseMerge: MergedReleasePullRequest = {
    number: 900,
    author: config.appLogin,
    head: config.branch,
    headCommit: 'release-head-1',
    base: 'main',
    mergeCommit: 'release-merge',
  };

  function publisherFakes(overrides: {
    pullRequest?: MergedReleasePullRequest | undefined;
    files?: Record<string, string>;
    audit?: { head: string; complete: boolean };
    existingTag?: { commit: string };
    failCreateRelease?: boolean;
  } = {}) {
    const tags: Array<{ tag: string; commit: string }> = [];
    const releases: Array<{ tag: string; target: string; body: string }> = [];
    const forbidden: string[] = [];
    const existingTags = new Map<string, { commit: string }>();
    if (overrides.existingTag !== undefined) existingTags.set('v1.3.0', overrides.existingTag);

    const git: ReleasePublisherGit = {
      readCommitFiles: async () => {
        if (overrides.files === undefined) forbidden.push('readCommitFiles');
        return overrides.files;
      },
      readAnnotatedTag: async (tag: string) => existingTags.get(tag),
      createAnnotatedTag: async ({ tag, commit }) => {
        tags.push({ tag, commit });
        existingTags.set(tag, { commit });
      },
    };
    const github: ReleasePublisherGithub = {
      findMergedPullRequestByMergeCommit: async () => overrides.pullRequest,
      readReleaseAudit: async () => {
        if (overrides.audit === undefined) forbidden.push('readReleaseAudit');
        return overrides.audit;
      },
      findReleaseByTag: async () => undefined,
      createRelease: async (input) => {
        if (overrides.failCreateRelease === true) throw new Error('simulated release creation failure');
        releases.push({ tag: input.tag, target: input.target, body: input.body });
      },
    };
    return { git, github, tags, releases, forbidden };
  }

  it('publishes exactly one annotated tag and GitHub Release from the approved artifacts', async () => {
    const { rendered } = await collectAndRender([[mergedPr()]]);
    const fakes = publisherFakes({
      pullRequest: releaseMerge,
      audit: { head: 'release-head-1', complete: true },
      files: { VERSION: '1.3.0\n', 'CHANGELOG.md': rendered.changelog },
    });

    const result = await runReleasePublisherAction({
      git: fakes.git,
      github: fakes.github,
      config,
      event: { branch: 'main', commit: 'release-merge' },
    });

    expect(result).toEqual({ state: 'published', version: '1.3.0' });
    expect(fakes.tags).toEqual([{ tag: 'v1.3.0', commit: 'release-merge' }]);
    expect(fakes.releases).toHaveLength(1);
    expect(fakes.releases[0]!.body).toContain(HOSTILE_NOTE);
  });

  it.each([
    ['an ordinary implementation merge', { ...releaseMerge, number: 41, author: 'maintainer', head: 'feat/metadata' }],
    ['a foreign bot on the release branch', { ...releaseMerge, author: 'foreign[bot]' }],
    ['the App on a foreign branch', { ...releaseMerge, head: 'release/foreign' }],
    ['a direct push with no PR', undefined],
  ])('ignores %s before reading any release artifact', async (_case, pullRequest) => {
    const fakes = publisherFakes({ pullRequest });

    const result = await runReleasePublisherAction({
      git: fakes.git,
      github: fakes.github,
      config,
      event: { branch: 'main', commit: 'release-merge' },
    });

    expect(result).toEqual({ state: 'ignored' });
    expect(fakes.forbidden).toEqual([]);
    expect(fakes.tags).toEqual([]);
    expect(fakes.releases).toEqual([]);
  });

  it('rejects an approved merge whose candidate audit is not bound to the merged head', async () => {
    const { rendered } = await collectAndRender([[mergedPr()]]);
    const fakes = publisherFakes({
      pullRequest: releaseMerge,
      audit: { head: 'release-head-0', complete: true },
      files: { VERSION: '1.3.0\n', 'CHANGELOG.md': rendered.changelog },
    });

    const result = await runReleasePublisherAction({
      git: fakes.git,
      github: fakes.github,
      config,
      event: { branch: 'main', commit: 'release-merge' },
    });

    expect(result).toMatchObject({ state: 'rejected' });
    expect(fakes.tags).toEqual([]);
    expect(fakes.releases).toEqual([]);
  });

  it('finishes the same release after a tag-created, release-failed run without a duplicate tag', async () => {
    const { rendered } = await collectAndRender([[mergedPr()]]);
    const files = { VERSION: '1.3.0\n', 'CHANGELOG.md': rendered.changelog };
    const audit = { head: 'release-head-1', complete: true };
    const event = { branch: 'main', commit: 'release-merge' };
    const failing = publisherFakes({ pullRequest: releaseMerge, audit, files, failCreateRelease: true });

    await expect(runReleasePublisherAction({
      git: failing.git,
      github: failing.github,
      config,
      event,
    })).rejects.toThrow(/simulated release creation failure/);
    expect(failing.tags).toEqual([{ tag: 'v1.3.0', commit: 'release-merge' }]);

    const recovering = publisherFakes({
      pullRequest: releaseMerge,
      audit,
      files,
      existingTag: { commit: 'release-merge' },
    });

    const result = await runReleasePublisherAction({
      git: recovering.git,
      github: recovering.github,
      config,
      event,
    });

    expect(result).toEqual({ state: 'published', version: '1.3.0' });
    expect(recovering.tags).toEqual([]);
    expect(recovering.releases).toHaveLength(1);
  });
});

describe('TI-7 — the legacy pending set transitions exactly once', () => {
  const auditPath = '.docs/release/backlog-transition.md';
  const approvedAudit = 'Status: approved\n\n| Legacy entry | Disposition |\n| --- | --- |\n| Old repair | consolidated |\n';

  async function seedInput(git: FakeGit, github: FakeGithub, transition: {
    status: 'proposed' | 'approved';
    unresolved: readonly string[];
  }) {
    const { generatedFiles, audit } = await collectAndRender([[mergedPr()]]);
    return {
      git,
      github,
      config,
      generatedFiles,
      title: 'Release 1.3.0',
      body: 'Automated release proposal.',
      expectedMainHead: 'main-1',
      audit,
      transition: { ...transition, auditPath, audit: approvedAudit },
    };
  }

  it('seeds the operator-approved audit into the first release PR as a generated surface', async () => {
    const git = new FakeGit();
    const github = new FakeGithub();

    const result = await runReleasePrAction(await seedInput(git, github, { status: 'approved', unresolved: [] }));

    expect(result).toMatchObject({ action: 'created', transitionConsumed: true });
    expect(git.pushes[0]!.files[auditPath]).toBe(approvedAudit);
  });

  it.each([
    ['an unapproved proposal', { status: 'proposed' as const, unresolved: [] }],
    ['an approved proposal with unresolved items', { status: 'approved' as const, unresolved: ['Ambiguous entry'] }],
  ])('refuses %s before any Git or GitHub mutation', async (_case, transition) => {
    const git = new FakeGit();
    const github = new FakeGithub();

    await expect(runReleasePrAction(await seedInput(git, github, transition)))
      .rejects.toThrow(/operator-approved proposal with no unresolved items/i);

    expect(git.pushes).toEqual([]);
    expect(github.created).toEqual([]);
  });

  it('refuses to rerun once the transition is recorded consumed on the base branch', async () => {
    const git = new FakeGit();
    const github = new FakeGithub();
    git.baseFiles.set(auditPath, 'Status: consumed\n');

    await expect(runReleasePrAction(await seedInput(git, github, { status: 'approved', unresolved: [] })))
      .rejects.toThrow(/already consumed/i);

    expect(git.pushes).toEqual([]);
    expect(github.created).toEqual([]);
  });
});
