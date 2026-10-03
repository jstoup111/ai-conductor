import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ConductState, StepName } from '../../src/types/index.js';
import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import {
  advanceFinishPublication,
  routeFinishPublicationDisposition,
  type AdvanceFinishPublicationResult,
  type PublicationDisposition,
  type PublicationSnapshot,
} from '../../src/engine/finish-publication.js';
import type { FullSuitePassEvidence } from '../../src/engine/full-suite-evidence.js';
import { readAllVerdicts, writeVerdict } from '../../src/engine/gate-verdicts.js';
import { persistAsBuiltVerdict } from '../../src/engine/as-built-verdict-store.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import * as asBuiltVerdictStore from '../../src/engine/as-built-verdict-store.js';
import * as gateVerdicts from '../../src/engine/gate-verdicts.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';
import { writeRegionCapture } from '../../src/engine/pr-body-region-store.js';
import type { GithubOperationRequest, GithubOperationRunner } from '../../src/engine/github-operations.js';

vi.mock('../../src/engine/project-prelude.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/project-prelude.js')>()),
  currentCommitSha: vi.fn(async () => null),
}));

vi.mock('../../src/engine/as-built-verdict-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/as-built-verdict-store.js')>();
  return { ...actual, persistAsBuiltVerdict: vi.fn(actual.persistAsBuiltVerdict) };
});

vi.mock('../../src/engine/gate-verdicts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/gate-verdicts.js')>();
  return { ...actual, writeVerdict: vi.fn(actual.writeVerdict) };
});

const ROUTED_SENTINEL = new Error('stop after first FINISH publication route');

const PASS_EVIDENCE: FullSuitePassEvidence = {
  version: 3,
  outcome: 'PASS',
  reason: 'exit_zero',
  fingerprint: 'sha256:current-test-inputs',
  categoryFingerprints: {
    additional_inputs: 'sha256:additional-inputs',
    dependencies: 'sha256:dependencies',
    environment: 'sha256:environment',
    migrations: 'sha256:migrations',
    project_config: 'sha256:project-config',
    source: 'sha256:source',
    test_infrastructure: 'sha256:test-infrastructure',
    tests: 'sha256:tests',
  },
  provenanceHeadSha: '0123456789abcdef',
  command: 'npm test',
  workingDirectory: 'src/conductor',
  startedAt: '2026-08-15T00:00:00.000Z',
  endedAt: '2026-08-15T00:00:01.000Z',
  durationMs: 1_000,
  exitCode: 0,
  stdout: 'all tests passed\\n',
  stderr: '',
};

const AS_BUILT_FIXTURE_POLICY: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'fixture' },
  planGap: { enabled: true, reason: 'fixture' },
  adrCompliance: { enabled: false, reason: 'fixture' },
  diagramDrift: { enabled: false, reason: 'fixture' },
};

async function writePrdAuditFixture(
  dir: string,
  attemptId = 'fixture-run',
  grade: 'PASS' | 'PLAN_GAP' = 'PASS',
  codeStamp: string | null = null,
): Promise<void> {
  await persistPrdAuditVerdict(dir, {
    complete: true,
    judgment: {
      version: 'v1',
      criterionJudgments: [{
        criterion: { storyId: '1', ordinal: 1 },
        criterionId: 'S1.1',
        grade,
        evidence: 'finish evidence',
        rationale: 'The fixture supplies the current typed audit judgment.',
        requirementAssociations: [],
        evidenceTaskIds: ['1'],
      }],
      noOwnerObservations: [],
    },
    diagnostics: [],
    recordedDispositions: [],
  }, { attemptId, codeStamp });
}

async function writeGreenShipValidatorEvidence(dir: string, attemptId?: string): Promise<void> {
  await mkdir(join(dir, '.docs', 'specs'), { recursive: true });
  await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
  await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  // The audit below cites Plan task 1; the plan is its citation authority.
  await writeFile(
    join(dir, '.docs', 'plans', 'finish-publication.md'),
    '### Task 1: Finish publication\n\n**Files:** src/example.ts\n',
  );
  await writeFile(
    join(dir, '.docs', 'specs', 'finish-publication.md'),
    '# PRD\n\n## Functional Requirements\n\n- FR-1: The feature can finish.\n',
  );
  await writeFile(
    join(dir, '.docs', 'stories', 'finish-publication.md'),
    '# Stories\n\n## Story 1: Finish publication\n\n**Requirement:** FR-1\n\n### Happy Path\n\n- Given a ready feature, when it finishes, then it is published.\n',
  );
  await writePrdAuditFixture(dir, attemptId);
  await persistAsBuiltVerdict(dir, {
    version: 'v1',
    verdict: 'APPROVED',
    reachability: [],
    driftNotes: [],
  }, {
    attemptId: 'fixture-run',
    codeStamp: null,
    policy: AS_BUILT_FIXTURE_POLICY,
  });
  const fresh = new Date(Date.now() + 60_000);
  await utimes(join(dir, '.pipeline', 'prd-audit.json'), fresh, fresh);
  await utimes(join(dir, '.pipeline', 'prd-audit.md'), fresh, fresh);
  await utimes(join(dir, '.pipeline', 'architecture-review-as-built.md'), fresh, fresh);
}

const SYNTHETIC_FINISH_EVIDENCE_PATHS = [
  '.pipeline/prd-audit.json',
  '.pipeline/prd-audit.md',
  '.pipeline/architecture-review-as-built.json',
  '.pipeline/architecture-review-as-built.md',
] as const;

