// Task: 10
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
// Spy targets for the process-level exec surface. artifacts.ts does not
// import child_process at all today (that's the purity being pinned), so
// these mocks intercept the module directly rather than relying on
// vi.spyOn — child_process's exports are non-configurable and cannot be
// spied on in place.
const execSpy = vi.fn();
const execFileSpy = vi.fn();
const execSyncSpy = vi.fn();
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    exec: (...args: unknown[]) => execSpy(...args),
    execFile: (...args: unknown[]) => execFileSpy(...args),
    execSync: (...args: unknown[]) => execSyncSpy(...args),
  };
});

import {
  checkStepCompletion,
  ACCEPTANCE_SPECS_RED_EVIDENCE,
  validateAcceptanceRedEvidence,
} from '../../src/engine/artifacts.js';

// Regression pin for #733's self-heal boundary: the acceptance_specs
// completion predicate must remain a pure, synchronous-per-call READ of the
// worktree-root evidence marker. Task 9 wired the self-heal *execution* into
// conductor.ts's step-handling seam, specifically so the predicate itself
// never shells out and never reaches into a nested (non-root) path. This
// test spies on the process-level exec surface and on the marker path the
// predicate touches, and fails if either boundary is ever crossed again.
describe('engine/artifacts — acceptance_specs predicate purity', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'artifacts-acceptance-specs-test-'));
    execSpy.mockClear();
    execFileSpy.mockClear();
    execSyncSpy.mockClear();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function createFile(relativePath: string, content = 'test') {
    const fullPath = join(dir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }

  const validEvidence = {
    outcome: 'specs-generated',
    command: 'pytest spec/integration/test_x.py',
    targetSpecs: ['spec/integration/test_x.py'],
    executed: 3,
    passed: 0,
    failed: 3,
    skipped: 0,
    errors: 0,
    failingTests: [{ name: 'test_x', reason: 'expected result was absent' }],
    ranAt: '2026-08-10T12:00:00.000Z',
    intentRationale: 'The failed test proves the requested behavior is not yet implemented.',
  };

  it('performs no subprocess exec when the RED marker is missing (miss path)', async () => {
    await createFile('test/acceptance/foo.spec.ts', 'spec content');

    const result = await checkStepCompletion(dir, 'acceptance_specs');

    expect(result.done).toBe(false);
    expect(execSpy).not.toHaveBeenCalled();
    expect(execFileSpy).not.toHaveBeenCalled();
    expect(execSyncSpy).not.toHaveBeenCalled();
  });

  it('performs no subprocess exec when the RED marker is present and valid (hit path)', async () => {
    await createFile('test/acceptance/foo.spec.ts', 'spec content');
    await createFile(ACCEPTANCE_SPECS_RED_EVIDENCE, JSON.stringify(validEvidence));

    const result = await checkStepCompletion(dir, 'acceptance_specs');

    expect(result).toEqual({ done: true, viaException: false });
    expect(execSpy).not.toHaveBeenCalled();
    expect(execFileSpy).not.toHaveBeenCalled();
    expect(execSyncSpy).not.toHaveBeenCalled();
  });

  it('reports whether a valid marker satisfied the gate through a remediation exception', async () => {
    await createFile('test/acceptance/foo.spec.ts', 'spec content');
    await createFile(
      ACCEPTANCE_SPECS_RED_EVIDENCE,
      JSON.stringify({
        ...validEvidence,
        failed: 0,
        passed: 3,
        failingTests: [],
        exception: {
          kind: 'remediation',
          reason: 'The remediation necessarily changed the acceptance spec and production behavior together.',
          attribution: 'remediation task 8',
        },
      }),
    );

    const result = await checkStepCompletion(dir, 'acceptance_specs');

    expect(result).toEqual({ done: true, viaException: true });
  });

  it('reads only the worktree-root marker path, never a nested marker path', async () => {
    await createFile('test/acceptance/foo.spec.ts', 'spec content');
    // Plant a nested marker at a plausible-but-wrong location; if the
    // predicate ever drifted to reading a nested path instead of (or in
    // addition to) the root marker, this would let a nested-only marker
    // satisfy the gate. It must not.
    await createFile(
      join('src/conductor', ACCEPTANCE_SPECS_RED_EVIDENCE),
      JSON.stringify(validEvidence),
    );

    const result = await checkStepCompletion(dir, 'acceptance_specs');

    // No root marker exists, so the gate must still report not-done —
    // proving the predicate never fell back to the nested path.
    expect(result.done).toBe(false);
    expect(result.reason).toContain(ACCEPTANCE_SPECS_RED_EVIDENCE);
  });

  it('completes a disposition-only outcome without spec files, a run contract, or RED counters', async () => {
    await createFile(
      ACCEPTANCE_SPECS_RED_EVIDENCE,
      JSON.stringify({
        outcome: 'disposition-only',
        dispositions: [
          {
            criterion: 'happy: visible result',
            disposition: 'existing-sufficient-test',
            citation: 'src/conductor/test/engine/artifacts.acceptance-specs.test.ts:1',
          },
          {
            criterion: 'negative: missing evidence',
            disposition: 'planned-lower-layer-test',
            citation: '.docs/plans/feature.md:42',
            owningTask: 'Task 12',
            layer: 'engine',
          },
        ],
      }),
    );

    await expect(checkStepCompletion(dir, 'acceptance_specs')).resolves.toEqual({
      done: true,
      viaException: false,
    });
  });

  it('refuses a disposition-only outcome when spec files are present', async () => {
    await createFile('test/acceptance/foo.spec.ts', 'spec content');
    await createFile(
      ACCEPTANCE_SPECS_RED_EVIDENCE,
      JSON.stringify({
        outcome: 'disposition-only',
        dispositions: [
          {
            criterion: 'happy: visible result',
            disposition: 'existing-sufficient-test',
            citation: 'src/conductor/test/engine/artifacts.acceptance-specs.test.ts:1',
          },
        ],
      }),
    );

    await expect(checkStepCompletion(dir, 'acceptance_specs')).resolves.toMatchObject({
      done: false,
      acceptanceRedRefusalClass: 'shape',
    });
  });

  it('refuses a disposition-only outcome when a run contract is present', async () => {
    await createFile(
      ACCEPTANCE_SPECS_RED_EVIDENCE,
      JSON.stringify({
        outcome: 'disposition-only',
        dispositions: [{
          criterion: 'happy: visible result',
          disposition: 'existing-sufficient-test',
          citation: 'src/conductor/test/engine/artifacts.acceptance-specs.test.ts:1',
        }],
      }),
    );
    await createFile('.pipeline/acceptance-specs-run.json', '{}');

    await expect(checkStepCompletion(dir, 'acceptance_specs')).resolves.toMatchObject({
      done: false,
      acceptanceRedRefusalClass: 'shape',
    });
  });
});

