// Covers: task:28
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readRemediationCaseStoreFeature,
  remediationCaseStorePath,
  RemediationCaseStore,
  type RemediationCaseStoreState,
} from '../../src/engine/remediation-case-store.js';
import { parseChildId } from '../../src/engine/child-context.js';

const FEATURE = { version: 'v1', repository: 'acme/conductor', feature: 'stacked-review' } as const;
const temporaryDirectories: string[] = [];

function state(id: string): RemediationCaseStoreState {
  return {
    version: 'v2',
    feature: FEATURE,
    cases: [{
      id,
      domain: 'build_review',
      disposition: 'act',
      priority: 'high',
      rationale: 'The child change needs its own regression coverage.',
      confidence: 'high',
      resolution: 'open',
      sources: [{ sourceId: `testQuality:${id}`, outcome: 'acted', recordedAt: '2026-10-09T12:00:00.000Z' }],
      effect: { id: `effect-${id}`, kind: 'action', status: 'reserved' },
    }],
    prdWideningCases: [],
    suppressions: [],
  };
}

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'remediation-case-child-'));
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('child-scoped build-review remediation cases', () => {
  it('keeps cases for an earlier child intact while the active child starts an independent store', async () => {
    const root = await projectRoot();
    const child1 = parseChildId(1)!;
    const child2 = parseChildId(2)!;
    const first = new RemediationCaseStore(root, FEATURE, { child: child1 });
    const second = new RemediationCaseStore(root, FEATURE, { child: child2 });

    await expect(first.mutate(async () => ({ value: undefined, nextState: state('child-1-case') }))).resolves.toEqual({ ok: true, value: undefined });
    const firstBytes = await readFile(remediationCaseStorePath(root, child1), 'utf8');

    await expect(second.read()).resolves.toEqual({
      ok: true,
      state: { version: 'v2', feature: FEATURE, cases: [], prdWideningCases: [], suppressions: [] },
    });
    await expect(second.mutate(async () => ({ value: undefined, nextState: state('child-2-case') }))).resolves.toEqual({ ok: true, value: undefined });

    await expect(readFile(remediationCaseStorePath(root, child1), 'utf8')).resolves.toBe(firstBytes);
    await expect(second.read()).resolves.toEqual({ ok: true, state: state('child-2-case') });
    await expect(readRemediationCaseStoreFeature(root, undefined, child2)).resolves.toEqual({ ok: true, feature: FEATURE });
  });

  it('uses the legacy flat path when there is no active child', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, FEATURE);

    await expect(store.mutate(async () => ({ value: undefined, nextState: state('flat-case') }))).resolves.toEqual({ ok: true, value: undefined });
    expect(remediationCaseStorePath(root)).toBe(join(root, '.pipeline', 'remediation-cases.json'));
    await expect(store.read()).resolves.toEqual({ ok: true, state: state('flat-case') });
  });
});
