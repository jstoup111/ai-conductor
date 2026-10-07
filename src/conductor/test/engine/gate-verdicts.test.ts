// Covers: task:2, task:4, task:5
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  checkGateCompletion,
  computeAndWriteVerdict,
  readAllVerdicts,
  readVerdict,
  verdictPathFor,
  writeVerdict,
  validRebaseOperationRecord,
  type GateVerdict,
  type RebaseOperationRecord,
} from '../../src/engine/gate-verdicts.js';
import { parseChildId } from '../../src/engine/child-context.js';
import {
  FULL_SUITE_EVIDENCE_VERSION,
  readFullSuiteEvidence,
  writeFullSuiteEvidence,
  type FullSuitePassEvidence,
} from '../../src/engine/full-suite-evidence.js';

describe('engine/gate-verdicts', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gate-verdicts-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('write + read roundtrip', async () => {
    await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 123 });
    const v = await readVerdict(dir, 'build');
    expect(v?.satisfied).toBe(true);
    expect(v?.checkedAt).toBe(123);
  });

  it('readVerdict returns null when absent', async () => {
    expect(await readVerdict(dir, 'plan')).toBeNull();
  });

  it('readVerdict returns null on malformed JSON', async () => {
    await mkdir(join(dir, '.pipeline/gates'), { recursive: true });
    await writeFile(join(dir, '.pipeline/gates/plan.json'), 'not json');
    expect(await readVerdict(dir, 'plan')).toBeNull();
  });

  it('computeAndWriteVerdict persists the predicate result', async () => {
    // build with no task-status.json → predicate reports not done
    const v = await computeAndWriteVerdict(dir, 'build');
    expect(v.satisfied).toBe(false);
    expect(v.reason).toMatch(/task-status/);
    const onDisk = await readVerdict(dir, 'build');
    expect(onDisk?.satisfied).toBe(false);
    expect(onDisk?.checkedAt).toBeTypeOf('number');
  });

  it('readAllVerdicts returns every persisted gate', async () => {
    await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'plan', { satisfied: false, reason: 'x', checkedAt: 2 });
    const all = await readAllVerdicts(dir);
    expect(Object.keys(all).sort()).toEqual(['build', 'plan']);
    expect(all.plan?.satisfied).toBe(false);
  });

  it('preserves kickback provenance', async () => {
    await writeVerdict(dir, 'plan', {
      satisfied: false,
      checkedAt: 5,
      kickback: { from: 'build', evidence: 'AC-7 needs a new table' },
    });
    const v = await readVerdict(dir, 'plan');
    expect(v?.kickback?.from).toBe('build');
    expect(v?.kickback?.evidence).toMatch(/AC-7/);
  });

  it('preserves decide-change kickback provenance for an unsatisfied coverage binding', async () => {
    await writeVerdict(dir, 'coverage_binding', {
      satisfied: false,
      checkedAt: 6,
      kickback: { from: 'decide-change', evidence: 'accepted plan amendment changed coverage' },
    });

    expect((await readVerdict(dir, 'coverage_binding'))?.kickback?.from).toBe('decide-change');
  });

  it('round trips replay-bound preservation without replacing the original judge identity', async () => {
    const preservation = {
      gate: 'build_review' as const,
      original: {
        artifactDigest: 'sha256:original-artifact',
        attemptId: 'attempt-original',
        runId: 'run-original',
        codeStamp: 'a'.repeat(40),
      },
      replay: {
        preRebaseHead: 'a'.repeat(40),
        mergeBase: 'b'.repeat(40),
        target: 'c'.repeat(40),
        completedHead: 'd'.repeat(40),
        expectedTree: 'e'.repeat(40),
      },
      relevantInputIdentities: ['.docs/plans/feature.md@sha256:plan'],
      operationId: 'rebase-operation-1',
    };
    const replayBoundVerdict: GateVerdict = {
      satisfied: true,
      checkedAt: 123,
      preservation,
    };
    await writeVerdict(dir, 'build_review', replayBoundVerdict);

    expect(await readVerdict(dir, 'build_review')).toEqual({
      satisfied: true,
      checkedAt: 123,
      preservation,
    });
  });

  it('round trips applying and applied rebase transition records', async () => {
    const operation = {
      id: 'rebase-operation-1',
      status: 'applying' as const,
      transition: {
        preserved: ['build_review'] as const,
        invalidated: ['test_suite'] as const,
        reverified: [] as const,
      },
      replay: {
        preRebaseHead: 'a'.repeat(40),
        mergeBase: 'b'.repeat(40),
        target: 'c'.repeat(40),
        completedHead: 'd'.repeat(40),
        expectedTree: 'e'.repeat(40),
      },
    };
    const applyingVerdict: GateVerdict = { satisfied: true, checkedAt: 123, rebaseOperation: operation };
    await writeVerdict(dir, 'rebase', applyingVerdict);
    expect((await readVerdict(dir, 'rebase'))?.rebaseOperation).toEqual(operation);

    await writeVerdict(dir, 'rebase', {
      satisfied: true,
      checkedAt: 124,
      rebaseOperation: { ...operation, status: 'applied' },
    });
    expect((await readVerdict(dir, 'rebase'))?.rebaseOperation).toEqual({ ...operation, status: 'applied' });
  });

  it('validates optional appliedAt only when it is a finite positive number', () => {
    const operation = {
      id: 'rebase-operation-1',
      status: 'applied' as const,
      transition: { preserved: [], invalidated: [], reverified: [] },
      replay: {
        preRebaseHead: 'a'.repeat(40),
        mergeBase: 'b'.repeat(40),
        target: 'c'.repeat(40),
        completedHead: 'd'.repeat(40),
        expectedTree: 'e'.repeat(40),
      },
    };

    expect(validRebaseOperationRecord({ ...operation, appliedAt: 123 })).toBe(true);
    expect(validRebaseOperationRecord({ ...operation, appliedAt: Number.NaN })).toBe(false);
    expect(validRebaseOperationRecord({ ...operation, appliedAt: '123' } as never)).toBe(false);
  });

  it('rejects an applying rebase operation carrying an applied timestamp', () => {
    const operation = validRebaseOperationFixture();

    expect(validRebaseOperationRecord({ ...operation, appliedAt: 123 })).toBe(false);
  });

  it('accepts legacy rebase operation records without preservation evidence', () => {
    const operation = validRebaseOperationFixture();

    expect(validRebaseOperationRecord(operation)).toBe(true);
  });

  it('accepts complete preservation evidence with a sha256 verdict digest', () => {
    const operation = validRebaseOperationFixture({
      preservationEvidence: [preservationEvidence('build_review')],
    });

    expect(validRebaseOperationRecord(operation)).toBe(true);
  });

  it('rejects preservation evidence whose gates differ from the preserved transition gates', () => {
    const operation = validRebaseOperationFixture({
      preservationEvidence: [preservationEvidence('prd_audit')],
    });

    expect(validRebaseOperationRecord(operation)).toBe(false);
  });

  it('rejects a non-array preservation evidence value', () => {
    const operation = validRebaseOperationFixture({ preservationEvidence: {} as never });

    expect(validRebaseOperationRecord(operation)).toBe(false);
  });

  it.each(['', 'persisted-verdict-digest', 'sha256:not-a-digest', `sha1:${'a'.repeat(64)}`])(
    'rejects preservation evidence without a sha256 original verdict digest: %s',
    (originalVerdictDigest) => {
      const operation = validRebaseOperationFixture({
        preservationEvidence: [{ ...preservationEvidence('build_review'), originalVerdictDigest }],
      });

      expect(validRebaseOperationRecord(operation)).toBe(false);
    },
  );

  it('drops obsolete preservation metadata when an ordinary verdict replaces the record', async () => {
    await writeVerdict(dir, 'build_review', {
      satisfied: true,
      checkedAt: 1,
      preservation: {
        gate: 'build_review',
        original: { artifactDigest: 'sha256:old', attemptId: 'attempt-old', runId: 'run-old', codeStamp: 'a'.repeat(40) },
        replay: { preRebaseHead: 'a'.repeat(40), mergeBase: 'b'.repeat(40), target: 'c'.repeat(40), completedHead: 'd'.repeat(40), expectedTree: 'e'.repeat(40) },
        relevantInputIdentities: [],
        operationId: 'old-operation',
      },
    });

    await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 2, reason: 'fresh ordinary verdict' });
    expect(await readVerdict(dir, 'build_review')).toEqual({
      satisfied: true,
      checkedAt: 2,
      reason: 'fresh ordinary verdict',
    });
  });

  it('continues to read legacy verdicts without optional replay metadata', async () => {
    await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 123 });
    const verdict = await readVerdict(dir, 'build_review');
    expect(verdict?.preservation).toBeUndefined();
    expect(verdict?.rebaseOperation).toBeUndefined();
  });

  it.each(['failed', 'refused'] as const)('does not satisfy coverage_binding for a %s envelope', async (status) => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'coverage-binding.json'), JSON.stringify({
      version: 1,
      slug: 'coverage-feature',
      runId: 'coverage-run',
      status,
      entries: [],
    }));

    expect(await checkGateCompletion(dir, 'coverage_binding')).toMatchObject({ done: false });
  });

  it('resolves flat and region-child verdict paths', () => {
    expect(verdictPathFor(dir, 'build')).toBe(join(dir, '.pipeline/gates/build.json'));
    expect(verdictPathFor(dir, 'build_review', parseChildId('2')!)).toBe(
      join(dir, '.pipeline/children/2/gates/build_review.json'),
    );
  });

  it('writes and reads a region verdict under its child path without touching siblings', async () => {
    const child = parseChildId('2')!;
    const sibling = parseChildId('3')!;

    await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 8 });
    await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 9 }, sibling);
    await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 1 }, child);

    const flatPath = join(dir, '.pipeline/gates/build_review.json');
    const siblingPath = join(dir, '.pipeline/children/3/gates/build_review.json');
    const childPath = join(dir, '.pipeline/children/2/gates/build_review.json');
    const flatBefore = await readFile(flatPath, 'utf8');
    const siblingBefore = await readFile(siblingPath, 'utf8');

    await writeVerdict(dir, 'build_review', { satisfied: false, reason: 'rewritten', checkedAt: 2 }, child);

    expect(await readFile(flatPath, 'utf8')).toBe(flatBefore);
    expect(await readFile(siblingPath, 'utf8')).toBe(siblingBefore);
    expect(JSON.parse(await readFile(childPath, 'utf8'))).toEqual({
      satisfied: false,
      reason: 'rewritten',
      checkedAt: 2,
    });
    expect(await readVerdict(dir, 'build_review', child)).toEqual({
      satisfied: false,
      reason: 'rewritten',
      checkedAt: 2,
    });
  });

  it('refuses a whole-feature child verdict path', () => {
    expect(() => verdictPathFor(dir, 'prd_audit', parseChildId('2')!)).toThrow(
      /whole-feature step "prd_audit"/,
    );
  });

  it('refuses a whole-feature child write without creating child state, while the flat write still works', async () => {
    // Pre-create the child directory so the refusal is what leaves it empty.
    await mkdir(join(dir, '.pipeline/children/2'), { recursive: true });

    await expect(
      writeVerdict(dir, 'prd_audit', { satisfied: true, checkedAt: 1 }, parseChildId('2')!),
    ).rejects.toThrow(/whole-feature step "prd_audit"/);

    expect(await readdir(join(dir, '.pipeline/children/2'))).toEqual([]);

    await writeVerdict(dir, 'prd_audit', { satisfied: true, checkedAt: 1 });
    expect(JSON.parse(await readFile(join(dir, '.pipeline/gates/prd_audit.json'), 'utf8'))).toEqual({
      satisfied: true,
      checkedAt: 1,
    });
  });

  it('keeps flat verdict enumeration and full-suite evidence unchanged by a populated child region', async () => {
    await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 1 });
    await writeFullSuiteEvidence(dir, FULL_SUITE_PASS);

    const beforeVerdicts = await readAllVerdicts(dir);
    const beforeSuite = await readFullSuiteEvidence(dir);

    await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 2 }, parseChildId('2')!);

    const afterVerdicts = await readAllVerdicts(dir);
    const afterSuite = await readFullSuiteEvidence(dir);

    expect(afterVerdicts).toEqual(beforeVerdicts);
    expect(afterSuite).toEqual(beforeSuite);
    expect(afterVerdicts.build_review).toBeUndefined();
  });
});

