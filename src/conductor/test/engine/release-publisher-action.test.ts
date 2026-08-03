import { describe, expect, it, vi } from 'vitest';

import { runReleasePublisherAction } from '../../src/engine/release-publisher-action.js';

describe('engine/release-publisher-action — release PR provenance (Task 14)', () => {
  const config = { branch: 'release/pending', base: 'main', appLogin: 'release-app[bot]' };

  it('publishes only the approved version section from the designated merged release PR', async () => {
    const git = {
      readCommitFiles: vi.fn(async () => ({
        VERSION: '1.2.4\n',
        'CHANGELOG.md': [
          '# Changelog',
          '',
          '## [Unreleased]',
          '',
          '## [1.2.4] - 2026-08-02',
          '',
          '### Fixed',
          '',
          '- Publish only approved releases.',
          '',
          '## [1.2.3] - 2026-08-01',
          '',
        ].join('\n'),
      })),
      createAnnotatedTag: vi.fn(async () => undefined),
    };
    const github = {
      findMergedPullRequestByMergeCommit: vi.fn(async () => ({
        number: 42,
        author: config.appLogin,
        head: config.branch,
        headCommit: 'release-head-42',
        base: config.base,
        mergeCommit: 'merged-release-head',
      })),
      readReleaseAudit: vi.fn(async () => ({ head: 'release-head-42', complete: true })),
      createRelease: vi.fn(async () => undefined),
    };

    await expect(runReleasePublisherAction({
      git,
      github,
      config,
      event: { branch: 'main', commit: 'merged-release-head' },
    })).resolves.toEqual({ state: 'published', version: '1.2.4' });

    expect(git.createAnnotatedTag).toHaveBeenCalledWith({
      tag: 'v1.2.4',
      commit: 'merged-release-head',
      message: 'Release v1.2.4',
    });
    expect(github.createRelease).toHaveBeenCalledWith({
      tag: 'v1.2.4',
      title: 'v1.2.4',
      body: '### Fixed\n\n- Publish only approved releases.\n',
      target: 'merged-release-head',
    });
  });

  it.each([
    ['an implementation PR', { author: 'developer', head: 'feature/add-widget', base: 'main' }],
    ['a foreign release-shaped PR', { author: 'foreign[bot]', head: config.branch, base: 'main' }],
  ])('ignores %s without reading release state or mutating publication', async (_name, identity) => {
    const { git, github } = dependencies({ ...identity, mergeCommit: 'ordinary-merge' });

    await expect(runReleasePublisherAction({
      git,
      github,
      config,
      event: { branch: 'main', commit: 'ordinary-merge' },
    })).resolves.toEqual({ state: 'ignored' });

    expect(github.readReleaseAudit).not.toHaveBeenCalled();
    expect(git.readCommitFiles).not.toHaveBeenCalled();
    expect(git.createAnnotatedTag).not.toHaveBeenCalled();
    expect(github.createRelease).not.toHaveBeenCalled();
  });

  it('ignores a direct main push before querying GitHub or mutating publication', async () => {
    const { git, github } = dependencies();

    await expect(runReleasePublisherAction({
      git,
      github,
      config,
      event: { branch: 'release/pending', commit: 'direct-push' },
    })).resolves.toEqual({ state: 'ignored' });

    expect(github.findMergedPullRequestByMergeCommit).not.toHaveBeenCalled();
    expect(git.createAnnotatedTag).not.toHaveBeenCalled();
    expect(github.createRelease).not.toHaveBeenCalled();
  });

  it('rejects a designated release PR whose candidate audit is incomplete before mutating Git or GitHub', async () => {
    const { git, github } = dependencies();
    github.readReleaseAudit.mockResolvedValue({ head: 'release-head-42', complete: false });

    await expect(runReleasePublisherAction({
      git,
      github,
      config,
      event: { branch: 'main', commit: 'merged-release-head' },
    })).resolves.toMatchObject({ state: 'rejected', reason: expect.stringMatching(/complete.*audit/i) });

    expect(git.readCommitFiles).not.toHaveBeenCalled();
    expect(git.createAnnotatedTag).not.toHaveBeenCalled();
    expect(github.createRelease).not.toHaveBeenCalled();
  });

  it('rejects an approved PR when VERSION does not identify a matching changelog section', async () => {
    const { git, github } = dependencies();
    git.readCommitFiles.mockResolvedValue({ VERSION: '1.2.4\n', 'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n' });

    await expect(runReleasePublisherAction({
      git,
      github,
      config,
      event: { branch: 'main', commit: 'merged-release-head' },
    })).resolves.toMatchObject({ state: 'rejected', reason: expect.stringMatching(/VERSION.*changelog/i) });

    expect(git.createAnnotatedTag).not.toHaveBeenCalled();
    expect(github.createRelease).not.toHaveBeenCalled();
  });

  function dependencies(pullRequest = {
    author: config.appLogin,
    head: config.branch,
    base: config.base,
    mergeCommit: 'merged-release-head',
  }) {
    return {
      git: {
        readCommitFiles: vi.fn(async () => ({ VERSION: '1.2.4\n', 'CHANGELOG.md': '# Changelog\n\n## [1.2.4] - 2026-08-02\n\nApproved.\n' })),
        createAnnotatedTag: vi.fn(async () => undefined),
      },
      github: {
        findMergedPullRequestByMergeCommit: vi.fn(async () => ({ number: 42, headCommit: 'release-head-42', ...pullRequest })),
        readReleaseAudit: vi.fn(async () => ({ head: 'release-head-42', complete: true })),
        createRelease: vi.fn(async () => undefined),
      },
    };
  }
});
