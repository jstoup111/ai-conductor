// Covers: task:37
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { reduceBuildReviewAdjudication } from '../../src/engine/build-review-adjudication.js';
import { reconcileRemediationCases } from '../../src/engine/remediation-case-reconciler.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';
import type { RemediationCaseGraph } from '../../src/engine/remediation-case-validator.js';

const roots: string[] = [];
const feature = { version: 'v1' as const, repository: 'acme/conductor', feature: 'custom-convergence' };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('custom build-review convergence', () => {
  it('keeps a current custom policy decision-owner escalation out of the deferral lane', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'build-review-custom-convergence-'));
    roots.push(projectRoot);
    const sourceId = 'portable-policy:sha256:updated-content:finding-1';
    const graph: RemediationCaseGraph = {
      sourceOutcomes: [{ sourceId, outcome: 'escalate', caseRef: 'architecture-stop' }],
      cases: [{
        case: {
          caseRef: 'architecture-stop', disposition: 'escalate', priority: 'high', confidence: 'high',
          rationale: 'The portable build policy requires an architecture decision.',
          effect: { kind: 'none' }, escalation: { owner: 'architecture' },
        },
        sources: [{ sourceId, outcome: 'escalate', caseRef: 'architecture-stop' }],
      }],
    };
    const ids = ['case-architecture-stop', 'unexpected-effect'];
    const reconciled = await reconcileRemediationCases(new RemediationCaseStore(projectRoot, feature), {
      graph, recordedAt: '2026-09-11T00:00:00.000Z', generateId: () => ids.shift()!,
    });

    expect(reconciled).toMatchObject({ ok: true });
    if (!reconciled.ok) return;

    const transition = reduceBuildReviewAdjudication({
      currentSourceIds: [sourceId], cases: reconciled.state.cases, mechanical: 'retry',
    });

    expect({ record: reconciled.state.cases[0], transition }).toMatchObject({
      record: {
        disposition: 'escalate', resolution: 'open', effect: { kind: 'none' },
        escalation: { owner: 'architecture' },
      },
      transition: {
        route: 'halt', remainingMechanical: true,
        reason: 'architecture decision is required for current remediation sources',
      },
    });
  });
});
