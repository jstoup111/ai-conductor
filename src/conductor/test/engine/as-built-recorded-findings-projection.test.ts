// Covers: task:14
// Covers: S7.2 (Task 19) — the recorded-findings projection updates the typed
// verdict, re-renders the report, and clears the ledger's pending entries in one step.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Conductor } from '../test-conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { renderAsBuiltProjection, type AsBuiltProjection } from '../../src/engine/as-built-projection.js';
import {
  AS_BUILT_REPORT_PATH,
  persistAsBuiltVerdict,
  readAsBuiltVerdict,
} from '../../src/engine/as-built-verdict-store.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';
import { appendRecordedShipmentFindings, recordedShipmentFindings } from '../../src/engine/shipment-association.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const policy: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'all tiers' },
  planGap: { enabled: true, reason: 'all tiers' },
  adrCompliance: { enabled: false, reason: 'no approved ADRs' },
  diagramDrift: { enabled: false, reason: 'no diagrams' },
};

describe('as-built recorded-findings projection', () => {
  // Covers: task:14
  it('writes remediation outcomes into the typed verdict, re-renders the report, and clears the ledger', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'as-built-projection-'));
    dirs.push(dir);
    await persistAsBuiltVerdict(dir, {
      version: 'v2', verdict: 'APPROVED', reachability: [], driftNotes: [],
    }, { attemptId: 'attempt-2', codeStamp: 'abc123', policy });
    expect(await readFile(join(dir, AS_BUILT_REPORT_PATH), 'utf8')).not.toContain('Recorded remediation findings');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'kickback-ledger.json'), JSON.stringify({
      version: 1,
      gates: {},
      pendingAsBuiltRemediationFindings: [{
        gate: 'architecture_review_as_built',
        finding: 'as-built:attempt-2:1',
        class: 'REMEDIABLE',
        governingClause: 'Task 4',
        reference: { kind: 'plan-task', taskId: '4' },
        summary: 'wire the renderer',
        outcome: 'remediated',
      }],
    }));
    const conductor = new Conductor({
      stateFilePath: join(dir, '.pipeline', 'conduct-state.json'),
      stepRunner: { run: vi.fn().mockResolvedValue({ success: true }) },
      events: new ConductorEventEmitter(),
      projectRoot: dir,
    });
    expect((await readKickbackLedger(dir)).pendingAsBuiltRemediationFindings).toEqual([
      expect.objectContaining({ finding: 'as-built:attempt-2:1' }),
    ]);

    await expect((conductor as unknown as {
      projectPendingAsBuiltRemediationFindings: () => Promise<string | undefined>;
    }).projectPendingAsBuiltRemediationFindings()).resolves.toBeUndefined();

    const stored = await readAsBuiltVerdict(dir);
    expect(stored).toMatchObject({
      kind: 'present',
      value: {
        attemptId: 'attempt-2',
        codeStamp: 'abc123',
        verdict: { verdict: 'APPROVED' },
        recordedFindings: [{
          id: 'as-built:attempt-2:1', class: 'REMEDIABLE', reference: { kind: 'plan-task', taskId: '4' },
          summary: 'wire the renderer', outcome: 'remediated',
        }],
      },
    });
    expect(await readFile(join(dir, AS_BUILT_REPORT_PATH), 'utf8')).toContain(
      '## Recorded remediation findings\n- as-built:attempt-2:1 [REMEDIABLE] (plan task 4): wire the renderer — remediated\n',
    );
    expect((await readKickbackLedger(dir)).pendingAsBuiltRemediationFindings).toBeUndefined();

    if (stored.kind !== 'present') throw new Error('expected persisted v2 verdict');
    const projection: AsBuiltProjection = {
      version: 1,
      diff: { changedFiles: [], hunks: [], omittedFiles: [] },
      tasks: [], storyCriteria: [], policy, diagrams: [], governingAdrs: [],
      priorFindings: [{
        finding: 'as-built:attempt-2:1', class: 'REMEDIABLE', governingClause: 'Task 4', summary: 'wire the renderer',
      }],
    };
    expect(renderAsBuiltProjection(projection)).toContain('as-built:attempt-2:1 | REMEDIABLE | Task 4 | wire the renderer');
    const shippedRecord = appendRecordedShipmentFindings(
      '---\nslug: as-built-stamps\n---\n',
      recordedShipmentFindings({ asBuilt: stored.value }),
    );
    expect(shippedRecord).toContain('as-built:attempt-2:1');
  });

  // Covers: task:14
  it('keeps first-lap stamped findings while a second lap is persisted pending', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'as-built-pending-laps-'));
    dirs.push(dir);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const firstLap = {
      gate: 'architecture_review_as_built' as const,
      finding: 'as-built:attempt-one:1', class: 'REMEDIABLE' as const,
      governingClause: 'Task 4', reference: { kind: 'plan-task' as const, taskId: '4' },
      summary: 'first repair', outcome: 'remediated' as const,
    };
    const secondLap = {
      gate: 'architecture_review_as_built' as const,
      finding: 'as-built:attempt-two:1', class: 'REMEDIABLE' as const,
      governingClause: 'Task 5', reference: { kind: 'plan-task' as const, taskId: '5' },
      summary: 'second repair', outcome: 'remediated' as const,
    };
    await writeFile(join(dir, '.pipeline', 'kickback-ledger.json'), JSON.stringify({
      version: 1, gates: {}, pendingAsBuiltRemediationFindings: [firstLap],
    }));
    const conductor = new Conductor({
      stateFilePath: join(dir, '.pipeline', 'conduct-state.json'),
      stepRunner: { run: vi.fn().mockResolvedValue({ success: true }) },
      events: new ConductorEventEmitter(), projectRoot: dir,
    });
    const pending = conductor as unknown as {
      reloadPendingAsBuiltRemediationFindings: () => Promise<string | undefined>;
      persistPendingAsBuiltRemediationFindings: () => Promise<void>;
      pendingAsBuiltRemediationFindings: Map<string, typeof firstLap>;
    };

    await expect(pending.reloadPendingAsBuiltRemediationFindings()).resolves.toBeUndefined();
    pending.pendingAsBuiltRemediationFindings.set(secondLap.finding, secondLap);
    await pending.persistPendingAsBuiltRemediationFindings();

    expect((await readKickbackLedger(dir)).pendingAsBuiltRemediationFindings).toEqual([firstLap, secondLap]);
  });
});
