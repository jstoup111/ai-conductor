// Covers: task:rem-as-built-r18-6
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readRemediationCaseJudgement,
  type RemediationCaseJudgement,
} from '../../src/engine/remediation-case-artifact.js';
import { reconcileRemediationCases } from '../../src/engine/remediation-case-reconciler.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';
import { validateRemediationCaseGraph } from '../../src/engine/remediation-case-validator.js';

const FEATURE = { version: 'v1', repository: 'acme/conductor', feature: 'advisory-round-trip' } as const;
const SOURCE_ID = 'testQuality:advisory-finding';
const temporaryDirectories: string[] = [];

function advisoryJudgement(mode: RemediationCaseJudgement['mode']): RemediationCaseJudgement {
  const base = {
    mode,
    domain: 'build_review' as const,
    sourceOutcomes: [{ sourceId: SOURCE_ID, outcome: 'advisory' as const, caseRef: 'advisory-case' }],
    cases: [{
      caseRef: 'advisory-case',
      disposition: 'advisory' as const,
      priority: 'low' as const,
      rationale: 'The adjudicated severity is below the declared threshold.',
      confidence: 'high' as const,
      effect: { kind: 'none' as const },
      adjudicatedSeverity: 'minor' as const,
    }],
  };
  return mode === 'case-v1'
    ? { ...base, mode: 'case-v1' }
    : {
        ...base,
        mode: 'case-v2',
        consistency: {
          verdict: 'consistent',
          sourceIds: [SOURCE_ID],
          caseRefs: ['advisory-case'],
          rationale: 'The one-source advisory case is internally consistent.',
        },
      };
}

async function createProjectRoot(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'remediation-case-advisory-roundtrip-'));
  temporaryDirectories.push(projectRoot);
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  return projectRoot;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('advisory remediation case round trip', () => {
  it.each(['case-v1', 'case-v2'] as const)('parses, validates, persists, and reloads a %s advisory case with no effect', async (mode) => {
    const projectRoot = await createProjectRoot();
    const judgement = advisoryJudgement(mode);
    await writeFile(join(projectRoot, '.pipeline/remediation.json'), JSON.stringify(judgement));

    const parsed = await readRemediationCaseJudgement(projectRoot, Date.now() - 60_000);
    expect(parsed).toEqual({ ok: true, judgement });
    if (!parsed.ok) throw new Error(`unexpected artifact rejection: ${parsed.reason}`);

    const validated = validateRemediationCaseGraph([SOURCE_ID], parsed.judgement, {
      sourceRubrics: { [SOURCE_ID]: 'testQuality' },
      sourceReviewerSeverities: { [SOURCE_ID]: 'major' },
      declaredSeverityThresholds: { testQuality: 'major' },
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error(`unexpected graph rejection: ${validated.reason}`);

    const persisted = await reconcileRemediationCases(new RemediationCaseStore(projectRoot, FEATURE), {
      graph: validated.graph,
      recordedAt: '2026-10-23T12:00:00.000Z',
      generateId: () => `advisory-case-${mode}`,
    });
    expect(persisted).toMatchObject({ ok: true });

    await expect(new RemediationCaseStore(projectRoot, FEATURE).read()).resolves.toEqual({
      ok: true,
      state: expect.objectContaining({
        cases: [expect.objectContaining({
          id: `advisory-case-${mode}`,
          disposition: 'advisory',
          sources: [{ sourceId: SOURCE_ID, outcome: 'advisory', recordedAt: '2026-10-23T12:00:00.000Z' }],
          effect: { kind: 'none' },
          adjudicatedSeverity: 'minor',
        })],
      }),
    });
  });
});
