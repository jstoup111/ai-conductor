import { describe, it, expect } from 'vitest';
import { ghIssueLabelReader, parsePriorityLabels, type ExecRunner } from '../src/engine/backlog-priority.js';
import { execSync } from 'child_process';

/**
 * Shell-based exec runner for testing with the real `gh` CLI.
 * Executes gh commands via shell and parses JSON output.
 *
 * For `gh api` commands, converts ['api', 'repos', owner, repo, 'issues', N] → 'gh api repos/owner/repo/issues/N'
 *
 * @returns ExecRunner that uses the real gh binary
 */
function shellExecRunner(): ExecRunner {
  return async (argv: string[]) => {
    try {
      // Special handling for 'gh api' commands: join path segments with /
      let command: string;
      if (argv[0] === 'api') {
        // Convert ['api', 'repos', owner, repo, 'issues', number] to 'gh api repos/owner/repo/issues/number'
        const pathSegments = argv.slice(1).join('/');
        command = `gh api ${pathSegments}`;
      } else {
        // For other gh commands, join with spaces
        command = ['gh', ...argv].join(' ');
      }

      const stdout = execSync(command, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'], // Capture all output, suppress stderr to reduce noise
      });
      return { stdout };
    } catch (error) {
      // Re-throw with context
      if (error instanceof Error) {
        throw new Error(`gh command failed: ${error.message}`);
      }
      throw error;
    }
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
      const reader = ghIssueLabelReader(shellExecRunner());
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
      const reader = ghIssueLabelReader(shellExecRunner());
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
