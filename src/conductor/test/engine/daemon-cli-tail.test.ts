/**
 * Task 10: Tests for daemon-cli post-run tail behavior
 *
 * Verifies that the post-run tail (after conductor.run() completes in runConductorInWorktree)
 * performs NO rehabilitateHaltPr invocation. The single invocation site is now the
 * in-step repair (Task 9) in conductor.ts.
 *
 * Story 1 negative path: "post-run tail … makes NO rehabilitation call"
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('daemon-cli post-run tail (Task 10 — no rehabilitateHaltPr call)', () => {
  it('Story 1 negative path: daemon-cli does NOT import rehabilitateHaltPr', () => {
    /**
     * This test verifies that rehabilitateHaltPr is no longer imported in daemon-cli.ts.
     *
     * After Task 10 removes the rehabilitateHaltPr call block (lines 785-801),
     * the import itself should also be removed (line 9).
     *
     * This is a source-level assertion: we read daemon-cli.ts directly and verify
     * that rehabilitateHaltPr is not imported. This test will FAIL while the code
     * is still present, and PASS after removal.
     */

    const daemonCliPath = join(__dirname, '../../src/daemon-cli.ts');
    const content = readFileSync(daemonCliPath, 'utf-8');

    // Verify that daemon-cli.ts does NOT contain an import of rehabilitateHaltPr
    expect(content).not.toMatch(/import\s*{[^}]*rehabilitateHaltPr[^}]*}\s*from\s*['"].*halt-pr-rehabilitation/);

    // Also verify the call site is gone: the entire block that calls rehabilitateHaltPr
    expect(content).not.toMatch(/await\s+rehabilitateHaltPr\s*\(/);
  });

  it('the post-run tail gives closeIssueOnImplementationMerge a feature-scoped guarded runner', () => {
    /**
     * This test verifies that the post-run tail still contains the
     * closeIssueOnImplementationMerge call (which we keep), but does NOT contain
     * the rehabilitateHaltPr call (which we remove).
     *
     * The body update is a feature PR mutation, so it must derive fresh
     * committed ownership and pass the guarded runner. A raw gh fallback would
     * bypass the ownership gate while still making this best-effort tail look
     * successful.
     */

    const daemonCliPath = join(__dirname, '../../src/daemon-cli.ts');
    const content = readFileSync(daemonCliPath, 'utf-8');

    // Should still contain closeIssueOnImplementationMerge call
    expect(content).toMatch(/await\s+closeIssueOnImplementationMerge\s*\(/);
    expect(content).toMatch(/closeIssueMutation\s*=\s*item\.sourceRef\s*&&\s*implementationPrUrl[\s\S]*?resolveFeatureRemoteMutation\s*\(/);
    expect(content).toMatch(
      /operations:\s*closeIssueMutation\s*\?\s*createGuardedGithubOperationRunner\(/,
    );

    // Should NOT contain rehabilitateHaltPr call
    expect(content).not.toMatch(/await\s+rehabilitateHaltPr\s*\(/);
  });

  it('gives each mergeable-sweep entry a feature-scoped guarded runner', () => {
    const daemonCliPath = join(__dirname, '../../src/daemon-cli.ts');
    const content = readFileSync(daemonCliPath, 'utf-8');
    const sweepStart = content.indexOf('sweepMergeableLabels: async () =>');
    const sweepEnd = content.indexOf('// Task 17: dispatch autoresolve', sweepStart);
    const sweep = content.slice(sweepStart, sweepEnd);

    expect(sweep).toMatch(/operations:\s*\(entry\)\s*=>\s*{[\s\S]*?parseIssueRef\(entry\.prUrl\)[\s\S]*?haltPrOperations\(/);
  });
});
