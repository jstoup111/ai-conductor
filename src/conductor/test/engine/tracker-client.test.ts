import { describe, expect, it } from 'vitest';

import {
  createGithubTrackerClient,
  type GhRunner,
} from '../../src/engine/tracker-client.js';

const EFFECT_MARKER = '<!-- ai-conductor:remediation-effect:effect-123 -->';

function fakeRunner(stdout: string): {
  runner: GhRunner;
  calls: Array<{ args: string[]; opts: { cwd: string } }>;
} {
  const calls: Array<{ args: string[]; opts: { cwd: string } }> = [];
  const runner: GhRunner = async (args, opts) => {
    calls.push({ args, opts });
    return { stdout };
  };
  return { runner, calls };
}

function expectedSearchCall(): { args: string[]; opts: { cwd: string } } {
  return {
    args: [
      'issue',
      'list',
      '--state',
      'all',
      '--search',
      `"${EFFECT_MARKER}" in:body`,
      '--json',
      'url,body',
      '--limit',
      '2',
      '-R',
      'acme/intake',
    ],
    opts: { cwd: '/worktree' },
  };
}

describe('createGithubTrackerClient.findIssueByEffectMarker', () => {
  it('returns an open issue with the exact marker and searches every issue state in the configured repository', async () => {
    const { runner, calls } = fakeRunner(JSON.stringify([
      { url: 'https://github.com/acme/intake/issues/41', body: `Observed\n${EFFECT_MARKER}\nImpact` },
    ]));

    const found = await createGithubTrackerClient(runner).findIssueByEffectMarker(
      EFFECT_MARKER,
      'acme/intake',
      '/worktree',
    );

    expect(found).toBe('https://github.com/acme/intake/issues/41');
    expect(calls).toEqual([expectedSearchCall()]);
  });

  it('returns a closed issue with the exact marker', async () => {
    const { runner } = fakeRunner(JSON.stringify([
      { url: 'https://github.com/acme/intake/issues/42', body: `${EFFECT_MARKER}\nClosed after triage` },
    ]));

    await expect(
      createGithubTrackerClient(runner).findIssueByEffectMarker(EFFECT_MARKER, 'acme/intake', '/worktree'),
    ).resolves.toBe('https://github.com/acme/intake/issues/42');
  });

  it('returns null when no issue has the marker', async () => {
    const { runner } = fakeRunner(JSON.stringify([
      { url: 'https://github.com/acme/intake/issues/43', body: 'No remediation marker here.' },
    ]));

    await expect(
      createGithubTrackerClient(runner).findIssueByEffectMarker(EFFECT_MARKER, 'acme/intake', '/worktree'),
    ).resolves.toBeNull();
  });

  it('does not mistake a similar marker for the reserved effect marker', async () => {
    const { runner } = fakeRunner(JSON.stringify([
      {
        url: 'https://github.com/acme/intake/issues/44',
        body: '<!-- ai-conductor:remediation-effect:effect-1234 -->',
      },
    ]));

    await expect(
      createGithubTrackerClient(runner).findIssueByEffectMarker(EFFECT_MARKER, 'acme/intake', '/worktree'),
    ).resolves.toBeNull();
  });

  it('propagates malformed search output as a named parse error', async () => {
    const { runner } = fakeRunner('not json');

    await expect(
      createGithubTrackerClient(runner).findIssueByEffectMarker(EFFECT_MARKER, 'acme/intake', '/worktree'),
    ).rejects.toThrow(/findIssueByEffectMarker/);
  });

  it('propagates runner failures as a typed gh error', async () => {
    const runner: GhRunner = async () => {
      const error = new Error('authentication failed') as Error & { code: number; stderr: string };
      error.code = 1;
      error.stderr = 'HTTP 401';
      throw error;
    };

    await expect(
      createGithubTrackerClient(runner).findIssueByEffectMarker(EFFECT_MARKER, 'acme/intake', '/worktree'),
    ).rejects.toMatchObject({
      name: 'GhRunnerError',
      argv: expectedSearchCall().args,
      stderr: 'HTTP 401',
    });
  });
});
