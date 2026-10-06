// Covers: task:17
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ root: string; statePath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'prd-audit-retry-'));
  roots.push(root);
  const statePath = join(root, 'conduct-state.json');
  const seedResult = await readState(statePath);
  const seed = (seedResult.ok ? seedResult.value : {}) as Record<string, unknown>;
  for (const step of ALL_STEPS) {
    seed[step.name] = step.name === 'prd_audit' ? 'pending' : 'skipped';
    if (step.name === 'prd_audit') break;
    seed[step.name] = 'done';
  }
  seed.prd_audit = 'pending';
  seed.architecture_review_as_built = 'skipped';
  seed.rebase = 'skipped';
  seed.finish = 'done';
  await writeState(statePath, seed as ConductState);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  return { root, statePath };
}

async function writeCurrentPass(root: string, attemptId: string): Promise<void> {
  await persistPrdAuditVerdict(root, {
    complete: true,
    judgment: {
      version: 'v1',
      criterionJudgments: [{
        criterion: { storyId: '1', ordinal: 1 },
        criterionId: 'S1.1',
        grade: 'PASS',
        evidence: 'The current invocation supplied a complete typed verdict.',
        rationale: 'Only the current attempt may settle this review.',
        requirementAssociations: [],
        evidenceTaskIds: [],
      }],
      noOwnerObservations: [],
    },
    diagnostics: [],
    recordedDispositions: [],
  }, { attemptId, codeStamp: 'current-head' });
}

function conductor(root: string, statePath: string, stepRunner: StepRunner, maxRetries: number): Conductor {
  return new Conductor({
    projectRoot: root,
    stateFilePath: statePath,
    stepRunner,
    events: new ConductorEventEmitter(),
    fromStep: 'prd_audit',
    verifyArtifacts: true,
    mode: 'auto',
    maxRetries,
    config: { gate_code_validity: { enabled: false } },
  });
}

describe('prd_audit absent-result retries', () => {
  it('re-invokes within the resolved allowance and accepts only the fresh typed verdict', async () => {
    const { root, statePath } = await fixture();
    let calls = 0;
    const run = vi.fn<StepRunner['run']>(async (_step, _state, options) => {
      calls += 1;
      if (calls === 2) {
        await writeCurrentPass(root, options?.runId ?? 'missing-run-id');
      }
      return calls === 1
        ? { success: true, output: 'structured-result-missing' }
        : { success: true };
    });

    await conductor(root, statePath, { run }, 2).run();

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.map(([, , options]) => options?.runId)).toEqual([
      expect.any(String),
      expect.any(String),
    ]);
    expect(run.mock.calls[0]?.[2]?.runId).not.toBe(run.mock.calls[1]?.[2]?.runId);
    await expect(readState(statePath)).resolves.toMatchObject({
      ok: true,
      value: { prd_audit: 'done' },
    });
  });

  it.each([
    ['structured-result-missing', 'produced no verdict'],
    [
      'structured-result-rejected: criterionJudgments[0].criterion S9.9 does not resolve; criterionJudgments[0].evidence is required',
      'criterionJudgments[0].criterion S9.9 does not resolve',
    ],
  ])('halts exhausted %s output without synthetic remediation or BUILD dispatch', async (output, expectedDetail) => {
    const { root, statePath } = await fixture();
    const run = vi.fn<StepRunner['run']>(async () => ({ success: true, output }));

    await conductor(root, statePath, { run }, 2).run();

    expect(run.mock.calls.map(([step]) => step)).toEqual(['prd_audit', 'prd_audit']);
    const halt = await readFile(join(root, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain("step 'prd_audit' exhausted retries without a fresh verdict");
    expect(halt).toContain(expectedDetail);
    if (output.startsWith('structured-result-rejected:')) {
      expect(halt).toContain('criterionJudgments[0].evidence is required');
    }
    await expect(readState(statePath)).resolves.toMatchObject({
      ok: true,
      value: { prd_audit: 'failed' },
    });
    await expect(readFile(join(root, '.pipeline', 'remediation.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers after clearing its halt without manually deleting stale typed evidence', async () => {
    const { root, statePath } = await fixture();
    await writeCurrentPass(root, 'stale-attempt');
    const missing = vi.fn<StepRunner['run']>(async () => ({ success: true, output: 'structured-result-missing' }));

    await conductor(root, statePath, { run: missing }, 1).run();
    await expect(readFile(join(root, '.pipeline', 'prd-audit.json'), 'utf8')).resolves.toContain('stale-attempt');
    await rm(join(root, '.pipeline', 'HALT'));
    await rm(join(root, '.pipeline', 'HALT.class'));

    const recovered = vi.fn<StepRunner['run']>(async (_step, _state, options) => {
      await writeCurrentPass(root, options?.runId ?? 'missing-run-id');
      return { success: true };
    });
    await conductor(root, statePath, { run: recovered }, 1).run();

    expect(recovered).toHaveBeenCalledOnce();
    await expect(readState(statePath)).resolves.toMatchObject({
      ok: true,
      value: { prd_audit: 'done' },
    });
    await expect(readFile(join(root, '.pipeline', 'prd-audit.json'), 'utf8')).resolves.not.toContain('stale-attempt');
  });
});