describe('validateAcceptanceRedEvidence refusal classification', () => {
  const validEvidence = {
    outcome: 'specs-generated',
    command: 'pytest spec/integration/test_x.py',
    targetSpecs: ['spec/integration/test_x.py'],
    executed: 3,
    passed: 0,
    failed: 3,
    skipped: 0,
    errors: 0,
    failingTests: [{ name: 'test_x', reason: 'expected result was absent' }],
    ranAt: '2026-08-10T12:00:00.000Z',
    intentRationale: 'The failed test proves the requested behavior is not yet implemented.',
  };

  it('classifies a missing command as a shape refusal', () => {
    const { command: _command, ...evidenceWithoutCommand } = validEvidence;

    expect(validateAcceptanceRedEvidence(evidenceWithoutCommand)).toMatchObject({
      ok: false,
      class: 'shape',
    });
  });

  it.each([
    ['missing outcome', (() => { const { outcome: _outcome, ...evidence } = validEvidence; return evidence; })()],
    ['unknown outcome', { ...validEvidence, outcome: 'other' }],
  ])('refuses a %s as a tagged-union shape failure', (_case, evidence) => {
    expect(validateAcceptanceRedEvidence(evidence)).toMatchObject({ ok: false, class: 'shape' });
  });

  it('accepts exhaustive citation-bearing disposition-only records', () => {
    expect(
      validateAcceptanceRedEvidence({
        outcome: 'disposition-only',
        dispositions: [
          {
            criterion: 'happy: completion',
            disposition: 'existing-sufficient-test',
            citation: 'src/conductor/test/engine/artifacts.acceptance-specs.test.ts:1',
          },
          {
            criterion: 'negative: malformed evidence',
            disposition: 'planned-lower-layer-test',
            citation: '.docs/plans/feature.md:42',
            owningTask: 'Task 12',
            layer: 'engine',
          },
        ],
      }),
    ).toEqual({ ok: true });
  });

  it.each([
    ['empty records', { outcome: 'disposition-only', dispositions: [] }],
    ['missing citation', { outcome: 'disposition-only', dispositions: [{ criterion: 'happy', disposition: 'existing-sufficient-test' }] }],
    ['incomplete lower-layer record', { outcome: 'disposition-only', dispositions: [{ criterion: 'negative', disposition: 'planned-lower-layer-test', citation: 'plan.md:1' }] }],
    ['unknown disposition', { outcome: 'disposition-only', dispositions: [{ criterion: 'happy', disposition: 'acceptance-system-spec', citation: 'spec.ts:1' }] }],
    ['mixed RED fields', { outcome: 'disposition-only', command: 'npm test', dispositions: [{ criterion: 'happy', disposition: 'existing-sufficient-test', citation: 'test.ts:1' }] }],
    ['mixed disposition records', { ...validEvidence, dispositions: [{ criterion: 'happy', disposition: 'existing-sufficient-test', citation: 'test.ts:1' }] }],
  ])('refuses disposition-only evidence with %s', (_case, evidence) => {
    expect(validateAcceptanceRedEvidence(evidence)).toMatchObject({ ok: false, class: 'shape' });
  });

  it('classifies a missing passed counter as a shape refusal', () => {
    const { passed: _passed, ...evidenceWithoutPassed } = validEvidence;

    expect(validateAcceptanceRedEvidence(evidenceWithoutPassed)).toMatchObject({
      ok: false,
      class: 'shape',
      reason: expect.stringContaining('executed/passed/failed/skipped/errors'),
    });
  });

  it('classifies no failing tests as an outcome refusal', () => {
    expect(validateAcceptanceRedEvidence({ ...validEvidence, failed: 0 })).toMatchObject({
      ok: false,
      class: 'outcome',
    });
  });

  it('accepts a green run only when its remediation exception is recorded', () => {
    const waivedEvidence = {
      ...validEvidence,
      failed: 0,
      passed: 3,
      exception: {
        kind: 'remediation',
        reason: 'The remediation necessarily changed the acceptance spec and production behavior together.',
        attribution: 'remediation task 7',
      },
    };

    expect(validateAcceptanceRedEvidence(waivedEvidence)).toEqual({ ok: true });
    expect(validateAcceptanceRedEvidence({ ...validEvidence, failed: 0 })).toEqual({
      ok: false,
      class: 'outcome',
      reason:
        'acceptance-specs RED run shows 0 failed — RED not established; the generated specs must FAIL before implementation',
    });
  });

  it('accepts an empty failingTests list only for a well-formed remediation waiver', () => {
    const waiver = {
      kind: 'remediation',
      reason: 'The remediation necessarily changed the acceptance spec and production behavior together.',
      attribution: 'remediation task 8',
    };

    expect(
      validateAcceptanceRedEvidence({
        ...validEvidence,
        failed: 0,
        passed: 3,
        failingTests: [],
        exception: waiver,
      }),
    ).toEqual({ ok: true });
    expect(
      validateAcceptanceRedEvidence({
        ...validEvidence,
        failed: 0,
        passed: 3,
        failingTests: [{ name: ' ', reason: 'missing identity' }],
        exception: waiver,
      }),
    ).toMatchObject({ ok: false, class: 'shape', reason: expect.stringContaining('failingTests') });
  });

  it.each([
    ['empty reason', { kind: 'remediation', reason: '  ', attribution: 'remediation task 8' }],
    ['missing attribution', { kind: 'remediation', reason: 'Approved atomic remediation.' }],
    ['unrecognized kind', { kind: 'operator_override', reason: 'Approved atomic remediation.', attribution: 'remediation task 8' }],
  ])('refuses an exception with a %s even when genuine RED exists', (_case, exception) => {
    expect(validateAcceptanceRedEvidence({ ...validEvidence, exception })).toMatchObject({
      ok: false,
      class: 'shape',
      reason: expect.stringContaining('exception'),
    });
  });

  it.each([
    [
      'errors > 0',
      { errors: 1 },
      'acceptance specs errored at collection (1) — they never ran; fix the specs so they execute (this is not RED)',
    ],
    [
      'skipped > 0',
      { skipped: 1 },
      "1 acceptance spec(s) were SKIPPED — a skipped spec does not establish RED (missing testcontainer/dependency, or a unit-only test scope?). Bring up the required infra and run the feature's specs so they actually execute",
    ],
    [
      'executed == 0',
      { executed: 0 },
      'acceptance-specs RED run executed 0 tests — the command did not select the feature\'s specs',
    ],
  ])('never waives %s and preserves its execution refusal text', (_case, counters, reason) => {
    const exception = {
      kind: 'remediation',
      reason: 'The remediation necessarily changed the acceptance spec and production behavior together.',
      attribution: 'remediation task 8',
    };

    expect(validateAcceptanceRedEvidence({ ...validEvidence, failed: 0, passed: 3, ...counters, exception })).toEqual({
      ok: false,
      class: 'outcome',
      reason,
    });
  });

  it('accepts genuine RED when a well-formed remediation exception is also recorded', () => {
    expect(
      validateAcceptanceRedEvidence({
        ...validEvidence,
        exception: {
          kind: 'remediation',
          reason: 'The remediation necessarily changed the acceptance spec and production behavior together.',
          attribution: 'remediation task 8',
        },
      }),
    ).toEqual({ ok: true });
  });

  it('requires failingTests identity while accepting a named failed test', () => {
    const evidenceWithFailingTest = {
      ...validEvidence,
      failingTests: [{ name: 'rejects an absent marker', reason: 'marker is missing' }],
    };
    const { failingTests: _failingTests, ...evidenceWithoutFailingTests } = evidenceWithFailingTest;

    expect(validateAcceptanceRedEvidence(evidenceWithFailingTest)).toEqual({ ok: true });
    expect(validateAcceptanceRedEvidence(evidenceWithoutFailingTests)).toMatchObject({
      ok: false,
      class: 'shape',
      reason: expect.stringContaining('failingTests'),
    });
  });

  it('refuses an empty failingTests array as a shape failure', () => {
    expect(validateAcceptanceRedEvidence({ ...validEvidence, failingTests: [] })).toMatchObject({
      ok: false,
      class: 'shape',
      reason: expect.stringContaining('failingTests'),
    });
  });

  it('refuses a failing test without a reason as a shape failure', () => {
    expect(
      validateAcceptanceRedEvidence({
        ...validEvidence,
        failingTests: [{ name: 'test_x' }],
      }),
    ).toMatchObject({
      ok: false,
      class: 'shape',
      reason: expect.stringContaining('failingTests'),
    });
  });

  it('refuses absent or unparseable ranAt as a shape failure', () => {
    const { ranAt: _ranAt, ...evidenceWithoutRanAt } = validEvidence;

    expect(validateAcceptanceRedEvidence(evidenceWithoutRanAt)).toMatchObject({
      ok: false,
      class: 'shape',
      reason: expect.stringContaining('ranAt'),
    });
    expect(validateAcceptanceRedEvidence({ ...validEvidence, ranAt: 'not a timestamp' })).toMatchObject({
      ok: false,
      class: 'shape',
      reason: expect.stringContaining('ranAt'),
    });
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['whitespace-only', '  \t  '],
  ])('refuses a %s intentRationale as a shape failure', (_case, intentRationale) => {
    const { intentRationale: _intentRationale, ...evidenceWithoutIntentRationale } = validEvidence;
    const evidence =
      intentRationale === undefined
        ? evidenceWithoutIntentRationale
        : { ...validEvidence, intentRationale };

    expect(validateAcceptanceRedEvidence(evidence)).toMatchObject({
      ok: false,
      class: 'shape',
      reason: expect.stringContaining('intentRationale'),
    });
  });

  it.each([
    [
      'errors > 0',
      { errors: 1 },
      'acceptance specs errored at collection (1) — they never ran; fix the specs so they execute (this is not RED)',
    ],
    [
      'skipped > 0',
      { skipped: 1 },
      "1 acceptance spec(s) were SKIPPED — a skipped spec does not establish RED (missing testcontainer/dependency, or a unit-only test scope?). Bring up the required infra and run the feature's specs so they actually execute",
    ],
    [
      'executed < 1',
      { executed: 0 },
      "acceptance-specs RED run executed 0 tests — the command did not select the feature's specs",
    ],
    [
      'failed < 1',
      { failed: 0 },
      'acceptance-specs RED run shows 0 failed — RED not established; the generated specs must FAIL before implementation',
    ],
  ])('preserves the exact %s counter refusal before provenance validation', (_case, counters, reason) => {
    const evidence = { ...validEvidence, ...counters };
    const { intentRationale: _intentRationale, ...evidenceWithoutIntentRationale } = evidence;

    expect(validateAcceptanceRedEvidence(evidence)).toEqual({ ok: false, class: 'outcome', reason });
    expect(validateAcceptanceRedEvidence(evidenceWithoutIntentRationale)).toEqual({
      ok: false,
      class: 'outcome',
      reason,
    });
  });
});

