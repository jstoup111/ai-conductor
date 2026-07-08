/**
 * Tests for ci-fix.ts (Task 15–16: RETRY hint builder).
 *
 * All gh interactions use fake runners; no real `gh` binary required.
 */

import { describe, it, expect } from 'vitest';
import { buildCiFixHint } from '../../src/engine/ci-fix.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a fake GhRunner that returns check results and run logs.
 *
 * When `gh pr checks --json` is called, returns the `prChecks` response.
 * When `gh run view --log-failed` is called, returns the `runLogs` response.
 */
function makeFakeGhForHints(
  prChecks: { stdout: string },
  runLogs: { stdout: string },
): GhRunner {
  return async (args) => {
    // gh pr checks <url> --json
    if (args[0] === 'pr' && args[1] === 'checks' && args[args.length - 1] === '--json') {
      return prChecks;
    }

    // gh run view <run-id> --log-failed
    if (args[0] === 'run' && args[1] === 'view' && args.includes('--log-failed')) {
      return runLogs;
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

    const gh = makeFakeGhForHints(prChecks, runLogs);
    const hint = await buildCiFixHint(gh, CWD, PR_URL);

    expect(hint).toContain('unit-tests');
    expect(hint).toContain('line 1 of error');
    expect(hint).toContain('line 2 of error');
    // Should have bounded length, might not include all lines
    expect(hint.length).toBeLessThan(1000);
  });
});
