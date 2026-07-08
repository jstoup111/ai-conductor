/**
 * CI fix eligibility, hint builder, and resolver for failed check remediation.
 *
 * Provides:
 * - `buildCiFixHint`: Fetches failing check names and log excerpts
 * - `isEligibleForCiFix`: Eligibility gates for ci-fix dispatch
 * - `runCiFix`: Resolver orchestration (Tasks 17–20)
 */

import type { GhRunner } from './pr-labels.js';

/**
 * Build a RETRY hint from failing checks and their logs.
 *
 * Story: TR-4 happy (hint names failing checks + includes log excerpt)
 *
 * Fetches `gh pr checks --json` to get the list of checks, identifies failed ones,
 * then calls `gh run view --log-failed` for each to get log excerpts.
 * Returns a bounded-length hint string suitable for injecting into a fix session.
 *
 * @param gh The GhRunner to execute commands
 * @param cwd Working directory for gh commands
 * @param prUrl The PR URL to fetch checks for
 * @returns A hint string containing check names and log excerpts
 */
export async function buildCiFixHint(
  gh: GhRunner,
  cwd: string,
  prUrl: string,
): Promise<string> {
  try {
    // Fetch the list of checks for this PR
    const checksResult = await gh(['pr', 'checks', prUrl, '--json'], { cwd });
    const checksData = JSON.parse(checksResult.stdout);

    // Extract failed checks with their run links
    const failedChecks: Array<{ name: string; url: string }> = [];

    if (checksData.checkSuites && Array.isArray(checksData.checkSuites)) {
      for (const suite of checksData.checkSuites) {
        if (suite.checkRuns && Array.isArray(suite.checkRuns)) {
          for (const run of suite.checkRuns) {
            if (run.conclusion === 'FAILURE' && run.detailsUrl) {
              failedChecks.push({
                name: run.name,
                url: run.detailsUrl,
              });
            }
          }
        }
      }
    }

    // Build the hint from failed checks
    const lines: string[] = ['CI checks failed:'];

    for (const check of failedChecks) {
      lines.push(`\n• ${check.name}`);

      // Try to fetch logs for this check
      try {
        // Extract run ID from the details URL (GitHub Actions run URL format)
        const runIdMatch = check.url.match(/\/runs\/(\d+)/);
        if (runIdMatch) {
          const runId = runIdMatch[1];
          const logsResult = await gh(['run', 'view', runId, '--log-failed'], { cwd });
          const logLines = logsResult.stdout.split('\n');

          // Include first few log lines (bounded length)
          const maxLogLines = 10;
          const excerpt = logLines.slice(0, maxLogLines).join('\n');
          if (excerpt.trim()) {
            lines.push('  Log excerpt:');
            lines.push('  ' + excerpt.split('\n').join('\n  '));
          }
        }
      } catch (err) {
        // Degrade gracefully: log fetch failed, continue with just the check name
        // (Task 16: negative path)
      }
    }

    return lines.join('\n');
  } catch (err) {
    // If gh call fails, return empty hint
    return '';
  }
}
