// Covers: task:14, task:23
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { checkStepCompletion } from '../src/engine/artifacts.js';
import { persistAsBuiltVerdict } from '../src/engine/as-built-verdict-store.js';
import { recordedShipmentFindings } from '../src/engine/shipment-association.js';
import type { AsBuiltPolicy } from '../src/engine/as-built-policy.js';

const dirs: string[] = [];
const policy: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'fixture' },
  planGap: { enabled: true, reason: 'fixture' },
  adrCompliance: { enabled: false, reason: 'fixture' },
  diagramDrift: { enabled: false, reason: 'fixture' },
};

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'as-built-verdict-'));
  dirs.push(root);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('as-built typed verdict authority', () => {
  it('accepts a delivered plan gap only from the typed envelope', async () => {
    const root = await fixture();
    await persistAsBuiltVerdict(root, {
      version: 'v1', verdict: 'PLAN_GAP', reachability: [], driftNotes: [],
      outcomeDelivered: true, affectedOutcome: 'The plan is the limit.',
    }, { attemptId: 'fixture-run', codeStamp: null, policy });

    await expect(checkStepCompletion(root, 'architecture_review_as_built', {
      sessionStartedAt: Date.now() - 1_000,
    })).resolves.toMatchObject({ done: true });
  });

  it('ignores a reviewer-written Markdown findings table without a typed verdict', async () => {
    const root = await fixture();
    await writeFile(join(root, '.pipeline', 'architecture-review-as-built.md'), [
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| AB-1 | REMEDIABLE | Task 1 | A prose-only finding |',
    ].join('\n'));

    await expect(checkStepCompletion(root, 'architecture_review_as_built', {
      sessionStartedAt: Date.now() - 1_000,
    })).resolves.toMatchObject({ done: false, routeClass: 'absent' });
    expect(recordedShipmentFindings({})).toEqual([]);
  });

  it('keeps a typed remediable verdict on the repair route', async () => {
    const root = await fixture();
    await persistAsBuiltVerdict(root, {
      version: 'v1', verdict: 'BLOCKED', reachability: [], driftNotes: [],
      findings: [{ id: 'AB-1', class: 'REMEDIABLE', reference: { kind: 'plan-task', taskId: '1' }, summary: 'Repair it' }],
      violations: 'repair', resolution: 'repair',
    }, { attemptId: 'fixture-run', codeStamp: null, policy });
    await expect(checkStepCompletion(root, 'architecture_review_as_built', {
      sessionStartedAt: Date.now() - 1_000,
    })).resolves.toMatchObject({
      routeClass: 'named-route', reason: expect.stringContaining('a repair, not a decision'),
    });
  });
});
