import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import { ADMITTED_EXTERNAL_PIPELINE_EVENT_TYPES, appendCloseoutEvent, appendKickbackBudgetAuthorizationEvent } from '../src/engine/closeout-events.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

const authorization = (adjustmentId: string) => ({
  type: 'kickback_budget_adjustment_authorized' as const, adjustmentId, gate: 'build_review', kind: 'raise' as const,
  feature: 'feature', operator: 'operator', rationale: 'evidence', beforeConsumed: 1, afterConsumed: 1,
  beforeLimit: 5, afterLimit: 6, ts: '2026-09-08T00:00:00.000Z',
});

describe('external pipeline event writer', () => {
  it('admits only the declared external types and writes them to the sibling ledger', async () => {
    expect(ADMITTED_EXTERNAL_PIPELINE_EVENT_TYPES).toEqual([
      'build_review_disposition_accepted', 'build_review_reduced_coverage_accepted',
      'build_review_disposition_refused', 'build_review_outer_verdict', 'kickback_budget_adjustment_authorized',
    ]);
    const projectRoot = await mkdtemp(join(tmpdir(), 'closeout-events-'));
    directories.push(projectRoot);
    appendCloseoutEvent(projectRoot, authorization('adj-1'));
    await expect(readFile(join(projectRoot, '.pipeline/pipeline-events.jsonl'), 'utf8'))
      .resolves.toContain('"kickback_budget_adjustment_authorized"');
  });

  it('serializes concurrent authorization appends by adjustment id', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'closeout-events-'));
    directories.push(projectRoot);
    await Promise.all([
      appendKickbackBudgetAuthorizationEvent(projectRoot, authorization('adj-1')),
      appendKickbackBudgetAuthorizationEvent(projectRoot, authorization('adj-1')),
      appendKickbackBudgetAuthorizationEvent(projectRoot, authorization('adj-2')),
    ]);
    const records = (await readFile(join(projectRoot, '.pipeline/pipeline-events.jsonl'), 'utf8')).trim()
      .split('\n').map((line) => JSON.parse(line) as { adjustmentId: string });
    expect(records.map((record) => record.adjustmentId).sort()).toEqual(['adj-1', 'adj-2']);
  });
});
