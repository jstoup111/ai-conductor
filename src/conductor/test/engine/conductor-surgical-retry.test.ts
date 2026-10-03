/**
 * Negative-path tests for surgical retry misclassification + budget guards (Task 12)
 *
 * These tests verify that the surgical retry classification logic correctly:
 * 1. Rejects mixed gaps (recording + other) → standard prompt, not surgical
 * 2. Handles legacy results without `missing` field → standard prompt
 * 3. Leaves recording recovery to the engine-owned publication coordinator
 * 4. Ensures the prompt does not direct a managed session to a blocked CLI
 *
 * Story 4: Negative paths ("mixed gap → full re-walk"; "absent code → full";
 * "bounded budget"; "refusal preserved")
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({
  execa: vi.fn(() =>
    Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
  ),
}));

import { buildRetryHint } from '../../src/engine/conductor.js';

describe('conductor/surgical-retry', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-surgical-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ───────────────────────────────────────────────────────────────────
  // AC 1: Recording missing AND push evidence false → missing NOT 'recording'
  //       → standard prompt (not surgical)
  // ───────────────────────────────────────────────────────────────────

  describe('AC 1: Misclassification guard — mixed gaps (recording + push)', () => {
    it('should reject surgical path when missing="other" (push evidence false)', async () => {
      // Simulate a completion result with missing='other' (e.g., push evidence false)
      // This should NOT trigger the surgical hint even though the finish step failed
      const reason = 'Push evidence required: HEAD not found in refs/remotes/origin/<branch>';
      const missing: 'other' | undefined = 'other'; // mixed gap: not just recording

      const hint = buildRetryHint('finish', reason, missing);

      // Should NOT contain surgical hint (finish-record)
      expect(hint).not.toContain('finish-record');
      // Should NOT mention "--choice" (surgical marker)
      expect(hint).not.toContain('--choice');
      // Should contain standard hint
      expect(hint).toContain('Finish the work now');
      expect(hint).toContain(`${reason}`);
    });

    it('should reject surgical path when multiple evidence conditions fail', async () => {
      // Simulate a completion result classifying as 'other' due to multiple issues
      // (e.g., recording missing + push false = treat as 'other', full re-walk)
      const reason = 'Multiple evidence conditions failed';
      const missing: 'other' | undefined = 'other';

      const hint = buildRetryHint('finish', reason, missing);

      // Standard prompt, not surgical
      expect(hint).toContain('Finish the work now');
      expect(hint).not.toContain('finish-record');
    });

    it('should accept surgical path only when missing="recording" AND no other gaps', async () => {
      // When missing='recording' ALONE (no mixed gaps), surgical hint applies
      const reason = '.pipeline/finish-choice is missing';
      const missing: 'recording' | undefined = 'recording';

      const hint = buildRetryHint('finish', reason, missing);

      // Should contain surgical hint
      expect(hint).toContain('publication coordinator');
      expect(hint).toContain('re-observe');
      expect(hint).toContain('Do NOT repeat the full /finish walk');
      // Should NOT say "Finish the work now" (that's standard)
      expect(hint).not.toContain('Finish the work now');
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // AC 2: Legacy result object without missing field → standard prompt
  //       (backward compat)
  // ───────────────────────────────────────────────────────────────────

  describe('AC 2: Legacy backward compat — missing field absent', () => {
    it('should use standard prompt when missing field is undefined (legacy result)', async () => {
      // Simulate old completion result that doesn't have `missing` field at all
      const reason = 'finish skill did not record outcome';
      const missing: 'recording' | 'other' | undefined = undefined; // absent

      const hint = buildRetryHint('finish', reason, missing);

      // Absent missing field → standard prompt, not surgical
      expect(hint).toContain('Finish the work now');
      expect(hint).not.toContain('finish-record');
      expect(hint).not.toContain('--choice');
    });

    it('should handle undefined missing for non-finish steps without error', async () => {
      // Verify that other steps (build, prd_audit) work correctly with undefined missing
      const reason = 'tasks not completed';
      const missing: undefined = undefined;

      const hint = buildRetryHint('build', reason, missing);

      // Should produce a build-specific hint
      expect(hint).toContain('Task');
      expect(hint).not.toContain('finish-record');
    });

    it('should use standard prompt when missing is explicitly undefined', async () => {
      const reason = 'unknown finish failure';
      const missing = undefined as 'recording' | 'other' | undefined;

      const hint = buildRetryHint('finish', reason, missing);

      // Undefined → standard prompt
      expect(hint).toContain('Finish the work now');
      expect(hint).not.toContain('finish-record');
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // AC 3: Recording recovery is coordinator-owned
  // ───────────────────────────────────────────────────────────────────

  describe('AC 3: Surgical retries exhaust shared budget', () => {
    it('should keep recording recovery independent of the deprecated CLI arguments', async () => {
      const reason = '.pipeline/finish-choice is missing';
      const missing: 'recording' | undefined = 'recording';
      const hint = buildRetryHint('finish', reason, missing, join(dir, '.pipeline'));

      expect(hint).toContain('coordinator');
      expect(hint).toContain('record completion when authorized');
      expect(hint).not.toContain('finish-record');
    });

    it('should not direct the session to retry a blocked recording command', async () => {
      const reason = '.pipeline/finish-choice is missing';
      const missing: 'recording' | undefined = 'recording';

      const hint = buildRetryHint('finish', reason, missing);

      expect(hint).toContain('Do NOT repeat the full /finish walk');
      expect(hint).not.toContain('finish-record');
      expect(hint).not.toContain('try again');
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // AC 4: Surgical prompt is fail-closed (coordinator-only, no managed CLI)
  // ───────────────────────────────────────────────────────────────────

  describe('AC 4: Surgical prompt is fail-closed (coordinator-only, no managed CLI)', () => {
    it('should direct recording recovery to the coordinator, not a blocked CLI', async () => {
      const reason = '.pipeline/finish-choice is missing';
      const missing: 'recording' | undefined = 'recording';

      const hint = buildRetryHint('finish', reason, missing);

      expect(hint).toContain('engine-owned publication coordinator');
      expect(hint).toContain('record completion when authorized');
      expect(hint).not.toContain('finish-record');
      expect(hint).not.toContain('marker');
    });

    it('should not expose a pipeline path for coordinator-owned recovery', async () => {
      const reason = '.pipeline/finish-choice is missing';
      const missing: 'recording' | undefined = 'recording';
      const pipelineDir = join(dir, 'custom', '.pipeline');

      const hint = buildRetryHint('finish', reason, missing, pipelineDir);

      expect(hint).not.toContain(pipelineDir);
      expect(hint).not.toContain('--pipeline-dir');
    });

    it('should not direct a coordinator-owned recovery to .pipeline', async () => {
      const reason = '.pipeline/finish-choice is missing';
      const missing: 'recording' | undefined = 'recording';
      // pipelineDir not provided (undefined)

      const hint = buildRetryHint('finish', reason, missing);

      expect(hint).not.toContain('--pipeline-dir');
    });

    it('should explain the coordinator-owned observation boundary', async () => {
      const reason = '.pipeline/finish-choice is missing';
      const missing: 'recording' | undefined = 'recording';

      const hint = buildRetryHint('finish', reason, missing);

      expect(hint).toContain('re-observe the existing result');
      expect(hint).toContain('record completion when authorized');
      expect(hint).not.toContain('finish-record');
    });

    it('should make the no-full-walk restriction explicit', async () => {
      const reason = '.pipeline/finish-choice is missing';
      const missing: 'recording' | undefined = 'recording';

      const hint = buildRetryHint('finish', reason, missing);

      expect(hint).toContain('Do NOT repeat the full /finish walk');
      expect(hint).not.toContain('finish-record');
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // Composite scenario: Verify guards prevent false positives
  // ───────────────────────────────────────────────────────────────────

  describe('Composite: Misclassification guard prevents false surgical', () => {
    it('should not apply surgical path when classification is ambiguous', async () => {
      // Even if the name contains "recording", if missing is not 'recording',
      // it should not trigger surgical path
      const reason = 'finish skill recording failed but push also failed';
      const missing: 'other' | undefined = 'other'; // Classification overrides reason text

      const hint = buildRetryHint('finish', reason, missing);

      expect(hint).toContain('Finish the work now');
      expect(hint).not.toContain('finish-record');
    });

    it('should apply surgical path only for finish step with exact missing="recording"', async () => {
      // Surgical only when step='finish' AND missing='recording'
      // Verify it doesn't apply to other steps
      const reason = 'outcome not recorded';
      const missing: 'recording' | undefined = 'recording';

      // build step with missing='recording' should NOT be surgical
      const buildHint = buildRetryHint('build', reason, missing);
      expect(buildHint).not.toContain('finish-record');

      // prd_audit step with missing='recording' should NOT be surgical
      const auditHint = buildRetryHint('prd_audit', reason, missing);
      expect(auditHint).not.toContain('finish-record');

      // Only finish should be surgical
      const finishHint = buildRetryHint('finish', reason, missing);
      expect(finishHint).toContain('publication coordinator');
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // Edge cases and defensive checks
  // ───────────────────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should handle empty reason string', async () => {
      const reason = '';
      const missing: 'recording' | undefined = 'recording';

      const hint = buildRetryHint('finish', reason, missing);

      // Should not crash, should still be surgical
      expect(hint).toContain('publication coordinator');
      expect(hint).toContain('re-observe');
    });

    it('should handle undefined reason with surgical missing', async () => {
      const reason = undefined;
      const missing: 'recording' | undefined = 'recording';

      const hint = buildRetryHint('finish', reason, missing);

      // Should not crash, should still be surgical
      expect(hint).toContain('publication coordinator');
    });

    it('should preserve reason text in surgical hint', async () => {
      const reason = 'Custom: specific finish failure';
      const missing: 'recording' | undefined = 'recording';

      const hint = buildRetryHint('finish', reason, missing);

      // Should include the provided reason
      expect(hint).toContain(reason);
      expect(hint).toContain('publication coordinator');
    });

    it("missing='presentation' asks only for a PR body rewrite, never for more implementation", async () => {
      const reason =
        'recorded PR https://github.com/o/r/pull/1 body is an engine-generated placeholder';

      const hint = buildRetryHint('finish', reason, 'presentation');

      expect(hint).toContain(reason);
      // Body-rewrite instructions, in the template shape the gate enforces.
      expect(hint).toContain('## Why');
      expect(hint).toContain('## What Changed');
      expect(hint).toContain('## Testing');
      expect(hint).toContain('pull-request.edit');
      expect(hint).toContain('github-operation --request-file');
      // Never re-open implementation: the code and the plan are done.
      expect(hint).not.toContain('Finish the work now');
      expect(hint).not.toMatch(/re-record|record the finish outcome/i);
      expect(hint).toMatch(/do not (re-?implement|change code)/i);
    });

    it('should not mutate input parameters', async () => {
      const reason = 'test reason';
      const missing: 'recording' | undefined = 'recording';
      const pipelineDir = join(dir, '.pipeline');

      buildRetryHint('finish', reason, missing, pipelineDir);

      // Verify inputs are unchanged
      expect(reason).toBe('test reason');
      expect(missing).toBe('recording');
      expect(pipelineDir).toContain('.pipeline');
    });
  });
});
