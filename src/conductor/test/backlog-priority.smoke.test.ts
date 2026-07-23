import { describe, it, expect } from 'vitest';
import { ghIssueLabelReader, parsePriorityLabels } from '../src/engine/backlog-priority.js';
import type { GhRunner } from '../src/engine/tracker-client.js';
import { execFileSync } from 'child_process';

/**
 * Real-binary exec runner: executes the PRODUCTION argv verbatim against the
 * real `gh` binary. No rewriting/joining — any translation here would let the
 * smoke pass while production ships a broken argv (the exact trap this test
 * exists to catch).
 */
function realExecRunner(): GhRunner {
  return async (argv: string[]) => {
    const stdout = execFileSync('gh', argv, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout };
  };
}

/**
 * Smoke test for ghIssueLabelReader using the real gh CLI.
 *
 * This test validates end-to-end label reading behavior:
 * - Calls the reader with the real exec runner (not mocked)
 * - Fetches labels from a real GitHub issue
 * - Verifies the issue has a priority label
 * - Confirms the label parses to a valid priority band
 *
 * Gated by PRIORITY_GH_SMOKE env var — skipped in CI/offline environments.
 */
describe.skipIf(!process.env.PRIORITY_GH_SMOKE)(
  'gh label reader smoke test (real gh binary)',
  () => {
    it('reads priority label from real issue jstoup111/ai-conductor#200', async () => {
      const reader = ghIssueLabelReader(realExecRunner());
      const result = await reader(['jstoup111/ai-conductor#200']);

      // Verify result is defined
      expect(result).toBeDefined();

      // Verify the issue was found (not 'not-found')
      const labels = result.get('jstoup111/ai-conductor#200');
      expect(labels).toBeDefined();
      expect(labels).not.toBe('not-found');

      // Verify we got an array of label strings
      expect(Array.isArray(labels)).toBe(true);

      // Extract priority band from the labels
      const bands = (labels as string[])
        .map((label) => parsePriorityLabels([label]))
        .filter((b) => b !== undefined);

      // Verify at least one valid priority label was found
      expect(bands.length).toBeGreaterThan(0);

      // Verify the priority band is one of the valid values
      const firstBand = bands[0];
      expect(['high', 'medium', 'low']).toContain(firstBand);
    });

    it('handles real issue with multiple labels including priority', async () => {
      const reader = ghIssueLabelReader(realExecRunner());
      const result = await reader(['jstoup111/ai-conductor#200']);

      const labels = result.get('jstoup111/ai-conductor#200');
      expect(Array.isArray(labels)).toBe(true);

      // Verify parsePriorityLabels can extract the highest priority from all labels
      const highestPriority = parsePriorityLabels(labels as string[]);
      expect(highestPriority).toBeDefined();
      expect(['high', 'medium', 'low']).toContain(highestPriority);
    });
  }
);
