/**
 * Tests for ci-fix.ts (Task 15–16: RETRY hint builder).
 *
 * All gh interactions use fake runners; no real `gh` binary required.
 */

import { describe, it, expect } from 'vitest';
import { buildCiFixHint, isEligibleForCiFix } from '../../src/engine/ci-fix.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import type { WatchEntry } from '../../src/engine/mergeable-sweep.js';
import type { PrMergeState } from '../../src/engine/pr-labels.js';
import type { HarnessConfig } from '../../src/types/config.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a fake GhRunner that returns check results and run logs.
 *
 * When `gh pr checks --json` is called, returns the `prChecks` response.
 * When `gh run view --log-failed` is called, returns the `runLogs` response.
 * Can optionally throw on specific commands.
 */
function makeFakeGhForHints(options: {
  prChecks: { stdout: string };
  runLogs?: { stdout: string };
  throwOnRunView?: boolean;
}): GhRunner {
  return async (args) => {
    // gh pr checks <url> --json
    if (args[0] === 'pr' && args[1] === 'checks' && args[args.length - 1] === '--json') {
      return options.prChecks;
    }

    // gh run view <run-id> --log-failed
    if (args[0] === 'run' && args[1] === 'view' && args.includes('--log-failed')) {
      if (options.throwOnRunView) {
        throw new Error('gh run view failed');
      }
      return options.runLogs || { stdout: '' };
    }

    return { stdout: '' };
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ci-fix: buildCiFixHint', () => {
  const PR_URL = 'https://github.com/foo/bar/pull/42';
  const CWD = '/fake/repo';

  it('happy path: returns check name + log excerpt from one failed check', async () => {
    const prChecks = {
      stdout: JSON.stringify({
        checkSuites: [
          {
            checkRuns: [
              {
                name: 'unit-tests',
                conclusion: 'FAILURE',
                detailsUrl: 'https://github.com/foo/bar/runs/123',
              },
            ],
          },
        ],
      }),
    };

    const runLogs = {
      stdout: `FAILED: unit-tests
line 1 of error
line 2 of error
line 3 of error
line 4 of error
line 5 of error
line 6 of error
line 7 of error
line 8 of error
line 9 of error
line 10 of error`,
    };

    const gh = makeFakeGhForHints({ prChecks, runLogs });
    const hint = await buildCiFixHint(gh, CWD, PR_URL);

    expect(hint).toContain('unit-tests');
    expect(hint).toContain('line 1 of error');
    expect(hint).toContain('line 2 of error');
    // Should have bounded length, might not include all lines
    expect(hint.length).toBeLessThan(1000);
  });

  it('degradation: gh run view throws → hint contains check name + link, non-empty, no throw', async () => {
    const prChecks = {
      stdout: JSON.stringify({
        checkSuites: [
          {
            checkRuns: [
              {
                name: 'lint-check',
                conclusion: 'FAILURE',
                detailsUrl: 'https://github.com/foo/bar/runs/456',
              },
            ],
          },
        ],
      }),
    };

    const gh = makeFakeGhForHints({ prChecks, throwOnRunView: true });
    const hint = await buildCiFixHint(gh, CWD, PR_URL);

    // Hint must be non-empty
    expect(hint).toBeTruthy();
    expect(hint.length).toBeGreaterThan(0);
    // Must contain check name
    expect(hint).toContain('lint-check');
    // Must contain the link
    expect(hint).toContain('https://github.com/foo/bar/runs/456');
  });

  it('degradation: no run link present → hint contains check name, non-empty, no throw', async () => {
    const prChecks = {
      stdout: JSON.stringify({
        checkSuites: [
          {
            checkRuns: [
              {
                name: 'test-suite',
                conclusion: 'FAILURE',
                // No detailsUrl
              },
            ],
          },
        ],
      }),
    };

    const gh = makeFakeGhForHints({ prChecks });
    const hint = await buildCiFixHint(gh, CWD, PR_URL);

    // Hint must be non-empty
    expect(hint).toBeTruthy();
    expect(hint.length).toBeGreaterThan(0);
    // Must contain check name
    expect(hint).toContain('test-suite');
  });
});

