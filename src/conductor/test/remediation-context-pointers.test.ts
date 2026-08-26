import { describe, expect, it } from 'vitest';

import type { BuildReviewFinding } from '../src/engine/build-review-domain.js';
import { planContractPointers, priorAttemptPointers } from '../src/engine/remediation-context-pointers.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

function finding(path: string, overrides: Partial<BuildReviewFinding> = {}, locus: Record<string, unknown> = {}): BuildReviewFinding {
  return {
    concernKind: 'test-insensitive',
    summary: `${path} passes against reverted production.`,
    evidenceLocations: [`${path}:1`],
    anchor: { rubric: 'testQuality', locus: { path, contentHash: HASH_A, display: `${path} changed test`, ...locus } },
    ...overrides,
  };
}

const PLAN = `# Implementation Plan

### Task 2: Own a focused test file
**Files:** src/engine/owned.test.ts

### Task 3: First shared-test task
**Files:** src/engine/shared.test.ts

### Task 4: Second shared-test task
**Files:** src/engine/shared.test.ts
`;

describe('planContractPointers', () => {
  it('renders a file-anchored pointer only when exactly one plan task owns the file', () => {
    expect(planContractPointers(
      [finding('src/engine/owned.test.ts'), finding('src/engine/shared.test.ts'), finding('src/engine/unmapped.test.ts')],
      PLAN,
      '.docs/plans/remediation-context.md',
    )).toEqual([
      'plan contract: .docs/plans/remediation-context.md — Task 2 (anchor: src/engine/owned.test.ts)',
    ]);
  });

  it('keeps the pointer concise and free of plan step prose', () => {
    const pointers = planContractPointers([finding('src/engine/owned.test.ts')], `${PLAN}
**Steps:**
1. This detailed implementation text must not appear in the pointer.
`, '.docs/plans/remediation-context.md');

    expect(pointers).toHaveLength(1);
    expect(pointers[0]).not.toContain('detailed implementation text');
  });

  it('ignores an unresolvable plan and malformed findings', () => {
    expect(planContractPointers([finding('src/engine/owned.test.ts')], '', '.docs/plans/remediation-context.md')).toEqual([]);
    expect(planContractPointers([finding('src/engine/owned.test.ts')], '### Task 1: Existing task\n', '.docs/plans/remediation-context.md')).toEqual([]);
    expect(planContractPointers([null as unknown as BuildReviewFinding], PLAN, '.docs/plans/remediation-context.md')).toEqual([]);
    expect(planContractPointers([finding('/absolute/owned.test.ts')], PLAN, '.docs/plans/remediation-context.md')).toEqual([]);
    expect(planContractPointers([finding('src/engine/owned.test.ts', { concernKind: 'source-text-mirror' })], PLAN, '.docs/plans/remediation-context.md')).toEqual([]);
    expect(planContractPointers([], PLAN, '.docs/plans/remediation-context.md')).toEqual([]);
  });
});

describe('priorAttemptPointers', () => {
  it('renders concise references to same-anchor findings across prior review laps', () => {
    const current = finding('src/engine/conductor.test.ts', { summary: 'The current lap wording.', evidenceLocations: ['src/engine/conductor.test.ts:1'] });
    const priorLaps = [
      {
        artifactPath: '.pipeline/build-review/lap-1/testQuality.json',
        findings: [{ findingRef: '0', finding: finding('src/engine/conductor.test.ts', { summary: 'The first lap wording.', evidenceLocations: ['src/engine/conductor.test.ts:10'] }, { display: 'earlier display' }) }],
      },
      {
        artifactPath: '.pipeline/build-review/lap-2/testQuality.json',
        findings: [
          { findingRef: '0', finding: finding('src/engine/other.test.ts') },
          { findingRef: '1', finding: finding('src/engine/conductor.test.ts', { summary: 'The second lap wording.' }) },
        ],
      },
    ];

    expect(priorAttemptPointers([current], priorLaps)).toEqual([
      'prior attempts (2): .pipeline/build-review/lap-1/testQuality.json#0, .pipeline/build-review/lap-2/testQuality.json#1',
    ]);
  });

  it('treats a different path, content hash, or occurrence as a different anchor', () => {
    const current = finding('src/engine/conductor.test.ts');
    const lap = (entry: BuildReviewFinding) => [{ artifactPath: '.pipeline/build-review/lap-x/testQuality.json', findings: [{ findingRef: '0', finding: entry }] }];

    expect(priorAttemptPointers([current], lap(finding('src/engine/other.test.ts')))).toEqual([]);
    expect(priorAttemptPointers([current], lap(finding('src/engine/conductor.test.ts', {}, { contentHash: HASH_B })))).toEqual([]);
    expect(priorAttemptPointers([current], lap(finding('src/engine/conductor.test.ts', {}, { occurrence: 1 })))).toEqual([]);
    expect(priorAttemptPointers([finding('src/engine/conductor.test.ts', {}, { occurrence: 1 })], lap(finding('src/engine/conductor.test.ts', {}, { occurrence: 1 }))))
      .toEqual(['prior attempts (1): .pipeline/build-review/lap-x/testQuality.json#0']);
  });

  it('ignores malformed prior laps and null or malformed findings without losing valid pointers', () => {
    const current = finding('src/engine/conductor.test.ts');
    type PriorLap = Parameters<typeof priorAttemptPointers>[1][number];

    expect(priorAttemptPointers([current], [
      null as unknown as PriorLap,
      { artifactPath: 42, findings: [{ findingRef: '0', finding: current }] } as unknown as PriorLap,
      { artifactPath: '.pipeline/build-review/lap-bad/testQuality.json', findings: 'none' } as unknown as PriorLap,
      {
        artifactPath: '.pipeline/build-review/lap-mixed/testQuality.json',
        findings: [
          { findingRef: 7, finding: current } as unknown as PriorLap['findings'][number],
          { findingRef: 'null', finding: null } as unknown as PriorLap['findings'][number],
          { findingRef: 'valid', finding: current },
        ],
      },
    ])).toEqual(['prior attempts (1): .pipeline/build-review/lap-mixed/testQuality.json#valid']);
    expect(priorAttemptPointers([null as unknown as BuildReviewFinding, {} as unknown as BuildReviewFinding], [
      { artifactPath: '.pipeline/build-review/lap-1/testQuality.json', findings: [{ findingRef: '0', finding: current }] },
    ])).toEqual([]);
    expect(priorAttemptPointers([current], [])).toEqual([]);
  });
});
