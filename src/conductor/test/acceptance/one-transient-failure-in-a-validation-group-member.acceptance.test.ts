// Covers: S1.1, S1.2, S1.3, S1.4, S2.1, S2.2, S2.6, S2.8, task:2, task:5
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { createFilesystemConductStateStore } from '../../src/engine/filesystem-conduct-state-store.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, ConductorEvent, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const PRD_PASS = [
  '# PRD Audit',
  '',
  '| FR | Verdict | Gap-class | Evidence | Accepted? |',
  '|--|--|--|--|--|',
  '| FR-1 | ALIGNED | | evidence.ts:1 | yes |',
  '',
].join('\n');

describe('validation-group no-verdict sibling retention (#1425)', () => {
  it('halts for the failed member while retaining both siblings that passed the joined gate checks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'validation-retain-siblings-'));
    const statePath = join(dir, 'conduct-state.json');

    try {
      const state: Record<string, unknown> = {};
      for (const step of ALL_STEPS) {
        if (step.name === 'manual_test') break;
        state[step.name] = 'done';
      }
      Object.assign(state, {
        complexity_tier: 'M',
        track: 'product',
        feature_desc: 'one-transient-failure-in-a-validation-group-member',
        build_review: 'done',
      });
      await writeState(statePath, state as unknown as ConductState);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );

      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'manual_test') {
            throw new Error('validator process exited before writing its verdict');
          }
          if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), PRD_PASS);
          }
          if (step === 'architecture_review_as_built') {
            await writeFile(
              join(dir, '.pipeline/architecture-review-as-built.md'),
              '# As-Built Architecture Review\n\nVerdict: APPROVED\n',
            );
          }
          return { success: true } as StepRunResult;
        }),
      };

      const emitted: ConductorEvent[] = [];
      const events = new ConductorEventEmitter();
      events.on('loop_halt', (event) => { emitted.push(event); });
      events.on('step_failed', (event) => { emitted.push(event); });
      events.on('kickback', (event) => { emitted.push(event); });

      const stateStore = createFilesystemConductStateStore(statePath);
      const applyBatch = vi.spyOn(stateStore, 'applyBatch');
      const conductor = new Conductor({
        stateFilePath: statePath,
        stateStore,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 2,
        fromStep: 'manual_test',
      });
      await conductor.run();

      expect(calls.filter((step) => step === 'manual_test')).toHaveLength(2);
      expect(calls).toContain('prd_audit');
      expect(calls).toContain('architecture_review_as_built');
      expect(calls).not.toContain('remediate');

      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.value).toMatchObject({
        prd_audit: 'done',
        architecture_review_as_built: 'done',
        validation__prd_audit: 'done',
        validation__architecture_review_as_built: 'done',
        manual_test: 'failed',
        last_step: 'manual_test',
      });
      expect((result.value as Record<string, unknown>).validation__manual_test).not.toBe('done');

      const haltCommits = applyBatch.mock.calls
        .map(([batch]) => batch)
        .filter((batch) => batch.name === 'fail manual_test validation group');
      expect(haltCommits).toHaveLength(1);
      expect(haltCommits[0]?.mutations).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'prd_audit', next: 'done' }),
        expect.objectContaining({ field: 'architecture_review_as_built', next: 'done' }),
        expect.objectContaining({ field: 'validation__prd_audit', next: 'done' }),
        expect.objectContaining({ field: 'validation__architecture_review_as_built', next: 'done' }),
        expect.objectContaining({ field: 'manual_test', next: 'failed' }),
        expect.objectContaining({ field: 'last_step', next: 'manual_test' }),
      ]));

      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf8');
      expect(halt).toContain('manual_test');
      expect(halt).toContain('validator process exited before writing its verdict');
      await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).resolves.toBe('needs-human');
      await expect(readFile(join(dir, '.pipeline/remediation.json'), 'utf8')).rejects.toThrow();
      expect(emitted.filter((event) => event.type === 'loop_halt')).toHaveLength(1);
      expect(emitted.filter((event) => event.type === 'step_failed')).toHaveLength(1);
      expect(emitted.filter((event) => event.type === 'kickback')).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
