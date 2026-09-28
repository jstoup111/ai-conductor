// Covers: S7.2 (Task 19) — the recorded-findings projection updates the typed
// verdict, re-renders the report, and clears the ledger's pending entries in one step.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Conductor } from '../test-conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import {
  AS_BUILT_REPORT_PATH,
  persistAsBuiltVerdict,
  readAsBuiltVerdict,
} from '../../src/engine/as-built-verdict-store.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';

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
  it('writes remediation outcomes into the typed verdict, re-renders the report, and clears the ledger', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'as-built-projection-'));
    dirs.push(dir);
    await persistAsBuiltVerdict(dir, {
      version: 'v1', verdict: 'APPROVED', reachability: [], driftNotes: [],
    }, { attemptId: 'attempt-2', codeStamp: 'abc123', policy });
    expect(await readFile(join(dir, AS_BUILT_REPORT_PATH), 'utf8')).not.toContain('Recorded remediation findings');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'kickback-ledger.json'), JSON.stringify({
      version: 1,
      gates: {},
      pendingAsBuiltRemediationFindings: [{
        gate: 'architecture_review_as_built',
        finding: 'ARCH-1',
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
          id: 'ARCH-1', class: 'REMEDIABLE', reference: { kind: 'plan-task', taskId: '4' },
          summary: 'wire the renderer', outcome: 'remediated',
        }],
      },
    });
    expect(await readFile(join(dir, AS_BUILT_REPORT_PATH), 'utf8')).toContain(
      '## Recorded remediation findings\n- ARCH-1 [REMEDIABLE] (plan task 4): wire the renderer — remediated\n',
    );
    expect((await readKickbackLedger(dir)).pendingAsBuiltRemediationFindings).toBeUndefined();
  });
});