async function expectNoSyntheticFinishEvidence(dir: string): Promise<void> {
  for (const path of SYNTHETIC_FINISH_EVIDENCE_PATHS) {
    await expect(readFile(join(dir, path), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }
}

// Covers: task:6, task:9
describe('Conductor FINISH publication routing', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await mkdtemp(join(tmpdir(), 'conductor-finish-publication-'));
    statePath = join(dir, 'conduct-state.json');
    const state: Record<string, unknown> = {
      complexity_tier: 'S',
      track: 'technical',
      feature_desc: 'finish-publication',
    };
    for (const step of [
      'bootstrap', 'memory', 'assess', 'explore', 'prd', 'complexity', 'stories',
      'conflict_check', 'plan', 'coherence_check', 'architecture_diagram',
      'architecture_review', 'worktree', 'acceptance_specs', 'build', 'build_review',
      'test_suite', 'manual_test', 'prd_audit',
      'architecture_review_as_built', 'rebase',
    ] satisfies StepName[]) {
      state[step] = 'done';
    }
    await writeState(statePath, state as ConductState);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('restores an authoring-omitted captured region before the prose judge observes the revision', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/42';
    const owner = 'compliance-attest';
    const capture = '\nCompliance-Attestation: signed 2026-09-24\n';
    await writeRegionCapture(dir, prUrl, owner, capture);
    let body = '## Summary\n\nReader-facing prose';
    const edits: GithubOperationRequest[] = [];
    let bodySeenByJudge = '';
    const operations: GithubOperationRunner = { run: async (request) => {
      edits.push(request);
      body = (request.payload as { body: string }).body;
      return {} as never;
    } };
    const runner: StepRunner = { run: vi.fn(async (_step, _state, options) => {
      if (options?.finishProsePass === 'judge') bodySeenByJudge = body;
      return { success: true };
    }) };
    const finishPublication = { advance: vi.fn(async ({ dispatchAuthoring, dispatchJudgment }) => {
      await dispatchAuthoring({ kind: 'author_pr_prose', pullRequestUrl: prUrl, revisionGuidance: undefined });
      await dispatchJudgment({ kind: 'finish_pr_prose_quality', pullRequestUrl: prUrl, qualityScope: ['title', 'body'], maximumPasses: 1 });
      return { kind: 'complete' } as const;
    }) };
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, finishPublication, events: new ConductorEventEmitter(), projectRoot: dir,
      gh: async () => ({ stdout: JSON.stringify({ body }) }), git: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
      resolveShipDraftPublicationDependencies: async () => ({ operations }) as never,
    });

    await (conductor as unknown as { runFinishPublication(state: ConductState, options: never): Promise<unknown> }).runFinishPublication({
      feature_desc: 'finish-publication', worktree_branch: 'feat/region', complexity_tier: 'S',
    } as ConductState, {} as never);

    const restored = `<!-- ai-conductor:step ${owner} -->${capture}<!-- /ai-conductor:step -->`;
    expect(edits).toHaveLength(1);
    expect(bodySeenByJudge).toContain(restored);
    expect(body).toContain(restored);
  });

  it('restores a region omitted by a judge-repair dispatch before the repaired body is observed', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/42';
    const owner = 'compliance-attest';
    const capture = '\nCompliance-Attestation: signed 2026-09-24\n';
    const restored = `<!-- ai-conductor:step ${owner} -->${capture}<!-- /ai-conductor:step -->`;
    await writeRegionCapture(dir, prUrl, owner, capture);
    let body = `## Summary\n\n${restored}`;
    const operations: GithubOperationRunner = { run: async (request) => {
      body = (request.payload as { body: string }).body;
      return {} as never;
    } };
    const runner: StepRunner = { run: vi.fn(async (_step, _state, options) => {
      if (options?.finishProsePass === 'judge') body = '## Summary\n\nJudge-repaired prose';
      return { success: true };
    }) };
    const finishPublication = { advance: vi.fn(async ({ dispatchJudgment }) => {
      await dispatchJudgment({ kind: 'finish_pr_prose_quality', pullRequestUrl: prUrl, qualityScope: ['title', 'body'], maximumPasses: 1 });
      expect(body).toContain(restored);
      return { kind: 'complete' } as const;
    }) };
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, finishPublication, events: new ConductorEventEmitter(), projectRoot: dir,
      gh: async () => ({ stdout: JSON.stringify({ body }) }), git: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
      resolveShipDraftPublicationDependencies: async () => ({ operations }) as never,
    });

    await (conductor as unknown as { runFinishPublication(state: ConductState, options: never): Promise<unknown> }).runFinishPublication({
      feature_desc: 'finish-publication', worktree_branch: 'feat/region', complexity_tier: 'S',
    } as ConductState, {} as never);
  });

  it.each([
    ['authoring', 'author', 'returns false' as const],
    ['judgment', 'judge', 'returns false' as const],
    ['authoring', 'author', 'throws' as const],
    ['judgment', 'judge', 'throws' as const],
  ])('restores an omitted region after %s dispatch %s', async (_name, pass, outcome) => {
    const prUrl = 'https://github.com/acme/widget/pull/42';
    const owner = 'compliance-attest';
    const capture = '\nCompliance-Attestation: signed 2026-09-24\n';
    const restored = `<!-- ai-conductor:step ${owner} -->${capture}<!-- /ai-conductor:step -->`;
    const dispatchError = new Error(`${pass} response lost`);
    await writeRegionCapture(dir, prUrl, owner, capture);
    let body = `## Summary\n\n${restored}`;
    const operations: GithubOperationRunner = { run: async (request) => {
      body = (request.payload as { body: string }).body;
      return {} as never;
    } };
    const runner: StepRunner = { run: vi.fn(async () => {
      body = `## Summary\n\n${pass} rewrote prose without the capture`;
      if (outcome === 'throws') throw dispatchError;
      return { success: false };
    }) };
    const finishPublication = { advance: vi.fn(async ({ dispatchAuthoring, dispatchJudgment }) => {
      const dispatch = pass === 'author' ? dispatchAuthoring : dispatchJudgment;
      const request = pass === 'author'
        ? { kind: 'author_pr_prose' as const, pullRequestUrl: prUrl, revisionGuidance: undefined }
        : { kind: 'finish_pr_prose_quality' as const, pullRequestUrl: prUrl, qualityScope: ['title', 'body'] as const, maximumPasses: 1 };
      if (outcome === 'throws') await expect(dispatch(request)).rejects.toBe(dispatchError);
      else await expect(dispatch(request)).resolves.toEqual({ success: false });
      expect(body).toContain(restored);
      return { kind: 'complete' } as const;
    }) };
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, finishPublication, events: new ConductorEventEmitter(), projectRoot: dir,
      gh: async () => ({ stdout: JSON.stringify({ body }) }), git: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
      resolveShipDraftPublicationDependencies: async () => ({ operations }) as never,
    });

    await (conductor as unknown as { runFinishPublication(state: ConductState, options: never): Promise<unknown> }).runFinishPublication({
      feature_desc: 'finish-publication', worktree_branch: 'feat/region', complexity_tier: 'S',
    } as ConductState, {} as never);
  });

  it('restores every omitted captured region once with its own bytes after authoring', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/42';
    const captures = [
      ['compliance-attest', '\nCompliance-Attestation: signed 2026-09-24\n'],
      ['release-disposition', '\nRelease-Disposition: no-note\n'],
    ] as const;
    for (const [owner, bytes] of captures) await writeRegionCapture(dir, prUrl, owner, bytes);
    let body = '## Summary\n\nAuthoring omitted both project-owned regions.';
    const operations: GithubOperationRunner = { run: async (request) => {
      body = (request.payload as { body: string }).body;
      return {} as never;
    } };
    const runner: StepRunner = { run: vi.fn(async () => ({ success: true })) };
    const finishPublication = { advance: vi.fn(async ({ dispatchAuthoring }) => {
      await dispatchAuthoring({ kind: 'author_pr_prose', pullRequestUrl: prUrl, revisionGuidance: undefined });
      return { kind: 'complete' } as const;
    }) };
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, finishPublication, events: new ConductorEventEmitter(), projectRoot: dir,
      gh: async () => ({ stdout: JSON.stringify({ body }) }), git: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
      resolveShipDraftPublicationDependencies: async () => ({ operations }) as never,
    });

    await (conductor as unknown as { runFinishPublication(state: ConductState, options: never): Promise<unknown> }).runFinishPublication({
      feature_desc: 'finish-publication', worktree_branch: 'feat/region', complexity_tier: 'S',
    } as ConductState, {} as never);

    for (const [owner, bytes] of captures) {
      expect(body).toContain(`<!-- ai-conductor:step ${owner} -->${bytes}<!-- /ai-conductor:step -->`);
      expect(body.match(new RegExp(`<!-- ai-conductor:step ${owner} -->`, 'g'))).toHaveLength(1);
    }
  });

  it('does not edit an intact captured region and dispatches exactly one judge', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/42';
    const owner = 'compliance-attest';
    const capture = '\nCompliance-Attestation: signed 2026-09-24\n';
    await writeRegionCapture(dir, prUrl, owner, capture);
    let body = `## Summary\n\n<!-- ai-conductor:step ${owner} -->${capture}<!-- /ai-conductor:step -->`;
    const operations = { run: vi.fn(async () => ({})) } as unknown as GithubOperationRunner;
    const runner: StepRunner = { run: vi.fn(async () => ({ success: true })) };
    const finishPublication = { advance: vi.fn(async ({ dispatchJudgment }) => {
      await dispatchJudgment({ kind: 'finish_pr_prose_quality', pullRequestUrl: prUrl, qualityScope: ['title', 'body'], maximumPasses: 1 });
      return { kind: 'complete' } as const;
    }) };
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, finishPublication, events: new ConductorEventEmitter(), projectRoot: dir,
      gh: async () => ({ stdout: JSON.stringify({ body }) }), git: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
      resolveShipDraftPublicationDependencies: async () => ({ operations }) as never,
    });

    await (conductor as unknown as { runFinishPublication(state: ConductState, options: never): Promise<unknown> }).runFinishPublication({
      feature_desc: 'finish-publication', worktree_branch: 'feat/region', complexity_tier: 'S',
    } as ConductState, {} as never);

    expect(operations.run).not.toHaveBeenCalled();
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect((runner.run as ReturnType<typeof vi.fn>).mock.calls[0][2]).toMatchObject({ finishProsePass: 'judge' });
  });

  it('halts with the owner name and does not ready the PR when region re-insertion is refused', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/42';
    const owner = 'compliance-attest';
    await writeRegionCapture(dir, prUrl, owner, '\nCompliance-Attestation: signed 2026-09-24\n');
    let body = '## Summary\n\nAuthor omitted the project-owned content';
    const ready = vi.fn();
    const operations: GithubOperationRunner = { run: async () => ({ kind: 'refused', reason: 'other-owner' }) };
    const finishPublication = { advance: vi.fn(async ({ dispatchAuthoring }) => {
      await dispatchAuthoring({ kind: 'author_pr_prose', pullRequestUrl: prUrl, revisionGuidance: undefined });
      ready();
      return { kind: 'complete' } as const;
    }) };
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: { run: vi.fn(async () => ({ success: true })) }, finishPublication,
      events: new ConductorEventEmitter(), projectRoot: dir, fromStep: 'finish', mode: 'auto', daemon: true, maxRetries: 1,
      gh: async () => ({ stdout: JSON.stringify({ body }) }), git: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
      resolveShipDraftPublicationDependencies: async () => ({ operations }) as never, log: () => {},
    });

    await conductor.run();

    expect(ready).not.toHaveBeenCalled();
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(`project-owned region restore failed for ${owner}: guarded edit refused`);
  });

  it.each([
    { name: 'interactive', mode: 'interactive' as const, daemon: false },
    { name: 'default foreground', mode: 'default' as const, daemon: false },
  ])('does not write a synthetic validation key for a successful serial member in %s mode', async ({ mode, daemon }) => {
    const persisted = await readState(statePath);
    if (!persisted.ok) throw persisted.error;
    await writeState(statePath, {
      ...persisted.value,
      prd_audit: 'pending',
      validation__manual_test: 'done',
    } as ConductState);

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'prd_audit',
      mode,
      daemon,
      verifyArtifacts: false,
    }).run();

    const after = await readState(statePath);
    if (!after.ok) throw after.error;
    expect(after.value.prd_audit).toBe('done');
    expect((after.value as Record<string, unknown>).validation__prd_audit).toBeUndefined();
  });

  it('lets a mocked daemon FINISH use its runner result without synthetic validator evidence', async () => {
    const advance = vi.fn(async () => ({ kind: 'complete' } as const));
    await new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance },
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
    }).run();

    expect(advance).toHaveBeenCalledOnce();
    await expectNoSyntheticFinishEvidence(dir);
    expect(asBuiltVerdictStore.persistAsBuiltVerdict).not.toHaveBeenCalled();
    expect(gateVerdicts.writeVerdict).not.toHaveBeenCalledWith(
      dir,
      expect.stringMatching(/^(manual_test|prd_audit|architecture_review_as_built)$/),
      expect.anything(),
    );
  });

  it.each([
    {
      name: 'validator evidence',
      write: async () => {
        await mkdir(join(dir, '.pipeline'), { recursive: true });
        await writePrdAuditFixture(dir, 'synthetic-finish-evidence');
      },
    },
    {
      name: 'as-built evidence',
      write: async () => {
        await persistAsBuiltVerdict(dir, {
          version: 'v1',
          verdict: 'APPROVED',
          reachability: [],
          driftNotes: [],
        }, {
          attemptId: 'synthetic-finish-evidence',
          codeStamp: null,
          policy: AS_BUILT_FIXTURE_POLICY,
        });
      },
    },
  ])('rejects a FINISH coordinator variant that writes synthetic $name before advancing', async ({ write }) => {
    const advance = vi.fn(async () => {
      await write();
      return { kind: 'complete' } as const;
    });

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance },
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
    }).run();

    expect(advance).toHaveBeenCalledOnce();
    await expect(expectNoSyntheticFinishEvidence(dir)).rejects.toThrow();
  });

  it('does not write a synthetic validation key for an auto serial member without a retained sibling', async () => {
    await writeGreenShipValidatorEvidence(dir);
    const persisted = await readState(statePath);
    if (!persisted.ok) throw persisted.error;
    await writeState(statePath, { ...persisted.value, prd_audit: 'pending' });

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'prd_audit',
      mode: 'auto',
      daemon: false,
      verifyArtifacts: false,
    }).run();

    const after = await readState(statePath);
    if (!after.ok) throw after.error;
    expect(after.value.prd_audit).toBe('done');
    expect(Object.keys(after.value).filter((key) => key.startsWith('validation__'))).toEqual([]);
  });

  it.each([
    { name: 'interactive', mode: 'interactive' as const, daemon: false },
    { name: 'default foreground', mode: 'default' as const, daemon: false },
    { name: 'foreground auto', mode: 'auto' as const, daemon: false },
  ])('starts at FINISH and lets the coordinator bound %s judgment dispatches', async ({ mode, daemon }) => {
    const calls: StepName[] = [];
    const dispositions: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('finish_publication_disposition', (event) => {
      if (event.type === 'finish_publication_disposition') dispositions.push(event.disposition);
    });
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        calls.push(step);
        return { success: true };
      }),
    };
    const coordinator = {
      advance: vi.fn(async ({ dispatchJudgment }) => {
        if (mode !== 'default') await dispatchJudgment({
          kind: 'finish_pr_prose_quality',
          pullRequestUrl: 'https://example.test/pr/17',
          qualityScope: ['title', 'body'],
          maximumPasses: 1,
        });
        return { kind: 'complete' } as const;
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      finishPublication: coordinator,
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode,
      daemon,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    expect(coordinator.advance).toHaveBeenCalledOnce();
    expect(calls).toEqual(mode === 'default' ? [] : ['finish']);
    expect(dispositions).toEqual(['complete']);
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps the FINISH fence disabled for a non-daemon mocked dispatch even with non-green evidence', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'manual-test-results.md'),
      '# Manual Test Results\n\n| Story | Result |\n|---|---|\n| Story 1 | FAIL |\n',
    );
    const events = new ConductorEventEmitter();
    const kickbacks: Array<{ from: StepName; to: StepName }> = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
    });
    const advance = vi.fn(async () => ({ kind: 'complete' } as const));

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance },
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      daemon: false,
      verifyArtifacts: false,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    }).run();

    expect(advance).toHaveBeenCalledOnce();
    expect(kickbacks).toEqual([]);
  });

  it('keeps a done manual_test with FAIL rows non-green before the coordinator can publish', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeGreenShipValidatorEvidence(dir);
    await writeFile(
      join(dir, '.pipeline', 'manual-test-results.md'),
      '# Manual Test Results\n\n## Attempt 1\n\n| Story | Result |\n|---|---|\n| Story 1 | FAIL |\n',
    );
    const persisted = await readState(statePath);
    if (!persisted.ok) throw new Error('test fixture state must be readable');
    await writeState(statePath, {
      ...persisted.value,
      complexity_tier: 'M',
      architecture_review: 'skipped',
      manual_test: 'done',
    });
    const events = new ConductorEventEmitter();
    const kickbacks: Array<{ from: StepName; to: StepName }> = [];
    const gateVerdicts: Array<{ step: StepName; reason?: string }> = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
    });
    events.on('gate_verdict', (event) => {
      if (event.type === 'gate_verdict') gateVerdicts.push({ step: event.step, reason: event.reason });
    });
    const advance = vi.fn(async () => ({ kind: 'complete' } as const));
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'manual_test') throw ROUTED_SENTINEL;
        return { success: true };
      }),
    };

    await new Conductor({
      stateFilePath: statePath, stepRunner: runner, finishPublication: { advance }, events,
      projectRoot: dir, fromStep: 'finish', mode: 'auto', daemon: true, verifyArtifacts: true,
      git: async () => ({ stdout: '' }), gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    }).run();

    expect(advance).not.toHaveBeenCalled();
    expect(runner.run).toHaveBeenCalledWith('manual_test', expect.anything(), expect.anything());
    expect(kickbacks).toEqual([{ from: 'finish', to: 'manual_test' }]);
    expect(gateVerdicts).toEqual([{
      step: 'manual_test',
      reason: 'manual test evidence contains FAIL rows',
    }]);
  });

  it('blocks publication when a retained done prd_audit has an unsatisfied on-disk verdict', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeGreenShipValidatorEvidence(dir);
    await writeFile(
      join(dir, '.pipeline', 'manual-test-results.md'),
      '# Manual Test Results\n\n| Story | Result |\n|---|---|\n| Story 1 | PASS |\n',
    );
    // This is the retained member's on-disk gate evidence. FINISH must
    // re-evaluate it rather than trusting its `done` status.
    await writePrdAuditFixture(dir, 'retained-blocked-verdict', 'PLAN_GAP');
    const persisted = await readState(statePath);
    if (!persisted.ok) throw new Error('test fixture state must be readable');
    await writeState(statePath, {
      ...persisted.value,
      complexity_tier: 'M', architecture_review: 'skipped',
      manual_test: 'done', prd_audit: 'done', architecture_review_as_built: 'done',
      validation__prd_audit: 'done',
    } as ConductState);
    const advance = vi.fn(async () => ({ kind: 'complete' } as const));
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async (step) => {
        if (step === 'prd_audit') throw ROUTED_SENTINEL;
        return { success: true };
      }) },
      finishPublication: { advance }, events: new ConductorEventEmitter(), projectRoot: dir, fromStep: 'finish', mode: 'auto', daemon: true,
      verifyArtifacts: true, git: async () => ({ stdout: '' }), gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    });
    const finishFence = conductor as unknown as {
      nonGreenFinishValidators(state: ConductState): Promise<Array<{ name: StepName }>>;
    };
    const state = await readState(statePath);
    if (!state.ok) throw new Error('test fixture state must be readable');
    await expect(finishFence.nonGreenFinishValidators(state.value)).resolves.toEqual([
      expect.objectContaining({ name: 'prd_audit' }),
    ]);
    await conductor.run();
    expect(advance).not.toHaveBeenCalled();
  });

  it('retries a FINISH-fence recheck and publishes only after it writes passing evidence', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeGreenShipValidatorEvidence(dir);
    await writeFile(
      join(dir, '.pipeline', 'manual-test-results.md'),
      '# Manual Test Results\n\n## Attempt 1\n\n| Story | Result |\n|---|---|\n| Story 1 | PASS |\n',
    );
    await writeFile(join(dir, '.pipeline', 'manual-test-fail-evidence.json'), JSON.stringify({ codeStamp: 'baseline' }));
    await writePrdAuditFixture(dir, 'fixture-run', 'PASS', 'baseline');
    await writeFile(join(dir, '.pipeline', 'architecture-review-as-built-code-stamp.json'), JSON.stringify({ codeStamp: 'baseline' }));
    // The FINISH fence must distrust this retained member's stale evidence.
    await writePrdAuditFixture(dir, 'retained-blocked-verdict', 'PLAN_GAP');
    const persisted = await readState(statePath);
    if (!persisted.ok) throw new Error('test fixture state must be readable');
    await writeState(statePath, {
      ...persisted.value,
      complexity_tier: 'M', architecture_review: 'skipped',
      session_started_at: Date.now() - 60_000,
      coverage_binding: 'done',
      manual_test: 'skipped', prd_audit: 'done', architecture_review_as_built: 'done',
      validation__prd_audit: 'done',
      validation__architecture_review_as_built: 'done',
    } as ConductState);

    const calls: StepName[] = [];
    const advance = vi.fn(async () => {
      expect(calls.filter((step) => step === 'prd_audit')).toHaveLength(2);
      await expect(readFile(join(dir, '.pipeline', 'prd-audit.md'), 'utf8')).resolves.not.toContain('BLOCKED');
      return { kind: 'complete' } as const;
    });
    const runner: StepRunner = {
      run: vi.fn(async (step, _state, options) => {
        calls.push(step);
        if (step === 'prd_audit' && calls.length === 1) throw new Error('transient validator crash');
        if (step === 'prd_audit') {
          await writeGreenShipValidatorEvidence(dir, options?.runId);
          await writeFile(
            join(dir, '.pipeline', 'prd-audit-code-stamp.json'),
            JSON.stringify({ runId: options?.runId }),
          );
        }
        return { success: true };
      }),
    };

    await new Conductor({
      stateFilePath: statePath, stepRunner: runner, finishPublication: { advance },
      events: new ConductorEventEmitter(), projectRoot: dir, fromStep: 'finish',
      mode: 'auto', daemon: true, verifyArtifacts: true, maxRetries: 2,
      config: { steps: { manual_test: { disable: true } } },
      git: async () => ({ stdout: '' }), gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    }).run();

    expect(calls.filter((step) => step === 'prd_audit')).toEqual(['prd_audit', 'prd_audit']);
    expect(calls).not.toContain('manual_test');
    expect(advance).toHaveBeenCalled();
    const after = await readState(statePath);
    expect(after.ok && [
      after.value.prd_audit, after.value.architecture_review_as_built,
      (after.value as Record<string, unknown>).validation__prd_audit,
      (after.value as Record<string, unknown>).validation__architecture_review_as_built,
    ]).toEqual(['done', 'done', 'done', 'done']);
  });

  it('routes a changed-only lap PASS back through one aggregate test_suite run before publishing', async () => {
    await writeGreenShipValidatorEvidence(dir);
    const persisted = await readState(statePath);
    if (!persisted.ok) throw new Error('test fixture state must be readable');
    await writeState(statePath, {
      ...persisted.value,
      complexity_tier: 'M', architecture_review: 'skipped',
      session_started_at: Date.now() - 60_000,
      coverage_binding: 'done',
      manual_test: 'skipped',
      validation__prd_audit: 'done',
      validation__architecture_review_as_built: 'done',
    } as ConductState);

    const order: string[] = [];
    let aggregateRan = false;
    const fullSuiteVerifier = {
      inspect: vi.fn(async (options?: { requireAggregate?: boolean }) =>
        options?.requireAggregate === true && !aggregateRan
          ? { status: 'STALE' as const, reason: 'aggregate_required' as const }
          : { status: 'CURRENT' as const, evidence: PASS_EVIDENCE }),
      ensure: vi.fn(async (_inspection?: unknown, options?: { requireAggregate?: boolean }) => {
        order.push(`ensure:${options?.requireAggregate === true ? 'aggregate' : 'lap'}`);
        if (options?.requireAggregate === true) aggregateRan = true;
        return {
          status: 'EXECUTED' as const,
          freshness: { status: 'STALE' as const, reason: 'aggregate_required' as const },
          evidence: PASS_EVIDENCE,
        };
      }),
    };
    const advance = vi.fn(async () => {
      order.push('publish');
      return { kind: 'complete' } as const;
    });

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance },
      events: new ConductorEventEmitter(), projectRoot: dir, fromStep: 'finish',
      mode: 'auto', daemon: true, verifyArtifacts: true,
      config: {
        steps: { manual_test: { disable: true } },
        test_suite: {
          command: 'npm test',
          changed_command: 'npm test -- --changed {base}',
          verification: { mode: 'changed', drift_budget: {} as never },
        },
      },
      fullSuiteVerifier: fullSuiteVerifier as never,
      git: async () => ({ stdout: '' }), gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    }).run();

    // One aggregate run, strictly before the first publication attempt.
    expect(order.filter((entry) => entry.startsWith('ensure:'))).toEqual(['ensure:aggregate']);
    expect(order.slice(0, 2)).toEqual(['ensure:aggregate', 'publish']);
  });

  it('halts after the configured FINISH-fence recheck budget and never publishes', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeGreenShipValidatorEvidence(dir);
    await writeFile(
      join(dir, '.pipeline', 'manual-test-results.md'),
      '# Manual Test Results\n\n## Attempt 1\n\n| Story | Result |\n|---|---|\n| Story 1 | PASS |\n',
    );
    await writeFile(join(dir, '.pipeline', 'manual-test-fail-evidence.json'), JSON.stringify({ codeStamp: 'baseline' }));
    await writePrdAuditFixture(dir, 'fixture-run', 'PASS', 'baseline');
    await writeFile(join(dir, '.pipeline', 'architecture-review-as-built-code-stamp.json'), JSON.stringify({ codeStamp: 'baseline' }));
    await writePrdAuditFixture(dir, 'retained-blocked-verdict', 'PLAN_GAP');
    const persisted = await readState(statePath);
    if (!persisted.ok) throw new Error('test fixture state must be readable');
    await writeState(statePath, {
      ...persisted.value,
      complexity_tier: 'M', architecture_review: 'skipped',
      session_started_at: Date.now() - 60_000,
      coverage_binding: 'done',
      manual_test: 'skipped', prd_audit: 'done', architecture_review_as_built: 'done',
      validation__prd_audit: 'done',
      validation__architecture_review_as_built: 'done',
    } as ConductState);

    const advance = vi.fn(async () => ({ kind: 'complete' } as const));
    const runnerRun = vi.fn<StepRunner['run']>(async () => { throw new Error('validator remains down'); });
    const runner: StepRunner = { run: runnerRun };
    await new Conductor({
      stateFilePath: statePath, stepRunner: runner, finishPublication: { advance },
      events: new ConductorEventEmitter(), projectRoot: dir, fromStep: 'finish',
      mode: 'auto', daemon: true, verifyArtifacts: true, maxRetries: 2,
      config: { steps: { manual_test: { disable: true } } },
      git: async () => ({ stdout: '' }), gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    }).run();

    expect(runnerRun.mock.calls.filter(([step]) => step === 'prd_audit')).toHaveLength(2);
    expect(advance).not.toHaveBeenCalled();
    await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('validator remains down');
  });

  it('redirects several non-green validators to the earliest one without demoting a green sibling', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'manual-test-results.md'),
      '# Manual Test Results\n\n## Attempt 1\n\n| Story | Result |\n|---|---|\n| Story 1 | PASS |\n',
    );
    const persisted = await readState(statePath);
    if (!persisted.ok) throw new Error('test fixture state must be readable');
    await writeState(statePath, {
      ...persisted.value,
      complexity_tier: 'M', track: 'product', architecture_review: 'done',
      manual_test: 'stale', prd_audit: 'stale', architecture_review_as_built: 'done',
    });
    await persistAsBuiltVerdict(dir, {
      version: 'v1',
      verdict: 'APPROVED',
      reachability: [],
      driftNotes: [],
    }, {
      attemptId: 'fixture-run',
      codeStamp: null,
      policy: AS_BUILT_FIXTURE_POLICY,
    });
    const architectureEvidence = join(dir, '.pipeline', 'architecture-review-as-built.md');
    const freshMtime = new Date(Date.now() + 5_000);
    await utimes(architectureEvidence, freshMtime, freshMtime);
    await writeVerdict(dir, 'architecture_review_as_built', { satisfied: true, checkedAt: 1 });
    const events = new ConductorEventEmitter();
    const kickbacks: Array<{ from: StepName; to: StepName }> = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
    });
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'prd_audit') throw ROUTED_SENTINEL;
        return { success: true };
      }),
    };
    const advance = vi.fn(async () => ({ kind: 'complete' } as const));

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      finishPublication: { advance },
      events,
      projectRoot: dir, fromStep: 'finish', mode: 'auto', daemon: true, verifyArtifacts: true,
      git: async () => ({ stdout: '' }), gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    }).run();

    const after = await readState(statePath);
    const verdicts = await readAllVerdicts(dir);
    expect(advance).not.toHaveBeenCalled();
    expect(kickbacks).toEqual([{ from: 'finish', to: 'manual_test' }]);
    expect(runner.run).toHaveBeenCalledWith('manual_test', expect.anything(), expect.anything());
    expect(after.ok && after.value.finish).not.toBe('in_progress');
    expect(after.ok && after.value.architecture_review_as_built).toBe('done');
    expect(verdicts.architecture_review_as_built).toMatchObject({ satisfied: true });
    await expect(readFile(join(dir, '.pipeline', 'architecture-review-as-built.md'), 'utf8')).resolves.toContain('APPROVED');
  });

  it('preserves green validator evidence across repeated docs-only FINISH laps without rerunning test_suite', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeGreenShipValidatorEvidence(dir);
    await writeFile(
      join(dir, '.pipeline', 'manual-test-results.md'),
      '# Manual Test Results\n\n## Attempt 1 — 2026-08-16T00:00:00Z\n\n| Story | Result |\n|---|---|\n| Story 1 | PASS |\n',
    );
    await writeFile(join(dir, '.pipeline', 'manual-test-fail-evidence.json'), JSON.stringify({ codeStamp: 'baseline' }));
    const persisted = await readState(statePath);
    if (!persisted.ok) throw new Error('test fixture state must be readable');
    await writePrdAuditFixture(dir, 'fixture-run', 'PASS', 'baseline');
    await utimes(join(dir, '.pipeline', 'prd-audit.json'), new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
    await writeFile(join(dir, '.pipeline', 'architecture-review-as-built-code-stamp.json'), JSON.stringify({ codeStamp: 'baseline' }));
    await writeState(statePath, {
      ...persisted.value,
      complexity_tier: 'M',
      track: 'technical',
      architecture_review: 'skipped',
      manual_test: 'done',
      prd_audit: 'done',
      architecture_review_as_built: 'done',
    });
    for (const step of ['manual_test', 'prd_audit', 'architecture_review_as_built'] as const) {
      await writeVerdict(dir, step, { satisfied: true, checkedAt: Date.now() });
    }
    const ensure = vi.fn(async () => ({ status: 'REUSED' as const, evidence: PASS_EVIDENCE }));
    const inspect = vi.fn(async () => ({ status: 'CURRENT' as const, evidence: PASS_EVIDENCE }));
    const kickbacks: Array<{ from: StepName; to: StepName }> = [];
    const events = new ConductorEventEmitter();
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
    });
    const runnerRun = vi.fn(async (step: StepName) => {
      if (step === 'finish') {
        return { success: true };
      }
      if (step === 'manual_test') throw ROUTED_SENTINEL;
      return { success: true };
    });
    const runner: StepRunner = {
      run: runnerRun,
    };
    const finishPublication = {
      advance: vi.fn(async ({ dispatchJudgment }) => {
        await dispatchJudgment({
          kind: 'finish_pr_prose_quality',
          pullRequestUrl: 'https://example.test/pr/17',
          qualityScope: ['title', 'body'],
          maximumPasses: 1,
        });
        return { kind: 'complete' } as const;
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      finishPublication,
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      daemon: true,
      verifyArtifacts: true,
      fullSuiteVerifier: { ensure, inspect },
      git: async (args) => ({
        stdout: args[0] === 'diff' ? 'docs/notes.md\n' : '',
        exitCode: 0,
      }),
      gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    });

    const firstLapState = await readState(statePath);
    if (!firstLapState.ok) throw new Error('test fixture state must be readable');
    const finishFence = conductor as unknown as {
      nonGreenFinishValidators(state: ConductState): Promise<unknown[]>;
      runFinishPublication(state: ConductState, options: never): Promise<{ success: boolean }>;
    };
    const firstLap = await finishFence.nonGreenFinishValidators(firstLapState.value);
    const firstFinish = await finishFence.runFinishPublication(firstLapState.value, {} as never);
    const secondLapState = await readState(statePath);
    if (!secondLapState.ok) throw new Error('test fixture state must be readable');
    const secondLap = await finishFence.nonGreenFinishValidators(secondLapState.value);
    const secondFinish = await finishFence.runFinishPublication(secondLapState.value, {} as never);

    await writeFile(
      join(dir, '.pipeline', 'manual-test-results.md'),
      '# Manual Test Results\n\n## Attempt 2 — 2026-08-16T00:00:00Z\n\n| Story | Result |\n|---|---|\n| Story 1 | FAIL |\n',
    );
    const failedLapState = await readState(statePath);
    if (!failedLapState.ok) throw new Error('test fixture state must be readable');
    const failedLap = await finishFence.nonGreenFinishValidators(failedLapState.value);
    await conductor.run();

    const verdicts = await readAllVerdicts(dir);
    const after = await readState(statePath);
    expect(firstLap).toEqual([]);
    expect(secondLap).toEqual([]);
    expect(failedLap).toEqual([expect.objectContaining({
      name: 'manual_test',
      reason: 'manual test evidence contains FAIL rows',
    })]);
    expect(firstFinish.success).toBe(true);
    expect(secondFinish.success).toBe(true);
    expect(runnerRun.mock.calls.map(([step]) => step)).toEqual(['finish', 'finish', 'manual_test']);
    expect(finishPublication.advance).toHaveBeenCalledTimes(2);
    expect(ensure).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(after.ok && [after.value.manual_test, after.value.prd_audit, after.value.architecture_review_as_built]).toEqual(['in_progress', 'done', 'done']);
    expect(verdicts.manual_test).toMatchObject({ satisfied: false });
    expect(verdicts.prd_audit).toMatchObject({ satisfied: true });
    expect(verdicts.architecture_review_as_built).toMatchObject({ satisfied: true });
    expect(kickbacks).toEqual([{ from: 'finish', to: 'manual_test' }]);
  });

  it('treats malformed validator evidence as non-green without deleting prior evidence', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const evidencePath = join(dir, '.pipeline', 'manual-test-results.md');
    await writeFile(evidencePath, '# Manual Test Results\n\n| Story | Result |\n|---|---|\n| Story 1 | MAYBE |\n');
    const persisted = await readState(statePath);
    if (!persisted.ok) throw new Error('test fixture state must be readable');
    await writeState(statePath, {
      ...persisted.value,
      complexity_tier: 'M', architecture_review: 'skipped', manual_test: 'done',
    });
    const events = new ConductorEventEmitter();
    const kickbacks: Array<{ from: StepName; to: StepName }> = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
    });
    const advance = vi.fn(async () => ({ kind: 'complete' } as const));
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'manual_test') throw ROUTED_SENTINEL;
        return { success: true };
      }),
    };

    await new Conductor({
      stateFilePath: statePath, stepRunner: runner, finishPublication: { advance }, events,
      projectRoot: dir, fromStep: 'finish', mode: 'auto', daemon: true, verifyArtifacts: true,
      git: async () => ({ stdout: '' }), gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    }).run();

    expect(advance).not.toHaveBeenCalled();
    expect(kickbacks).toEqual([{ from: 'finish', to: 'manual_test' }]);
    await expect(readFile(evidencePath, 'utf8')).resolves.toContain('MAYBE');
    const verdict = await readAllVerdicts(dir);
    expect(verdict.manual_test).toMatchObject({ satisfied: false });
  });

  it('retries a publication-only result at FINISH without dispatching BUILD or remediation', async () => {
    const calls: Array<{ step: StepName; retryReason?: string }> = [];
    const dispositions: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('finish_publication_disposition', (event) => {
      if (event.type === 'finish_publication_disposition') dispositions.push(event.disposition);
    });
    const runner: StepRunner = {
      run: vi.fn(async (step, _state, options) => {
        calls.push({ step, retryReason: options?.retryReason });
        if (calls.length > 1) throw ROUTED_SENTINEL;
        return {
          success: false,
          publicationDisposition: {
            kind: 'publication_retry',
            transition: 'ready_pr',
            reason: 'presentation_repair_failed',
          },
        };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 2,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    expect(calls.map(({ step }) => step)).toEqual(['finish', 'finish']);
    expect(calls.map(({ step }) => step)).not.toContain('build');
    expect(calls.map(({ step }) => step)).not.toContain('remediate');
    expect(dispositions).toEqual(['retry_finish']);
    expect(calls[1]?.retryReason).toContain('Retry only the incomplete publication transition.');
    expect(calls[1]?.retryReason).toContain('presentation_repair_failed');
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
      ROUTED_SENTINEL.message,
    );
  });

  it('re-enters FINISH after verified publication progress without charging a retry', async () => {
    const stepRetries: StepName[] = [];
    const events = new ConductorEventEmitter();
    events.on('step_retry', (event) => {
      if (event.type === 'step_retry') stepRetries.push(event.step);
    });
    const advance = vi.fn()
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'ready_pr' } as const)
      .mockResolvedValueOnce({ kind: 'complete' } as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance },
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      maxRetries: 1,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    const state = await readState(statePath);
    expect({
      finish: state.ok ? state.value.finish : undefined,
      publicationAdvances: advance.mock.calls.length,
      stepRetries,
    }).toEqual({
      finish: 'done',
      publicationAdvances: 2,
      stepRetries: [],
    });
  });

  it('keeps the full retry allowance after five publication advances', async () => {
    const stepRetries: StepName[] = [];
    const events = new ConductorEventEmitter();
    events.on('step_retry', (event) => {
      if (event.type === 'step_retry') stepRetries.push(event.step);
    });
    const advance = vi.fn()
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'establish_pr' } as const)
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'write_shipped_record' } as const)
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'judge_pr_prose' } as const)
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'ready_pr' } as const)
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'record_outcome' } as const)
      .mockResolvedValueOnce({ kind: 'complete' } as const);
    const progressConductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance },
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      maxRetries: 3,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });

    await progressConductor.run();

    expect(advance).toHaveBeenCalledTimes(6);
    // Task 4's progress route must remain silent; this test's five advances
    // must not be indistinguishable from charged retry events.
    expect(stepRetries).toEqual([]);

    const retryCalls: StepName[] = [];
    const retryConductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: {
        run: vi.fn(async (step) => {
          retryCalls.push(step);
          return {
            success: false,
            publicationDisposition: {
              kind: 'publication_retry',
              transition: 'ready_pr',
              reason: 'presentation_repair_failed',
            },
          };
        }),
      },
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 3,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await retryConductor.run();

    expect(retryCalls).toEqual(['finish', 'finish', 'finish']);
    expect(stepRetries).toEqual(['finish', 'finish']);
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
      'FINISH publication retry exhausted: presentation_repair_failed',
    );
  });

  it.each([
    {
      name: 'repeated ready_pr progress',
      transitions: ['ready_pr'] as const,
      lastTransition: 'ready_pr',
    },
    {
      name: 'alternating publication progress',
      transitions: ['establish_pr', 'ready_pr'] as const,
      lastTransition: 'ready_pr',
    },
  ])('halts %s at the fourteen-transition allowance', async ({ transitions, lastTransition }) => {
    const advance = vi.fn(async () => {
      // The sentinel bounds the pre-fix infinite loop. A correct implementation
      // halts after the fourteenth verified transition and never reaches it
      // (two passes over each of the seven publication transitions).
      if (advance.mock.calls.length > 14) throw ROUTED_SENTINEL;
      return {
        kind: 'publication_progress',
        transition: transitions[(advance.mock.calls.length - 1) % transitions.length],
      } as const;
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance },
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    expect({
      publicationAdvances: advance.mock.calls.length,
      halt: await readFile(join(dir, '.pipeline/HALT'), 'utf8').catch(() => ''),
      haltClass: await readFile(join(dir, '.pipeline/HALT.class'), 'utf8').catch(() => ''),
    }).toEqual({
      publicationAdvances: 14,
      halt: expect.stringContaining(lastTransition),
      haltClass: 'needs-human',
    });
  });

  it('halts on the FIRST attempt for a non-retryable publication reason, without spending the budget', async () => {
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        calls.push(step);
        return {
          success: false,
          publicationDisposition: {
            kind: 'publication_retry',
            transition: 'establish_pr',
            // The remote carries work this checkout never observed. Re-running
            // the identical transition pushes the identical lease against the
            // identical remote-tracking ref, so every further attempt is
            // guaranteed to reach this same halt ~9s later.
            reason: 'draft_pr_lease-rejected',
          },
        };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 6,
      events: new ConductorEventEmitter(),
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    expect(calls).toEqual(['finish']);
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf8');
    expect(halt).toContain('draft_pr_lease-rejected');
    expect(halt).toContain('not retryable');
    // Distinguishable from the exhausted-budget halt: the operator must not be
    // left wondering whether six attempts were spent.
    expect(halt).not.toContain('retry exhausted');
  });

  it('still spends the full retry budget for a transient publication reason', async () => {
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        calls.push(step);
        return {
          success: false,
          publicationDisposition: {
            kind: 'publication_retry',
            transition: 'ready_pr',
            // A GitHub call that failed once can succeed on the next attempt.
            reason: 'presentation_repair_failed',
          },
        };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 3,
      events: new ConductorEventEmitter(),
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    expect(calls).toEqual(['finish', 'finish', 'finish']);
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
      'FINISH publication retry exhausted: presentation_repair_failed',
    );
  });

  it('routes a production accepted judgment through FINISH progress without a needs-human HALT', async () => {
    const pipeline = join(dir, '.pipeline');
    const productionStatePath = join(pipeline, 'conduct-state.json');
    const prUrl = 'https://github.com/acme/repo/pull/17';
    let pullRequest = {
      url: prUrl,
      title: 'feat: draft publication',
      body: '<!-- conductor:pr-body-floor -->\n\nDraft opened automatically.',
      isDraft: true,
    };
    await mkdir(pipeline);
    await writeGreenShipValidatorEvidence(dir);
    await mkdir(join(dir, '.docs', 'shipped'), { recursive: true });
    await writeFile(join(dir, '.docs', 'shipped', 'finish-publication.md'), '---\nslug: finish-publication\n---\n');
    const state: Record<string, unknown> = {
      complexity_tier: 'S',
      // This focused coordinator fixture has no product or architecture
      // evidence. Declare its real SHIP membership instead of leaving the
      // daemon fence to redispatch absent validators forever.
      track: 'technical',
      feature_desc: 'finish-publication',
      worktree_branch: 'feat/finish-publication',
      pr_url: prUrl,
    };
    for (const step of [
      'bootstrap', 'memory', 'assess', 'explore', 'prd', 'complexity', 'stories',
      'conflict_check', 'plan', 'coherence_check', 'architecture_diagram',
      'worktree', 'acceptance_specs', 'build', 'build_review',
      'test_suite', 'manual_test', 'prd_audit',
      'architecture_review_as_built', 'rebase',
    ] satisfies StepName[]) state[step] = 'done';
    // The as-built review now runs even without an upstream DECIDE review.
    state.architecture_review = 'skipped';
    await writeState(productionStatePath, state as ConductState);
    const runner: StepRunner = {
      run: vi.fn(async () => {
        pullRequest = {
          ...pullRequest,
          title: 'feat: publish coherent finish',
          body: 'Reader-facing summary of the completed change.',
        };
        return { success: true, publicationDisposition: { kind: 'accepted' } };
      }),
    };
    const events = new ConductorEventEmitter();
    const dispositions: string[] = [];
    events.on('finish_publication_disposition', (event) => {
      if (event.type === 'finish_publication_disposition') dispositions.push(event.disposition);
    });
    const coordinator = createProductionFinishPublicationCoordinator({
      projectRoot: dir,
      stateFilePath: productionStatePath,
      baseBranch: 'main',
      git: async (args) => args[0] === 'rev-parse'
        ? { stdout: 'refs/remotes/origin/feat/finish-publication\n' }
        : { stdout: '' },
      gh: async (args) => {
        if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify(pullRequest) };
        if (args[0] === 'pr' && args[1] === 'edit') {
          pullRequest = { ...pullRequest, body: args[args.indexOf('--body') + 1]! };
          return { stdout: '' };
        }
        if (args[0] === 'pr' && args[1] === 'ready') {
          pullRequest.isDraft = false;
          return { stdout: '' };
        }
        throw new Error(`unexpected gh command: ${args.join(' ')}`);
      },
      operations: {
        run: async (request) => {
          if (request.operation === 'pull-request.ready') {
            pullRequest = { ...pullRequest, isDraft: false };
          }
          if (request.operation === 'pull-request.edit' && request.payload) {
            const payload = request.payload;
            pullRequest = {
              ...pullRequest,
              ...('title' in payload && typeof payload.title === 'string' ? { title: payload.title } : {}),
              ...('body' in payload && typeof payload.body === 'string' ? { body: payload.body } : {}),
            };
          }
          return {};
        },
      },
      observeReleaseReadiness: async () => 'present',
      recordFinish: async () => {
        await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
        return 0;
      },
    });
    const conductor = new Conductor({
      stateFilePath: productionStatePath, stepRunner: runner, finishPublication: coordinator,
      events, projectRoot: dir, fromStep: 'finish', mode: 'auto', daemon: true,
      verifyArtifacts: false,
      git: async () => ({ stdout: '' }), gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    // Placeholder prose requires authoring. Its resulting retained-PR
    // title/body is accepted by the GitHub observation without another pass.
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(dispositions).not.toContain('retry_finish');
    expect(dispositions).not.toContain('human_required');
    await expect(readFile(join(pipeline, 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Regression: a small-tier feature resolves manual_test by SKIPPING it. The production
  // evidence observers compared those statuses to 'done' alone, so a skip read
  // as missing evidence, preflight raised `ship_evidence_invalid`, and the
  // router halted needs-human on a feature whose work was entirely green.
  it('treats a skipped manual-test step as resolved evidence rather than a missing-evidence HALT', async () => {
    const pipeline = join(dir, '.pipeline');
    const productionStatePath = join(pipeline, 'conduct-state.json');
    const prUrl = 'https://example.test/pr/18';
    let pullRequest = {
      url: prUrl,
      title: 'feat: draft publication',
      body: '<!-- conductor:pr-body-floor -->\n\nDraft opened automatically.',
      isDraft: true,
    };
    await mkdir(pipeline);
    await writeGreenShipValidatorEvidence(dir);
    await mkdir(join(dir, '.docs', 'shipped'), { recursive: true });
    await writeFile(join(dir, '.docs', 'shipped', 'finish-publication.md'), '---\nslug: finish-publication\n---\n');
    const state: Record<string, unknown> = {
      complexity_tier: 'S',
      track: 'technical',
      feature_desc: 'finish-publication',
      worktree_branch: 'feat/finish-publication',
      pr_url: prUrl,
    };
    for (const step of [
      'bootstrap', 'memory', 'assess', 'explore', 'prd', 'complexity', 'stories',
      'conflict_check', 'plan', 'coherence_check', 'architecture_diagram',
      'worktree', 'acceptance_specs', 'build', 'build_review',
      'test_suite', 'architecture_review_as_built', 'rebase',
    ] satisfies StepName[]) state[step] = 'done';
    // The as-built review runs independently of an upstream DECIDE review.
    state.architecture_review = 'skipped';
    // S-tier features legitimately skip manual testing; the other validators remain green.
    state.manual_test = 'skipped';
    await writeState(productionStatePath, state as ConductState);
    const runner: StepRunner = {
      run: vi.fn(async () => {
        pullRequest = {
          ...pullRequest,
          title: 'feat: publish coherent finish',
          body: 'Reader-facing summary of the completed change.',
        };
        return { success: true, publicationDisposition: { kind: 'accepted' } };
      }),
    };
    const events = new ConductorEventEmitter();
    const dispositions: string[] = [];
    events.on('finish_publication_disposition', (event) => {
      if (event.type === 'finish_publication_disposition') dispositions.push(event.disposition);
    });
    const coordinator = createProductionFinishPublicationCoordinator({
      projectRoot: dir,
      stateFilePath: productionStatePath,
      baseBranch: 'main',
      git: async (args) => args[0] === 'rev-parse'
        ? { stdout: 'refs/remotes/origin/feat/finish-publication\n' }
        : { stdout: '' },
      gh: async (args) => {
        if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify(pullRequest) };
        if (args[0] === 'pr' && args[1] === 'edit') {
          pullRequest = { ...pullRequest, body: args[args.indexOf('--body') + 1]! };
          return { stdout: '' };
        }
        if (args[0] === 'pr' && args[1] === 'ready') {
          pullRequest.isDraft = false;
          return { stdout: '' };
        }
        throw new Error(`unexpected gh command: ${args.join(' ')}`);
      },
      observeReleaseReadiness: async () => 'present',
      recordFinish: async () => {
        await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
        return 0;
      },
    });
    const conductor = new Conductor({
      stateFilePath: productionStatePath, stepRunner: runner, finishPublication: coordinator,
      events, projectRoot: dir, fromStep: 'finish', mode: 'auto', daemon: true,
      verifyArtifacts: false,
      git: async () => ({ stdout: '' }), gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    expect(dispositions).not.toContain('human_required');
    // No HALT at all is the expected outcome; `?? ''` keeps the assertion
    // reporting the offending reason when one IS written.
    const halt = await readFile(join(pipeline, 'HALT'), 'utf8').catch(() => '');
    expect(halt).not.toContain('ship_evidence_invalid');
  });

  it.each([
    [
      'a cited implementation defect',
      'build-review FAIL: src/engine/finish-publication.ts:497 returns an invalid implementation proof',
    ],
    [
      'a stale BUILD proof',
      'stale BUILD proof: .pipeline/gates/build.json predates the current HEAD',
    ],
  ])('routes %s back to BUILD with its evidence', async (_caseName, evidence) => {
    const calls: Array<{ step: StepName; retryReason?: string }> = [];
    const kickbacks: Array<{ from: StepName; to: StepName; evidence?: string }> = [];
    const dispositions: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push(event);
    });
    events.on('finish_publication_disposition', (event) => {
      if (event.type === 'finish_publication_disposition') dispositions.push(event.disposition);
    });
    const runner: StepRunner = {
      run: vi.fn(async (step, _state, options) => {
        calls.push({ step, retryReason: options?.retryReason });
        if (step === 'build') throw ROUTED_SENTINEL;
        return {
          success: false,
          publicationDisposition: {
            kind: 'implementation_invalid',
            evidence,
            unsatisfiedMembers: ['build_review'],
          },
        };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 2,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    expect(calls.map(({ step }) => step)).toEqual(['finish', 'build']);
    expect(calls[1]?.retryReason).toContain(evidence);
    const recordedEvidence = kickbacks.find((event) => event.from === 'finish' && event.to === 'build')?.evidence;
    expect(recordedEvidence).toContain(evidence);
    expect(calls.map(({ step }) => step)).not.toContain('remediate');
    expect(dispositions).toEqual(['retry_build']);
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
      ROUTED_SENTINEL.message,
    );
  });

  it.each([
    'implementation_evidence_invalid: Implementation evidence is invalid. Re-run the BUILD verification, then retry FINISH.',
    'rewritten implementation-evidence guidance that deliberately names no gate',
  ])('names the typed build-review member in the kickback and retry hint without parsing evidence text', async (evidence) => {
    const calls: Array<{ step: StepName; retryReason?: string }> = [];
    const kickbacks: Array<{ from: StepName; to: StepName; evidence?: string }> = [];
    const events = new ConductorEventEmitter();
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push(event);
    });
    const runner: StepRunner = {
      run: vi.fn(async (step, _state, options) => {
        calls.push({ step, retryReason: options?.retryReason });
        if (step === 'build') throw ROUTED_SENTINEL;
        return {
          success: false,
          publicationDisposition: {
            kind: 'implementation_invalid',
            evidence,
            unsatisfiedMembers: ['build_review'],
          },
        };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 2,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    const recordedEvidence = kickbacks.find((event) => event.from === 'finish' && event.to === 'build')?.evidence;
    const buildHint = calls.find(({ step }) => step === 'build')?.retryReason;
    expect(recordedEvidence).toContain('build_review');
    expect(buildHint).toContain('build_review');
  });

  it.each([
    ['failed', 'failed' as const],
    ['stale', 'stale' as const],
    ['missing', undefined],
  ])(
    'replays BUILD verification after implementation-invalid FINISH when prior verification state is %s',
    async (_caseName, priorStatus) => {
      const timeline: StepName[] = [];
      let verificationStatesAtBuild: Pick<ConductState, 'test_suite' | 'build_review'> | undefined;
      const ensure = vi.fn(async () => {
        timeline.push('test_suite');
        return {
          status: 'REUSED',
          evidence: PASS_EVIDENCE,
        } as const;
      });
      const runner: StepRunner = {
        run: vi.fn(async (step, state) => {
          timeline.push(step);
          if (step === 'build') {
            verificationStatesAtBuild = {
              test_suite: state.test_suite,
              build_review: state.build_review,
            };
          }
          if (step === 'finish') {
            return {
              success: false,
              publicationDisposition: {
                kind: 'implementation_invalid',
                evidence: 'implementation_evidence_invalid',
                unsatisfiedMembers: ['build_review'],
              },
            };
          }
          if (step === 'build_review') throw ROUTED_SENTINEL;
          return { success: true };
        }),
      };
      const persisted = await readState(statePath);
      if (!persisted.ok) throw new Error('test fixture state must be readable');
      const retryState = { ...persisted.value } as Record<string, unknown>;
      for (const step of ['test_suite', 'build_review']) {
        if (priorStatus === undefined) delete retryState[step];
        else retryState[step] = priorStatus;
      }
      await writeState(statePath, retryState as ConductState);

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events: new ConductorEventEmitter(),
        projectRoot: dir,
        fromStep: 'finish',
        mode: 'auto',
        maxRetries: 1,
        fullSuiteVerifier: {
          ensure,
          inspect: async () => ({ status: 'CURRENT', evidence: PASS_EVIDENCE } as const),
        },
        git: async () => ({ stdout: '' }),
        gh: async () => ({ stdout: '' }),
        runGh: async () => ({ stdout: '' }),
      });

      await conductor.run();

      expect(timeline).toEqual(['finish', 'build', 'test_suite', 'build_review']);
      expect(ensure).toHaveBeenCalledOnce();
      expect(verificationStatesAtBuild).toEqual({
        test_suite: 'stale',
        build_review: 'stale',
      });
      await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
        ROUTED_SENTINEL.message,
      );
    },
  );

  it('does not route a publication error without implementation evidence to BUILD', async () => {
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        calls.push(step);
        return {
          success: false,
          publicationDisposition: {
            kind: 'publication_retry',
            transition: 'ready_pr',
            reason: 'presentation_repair_failed',
          },
        };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 1,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    expect(calls).toEqual(['finish']);
    expect(calls).not.toContain('build');
    expect(calls).not.toContain('remediate');
  });

  it('halts a completed but non-advancing publication transition without spending FINISH budget', async () => {
    const stepRetries: StepName[] = [];
    const loopHalts: string[] = [];
    const dispositions: string[] = [];
    const publicationDispositions: AdvanceFinishPublicationResult[] = [];
    const events = new ConductorEventEmitter();
    events.on('step_retry', (event) => {
      if (event.type === 'step_retry') stepRetries.push(event.step);
    });
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') loopHalts.push(event.reason);
    });
    events.on('finish_publication_disposition', (event) => {
      if (event.type === 'finish_publication_disposition') dispositions.push(event.disposition);
    });
    const unchangedJudgmentSnapshot = {
      mode: 'daemon',
      intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
      implementationEvidence: 'valid',
      shipEvidence: 'valid',
      releaseReadiness: 'valid',
      branchPushed: 'valid',
      shippedRecord: 'valid',
      outcomeRecord: 'missing',
      pr: {
        identity: 'one',
        url: 'https://example.test/pr/27',
        prose: 'halt',
        ready: false,
      },
    } as const satisfies PublicationSnapshot;
    const advance = vi.fn(async (): Promise<PublicationDisposition> => {
      const disposition = await advanceFinishPublication({
        observe: async () => unchangedJudgmentSnapshot,
        effects: { dispatchJudgment: async () => ({ kind: 'accepted' }) },
      });
      publicationDispositions.push(disposition);
      return disposition.kind === 'advanced'
        ? { kind: 'publication_progress', transition: disposition.transition }
        : disposition;
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance },
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      maxRetries: 3,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    // A completed effect whose owned dimension remains unchanged is a terminal
    // human decision, not either a FINISH retry or a progress-loop tick.
    // These are Conductor-owned observations: a human-required disposition
    // terminates the FINISH retry loop before either counter can advance.
    expect(stepRetries).not.toContain('finish');
    expect(dispositions).toEqual(['human_required']);
    expect(publicationDispositions).toEqual([expect.objectContaining({ kind: 'human_required' })]);
    expect(loopHalts).toHaveLength(1);
    const state = await readState(statePath);
    expect(state.ok && state.value.finish).toBe('failed');
    await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).resolves.toBe('needs-human');
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.not.toContain(
      'judgment_dispatch_failed',
    );
  });

  it('halts an unselectable judgment retry without spending the Conductor FINISH attempt', async () => {
    const snapshot = {
      mode: 'daemon',
      intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
      implementationEvidence: 'valid',
      shipEvidence: 'valid',
      releaseReadiness: 'valid',
      branchPushed: 'valid',
      shippedRecord: 'valid',
      outcomeRecord: 'missing',
      pr: {
        identity: 'one',
        url: 'https://example.test/pr/unselectable',
        prose: 'stale',
        ready: false,
      },
    } as const satisfies PublicationSnapshot;
    const events = new ConductorEventEmitter();
    const retries: StepName[] = [];
    const dispositions: string[] = [];
    events.on('step_retry', (event) => {
      if (event.type === 'step_retry') retries.push(event.step);
    });
    events.on('finish_publication_disposition', (event) => {
      if (event.type === 'finish_publication_disposition') dispositions.push(event.disposition);
    });
    const advance = vi.fn(async (): Promise<PublicationDisposition> => {
      const result = await advanceFinishPublication({
        observe: async () => snapshot,
        effects: {
          dispatchJudgment: async () => ({
            kind: 'revision_required',
            reason: 'placeholder',
            detail: 'The title and body are placeholders.',
          }),
        },
      });
      return result.kind === 'advanced'
        ? { kind: 'publication_progress', transition: result.transition }
        : result;
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance },
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      maxRetries: 3,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    // The absence of a Conductor retry event is the observable proof that its
    // FINISH attempt budget remained intact; coordinator call counts are not
    // that counter.
    expect(retries).not.toContain('finish');
    expect(dispositions).toEqual(['human_required']);
    const state = await readState(statePath);
    expect(state.ok && state.value.finish).toBe('failed');
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
      'author_pr_prose retry cannot run',
    );
  });

  it('halts a newly halted judgment retry without spending the Conductor FINISH attempt', async () => {
    const initial = {
      mode: 'daemon',
      intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
      implementationEvidence: 'valid', shipEvidence: 'valid', releaseReadiness: 'valid',
      branchPushed: 'valid', shippedRecord: 'valid', outcomeRecord: 'missing',
      pr: { identity: 'one', url: 'https://example.test/pr/newly-halted', prose: 'stale', ready: false },
    } as const satisfies PublicationSnapshot;
    const newlyHalted = {
      ...initial,
      pr: { ...initial.pr, prose: 'halt' as const, halted: true as const },
    } as const satisfies PublicationSnapshot;
    const events = new ConductorEventEmitter();
    const retries: StepName[] = [];
    const dispositions: string[] = [];
    events.on('step_retry', (event) => {
      if (event.type === 'step_retry') retries.push(event.step);
    });
    events.on('finish_publication_disposition', (event) => {
      if (event.type === 'finish_publication_disposition') dispositions.push(event.disposition);
    });
    const advance = vi.fn(async (): Promise<PublicationDisposition> => {
      const observe = vi.fn<() => Promise<PublicationSnapshot>>()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(newlyHalted);
      const result = await advanceFinishPublication({
        observe,
        effects: { dispatchJudgment: async () => { throw new Error('response lost'); } },
      });
      return result.kind === 'advanced'
        ? { kind: 'publication_progress', transition: result.transition }
        : result;
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance }, events, projectRoot: dir, fromStep: 'finish',
      mode: 'default', maxRetries: 3,
      git: async () => ({ stdout: '' }), gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    expect(retries).not.toContain('finish');
    expect(dispositions).toEqual(['human_required']);
    expect(advance).toHaveBeenCalledTimes(1);
    const state = await readState(statePath);
    expect(state.ok && state.value.finish).toBe('failed');
  });

  it.each([
    { kind: 'complete', reason: 'contradictory' },
    { kind: 'unknown' },
  ])('halts unknown publication disposition without broad remediation', async (publicationDisposition) => {
    const calls: StepName[] = [];
    const dispositions: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('finish_publication_disposition', (event) => {
      if (event.type === 'finish_publication_disposition') dispositions.push(event.disposition);
    });
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        calls.push(step);
        return { success: false, publicationDisposition };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 2,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    expect(calls).toEqual(['finish']);
    expect(calls).not.toContain('build');
    expect(calls).not.toContain('remediate');
    expect(dispositions).toEqual(['human_required']);
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
      'publication disposition',
    );
  });

  it.each([
    {
      name: 'an unknown transition',
      disposition: { kind: 'publication_progress', transition: 'publish_everywhere' },
    },
    {
      name: 'an extra key',
      disposition: { kind: 'publication_progress', transition: 'ready_pr', reason: 'unexpected' },
    },
  ])('fails closed for publication progress carrying %s', ({ disposition }) => {
    expect(routeFinishPublicationDisposition(disposition)).toEqual({
      kind: 'halt',
      reason: 'Unknown or contradictory FINISH publication disposition; human review required.',
    });
  });

  it('accepts the observed establish-record-establish publication revisit without a HALT', async () => {
    const stepRetries: StepName[] = [];
    const events = new ConductorEventEmitter();
    events.on('step_retry', (event) => {
      if (event.type === 'step_retry') stepRetries.push(event.step);
    });
    const advance = vi.fn()
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'establish_pr' } as const)
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'write_shipped_record' } as const)
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'establish_pr' } as const)
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'ready_pr' } as const)
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'record_outcome' } as const)
      .mockResolvedValueOnce({ kind: 'complete' } as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance },
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    expect(advance).toHaveBeenCalledTimes(6);
    expect(stepRetries).toEqual([]);
    const state = await readState(statePath);
    expect(state.ok && state.value.finish).toBe('done');
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('starts a fresh FINISH entry with a fresh publication progress allowance', async () => {
    const exhaustedAdvance = vi.fn(async () => ({
      kind: 'publication_progress' as const,
      transition: 'ready_pr' as const,
    }));
    const exhausted = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance: exhaustedAdvance },
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });
    await exhausted.run();
    expect(exhaustedAdvance).toHaveBeenCalledTimes(14);

    await unlink(join(dir, '.pipeline/HALT'));
    await unlink(join(dir, '.pipeline/HALT.class'));
    const freshAdvance = vi.fn()
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'ready_pr' } as const)
      .mockResolvedValueOnce({ kind: 'complete' } as const);
    const fresh = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance: freshAdvance },
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });

    await fresh.run();

    expect(freshAdvance).toHaveBeenCalledTimes(2);
    const state = await readState(statePath);
    expect(state.ok && state.value.finish).toBe('done');
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each([
    {
      name: 'a transient retry', behavior: 'retry_then_sentinel', calls: 2, retries: 1,
      halt: ROUTED_SENTINEL.message,
    },
    {
      name: 'retry exhaustion', behavior: 'retry_exhaustion', calls: 3, retries: 2,
      halt: 'FINISH publication retry exhausted: draft_pr_failed',
    },
    {
      name: 'a non-retryable first observation', behavior: 'non_retryable', calls: 1, retries: 0,
      halt: 'draft_pr_lease-rejected is not retryable',
    },
    {
      name: 'a BUILD kickback', behavior: 'build_kickback', calls: 2, retries: 0,
      halt: ROUTED_SENTINEL.message,
    },
    {
      name: 'a human-required result', behavior: 'human_required', calls: 1, retries: 0,
      halt: 'operator must reconcile the publication state',
    },
  ] as const)('keeps legacy routing accounting for %s', async ({ behavior, calls: expectedCalls, retries, halt }) => {
    const calls: StepName[] = [];
    const stepRetries: StepName[] = [];
    const events = new ConductorEventEmitter();
    events.on('step_retry', (event) => {
      if (event.type === 'step_retry') stepRetries.push(event.step);
    });
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        calls.push(step);
        if (behavior === 'retry_then_sentinel' && calls.length === 2) throw ROUTED_SENTINEL;
        if (behavior === 'build_kickback' && step === 'build') throw ROUTED_SENTINEL;
        if (behavior === 'build_kickback') {
          return {
            success: false,
            publicationDisposition: {
              kind: 'implementation_invalid',
              evidence: 'BUILD proof is stale',
              unsatisfiedMembers: ['build_review'],
            },
          };
        }
        if (behavior === 'human_required') {
          return {
            success: false,
            publicationDisposition: { kind: 'human_required', reason: 'operator must reconcile the publication state' },
          };
        }
        return {
          success: false,
          publicationDisposition: {
            kind: 'publication_retry',
            transition: 'establish_pr',
            reason: behavior === 'non_retryable'
              ? 'draft_pr_lease-rejected'
              : 'draft_pr_failed',
          },
        };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 3,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    expect(calls).toHaveLength(expectedCalls);
    expect(stepRetries).toHaveLength(retries);
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(halt);
  });
});
