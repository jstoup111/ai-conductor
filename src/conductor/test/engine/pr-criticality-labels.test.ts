// Unit tests for `mirrorIssueCriticalityLabels` — the seam that copies an
// intake issue's `priority: <band>` labels onto the PR delivering it.
//
// Every gh call is injected; nothing here touches the network.

import { describe, it, expect } from 'vitest';
import {
  mirrorIssueCriticalityLabels,
  selectCriticalityLabels,
  isCriticalityLabel,
} from '../../src/engine/pr-criticality-labels.js';

type Call = { args: string[]; cwd: string };

/**
 * Fake gh: answers the issue-labels read with `labels`, records every call, and
 * fails any call listed in `failOn` (matched as a substring of the joined argv).
 */
function fakeGh(labels: string[], failOn: string[] = []) {
  const calls: Call[] = [];
  const gh = async (args: string[], opts: { cwd: string }) => {
    calls.push({ args, cwd: opts.cwd });
    const joined = args.join(' ');
    if (failOn.some((f) => joined.includes(f))) throw new Error(`boom: ${joined}`);
    if (/issues\/\d+\/labels$/.test(args[1] ?? '')) {
      return { stdout: JSON.stringify(labels.map((name) => ({ name }))) };
    }
    return { stdout: '' };
  };
  return { gh, calls };
}

const PR_URL = 'https://github.com/acme/app/pull/42';

describe('criticality label selection', () => {
  it('accepts only the exact `priority: <band>` shape', () => {
    expect(isCriticalityLabel('priority: critical')).toBe(true);
    expect(isCriticalityLabel('priority: low')).toBe(true);
    // Near-misses the daemon's own parser also rejects.
    expect(isCriticalityLabel('priority:medium')).toBe(false);
    expect(isCriticalityLabel('Priority: high')).toBe(false);
    expect(isCriticalityLabel('priority: urgent')).toBe(false);
  });

  it('drops non-criticality labels, including size', () => {
    expect(
      selectCriticalityLabels(['bug', 'size: M', 'priority: high', 'spec']),
    ).toEqual(['priority: high']);
  });
});

describe('mirrorIssueCriticalityLabels', () => {
  it('applies every criticality label from the issue to the PR', async () => {
    const { gh, calls } = fakeGh(['bug', 'priority: critical', 'size: L']);

    const result = await mirrorIssueCriticalityLabels({
      gh,
      cwd: '/repo',
      prUrl: PR_URL,
      sourceRef: 'acme/app#7',
    });

    expect(result).toEqual({ outcome: 'mirrored', labels: ['priority: critical'], failed: [] });
    expect(calls[0].args).toEqual(['api', 'repos/acme/app/issues/7/labels']);
    // The write targets the PR number, via the REST labels endpoint.
    expect(calls[1].args).toEqual([
      'api',
      '--method',
      'POST',
      'repos/acme/app/issues/42/labels',
      '-f',
      'labels[]=priority: critical',
    ]);
    expect(calls).toHaveLength(2);
  });

  it('mirrors across repos — the issue and the PR may live apart', async () => {
    const { gh, calls } = fakeGh(['priority: low']);

    await mirrorIssueCriticalityLabels({
      gh,
      cwd: '/repo',
      prUrl: 'https://github.com/other/target/pull/9',
      sourceRef: 'acme/app#7',
    });

    expect(calls[0].args[1]).toBe('repos/acme/app/issues/7/labels');
    expect(calls[1].args[3]).toBe('repos/other/target/issues/9/labels');
  });

  it('writes nothing when the issue carries no criticality label', async () => {
    const { gh, calls } = fakeGh(['bug', 'size: S']);

    const result = await mirrorIssueCriticalityLabels({
      gh,
      cwd: '/repo',
      prUrl: PR_URL,
      sourceRef: 'acme/app#7',
    });

    expect(result).toEqual({ outcome: 'none-on-issue' });
    expect(calls).toHaveLength(1);
  });

  // ── Fail-open ───────────────────────────────────────────────────────────────

  it('no-ops without a linked issue, touching gh not at all', async () => {
    const { gh, calls } = fakeGh(['priority: high']);

    const result = await mirrorIssueCriticalityLabels({
      gh,
      cwd: '/repo',
      prUrl: PR_URL,
      sourceRef: undefined,
    });

    expect(result).toEqual({ outcome: 'skipped', reason: 'no linked issue' });
    expect(calls).toHaveLength(0);
  });

  it('no-ops on an unparseable source ref', async () => {
    const { gh, calls } = fakeGh(['priority: high']);

    const result = await mirrorIssueCriticalityLabels({
      gh,
      cwd: '/repo',
      prUrl: PR_URL,
      sourceRef: 'not-a-ref',
    });

    expect(result.outcome).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('no-ops on an unparseable PR URL', async () => {
    const { gh, calls } = fakeGh(['priority: high']);

    const result = await mirrorIssueCriticalityLabels({
      gh,
      cwd: '/repo',
      prUrl: 'not a url',
      sourceRef: 'acme/app#7',
    });

    expect(result.outcome).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('returns an advisory failure — never throws — when the label read fails', async () => {
    const { gh } = fakeGh([], ['issues/7/labels']);
    const logged: string[] = [];

    const result = await mirrorIssueCriticalityLabels({
      gh,
      cwd: '/repo',
      prUrl: PR_URL,
      sourceRef: 'acme/app#7',
      log: (m) => logged.push(m),
    });

    expect(result.outcome).toBe('failed');
    expect(logged.join('\n')).toContain('acme/app#7');
  });

  it('returns an advisory failure — never throws — when the label read is not JSON', async () => {
    const gh = async () => ({ stdout: '<html>gh proxy error</html>' });

    const result = await mirrorIssueCriticalityLabels({
      gh,
      cwd: '/repo',
      prUrl: PR_URL,
      sourceRef: 'acme/app#7',
    });

    expect(result.outcome).toBe('failed');
  });

  it('keeps applying the remaining labels when one write fails', async () => {
    // Two bands on one issue (rare, but the endpoint permits it): the failing
    // write must not abort the other.
    const { gh } = fakeGh(
      ['priority: critical', 'priority: low'],
      ['labels[]=priority: critical'],
    );

    const result = await mirrorIssueCriticalityLabels({
      gh,
      cwd: '/repo',
      prUrl: PR_URL,
      sourceRef: 'acme/app#7',
    });

    expect(result).toEqual({
      outcome: 'mirrored',
      labels: ['priority: low'],
      failed: ['priority: critical'],
    });
  });
});
