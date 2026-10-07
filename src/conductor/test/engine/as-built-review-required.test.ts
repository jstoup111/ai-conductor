// Covers: task:1, task:13
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AS_BUILT_VERDICT_PATH,
  asBuiltReviewRequired,
  asBuiltVerdictRequiresReview,
  persistAsBuiltVerdict,
  readAsBuiltVerdict,
} from '../../src/engine/as-built-verdict-store.js';
import type { AsBuiltVerdict } from '../../src/engine/as-built-contract.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const dirs: string[] = [];
const policy: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'all tiers' },
  planGap: { enabled: true, reason: 'all tiers' },
  adrCompliance: { enabled: false, reason: 'not applicable' },
  diagramDrift: { enabled: false, reason: 'not applicable' },
};

const verdicts: readonly [AsBuiltVerdict, boolean][] = [
  [{ version: 'v2', verdict: 'APPROVED', reachability: [], driftNotes: [] }, false],
  [{ version: 'v2', verdict: 'APPROVED WITH DRIFT NOTES', reachability: [], driftNotes: [{ note: 'unexercised seam' }] }, true],
  [{ version: 'v2', verdict: 'PLAN_GAP', reachability: [], driftNotes: [], outcomeDelivered: true, affectedOutcome: 'Review decision' }, true],
  [{ version: 'v2', verdict: 'PLAN_GAP', reachability: [], driftNotes: [], outcomeDelivered: false, affectedOutcome: 'Review decision' }, true],
  [{ version: 'v2', verdict: 'BLOCKED', reachability: [], driftNotes: [], findings: [{ id: 'as-built:attempt-1:1', class: 'DESIGN', summary: 'needs decision' }], violations: 'unresolved decision', resolution: 'choose a design' }, true],
];

function approvedVerdict(): AsBuiltVerdict {
  return { version: 'v2', verdict: 'APPROVED', reachability: [], driftNotes: [] };
}

async function seedAsBuiltGate(statePath: string): Promise<void> {
  const state: Record<string, unknown> = { complexity_tier: 'M', feature_desc: 'prior-version-as-built' };
  for (const step of ALL_STEPS) {
    state[step.name] = step.name === 'architecture_review_as_built' ? 'pending' : 'skipped';
    if (step.name === 'architecture_review_as_built') break;
    state[step.name] = 'done';
  }
  state.rebase = 'skipped';
  state.finish = 'done';
  await writeState(statePath, state as ConductState);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('as-built review requirement', () => {
  it.each(verdicts)('classifies %s directly', (verdict, expected) => {
    expect(asBuiltVerdictRequiresReview(verdict)).toBe(expected);
  });

  it.each(verdicts)('classifies persisted %s', async (verdict, expected) => {
    const dir = await mkdtemp(join(tmpdir(), 'as-built-review-required-'));
    dirs.push(dir);
    await persistAsBuiltVerdict(dir, verdict, { attemptId: 'attempt-1', codeStamp: null, policy });

    expect(await asBuiltReviewRequired(dir)).toBe(expected);
  });

  it('requires review when no verdict authority exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'as-built-review-required-'));
    dirs.push(dir);

    expect(await asBuiltReviewRequired(dir)).toBe(true);
  });

  it('requires review when the verdict authority is unreadable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'as-built-review-required-'));
    dirs.push(dir);
    await mkdir(join(dir, '.pipeline'));
    await writeFile(join(dir, AS_BUILT_VERDICT_PATH), '{not json', 'utf8');

    expect(await asBuiltReviewRequired(dir)).toBe(true);
  });

  it('treats a prior-version verdict as stale authority, reruns once, and then reuses the v2 verdict', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'as-built-review-required-'));
    dirs.push(dir);
    const statePath = join(dir, 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, AS_BUILT_VERDICT_PATH), `${JSON.stringify({
      attemptId: 'prior-v1-attempt',
      codeStamp: null,
      verdict: { version: 'v1', verdict: 'APPROVED', reachability: [], driftNotes: [] },
      policy,
      recordedFindings: [],
    }, null, 2)}\n`, 'utf8');
    await seedAsBuiltGate(statePath);

    const reviewer = vi.fn(async (_step, _state, options) => {
      const beforeReview = JSON.parse(await readFile(join(dir, AS_BUILT_VERDICT_PATH), 'utf8'));
      expect(beforeReview.verdict.version).toBe('v1');
      await persistAsBuiltVerdict(dir, approvedVerdict(), {
        attemptId: options?.runId ?? 'missing-attempt', codeStamp: null, policy,
      });
      return { success: true };
    });
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: { run: reviewer } as StepRunner,
      events: new ConductorEventEmitter(),
      fromStep: 'architecture_review_as_built',
      mode: 'auto',
    });

    expect(await readAsBuiltVerdict(dir)).toEqual({ kind: 'prior-version', version: 'v1' });
    expect(await asBuiltReviewRequired(dir)).toBe(true);
    await expect((conductor as unknown as {
      verdictDispatchHandshake: (step: 'architecture_review_as_built', runId: string, startedAt: number) => Promise<unknown>;
    }).verdictDispatchHandshake('architecture_review_as_built', 'current-attempt', Date.now())).resolves.toMatchObject({
      done: false,
      routeClass: 'absent',
      reason: expect.stringContaining('prior contract version v1'),
    });

    await conductor.run();
    expect(reviewer).toHaveBeenCalledTimes(1);
    expect(await readAsBuiltVerdict(dir)).toMatchObject({
      kind: 'present',
      value: { verdict: approvedVerdict() },
    });

    const nextGateEvaluation = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: { run: reviewer } as StepRunner,
      events: new ConductorEventEmitter(),
      mode: 'auto',
    });
    await nextGateEvaluation.run();
    expect(reviewer).toHaveBeenCalledTimes(1);
  });
});
