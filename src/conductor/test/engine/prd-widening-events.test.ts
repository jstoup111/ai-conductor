// Covers: task:23

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/engine/build-review-effective.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-effective.js')>(),
  resolveBuildReviewFeatureIdentity: vi.fn(async () => ({
    version: 'v1' as const,
    repository: '/fixture/repository',
    feature: 'prd-widening-events',
  })),
}));

// Import and rejection events below model operator-cleared history.
vi.mock('../../src/engine/owner-gate/machine-identity.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/owner-gate/machine-identity.js')>(),
  readMachineOwnerConfig: vi.fn(async () => ({ spec_owner: 'fixture-operator' })),
}));

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { persistedEventTypes, renderedEventTypes } from '../../src/engine/event-sinks.js';
import { persistPrdWideningOffers } from '../../src/engine/prd-widening-offers.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('PRD widening events', () => {
  it('uses the existing persisted event spine without a per-occurrence renderer', () => {
    expect({
      persisted: persistedEventTypes().includes('prd_widening_reconciled'),
      rendered: renderedEventTypes().includes('prd_widening_reconciled'),
    }).toEqual({ persisted: true, rendered: false });
  });

  it('persists reconciliation source, case, decision, and bounded rejection reason through the registered ledger consumer', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'prd-widening-events-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    const occurrences = [
      { type: 'prd_widening_reconciled', sourceId: 'prd-audit:NC.1', caseId: 'case-original', outcome: 'offer' },
      { type: 'prd_widening_reconciled', sourceId: 'prd-audit:NC.1', caseId: 'case-original', decisionId: 'decision-1', outcome: 'imported' },
      { type: 'prd_widening_reconciled', sourceId: 'legacy-prd-source-1', caseId: 'legacy-prd-case-1', decisionId: 'legacy-decision-1', outcome: 'recovered' },
      { type: 'prd_widening_reconciled', sourceId: 'prd-audit:NC.2', caseId: 'case-original', outcome: 'same-case', reason: 'Same original behavior.' },
      { type: 'prd_widening_reconciled', sourceId: 'prd-audit:NC.3', outcome: 'different', reason: 'Different behavior.' },
      { type: 'prd_widening_reconciled', sourceId: 'prd-audit:NC.4', outcome: 'uncertain', reason: 'Insufficient identity evidence.' },
      { type: 'prd_widening_reconciled', sourceId: 'prd-audit:NC.5', outcome: 'rejected', reason: 'malformed-entry' },
      { type: 'prd_widening_reconciled', sourceId: 'prd-audit:NC.2', caseId: 'case-original', outcome: 'reused', reason: 'Same original behavior.' },
    ] satisfies ConductorEvent[];

    try {
      persister.start();
      for (const occurrence of occurrences) await events.emit(occurrence);
      persister.stop();

      const records = (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => {
          const { ts: _timestamp, ...record } = JSON.parse(line) as { ts: string } & ConductorEvent;
          return record;
        });
      expect(records).toEqual(occurrences);
    } finally {
      persister.stop();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('persists a malformed pre-audit rejection before returning its recovery output', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'prd-widening-entry-rejection-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    const runner: StepRunner = { run: vi.fn(async () => ({ success: true })) };
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, 'conduct-state.json'),
      stepRunner: runner,
      events,
    });
    const entry = conductor as unknown as {
      preparePrdWideningBeforeAudit(): Promise<string | undefined>;
    };

    try {
      await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
      await writeFile(
        join(projectRoot, '.pipeline', 'HALT.cleared'),
        '```json over-scope-decisions\nnot-json\n```',
      );
      persister.start();
      await events.emit({ type: 'step_started', step: 'prd_audit', index: 0 });

      await expect(entry.preparePrdWideningBeforeAudit()).resolves.toContain('malformed');
      persister.stop();

      const records = (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line) as ConductorEvent)
        .filter((record) => record.type === 'prd_widening_reconciled');
      expect(records).toEqual([{
        type: 'prd_widening_reconciled', sourceId: 'prd-audit:entry', outcome: 'rejected', reason: 'malformed-block',
        ts: expect.any(String),
      }]);
    } finally {
      persister.stop();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps an already-persisted sibling decision visible when another cleared entry is rejected', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'prd-widening-sibling-event-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    const runner: StepRunner = { run: vi.fn(async () => ({ success: true })) };
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, 'conduct-state.json'),
      stepRunner: runner,
      events,
    });
    const entry = conductor as unknown as {
      preparePrdWideningBeforeAudit(): Promise<string | undefined>;
    };

    try {
      await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
      const offers = await persistPrdWideningOffers(projectRoot, {
        version: 'v1', repository: '/fixture/repository', feature: 'prd-widening-events',
      }, [{
        criterion: 'NC.1', sourceId: 'prd-audit:NC.1', evidence: 'Original widening.',
        reportSnapshot: 'Original report.', relation: 'outside-visible',
      }]);
      if (!offers.ok) throw new Error('offer fixture did not persist');
      const offer = offers.offers[0]!;
      await writeFile(join(projectRoot, '.pipeline', 'HALT.cleared'), [
        '```json over-scope-decisions',
        JSON.stringify([{
          criterion: 'NC.1', offerEntryId: offer.offerEntryId, originalCaseId: offer.originalCaseId,
          originalSource: offer.originalSource, summary: offer.originalSource.snapshot,
          relation: 'outside-visible', decision: 'accept', rationale: 'Accepted original behavior.',
        }, 'malformed sibling entry']),
        '```',
      ].join('\n'));
      persister.start();

      await expect(entry.preparePrdWideningBeforeAudit()).resolves.toContain('malformed');
      persister.stop();

      const records = (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line) as ConductorEvent)
        .filter((record) => record.type === 'prd_widening_reconciled');
      expect(records).toEqual([
        expect.objectContaining({
          sourceId: 'prd-audit:NC.1', caseId: offer.originalCaseId,
          decisionId: expect.any(String), outcome: 'imported',
        }),
        expect.objectContaining({ sourceId: 'prd-audit:entry', outcome: 'rejected', reason: 'malformed-entry' }),
      ]);
    } finally {
      persister.stop();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('persists a legacy authority recovery with its source, case, and decision identities', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'prd-widening-recovery-event-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    const runner: StepRunner = { run: vi.fn(async () => ({ success: true })) };
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, 'conduct-state.json'),
      stepRunner: runner,
      events,
    });
    const entry = conductor as unknown as {
      preparePrdWideningBeforeAudit(): Promise<string | undefined>;
    };

    try {
      await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
      await writeFile(join(projectRoot, '.pipeline', 'accepted-widenings.json'), JSON.stringify({
        version: 1,
        decisions: [{
          criterion: 'NC.9', summary: 'Original legacy widening.', decision: 'accept',
          rationale: 'The original decision remains valid.', operator: 'operator@example.test',
          decidedAt: '2026-09-09T00:00:00.000Z',
        }],
      }));
      persister.start();

      await expect(entry.preparePrdWideningBeforeAudit()).resolves.toBeUndefined();
      persister.stop();

      const records = (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line) as ConductorEvent)
        .filter((record) => record.type === 'prd_widening_reconciled');
      expect(records).toEqual([expect.objectContaining({
        sourceId: expect.stringMatching(/^legacy-clear-source-/),
        caseId: expect.stringMatching(/^legacy-clear-case-/),
        decisionId: expect.stringMatching(/^legacy-decision-/),
        outcome: 'recovered',
      })]);
    } finally {
      persister.stop();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
