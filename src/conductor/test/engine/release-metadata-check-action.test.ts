import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import { runReleaseMetadataCheckAction } from '../../src/engine/release-metadata-check-action.js';

describe('release metadata GitHub Actions adapter (Task 3)', () => {
  it('exports the injected adapter and validates reviewable PRs on every update', async () => {
    const repositoryRoot = new URL('../../../../', import.meta.url);
    const [workflow, index] = await Promise.all([
      readFile(new URL('.github/workflows/release-metadata.yml', repositoryRoot), 'utf8'),
      readFile(new URL('src/conductor/src/index.ts', repositoryRoot), 'utf8'),
    ]);

    expect({
      skipsDrafts: /if:\s*github\.event\.pull_request\.head\.ref\s*!=\s*'automation\/release-pr'\s*&&\s*!github\.event\.pull_request\.draft/.test(workflow),
      validatesWhenReviewable: /types:\s*\[opened, reopened, synchronize, edited, ready_for_review\]/.test(workflow),
      usesGithubScript: /uses:\s*actions\/github-script@v9/.test(workflow),
      importsBuiltEngine: /import\(\s*`\$\{process\.env\.GITHUB_WORKSPACE\}\/src\/conductor\/dist\/index\.js`\s*\)/.test(workflow),
      invokesInjectedAction: /runReleaseMetadataCheckAction\(\s*\{\s*github\s*,\s*context\s*,\s*core\s*}\s*\)/s.test(workflow),
      reexportsAction: /export\s*\{\s*runReleaseMetadataCheckAction\s*}\s*from\s*['"]\.\/engine\/release-metadata-check-action\.js['"]/.test(index),
    }).toEqual({
      skipsDrafts: true,
      validatesWhenReviewable: true,
      usesGithubScript: true,
      importsBuiltEngine: true,
      invokesInjectedAction: true,
      reexportsAction: true,
    });
  });

  it('normalizes the PR body through an injected Actions event and exposes JSON output', async () => {
    const setOutput = vi.fn();
    const github = { rest: { pulls: { get: vi.fn() } } };

    await expect(runReleaseMetadataCheckAction({
      github,
      context: {
        payload: {
          pull_request: {
            body: [
              'Release-Disposition: note',
              'Release-Category: Fixed',
              'Release-Semver: patch',
              'Release-Note: Correct release metadata validation.',
            ].join('\n'),
          },
        },
      },
      core: { setOutput },
    })).resolves.toBeUndefined();

    expect({
      output: setOutput.mock.calls,
      githubCalls: github.rest.pulls.get.mock.calls,
    }).toEqual({
      output: [[
        'release-disposition',
        JSON.stringify({
          disposition: 'note',
          category: 'Fixed',
          semver: 'patch',
          note: 'Correct release metadata validation.',
        }),
      ]],
      githubCalls: [],
    });
  });

  it('stamps the declared semver band and retracts a stale one', async () => {
    const addLabels = vi.fn().mockResolvedValue(undefined);
    const removeLabel = vi.fn().mockResolvedValue(undefined);

    await runReleaseMetadataCheckAction({
      github: { rest: { issues: { addLabels, removeLabel } } },
      context: {
        repo: { owner: 'jstoup111', repo: 'ai-conductor' },
        payload: {
          pull_request: {
            number: 1402,
            labels: [{ name: 'semver:minor' }, { name: 'spec' }],
            body: [
              'Release-Disposition: note',
              'Release-Category: Fixed',
              'Release-Semver: patch',
              'Release-Note: Correct release metadata validation.',
            ].join('\n'),
          },
        },
      },
      core: { setOutput: vi.fn() },
    });

    expect({ add: addLabels.mock.calls, remove: removeLabel.mock.calls }).toEqual({
      add: [[{
        owner: 'jstoup111',
        repo: 'ai-conductor',
        issue_number: 1402,
        labels: ['semver:patch'],
      }]],
      remove: [[{
        owner: 'jstoup111',
        repo: 'ai-conductor',
        issue_number: 1402,
        name: 'semver:minor',
      }]],
    });
  });

  it('carries no band for no-note work and retracts one it no longer earns', async () => {
    const addLabels = vi.fn().mockResolvedValue(undefined);
    const removeLabel = vi.fn().mockResolvedValue(undefined);

    await runReleaseMetadataCheckAction({
      github: { rest: { issues: { addLabels, removeLabel } } },
      context: {
        repo: { owner: 'jstoup111', repo: 'ai-conductor' },
        payload: {
          pull_request: {
            number: 7,
            labels: [{ name: 'semver:major' }],
            body: 'Release-Disposition: no-note',
          },
        },
      },
      core: { setOutput: vi.fn() },
    });

    expect({ add: addLabels.mock.calls.length, remove: removeLabel.mock.calls }).toEqual({
      add: 0,
      remove: [[{
        owner: 'jstoup111',
        repo: 'ai-conductor',
        issue_number: 7,
        name: 'semver:major',
      }]],
    });
  });

  it('leaves an already-correct band alone', async () => {
    const addLabels = vi.fn().mockResolvedValue(undefined);
    const removeLabel = vi.fn().mockResolvedValue(undefined);

    await runReleaseMetadataCheckAction({
      github: { rest: { issues: { addLabels, removeLabel } } },
      context: {
        repo: { owner: 'jstoup111', repo: 'ai-conductor' },
        payload: {
          pull_request: {
            number: 9,
            labels: [{ name: 'semver:patch' }],
            body: [
              'Release-Disposition: note',
              'Release-Category: Added',
              'Release-Semver: patch',
              'Release-Note: Something reader-visible.',
            ].join('\n'),
          },
        },
      },
      core: { setOutput: vi.fn() },
    });

    expect([addLabels.mock.calls.length, removeLabel.mock.calls.length]).toEqual([0, 0]);
  });

  it('never bands a PR whose metadata failed validation', async () => {
    const addLabels = vi.fn();

    await expect(runReleaseMetadataCheckAction({
      github: { rest: { issues: { addLabels, removeLabel: vi.fn() } } },
      context: {
        repo: { owner: 'jstoup111', repo: 'ai-conductor' },
        payload: { pull_request: { number: 11, body: 'Release-Disposition: note' } },
      },
      core: { setOutput: vi.fn() },
    })).rejects.toThrow('Invalid release disposition: Category');

    expect(addLabels).not.toHaveBeenCalled();
  });

  it('grants the workflow the write scope the label stamp needs', async () => {
    const workflow = await readFile(
      new URL('.github/workflows/release-metadata.yml', new URL('../../../../', import.meta.url)),
      'utf8',
    );
    expect(/permissions:\s*\n\s*contents: read\s*\n(?:\s*#[^\n]*\n)*\s*pull-requests: write/.test(workflow)).toBe(true);
  });

  it('keeps a labels failure from failing the required check', async () => {
    const setOutput = vi.fn();
    const info = vi.fn();

    await expect(runReleaseMetadataCheckAction({
      github: {
        rest: {
          issues: {
            addLabels: vi.fn().mockRejectedValue(new Error('rate limited')),
            removeLabel: vi.fn(),
          },
        },
      },
      context: {
        repo: { owner: 'jstoup111', repo: 'ai-conductor' },
        payload: {
          pull_request: {
            number: 13,
            body: [
              'Release-Disposition: note',
              'Release-Category: Fixed',
              'Release-Semver: major',
              'Release-Note: Something reader-visible.',
            ].join('\n'),
          },
        },
      },
      core: { setOutput, info },
    })).resolves.toBeUndefined();

    expect([setOutput.mock.calls.length, info.mock.calls.length]).toEqual([1, 1]);
  });

  it('fails invalid PR metadata without emitting a normalized output', async () => {
    const setOutput = vi.fn();

    await expect(runReleaseMetadataCheckAction({
      github: { rest: { pulls: { get: vi.fn() } } },
      context: { payload: { pull_request: { body: 'Release-Disposition: note' } } },
      core: { setOutput },
    })).rejects.toThrow('Invalid release disposition: Category');

    expect(setOutput).not.toHaveBeenCalled();
  });
});
