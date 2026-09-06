import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor, type StepRunner, type StepRunResult } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import type { ConductState, ConductorEvent, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const MANUAL_TEST_PASS = '# Results\n\n| Story | Result |\n|--|--|\n| S1 | PASS |\n';
const PRD_AUDIT_PASS = [
  '# PRD Audit',
  '',
  '| FR | Verdict | Gap-class | Evidence | Accepted? |',
  '|--|--|--|--|--|',
  '| FR-1 | ALIGNED | | src/example.ts:1 | yes |',
].join('\n');
const AS_BUILT_PASS = '# As-Built Architecture Review\n\n**Verdict:** APPROVED\n';

async function seedToValidationGroup(dir: string, statePath: string): Promise<void> {
  const current = await readState(statePath);
  const state = (current.ok ? current.value : {}) as Record<string, unknown>;
  for (const step of ALL_STEPS) {
    if (step.name === 'manual_test') break;
    state[step.name] = 'done';
  }
  Object.assign(state, {
    complexity_tier: 'M',
    track: 'product',
    feature_desc: 'gate-verdict-observability',
    build_review: 'done',
    rebase: 'done',
    finish: 'done',
  });
  await writeState(statePath, state as ConductState);
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await writeFile(
    join(dir, '.pipeline/task-status.json'),
    JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
  );
}

describe('validation-group gate verdict observability', () => {
  it('emits and persists one verdict for each dispatched SHIP validator', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gate-verdict-group-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidationGroup(dir, statePath);
      const events = new ConductorEventEmitter();
      const observed: Extract<ConductorEvent, { type: 'gate_verdict' }>[] = [];
      events.on('gate_verdict', (event) => {
        if (event.type === 'gate_verdict') observed.push(event);
      });
      const persister = new EventPersister(join(dir, '.pipeline/events.jsonl'), events);
      persister.start();

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MANUAL_TEST_PASS);
          } else if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), PRD_AUDIT_PASS);
          } else if (step === 'architecture_review_as_built') {
            await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), AS_BUILT_PASS);
          }
          return { success: true } as StepRunResult;
        }),
      };

      await new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'manual_test',
      }).run();
      persister.stop();

      const members = ['manual_test', 'prd_audit', 'architecture_review_as_built'];
      expect(observed.map((event) => event.step)).toEqual(members);

      const persisted = (await readFile(join(dir, '.pipeline/events.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as ConductorEvent)
        .filter((event): event is Extract<ConductorEvent, { type: 'gate_verdict' }> =>
          event.type === 'gate_verdict',
        );
      expect(persisted.map((event) => event.step)).toEqual(members);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
