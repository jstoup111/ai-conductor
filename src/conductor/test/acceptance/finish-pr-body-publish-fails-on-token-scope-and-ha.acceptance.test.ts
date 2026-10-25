// Covers: S2.1, S2.2, S2.3, S2.7, S2.9, S3.1, task:6
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConductState, ConductorEvent, StepName } from '../../src/types/index.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';
import { persistAsBuiltVerdict } from '../../src/engine/as-built-verdict-store.js';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import type { PublicationDisposition } from '../../src/engine/finish-publication.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { writeState } from '../../src/engine/state.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { Conductor } from '../test-conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const AS_BUILT_FIXTURE_POLICY: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'fixture' },
  planGap: { enabled: true, reason: 'fixture' },
  adrCompliance: { enabled: false, reason: 'fixture' },
  diagramDrift: { enabled: false, reason: 'fixture' },
};

async function writeGreenShipEvidence(projectRoot: string): Promise<void> {
  await mkdir(join(projectRoot, '.docs', 'specs'), { recursive: true });
  await mkdir(join(projectRoot, '.docs', 'stories'), { recursive: true });
  await mkdir(join(projectRoot, '.docs', 'plans'), { recursive: true });
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  await writeFile(
    join(projectRoot, '.docs', 'plans', 'finish-publication.md'),
    '### Task 1: Finish publication\n\n**Files:** src/example.ts\n',
  );
  await writeFile(
    join(projectRoot, '.docs', 'specs', 'finish-publication.md'),
    '# PRD\n\n## Functional Requirements\n\n- FR-1: The feature can finish.\n',
  );
  await writeFile(
    join(projectRoot, '.docs', 'stories', 'finish-publication.md'),
    '# Stories\n\n## Story 1: Finish publication\n\n**Requirement:** FR-1\n\n### Happy Path\n\n' +
      '- Given a ready feature, when it finishes, then it is published.\n',
  );
  await persistPrdAuditVerdict(projectRoot, {
    complete: true,
    judgment: {
      version: 'v1',
      criterionJudgments: [{
        criterion: { storyId: '1', ordinal: 1 },
        criterionId: 'S1.1',
        grade: 'PASS',
        evidence: 'finish evidence',
        rationale: 'The fixture supplies the current typed audit judgment.',
        requirementAssociations: [],
        evidenceTaskIds: ['1'],
      }],
      noOwnerObservations: [],
    },
    diagnostics: [],
    recordedDispositions: [],
  }, { attemptId: 'fixture-run', codeStamp: 'fixture-head' });
  await persistAsBuiltVerdict(projectRoot, {
    version: 'v2',
    verdict: 'APPROVED',
    reachability: [],
    driftNotes: [],
  }, {
    attemptId: 'fixture-run',
    codeStamp: null,
    policy: AS_BUILT_FIXTURE_POLICY,
  });
  const fresh = new Date(Date.now() + 60_000);
  await utimes(join(projectRoot, '.pipeline', 'prd-audit.json'), fresh, fresh);
  await utimes(join(projectRoot, '.pipeline', 'prd-audit.md'), fresh, fresh);
  await utimes(join(projectRoot, '.pipeline', 'architecture-review-as-built.md'), fresh, fresh);
}

