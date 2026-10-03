// Covers: task:1
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AS_BUILT_VERDICT_PATH,
  asBuiltReviewRequired,
  asBuiltVerdictRequiresReview,
  persistAsBuiltVerdict,
} from '../../src/engine/as-built-verdict-store.js';
import type { AsBuiltVerdict } from '../../src/engine/as-built-contract.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';

const dirs: string[] = [];
const policy: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'all tiers' },
  planGap: { enabled: true, reason: 'all tiers' },
  adrCompliance: { enabled: false, reason: 'not applicable' },
  diagramDrift: { enabled: false, reason: 'not applicable' },
};

const verdicts: readonly [AsBuiltVerdict, boolean][] = [
  [{ version: 'v1', verdict: 'APPROVED', reachability: [], driftNotes: [] }, false],
  [{ version: 'v1', verdict: 'APPROVED WITH DRIFT NOTES', reachability: [], driftNotes: [{ note: 'unexercised seam' }] }, true],
  [{ version: 'v1', verdict: 'PLAN_GAP', reachability: [], driftNotes: [], outcomeDelivered: true, affectedOutcome: 'Review decision' }, true],
  [{ version: 'v1', verdict: 'PLAN_GAP', reachability: [], driftNotes: [], outcomeDelivered: false, affectedOutcome: 'Review decision' }, true],
  [{ version: 'v1', verdict: 'BLOCKED', reachability: [], driftNotes: [], findings: [{ id: 'AB-1', class: 'DESIGN', summary: 'needs decision' }], violations: 'unresolved decision', resolution: 'choose a design' }, true],
];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('as-built review requirement', () => {
  it.each(verdicts)('classifies %s directly', (verdict, expected) => {
    expect(asBuiltVerdictRequiresReview(verdict)).toBe(expected);
  });

  it.each(verdicts)('classifies persisted %s', async (verdict, expected) => {
    const dir = await mkdtemp(join(tmpdir(), 'as-built-review-required-'));
    dirs.push(dir);
    await persistAsBuiltVerdict(dir, verdict, { attemptId: 'attempt-1', codeStamp: null, policy });

    expect(await asBuiltReviewRequired(dir)).toBe(expected);
  });

  it('requires review when no verdict authority exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'as-built-review-required-'));
    dirs.push(dir);

    expect(await asBuiltReviewRequired(dir)).toBe(true);
  });

  it('requires review when the verdict authority is unreadable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'as-built-review-required-'));
    dirs.push(dir);
    await mkdir(join(dir, '.pipeline'));
    await writeFile(join(dir, AS_BUILT_VERDICT_PATH), '{not json', 'utf8');

    expect(await asBuiltReviewRequired(dir)).toBe(true);
  });
});