function validRebaseOperationFixture(overrides: Partial<RebaseOperationRecord> = {}): RebaseOperationRecord {
  return {
    id: 'rebase-operation-1',
    status: 'applying' as const,
    transition: { preserved: ['build_review'], invalidated: [], reverified: [] },
    replay: {
      preRebaseHead: 'a'.repeat(40),
      mergeBase: 'b'.repeat(40),
      target: 'c'.repeat(40),
      completedHead: 'd'.repeat(40),
      expectedTree: 'e'.repeat(40),
    },
    ...overrides,
  };
}

const FULL_SUITE_PASS: FullSuitePassEvidence = {
  version: FULL_SUITE_EVIDENCE_VERSION,
  outcome: 'PASS',
  reason: 'exit_zero',
  fingerprint: 'sha256:content-fingerprint',
  categoryFingerprints: {
    additional_inputs: 'category:additional_inputs',
    dependencies: 'category:dependencies',
    environment: 'category:environment',
    migrations: 'category:migrations',
    project_config: 'category:project_config',
    source: 'category:source',
    test_infrastructure: 'category:test_infrastructure',
    tests: 'category:tests',
  },
  provenanceHeadSha: '0123456789abcdef',
  mode: 'aggregate',
  selectors: [],
  driftLedger: [],
  command: 'npm test',
  workingDirectory: 'src/conductor',
  startedAt: '2026-07-25T12:00:00.000Z',
  endedAt: '2026-07-25T12:02:03.456Z',
  durationMs: 123_456,
  exitCode: 0,
  stdout: 'tests passed\n',
  stderr: '',
};

function preservationEvidence(gate: 'build_review' | 'prd_audit') {
  return {
    gate,
    original: {
      artifactDigest: 'sha256:artifact',
      attemptId: 'attempt-1',
      runId: 'run-1',
      codeStamp: 'a'.repeat(40),
    },
    originalVerdictDigest: `sha256:${'a'.repeat(64)}`,
    relevantInputIdentities: ['.docs/plans/feature.md@sha256:plan'],
  };
}