describe('FINISH publish-failure diagnosis', () => {
  let projectRoot: string;
  let stateFilePath: string;
  let state: ConductState;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'finish-publish-failure-'));
    stateFilePath = join(projectRoot, '.pipeline', 'conduct-state.json');
    await writeGreenShipEvidence(projectRoot);
    await mkdir(join(projectRoot, '.docs', 'shipped'), { recursive: true });
    await writeFile(
      join(projectRoot, '.docs', 'shipped', 'finish-publication.md'),
      '---\nslug: finish-publication\n---\n',
    );
    const fixtureState: Record<string, unknown> = {
      complexity_tier: 'S',
      track: 'technical',
      feature_desc: 'finish-publication',
      worktree_branch: 'feat/finish-publication',
      pr_url: 'https://github.com/acme/repo/pull/17',
    };
    for (const step of [
      'bootstrap', 'memory', 'assess', 'explore', 'prd', 'complexity', 'stories',
      'conflict_check', 'plan', 'coherence_check', 'architecture_diagram',
      'worktree', 'acceptance_specs', 'build', 'build_review', 'test_suite',
      'manual_test', 'prd_audit', 'architecture_review_as_built', 'rebase',
    ] satisfies StepName[]) fixtureState[step] = 'done';
    fixtureState.architecture_review = 'skipped';
    state = fixtureState as ConductState;
    await writeState(stateFilePath, state);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function observeFinish(recordPublishFailure: boolean): Promise<PublicationDisposition> {
    const prUrl = 'https://github.com/acme/repo/pull/17';
    const pullRequest = {
      url: prUrl,
      title: 'feat: draft publication',
      body: '<!-- conductor:pr-body-floor -->\n\nDraft opened automatically.',
      isDraft: true,
    };
    const events = new ConductorEventEmitter();
    const queuedPublishFailures: ConductorEvent[] = [];
    const runner: StepRunner = {
      run: vi.fn(async () => {
        if (recordPublishFailure) {
          for (const error of ['first publish failure', 'GraphQL: missing required scope read:org']) {
            queuedPublishFailures.push({
              type: 'github_operation_failed',
              operation: 'pull-request.edit',
              target: { kind: 'pull-request', repository: 'acme/repo', number: 17 },
              error,
              ts: new Date().toISOString(),
            });
          }
        }
        return { success: true };
      }),
    };
    const coordinator = createProductionFinishPublicationCoordinator({
      projectRoot,
      stateFilePath,
      baseBranch: 'main',
      git: async (args) => args[0] === 'rev-parse'
        ? { stdout: 'refs/remotes/origin/feat/finish-publication\n' }
        : args[0] === 'cat-file'
          ? { stdout: '', exitCode: 1 }
          : { stdout: '' },
      gh: async (args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return { stdout: JSON.stringify(pullRequest) };
        }
        throw new Error(`unexpected gh command: ${args.join(' ')}`);
      },
      observeReleaseReadiness: async () => 'present',
      acquireInteractiveIntent: async () => 'pr',
      recordFinish: async () => 0,
      events,
      flushSessionEvents: async () => {
        for (const event of queuedPublishFailures) await events.emit(event);
      },
    });
    return coordinator.advance({
      state,
      mode: 'default',
      daemon: false,
      dispatchJudgment: async () => ({
        success: true,
        publicationDisposition: { kind: 'accepted' },
      }),
      dispatchAuthoring: async () => runner.run('finish', state, { finishProsePass: 'author' }),
      emit: async () => {},
    });
  }

  async function routeFinish(disposition: PublicationDisposition): Promise<{
    halt: string;
    publicationEvents: ConductorEvent[];
    loopHalts: ConductorEvent[];
  }> {
    const events = new ConductorEventEmitter();
    const publicationEvents: ConductorEvent[] = [];
    const loopHalts: ConductorEvent[] = [];
    events.on('finish_publication_disposition', (event) => { publicationEvents.push(event); });
    events.on('loop_halt', (event) => { loopHalts.push(event); });
    const conductor = new Conductor({
      stateFilePath,
      stepRunner: { run: vi.fn(async () => { throw new Error('human-required disposition must not dispatch'); }) },
      finishPublication: { advance: async () => disposition },
      events,
      projectRoot,
      fromStep: 'finish',
      mode: 'default',
      daemon: false,
      maxRetries: 1,
      verifyArtifacts: false,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    return {
      halt: await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8'),
      publicationEvents,
      loopHalts,
    };
  }

  it('surfaces the last same-PR publish failure in the HALT and event spine', async () => {
    const disposition = await observeFinish(true);
    expect(disposition).toMatchObject({
      kind: 'human_required',
      reason: 'publication_operation_failed',
      detail: expect.stringContaining('GraphQL: missing required scope read:org'),
    });
    const result = await routeFinish(disposition);

    expect(result.halt).toContain(
      'A FINISH pull-request publish failed, so the authored prose never reached the pull request.',
    );
    expect(result.halt).toContain('Resolve the failure named below, then retry FINISH.');
    expect(result.halt).toContain('GraphQL: missing required scope read:org');
    expect(result.halt).not.toContain('left pr.prose unchanged at placeholder');
    expect(result.publicationEvents).toContainEqual(expect.objectContaining({
      type: 'finish_publication_disposition',
      disposition: 'human_required',
      reason: 'publication_operation_failed',
      detail: expect.stringContaining('GraphQL: missing required scope read:org'),
    }));
    expect(result.loopHalts).toContainEqual(expect.objectContaining({
      type: 'loop_halt',
      reason: expect.stringContaining('GraphQL: missing required scope read:org'),
    }));
  });

  it('keeps the existing unchanged-prose halt when no publish failure was recorded', async () => {
    const disposition = await observeFinish(false);
    expect(disposition).toMatchObject({
      kind: 'human_required',
      reason: 'publication_transition_unmoved',
      detail: 'The author_pr_prose transition left pr.prose unchanged at placeholder.',
    });
    const result = await routeFinish(disposition);

    expect(result.halt).toContain(
      'The author_pr_prose transition left pr.prose unchanged at placeholder.',
    );
    expect(result.halt).not.toContain('publication_operation_failed');
  });
});
