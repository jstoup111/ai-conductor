import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const VALIDATION_GROUP_PREREQS = {
  feature_desc: 'step-refusal-validation-group',
  worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
  stories: 'done', conflict_check: 'done', plan: 'done', coherence_check: 'done',
  architecture_diagram: 'done', architecture_review: 'done', acceptance_specs: 'done',
  build: 'done', build_review: 'done', wiring_check: 'done', test_suite: 'done',
  rebase: 'done', finish: 'done',
} as ConductState;

const MANUAL_TEST_PASS = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n';
const MANUAL_TEST_FAIL = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n';
const PRD_AUDIT_PASS =
  '**PRD:** present\n\n## Verdict Table\n\n| Criterion | Grade | Plan task | PRD: | Evidence |\n|---|---|---|---|---|\n| S1.1 | PASS | — | FR-1 | evidence.ts:1 |\n';
const AS_BUILT_APPROVED = '# As-Built Architecture Review\n\nVerdict: APPROVED\n';
const AS_BUILT_BLOCKED = '# As-Built Architecture Review\n\nVerdict: BLOCKED\n';

function persistedEvents(raw: string): Array<Record<string, unknown>> {
  return raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function seedValidationInputs(root: string): Promise<void> {
  await Promise.all([
    mkdir(join(root, '.docs/specs'), { recursive: true }),
    mkdir(join(root, '.docs/stories'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, '.docs/specs/step-refusal-validation-group.md'), '## Functional Requirements\n\nFR-1\n'),
    writeFile(join(root, '.docs/stories/step-refusal-validation-group.md'), '## Story 1\n\n**Requirements:** FR-1\n'),
  ]);
}

async function writeValidatorArtifact(root: string, step: StepName, asBuilt = AS_BUILT_APPROVED): Promise<void> {
  await mkdir(join(root, '.pipeline'), { recursive: true });
  if (step === 'manual_test') {
    await writeFile(join(root, '.pipeline/manual-test-results.md'), MANUAL_TEST_PASS);
  } else if (step === 'prd_audit') {
    await writeFile(join(root, '.pipeline/prd-audit.md'), PRD_AUDIT_PASS);
  } else if (step === 'architecture_review_as_built') {
    await writeFile(join(root, '.pipeline/architecture-review-as-built.md'), asBuilt);
  }
}

describe('validation-group refusal persistence', () => {
  const roots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
  });

  async function runAndReadRefusal(input: {
    runner: StepRunner;
    verifyArtifacts?: boolean;
    daemon?: boolean;
    expectedStep: StepName;
  }): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), 'step-refusal-group-'));
    roots.push(root);
    await Promise.all([
      seedValidationInputs(root),
      writeState(join(root, '.pipeline/conduct-state.json'), VALIDATION_GROUP_PREREQS),
    ]);
    const events = new ConductorEventEmitter();
    const eventsPath = join(root, '.pipeline/events.jsonl');
    const persister = new EventPersister(eventsPath, events);
    persister.start();
    try {
      await new Conductor({
        projectRoot: root,
        stateFilePath: join(root, '.pipeline/conduct-state.json'),
        stepRunner: input.runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        daemon: input.daemon,
        maxRetries: 1,
        verifyArtifacts: input.verifyArtifacts ?? false,
        escalateBuildFailure: async () => ({}),
      }).run();
    } finally {
      persister.stop();
    }

    const persisted = persistedEvents(await readFile(eventsPath, 'utf8'));
    const groupStart = persisted.find((event) => event.type === 'parallel_started');
    expect(groupStart).toEqual(expect.objectContaining({
      step: 'manual_test',
      branches: expect.arrayContaining(['manual_test', 'prd_audit']),
    }));
    expect(persisted).toContainEqual(expect.objectContaining({
      type: 'step_refused',
      step: input.expectedStep,
      kind: 'validation-verdict',
    }));
    const refusalIndex = persisted.findIndex((event) =>
      event.type === 'step_refused' && event.step === input.expectedStep,
    );
    const groupFailureIndex = persisted.findIndex((event) =>
      event.type === 'parallel_failure' && event.step === 'manual_test',
    );
    expect(refusalIndex).toBeGreaterThanOrEqual(0);
    expect(groupFailureIndex).toBeGreaterThan(refusalIndex);
  }

  it('keeps a crashed validator failed, not refused, when a width-2+ group runs out of retries', async () => {
    // Story 3, negative path (S3.4): a no-verdict outcome is the validator's
    // own runner dying. The refusal lane must never absorb it — the step keeps
    // `failed` and the spine keeps `step_failed`.
    const root = await mkdtemp(join(tmpdir(), 'step-refusal-no-verdict-'));
    roots.push(root);
    await Promise.all([
      seedValidationInputs(root),
      writeState(join(root, '.pipeline/conduct-state.json'), VALIDATION_GROUP_PREREQS),
    ]);
    const events = new ConductorEventEmitter();
    const eventsPath = join(root, '.pipeline/events.jsonl');
    const persister = new EventPersister(eventsPath, events);
    persister.start();
    try {
      await new Conductor({
        projectRoot: root,
        stateFilePath: join(root, '.pipeline/conduct-state.json'),
        stepRunner: {
          run: vi.fn(async (step) => {
            if (step !== 'manual_test') await writeValidatorArtifact(root, step);
            return step === 'manual_test'
              ? { success: false, output: 'validator exited before recording a verdict' }
              : { success: true };
          }),
        },
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        daemon: true,
        maxRetries: 1,
        verifyArtifacts: false,
        escalateBuildFailure: async () => ({}),
      }).run();
    } finally {
      persister.stop();
    }

    const persisted = persistedEvents(await readFile(eventsPath, 'utf8'));
    // No refusal is recorded for this lane, on the spine or in state.
    expect(persisted.some((event) => event.type === 'step_refused')).toBe(false);
    expect(persisted).toContainEqual(expect.objectContaining({
      type: 'loop_halt',
      step: 'manual_test',
    }));

    const state = JSON.parse(
      await readFile(join(root, '.pipeline/conduct-state.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(state.manual_test).toBe('failed');
  });

  it('persists the as-built judge when its gate halts a width-2+ group', async () => {
    await runAndReadRefusal({
      expectedStep: 'architecture_review_as_built',
      verifyArtifacts: true,
      runner: {
        run: vi.fn(async (step) => {
          await writeValidatorArtifact(roots[roots.length - 1]!, step, AS_BUILT_BLOCKED);
          return { success: true };
        }),
      },
    });
  });

  it('persists the failed member when auto mode takes the generic group halt', async () => {
    await runAndReadRefusal({
      expectedStep: 'manual_test',
      verifyArtifacts: true,
      daemon: false,
      runner: {
        run: vi.fn(async (step) => {
          if (step === 'manual_test') {
            await writeFile(join(roots[roots.length - 1]!, '.pipeline/manual-test-results.md'), MANUAL_TEST_FAIL);
          } else {
            await writeValidatorArtifact(roots[roots.length - 1]!, step);
          }
          return { success: true };
        }),
      },
    });
  });
});
