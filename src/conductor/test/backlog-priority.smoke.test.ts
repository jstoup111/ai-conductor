import { describe, it, expect } from 'vitest';
import { createOrderingSource } from '../src/engine/ordering-source.js';
import type { GhRunner } from '../src/engine/tracker-client.js';
import { execFileSync } from 'child_process';
export const smokeCapability = 'toolchain';

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
 * Smoke test for createOrderingSource using the real gh CLI.
 *
 * This test validates end-to-end label reading behavior:
 * - Calls the reader with the real exec runner (not mocked)
 * - Fetches labels from a real GitHub issue
 * - Verifies the issue has a priority label
 * - Confirms the label parses to a valid priority band
 *
 * Runs when the smoke tier provides the required toolchain capability.
 */
describe(
  'ordering source smoke test (real gh binary)',
  () => {
    it('reads priority label from real issue jstoup111/ai-conductor#200', async () => {
      const result = await createOrderingSource({ run: realExecRunner() }).readFacts(['jstoup111/ai-conductor#200']);

      // Verify result is defined
      expect(result).toBeDefined();

      // Verify the issue was found (not 'not-found')
      const labels = result.get('jstoup111/ai-conductor#200');
      expect(labels).toBeDefined();
      expect(labels).not.toBe('not-found');

      expect(typeof labels).toBe('object');
      expect(['critical', 'high', 'medium', 'low']).toContain((labels as { priority?: string }).priority);
    });

    it('handles real issue with multiple labels including priority', async () => {
      const result = await createOrderingSource({ run: realExecRunner() }).readFacts(['jstoup111/ai-conductor#200']);

      const labels = result.get('jstoup111/ai-conductor#200');
      expect((labels as { priority?: string }).priority).toBeDefined();
      expect(['critical', 'high', 'medium', 'low']).toContain((labels as { priority?: string }).priority);
    });
  }
);
