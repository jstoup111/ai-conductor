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
