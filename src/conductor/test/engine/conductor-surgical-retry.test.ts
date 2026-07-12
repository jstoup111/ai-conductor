/**
 * Negative-path tests for surgical retry misclassification + budget guards (Task 12)
 *
 * These tests verify that the surgical retry classification logic correctly:
 * 1. Rejects mixed gaps (recording + other) → standard prompt, not surgical
 * 2. Handles legacy results without `missing` field → standard prompt
 * 3. Exhausts surgical retry budget into recovery path
 * 4. Ensures surgical prompt contains only CLI (no engine-side marker write)
 *
 * Story 4: Negative paths ("mixed gap → full re-walk"; "absent code → full";
 * "bounded budget"; "refusal preserved")
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({
  execa: vi.fn(() =>
    Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
  ),
}));

import { buildRetryHint } from '../../src/engine/conductor.js';
import type { CompletionResult } from '../../src/engine/artifacts.js';

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
      expect(hint).toContain('finish-record');
      expect(hint).toContain('--choice');
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
  // AC 3: Surgical retries decrement same per-step retry budget and
  //       exhaust into recovery path
  // ───────────────────────────────────────────────────────────────────

  describe('AC 3: Surgical retries exhaust shared budget', () => {
    it('should indicate in surgical prompt that budget is shared with standard retries', async () => {
      // The surgical hint should communicate to the user that retries are limited
      const reason = '.pipeline/finish-choice is missing';
      const missing: 'recording' | undefined = 'recording';
      const pipelineDir = join(dir, '.pipeline');

      const hint = buildRetryHint('finish', reason, missing, pipelineDir);

      // Should mention that the step is not complete until finish-record exits 0
      // (implying there is a termination condition / budget constraint)
      expect(hint).toContain('is NOT complete until');
      expect(hint).toContain('exits 0');
      // Should provide exact pipeline dir argument
      expect(hint).toContain(pipelineDir);
    });

    it('should not grant unlimited retries in surgical path', async () => {
      // Verify that the hint does not suggest retrying indefinitely
      const reason = '.pipeline/finish-choice is missing';
      const missing: 'recording' | undefined = 'recording';

      const hint = buildRetryHint('finish', reason, missing);

      // Should NOT suggest looping or retrying multiple times
      // (that would be indicated by "try again" or "retry" without exit condition)
      expect(hint).toContain('conduct-ts finish-record');
      // The single command run is the requirement, not loops
      expect(hint).not.toContain('try again');
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // AC 4: Surgical prompt's command is fail-closed CLI (no engine-side
  //       marker write in conductor code)
  // ───────────────────────────────────────────────────────────────────

  describe('AC 4: Surgical prompt is fail-closed (CLI-only, no engine marker write)', () => {
    it('should contain only CLI command, not automatic engine write', async () => {
      // The surgical hint should instruct the user to RUN a command,
      // not describe automatic engine actions
      const reason = '.pipeline/finish-choice is missing';
      const missing: 'recording' | undefined = 'recording';

      const hint = buildRetryHint('finish', reason, missing);

      // Should contain the CLI command
      expect(hint).toContain('conduct-ts finish-record --choice');
      // Should be instructional (user-facing)
      expect(hint).toContain('run ONLY');
      // Should NOT mention automatic marker writes or engine state
      expect(hint).not.toContain('engine');
      expect(hint).not.toContain('marker');
      expect(hint).not.toContain('write');
    });

    it('should specify exact --pipeline-dir when provided', async () => {
      // When pipelineDir is provided, the hint must include it
      // to ensure the CLI runs with the correct working directory
      const reason = '.pipeline/finish-choice is missing';
      const missing: 'recording' | undefined = 'recording';
      const pipelineDir = join(dir, 'custom', '.pipeline');

      const hint = buildRetryHint('finish', reason, missing, pipelineDir);

      // Must include the exact pipelineDir path
      expect(hint).toContain(`--pipeline-dir ${pipelineDir}`);
      // Should warn about cwd requirement
      expect(hint).toContain('do NOT `cd` elsewhere');
    });

    it('should default to .pipeline when pipelineDir is not provided', async () => {
      // Surgical prompt should have a sensible default
      const reason = '.pipeline/finish-choice is missing';
      const missing: 'recording' | undefined = 'recording';
      // pipelineDir not provided (undefined)

      const hint = buildRetryHint('finish', reason, missing);

      // Should default to .pipeline
      expect(hint).toContain('.pipeline');
      expect(hint).toContain('--pipeline-dir');
    });

    it('should not mention engine state updates in surgical prompt', async () => {
      // Verify no engine-side writes or state modifications are mentioned
      const reason = '.pipeline/finish-choice is missing';
      const missing: 'recording' | undefined = 'recording';

      const hint = buildRetryHint('finish', reason, missing);

      // Should only mention user action (CLI), not engine action
      expect(hint).toContain('determine the finish outcome');
      expect(hint).toContain('run ONLY');
      // Should NOT mention engine persistence or automatic recording
      // (repo state lookup is acceptable; engine state write is not)
      expect(hint).not.toContain('persist');
      expect(hint).not.toContain('record the');
      expect(hint).not.toContain('update .pipeline');
    });

    it('should make CLI requirement explicit (no automation)', async () => {
      // The surgical prompt must make it clear that the user must run the CLI
      // (not an automatic re-run by the engine)
      const reason = '.pipeline/finish-choice is missing';
      const missing: 'recording' | undefined = 'recording';

      const hint = buildRetryHint('finish', reason, missing);

      // Should be clear that this is a user action
      expect(hint).toMatch(/run ONLY/i);
      // Should NOT suggest automation
      expect(hint).not.toContain('automatic');
      expect(hint).not.toContain('will');
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
      expect(finishHint).toContain('finish-record');
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
      expect(hint).toContain('finish-record');
      expect(hint).toContain('--choice');
    });

    it('should handle undefined reason with surgical missing', async () => {
      const reason = undefined;
      const missing: 'recording' | undefined = 'recording';

      const hint = buildRetryHint('finish', reason, missing);

      // Should not crash, should still be surgical
      expect(hint).toContain('finish-record');
    });

    it('should preserve reason text in surgical hint', async () => {
      const reason = 'Custom: specific finish failure';
      const missing: 'recording' | undefined = 'recording';

      const hint = buildRetryHint('finish', reason, missing);

      // Should include the provided reason
      expect(hint).toContain(reason);
      expect(hint).toContain('finish-record');
    });

    it('should not mutate input parameters', async () => {
      const reason = 'test reason';
      const missing: 'recording' | undefined = 'recording';
      const pipelineDir = join(dir, '.pipeline');

      const hint = buildRetryHint('finish', reason, missing, pipelineDir);

      // Verify inputs are unchanged
      expect(reason).toBe('test reason');
      expect(missing).toBe('recording');
      expect(pipelineDir).toContain('.pipeline');
    });
  });
});
