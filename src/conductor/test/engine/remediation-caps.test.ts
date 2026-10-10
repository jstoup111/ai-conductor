// Covers: task:3
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  readPlanGrowthBudget,
  readRemediationGateAppendBudget,
} from '../../src/engine/remediation-caps.js';

const STORY_TWO_SLUG = 'growth-feature';
const STORY_TWO_CONFIG = {
  prd_audit: { max_appended_tasks: 30, max_appended_ratio: 0.5 },
} as never;

function taskHeadings(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `### Task ${prefix}${index + 1}: work`).join('\n');
}

async function writePlanFixture(
  root: string,
  slug: string,
  plan: string | undefined,
  ledger: Record<string, unknown>,
  includeUnrelated = true,
): Promise<void> {
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({ feature_desc: slug }));
  await writeFile(join(root, '.pipeline', 'kickback-ledger.json'), JSON.stringify({ version: 1, gates: {}, ...ledger }));
  if (plan !== undefined) await writeFile(join(root, '.docs', 'plans', `${slug}.md`), plan);
  if (includeUnrelated) await writeFile(join(root, '.docs', 'plans', 'unrelated.md'), taskHeadings('other-', 3));
}

describe('readPlanGrowthBudget', () => {
  it('derives the Story 2 configured cap from the slug-matched plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remediation-caps-'));
    try {
      await writePlanFixture(root, STORY_TWO_SLUG, [taskHeadings('', 24), taskHeadings('rem-', 9)].join('\n'), {
        growth: { authored: 0, added: 9, byGate: { prd_audit: 5, architecture_review_as_built: 4 } },
      });

      await expect(readPlanGrowthBudget(root, STORY_TWO_CONFIG, { persist: true })).resolves.toEqual({
        growth: { authored: 24, added: 9, byGate: { prd_audit: 5, architecture_review_as_built: 4 }, remaining: 3 },
        cap: 12,
        capSource: 'config-derived',
        authoredSource: 'plan',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses the raised cap over the configured cap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remediation-caps-'));
    try {
      await writePlanFixture(root, STORY_TWO_SLUG, [taskHeadings('', 24), taskHeadings('rem-', 9)].join('\n'), {
        effectiveGrowthCap: 20,
        growth: { authored: 0, added: 9, byGate: { prd_audit: 5, architecture_review_as_built: 4 } },
      });

      await expect(readPlanGrowthBudget(root, STORY_TWO_CONFIG, { persist: true })).resolves.toMatchObject({
        growth: { authored: 24, added: 9, remaining: 11 }, cap: 20, capSource: 'raised', authoredSource: 'plan',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('derives the default cap for a resolved 17-task plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remediation-caps-'));
    try {
      await writePlanFixture(root, STORY_TWO_SLUG, taskHeadings('', 17), {});

      await expect(readPlanGrowthBudget(root, {}, { persist: true })).resolves.toMatchObject({
        growth: { authored: 17, added: 0, remaining: 4 }, cap: 4, capSource: 'config-derived', authoredSource: 'plan',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns an unresolved zero cap without a resolvable plan or growth record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remediation-caps-'));
    try {
      await writePlanFixture(root, STORY_TWO_SLUG, undefined, {}, false);

      await expect(readPlanGrowthBudget(root, {}, { persist: true })).resolves.toMatchObject({
        cap: 0, capSource: 'config-derived', authoredSource: 'unresolved',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('readRemediationGateAppendBudget', () => {
  it('uses the shared growth budget instead of every plan heading', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remediation-caps-'));
    try {
      await writePlanFixture(root, STORY_TWO_SLUG, [taskHeadings('', 24), taskHeadings('rem-', 9)].join('\n'), {
        growth: { authored: 0, added: 9, byGate: { prd_audit: 5, architecture_review_as_built: 4 } },
      });

      await expect(readRemediationGateAppendBudget(
        root, STORY_TWO_CONFIG, 'prd_audit', 1, 1, 1,
      )).resolves.toMatchObject({
        growthCap: 12,
        growth: { authored: 24 },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