// rem-build-review-task13-1: the disposition-only zero-spec check must count
// only the FEATURE's own acceptance spec files, not the repository-wide
// acceptance corpus — any unrelated pre-existing test previously refused a
// legitimate disposition-only completion.
describe('acceptance_specs disposition-only zero-spec check is feature-scoped', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'artifacts-acceptance-disposition-scope-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function createFile(relativePath: string, content = 'test') {
    const fullPath = join(dir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }

  const STORIES_DOC = [
    '# Stories',
    '',
    '**Status:** ACCEPTED',
    '',
    '## Story 1: Observable behavior',
    '',
    '### Happy Path',
    '- Given a valid input, When the engine runs, Then the visible result appears',
    '',
    '### Negative Paths',
    '- Given malformed evidence, When the engine runs, Then it refuses fail-closed',
    '',
  ].join('\n');

  const PLAN_DOC = [
    '# Plan',
    '',
    '### Task 12: Cover the lower-layer behavior',
    '**Files:** src/engine/foo.ts',
    '',
  ].join('\n');

  async function seedFeatureFixtures() {
    await createFile('.docs/stories/my-feature.md', STORIES_DOC);
    await createFile('.docs/plans/my-feature.md', PLAN_DOC);
    await createFile('test/engine/existing-behavior.test.ts', '// existing test');
  }

  const dispositionEvidence = {
    outcome: 'disposition-only',
    dispositions: [
      {
        criterion: 'Story 1 happy path: visible result',
        disposition: 'existing-sufficient-test',
        citation: 'test/engine/existing-behavior.test.ts:1',
      },
      {
        criterion: 'Story 1 negative path: refuses malformed evidence',
        disposition: 'planned-lower-layer-test',
        citation: '.docs/plans/my-feature.md:3',
        owningTask: 'Task 12',
        layer: 'engine',
      },
    ],
  };

  const featureCtx = {
    featureDesc: 'my-feature',
    artifactResolution: {
      featureIdentities: ['my-feature'],
      changedPaths: new Set<string>(),
    },
  };

  it('completes when only pre-existing unrelated acceptance specs exist', async () => {
    await seedFeatureFixtures();
    await createFile('test/acceptance/unrelated-legacy-feature.acceptance.test.ts', '// legacy');
    await createFile('spec/acceptance/other_corpus_spec.rb', '# legacy');
    await createFile(ACCEPTANCE_SPECS_RED_EVIDENCE, JSON.stringify(dispositionEvidence));

    await expect(checkStepCompletion(dir, 'acceptance_specs', featureCtx)).resolves.toEqual({
      done: true,
      viaException: false,
    });
  });

  it('refuses when a spec file is attributed to the feature by identity', async () => {
    await seedFeatureFixtures();
    await createFile('test/acceptance/my-feature.acceptance.test.ts', '// this feature');
    await createFile(ACCEPTANCE_SPECS_RED_EVIDENCE, JSON.stringify(dispositionEvidence));

    await expect(checkStepCompletion(dir, 'acceptance_specs', featureCtx)).resolves.toMatchObject({
      done: false,
      acceptanceRedRefusalClass: 'shape',
    });
  });

  it("refuses when a spec file is among the feature's changed paths", async () => {
    await seedFeatureFixtures();
    await createFile('test/acceptance/renamed-elsewhere.spec.ts', '// this feature');
    await createFile(ACCEPTANCE_SPECS_RED_EVIDENCE, JSON.stringify(dispositionEvidence));

    const ctx = {
      ...featureCtx,
      artifactResolution: {
        featureIdentities: ['my-feature'],
        changedPaths: new Set(['test/acceptance/renamed-elsewhere.spec.ts']),
      },
    };
    await expect(checkStepCompletion(dir, 'acceptance_specs', ctx)).resolves.toMatchObject({
      done: false,
      acceptanceRedRefusalClass: 'shape',
    });
  });

  it('falls back fail-closed to the whole corpus without any attribution context', async () => {
    await seedFeatureFixtures();
    await createFile('test/acceptance/unrelated-legacy-feature.acceptance.test.ts', '// legacy');
    await createFile(ACCEPTANCE_SPECS_RED_EVIDENCE, JSON.stringify(dispositionEvidence));

    await expect(checkStepCompletion(dir, 'acceptance_specs')).resolves.toMatchObject({
      done: false,
      acceptanceRedRefusalClass: 'shape',
    });
  });
});
