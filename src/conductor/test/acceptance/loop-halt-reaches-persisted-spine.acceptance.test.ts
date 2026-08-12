/**
 * RED acceptance coverage for `.docs/stories/loop-halt-never-reaches-events-
 * jsonl-so-a-halt-is-.md` (#1477).
 *
 * This spec drives the real daemon-shaped production entry path:
 * `Conductor.run()` halts at `manual_test`, the feature-scoped event bus feeds
 * the real `EventPersister` and `AuditTrailWriter`, and `computeCostRollup`
 * consumes the resulting ledger. It therefore covers the multi-operation
 * flow in Stories 1, 2, and 4 without testing a proposed helper directly.
 *
 * The remaining stories are deliberately lower-layer covered:
 * - Story 3: one rebase operation and its sink declarations (plan Tasks 2/7).
 * - Story 5: one halt-marker write contract (plan Tasks 8/9).
 * - Story 6: sink-table and no-halt invariants (plan Task 3).
 * - Story 7: documentation assertions (plan Task 11/integrity validation).
 *
 * Before implementation this fails because `loop_halt` is not subscribed by
 * `EventPersister`. Once persistence is enabled, it continues to protect the
 * central step stamp, the matching audit attribution, optional `prUrl`
 * omission, verbatim reason, and the revived halt counter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('execa', () => ({ execa: vi.fn() }));

import type { ConductState } from '../../src/types/index.js';
import { AuditTrailWriter, type AuditRecord } from '../../src/engine/audit-trail.js';
import { computeCostRollup } from '../../src/engine/cost-rollup.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { Conductor } from '../../src/engine/conductor.js';
import { startFeatureEventPersistence } from '../../src/engine/event-persister.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const NO_DISPATCH_RUNNER: StepRunner = {
  run: vi.fn(async (step) => {
    throw new Error(`unexpected dispatch of step '${step}'`);
  }),
};

const NOOP_ESCALATION = async () => ({});

type PersistedRecord = Record<string, unknown> & { type: string };

function parseJsonLines<T>(contents: string): T[] {
  return contents
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

describe('acceptance: a loop halt reaches the persisted event spine (#1477)', () => {
  let projectRoot: string;
  let statePath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'loop-halt-spine-'));
    statePath = join(projectRoot, 'conduct-state.json');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('persists a manual_test halt with matching ledger, audit, marker, and rollup data', async () => {
    // Starting directly at manual_test while build is pending makes the real
    // gate block before dispatch. The conductor's terminal-marker backstop
    // then writes HALT and emits loop_halt immediately before returning.
    await writeState(statePath, {
      complexity_tier: 'M',
      build: 'pending',
    } as ConductState);

    const globalEvents = new ConductorEventEmitter();
    const persistence = startFeatureEventPersistence(projectRoot, globalEvents);
    new AuditTrailWriter(projectRoot).subscribe(persistence.events);

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: NO_DISPATCH_RUNNER,
        events: persistence.events,
        projectRoot,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'manual_test',
        escalateBuildFailure: NOOP_ESCALATION,
      });

      await expect(conductor.run()).resolves.toBeUndefined();
    } finally {
      persistence.stop();
    }

    const haltReason = (await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf-8')).trimEnd();
    const ledger = parseJsonLines<PersistedRecord>(
      await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf-8'),
    );
    const haltRecord = ledger.find((record) => record.type === 'loop_halt');

    expect(haltRecord).toEqual({
      type: 'loop_halt',
      reason: haltReason,
      step: 'manual_test',
      ts: expect.any(String),
    });
    expect(haltRecord).not.toHaveProperty('prUrl');

    const audit = parseJsonLines<AuditRecord>(
      await readFile(
        join(projectRoot, '.pipeline', 'audit-trail', 'events.jsonl'),
        'utf-8',
      ),
    );
    expect(audit).toContainEqual(
      expect.objectContaining({
        origin: 'manual_test',
        phase: 'SHIP',
        event: 'intervention',
        cause: haltReason,
      }),
    );

    await expect(computeCostRollup(projectRoot)).resolves.toMatchObject({ halts: 1 });
  });
});