// ── Tests for isEligibleForCiFix (Task 13) ────────────────────────────────────

describe('ci-fix: isEligibleForCiFix eligibility gates (Task 13)', () => {
  const PR_URL = 'https://github.com/foo/bar/pull/42';
  const SLUG = 'foo/bar#42';
  const REPO_CWD = '/fake/repo';
  const NOW = new Date('2026-07-08T12:00:00Z');

  const defaultEntry: WatchEntry = {
    prUrl: PR_URL,
    slug: SLUG,
    repoCwd: REPO_CWD,
    ciFixAttempts: 0,
  };

  const defaultState: PrMergeState = {
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    hasFailingOrPendingChecks: true,
    labels: [],
    checksOutcome: 'failed',
  };

  const defaultConfig: HarnessConfig = {
    ci_watch: {
      enabled: true,
    },
  };

  it('eligible: all gates pass', async () => {
    const result = await isEligibleForCiFix(defaultEntry, defaultState, defaultConfig, NOW);
    expect(result.eligible).toBe(true);
  });

  it('gate 1 (cap): attempts >= 2 → ineligible with reason cap', async () => {
    const entry = { ...defaultEntry, ciFixAttempts: 2 };
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await isEligibleForCiFix(entry, defaultState, defaultConfig, NOW, logger);

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('cap');
    // Verify one outcome line was logged
    expect(logs.some((l) => l.includes('skipped') && l.includes('cap'))).toBe(true);
  });

  it('gate 1 (cap): attempts = 1 → eligible', async () => {
    const entry = { ...defaultEntry, ciFixAttempts: 1 };
    const result = await isEligibleForCiFix(entry, defaultState, defaultConfig, NOW);
    expect(result.eligible).toBe(true);
  });

  it('gate 2 (sticky label): needs-remediation present → ineligible', async () => {
    const state = { ...defaultState, labels: ['needs-remediation'] };
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await isEligibleForCiFix(defaultEntry, state, defaultConfig, NOW, logger);

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('sticky');
    // Verify one outcome line was logged
    expect(logs.some((l) => l.includes('skipped') && l.includes('sticky'))).toBe(true);
  });

  it('gate 2 (sticky label): needs-remediation absent → eligible', async () => {
    const state = { ...defaultState, labels: ['mergeable', 'ci-failed'] };
    const result = await isEligibleForCiFix(defaultEntry, state, defaultConfig, NOW);
    expect(result.eligible).toBe(true);
  });

  it('gate 3 (conflict): mergeable = CONFLICTING → ineligible', async () => {
    const state = { ...defaultState, mergeable: 'CONFLICTING' };
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await isEligibleForCiFix(defaultEntry, state, defaultConfig, NOW, logger);

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('conflict-precedence');
    // Verify one outcome line was logged
    expect(logs.some((l) => l.includes('skipped') && l.includes('conflict-precedence'))).toBe(true);
  });

  it('gate 3 (conflict): mergeable = MERGEABLE → eligible', async () => {
    const state = { ...defaultState, mergeable: 'MERGEABLE' };
    const result = await isEligibleForCiFix(defaultEntry, state, defaultConfig, NOW);
    expect(result.eligible).toBe(true);
  });

  it('multiple gate failures: first gate wins', async () => {
    const entry = { ...defaultEntry, ciFixAttempts: 2 };
    const state = { ...defaultState, labels: ['needs-remediation'] };
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await isEligibleForCiFix(entry, state, defaultConfig, NOW, logger);

    expect(result.eligible).toBe(false);
    // Cap gate should reject first (attempt 2 >= cap 2)
    expect(result.reason).toContain('cap');
    // Only one outcome line logged
    expect(logs.filter((l) => l.includes('skipped')).length).toBe(1);
  });

  it('no counter change on skip', async () => {
    const entry = { ...defaultEntry, ciFixAttempts: 5 };
    const state = { ...defaultState, mergeable: 'CONFLICTING' };

    const result = await isEligibleForCiFix(entry, state, defaultConfig, NOW);

    expect(result.eligible).toBe(false);
    // Entry's ciFixAttempts should not be mutated
    expect(entry.ciFixAttempts).toBe(5);
  });
});
