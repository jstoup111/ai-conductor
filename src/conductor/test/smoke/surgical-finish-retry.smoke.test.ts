/**
 * Real-binary smoke test for Story 4 / Task 13 (RED phase):
 * "A recording-only completion miss triggers a surgical retry, not a full
 * re-walk" (.docs/stories/finish-step-completion-becomes-engine-machinery-re.md,
 * ADR D4).
 *
 * Pattern: test/smoke/finish-record.smoke.test.ts (nested-mkdtemp isolated
 * repo, real `bin/conduct-ts` child process, no fakes for the final leg).
 *
 * Scenario: an isolated repo whose finish attempt has every completion
 * condition satisfiable EXCEPT the `.pipeline/finish-choice` recording marker
 * itself is absent (a pure recording-only gap — Task 1's own example case).
 *
 *   1. The REAL engine entry point `checkStepCompletion` (src/engine/artifacts.ts)
 *      must classify this as `missing: 'recording'` — a facet code that does
 *      not exist on `CompletionResult` yet (Task 1).
 *   2. The REAL retry-dispatch entry point `buildRetryHint` (src/engine/conductor.ts)
 *      must, on a recording-only miss, surface the narrow `conduct-ts
 *      finish-record` command with the absolute `--pipeline-dir` instead of
 *      the generic "finish the work now" fallback — a branch that does not
 *      exist yet (Task 11).
 *   3. Running that named command against the REAL binary and re-evaluating
 *      completion proves the one-command completion once wired.
 *
 * Expected to fail for the RIGHT reason right now: `completion.missing` is
 * `undefined` (not `'recording'`), and the retry hint contains none of the
 * `finish-record` command text — not a syntax error, not a trivially-true
 * assertion.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkStepCompletion, FINISH_CHOICE_MARKER } from '../../src/engine/artifacts.js';
import { buildRetryHint } from '../../src/engine/conductor.js';

const REPO_ROOT = join(process.cwd(), '..', '..');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');

let scratchParent: string;
let cwd: string;
let pipelineDirAbs: string;

beforeEach(async () => {
  scratchParent = await mkdtemp(join(tmpdir(), 'surgical-finish-retry-smoke-'));
  cwd = await mkdtemp(join(scratchParent, 'repo-'));
  pipelineDirAbs = join(cwd, '.pipeline');
  await mkdir(pipelineDirAbs, { recursive: true });
});

afterEach(async () => {
  await rm(scratchParent, { recursive: true, force: true });
});

describe('smoke: surgical finish-record retry drives one-command completion (Story 4 / Task 13)', () => {
  it(
    'recording-only miss classifies as missing:"recording", the surgical retry names the finish-record command, and running it completes the step',
    async () => {
      // Every other completion condition is satisfiable — only the recording
      // marker itself (.pipeline/finish-choice) is absent.
      const ctx = {
        sessionStartedAt: Date.now() - 60_000,
        isHeadPushed: async () => true,
      };

      const completion = await checkStepCompletion(cwd, 'finish', ctx);
      expect(completion.done).toBe(false);
      // NOT YET IMPLEMENTED (Task 1): CompletionResult carries no `missing`
      // facet code today, so this fails for the right reason.
      expect((completion as { missing?: string }).missing).toBe('recording');

      // The surgical prompt names the finish-record command when the miss is
      // classification-only (recording). Pass the missing field and pipelineDir.
      const hint = buildRetryHint('finish', completion.reason, completion.missing, pipelineDirAbs);
      expect(hint).toContain('conduct-ts finish-record');
      expect(hint).toContain(`--pipeline-dir ${pipelineDirAbs}`);

      // Proving the one-command completion: run the exact command the
      // surgical prompt should have named, against the REAL binary.
      const result = await execa(
        REAL_CONDUCT_TS,
        ['finish-record', '--choice', 'keep', '--pipeline-dir', pipelineDirAbs],
        { cwd, reject: false },
      );
      expect(result.exitCode).toBe(0);
      const marker = await readFile(join(pipelineDirAbs, 'finish-choice'), 'utf-8');
      expect(marker.trim()).toBe('keep');

      const reEvaluated = await checkStepCompletion(cwd, 'finish', ctx);
      expect(reEvaluated.done).toBe(true);
    },
    30_000,
  );

  it(
    'a mixed gap (recording present but push evidence false) does NOT classify as recording-only — the standard full retry applies',
    async () => {
      await writeFile(join(cwd, FINISH_CHOICE_MARKER), 'pr\n', 'utf-8');
      await writeFile(
        join(cwd, '.pipeline/conduct-state.json'),
        JSON.stringify({ pr_url: 'https://github.com/owner/repo/pull/1' }),
        'utf-8',
      );

      const ctx = {
        sessionStartedAt: Date.now() - 60_000,
        isHeadPushed: async () => false, // push evidence false: a NON-recording gap
      };

      const completion = await checkStepCompletion(cwd, 'finish', ctx);
      expect(completion.done).toBe(false);
      // Absent field is the safe default (full re-walk) — Task 12's
      // misclassification guard. Today the field is simply always absent, so
      // this half currently passes vacuously; paired here with the recording
      // case above so the file exercises both classification arms.
      expect((completion as { missing?: string }).missing).not.toBe('recording');
    },
  );
});
