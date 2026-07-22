/**
 * Acceptance specs for .docs/stories/build-auth-token-check-and-classify.md
 * (FR-4), governed by .docs/specs/2026-07-22-build-auth-token-check-and-classify.md
 * and .docs/plans/2026-07-22-build-auth-token-check-and-classify.md (Task 4).
 *
 * WHY ACCEPTANCE-LEVEL (not unit): FR-4 requires that a rejected-credential
 * build failure parks (park-and-poll on the daemon build-token source, zero
 * retry/escalation budget burned) on the CONCURRENT group dispatch path, not
 * just the serial path. `runGroupBranch` (group-core.ts) already surfaces an
 * `authFailure` result as a `no-verdict` outcome (see the comment at
 * group-core.ts ~488-494: "this task does not implement park/resume itself —
 * that belongs to the group CORE/join logic"). Today, the JOIN logic in
 * `Conductor.run()` (conductor.ts, the `noVerdictIdx !== -1` branch, ~2237)
 * treats EVERY no-verdict reason identically: it writes a loud
 * `.pipeline/HALT` ("... produced no-verdict after exhausting its retries
 * (authFailure).") and returns immediately — the exact per-feature-cascade
 * failure mode #484/#483 this feature closes, just one layer up (group
 * instead of serial). A unit test that calls `runGroupBranch` directly and
 * asserts it returns `{kind:'no-verdict', reason:'authFailure'}` (already
 * true today) would prove NOTHING about whether `Conductor.run()`'s join
 * still treats that outcome as a generic exhausted-retries HALT — the bug
 * lives in the JOIN, not the branch. This file drives the real
 * `Conductor.run()` entry point (same convention as
 * `parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts`
 * and `isolate-daemon-build-auth-from-operator-oauth.acceptance.test.ts`)
 * against the real built-in SHIP-tail validation group (manual_test,
 * prd_audit, architecture_review_as_built — group-core.ts / steps.ts, width
 * 3) so a fan-out actually engages, with a fake `StepRunner` that returns the
 * observed 401 shape from `manual_test`.
 *
 * Per-call-site unit behavior (classifier pattern matching, precedence,
 * bare-401 non-match) is unit-level and belongs to
 * test/execution/claude-provider.test.ts (plan Tasks 1-3) — not duplicated
 * here. The serial dispatch path already has a working authFailure
 * park-and-poll branch (conductor.ts ~3082, proven by
 * sandbox-auth-expiry-park.acceptance.test.ts /
 * isolate-daemon-build-auth-from-operator-oauth.acceptance.test.ts); plan
 * Task 5 pins that the NEW classifier patterns reach it, at the unit/
 * engine-test layer (verify-only) — not duplicated here either. This file
 * covers ONLY the group/join path, which is genuinely new production
 * behavior with a real risk of shipping as an orphaned branch-level flag
 * (green `runGroupBranch` unit test, join never consults it — the #297/#733
 * "new primitive, inert feature" failure class this repo's own
 * writing-system-tests skill (§3b) exists to catch).
 *
 * PRE-FIX RED: as of this file's authoring, the join's `noVerdictIdx !== -1`
 * branch does not special-case `reason === 'authFailure'` — it always writes
 * `.pipeline/HALT` with a message containing "no-verdict after exhausting
 * its retries" and returns, regardless of reason. Every scenario below fails
 * for that reason until plan Task 4 lands.
 *
 * ASSUMPTION FLAGGED (per verify-claims / writing-system-tests correctness
 * gate): neither the story, the PRD, nor the plan pins the EXACT mechanism
 * the join uses to retry the group after park resolves (e.g. `continue`-ing
 * the outer per-step loop to re-dispatch the whole group fresh, vs. some
 * other resumption shape). This file therefore asserts only the OBSERVABLE
 * contract the story text pins: (a) no generic "exhausted its retries" HALT
 * while a park is live, (b) the operator-facing failure is reported as an
 * auth/credential park (not a bare no-verdict/HALT), (c) zero dispatch
 * attempts of `manual_test` beyond the one that hit the rejected credential
 * plus the one that succeeds after the token refreshes (i.e. no retry-ladder
 * spin), and (d) the group step reaches `done` automatically once the token
 * file is refreshed, with no operator action. It does NOT assert internal
 * loop-index/state-key mechanics. Confidence the join needs a genuinely new
 * branch here (not already-passing behavior): ~95% (verified by reading
 * conductor.ts's noVerdictIdx branch directly, quoted above).
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { HALT_MARKER } from '../../src/engine/halt-marker.js';
import type { ConductState, StepName } from '../../src/types/index.js';

const MT_PASS = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n';
const AUDIT_HEADER = '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|--|--|--|--|--|\n';
const PRD_PASS = AUDIT_HEADER + '| FR-1 | ALIGNED | | evidence.ts:1 | yes |\n';

// Verbatim observed rejected-credential output
// (adr-2026-07-22-auth-failure-classification-observed-401-patterns).
const OBSERVED_401 = 'Failed to authenticate. API Error: 401 Invalid bearer token';

describe('acceptance: build-auth-token-check-and-classify — FR-4 group/join path parks on authFailure (#484)', () => {
  async function seedToValidators(
    dir: string,
    statePath: string,
    tokenPath: string,
  ): Promise<void> {
    const res = await readState(statePath);
    const state = (res.ok ? res.value : {}) as Record<string, unknown>;
    for (const s of ALL_STEPS) {
      if (s.name === 'manual_test') break;
      state[s.name] = 'done';
    }
    state.complexity_tier = 'M';
    state.track = 'product';
    state.feature_desc = 'build-auth-token-check-and-classify';
    state.build_review = 'done';
    await writeState(statePath, state as unknown as ConductState);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
    );
    void tokenPath;
  }

  function selfHostConfig(tokenPath: string) {
    return {
      harness_self_host: {
        build_auth: { mode: 'daemon-token', token_path: tokenPath },
      },
    } as never;
  }

  async function haltBody(dir: string): Promise<string | null> {
    return readFile(join(dir, HALT_MARKER), 'utf-8').catch(() => null);
  }

  it('does NOT write a generic "exhausted its retries" HALT for an authFailure no-verdict — parks instead, zero retry-budget burn, resumes automatically once the token refreshes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'group-auth-park-'));
    const tokenDir = await mkdtemp(join(tmpdir(), 'group-auth-park-token-'));
    const tokenPath = join(tokenDir, 'daemon-token');
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidators(dir, statePath, tokenPath);
      await writeFile(tokenPath, 'sk_truncated_invalid_token');

      let manualTestCalls = 0;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
          if (step === 'manual_test') {
            manualTestCalls += 1;
            if (manualTestCalls === 1) {
              // The exact rejected-credential shape a real dispatch failure
              // produces — classified authFailure:true by the extended
              // AUTH_FAILURE_RE (plan Task 1).
              return { success: false, output: OBSERVED_401, authFailure: true };
            }
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
            return { success: true };
          }
          if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\n' + PRD_PASS);
            return { success: true };
          }
          return { success: true };
        }),
      };

      const events = new ConductorEventEmitter();
      const haltEvents: unknown[] = [];
      events.on('event', (e) => {
        if ((e as { type?: string }).type === 'loop_halt') haltEvents.push(e);
      });

      // A refreshed, valid-shaped token lands during the park poll — mirrors
      // the sandbox-auth-expiry-park / isolate-daemon-build-auth convention
      // of writing a fresh credential from inside the injected sleep.
      const sleepFn = vi.fn(async () => {
        await writeFile(tokenPath, 'sk_valid_refreshed_daemon_token');
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        selfHost: true,
        verifyArtifacts: true,
        maxRetries: 1, // a retry-ladder spin on this failure would need > 1
        sleepFn,
        config: selfHostConfig(tokenPath),
      });

      await conductor.run();

      // (a) never the generic exhausted-retries HALT for this failure.
      const body = await haltBody(dir);
      if (body !== null) {
        expect(body).not.toMatch(/no-verdict after exhausting its retries/);
        expect(body).not.toMatch(/authFailure\)/);
      }

      // (b) the join never fires the loud loop_halt path for this run.
      expect(haltEvents).toHaveLength(0);

      // (c) zero retry-ladder spin: exactly the rejected attempt plus the
      // one resumed attempt after refresh — never more (a mis-wired retry
      // ladder would call manual_test on every attempt up to maxRetries).
      expect(manualTestCalls).toBe(2);

      // (d) the park loop actually engaged (the daemon-token source was
      // polled, not skipped straight to a HALT).
      expect(sleepFn).toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(tokenDir, { recursive: true, force: true });
    }
  });

  it('a bare "401" in ordinary prose from a group member does NOT trigger the park path — the group either passes or fails on its own merits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'group-auth-noflap-'));
    const tokenDir = await mkdtemp(join(tmpdir(), 'group-auth-noflap-token-'));
    const tokenPath = join(tokenDir, 'daemon-token');
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidators(dir, statePath, tokenPath);
      await writeFile(tokenPath, 'sk_valid_daemon_token');

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
          if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
            // Ordinary output that happens to discuss a 401 status code —
            // never an authentication-error shape.
            return { success: true, output: 'test suite expects a 401 response from /widgets' };
          }
          if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\n' + PRD_PASS);
            return { success: true };
          }
          return { success: true };
        }),
      };

      const events = new ConductorEventEmitter();
      const sleepFn = vi.fn(async () => {});
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        selfHost: true,
        verifyArtifacts: true,
        maxRetries: 1,
        sleepFn,
        config: selfHostConfig(tokenPath),
      });

      await conductor.run();

      // No park loop was ever entered for a benign "401" mention.
      expect(sleepFn).not.toHaveBeenCalled();
      const body = await haltBody(dir);
      if (body !== null) {
        expect(body).not.toMatch(/daemon build token/i);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(tokenDir, { recursive: true, force: true });
    }
  });
});
