/**
 * Production composition for the engine-owned FINISH coordinator.
 *
 * All process and GitHub work stays behind the runners supplied here.  The
 * coordinator itself remains the pure/resumable lifecycle in
 * `finish-publication.ts`; this module is deliberately only its real-boundary
 * adapter.
 */
import { access, lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import type { ConductorEvent, ConductState, FinishPublicationEvent, RunMode } from '../types/index.js';
import type { HarnessConfig } from '../types/config.js';
import type { StepRunResult } from './step-runner-types.js';
import { type GhRunner, type GitRunner } from './pr-labels.js';
import { decodeGithubOperationRequest, executeGithubOperation, type GithubOperationRunner, type GithubOperationTarget } from './github-operations.js';
import { headPushedToUpstream } from './push-evidence.js';
import { dispatchShippedRecord } from './shipped-record-cli.js';
import { withDaemonCoAuthorTrailer } from './bot-co-author.js';
import { commitEngineChangeWhenStacked } from './guarded-engine-commit.js';
import { ensureShipReady, hasHaltSignal, isEngineFlooredBody } from './halt-pr-rehabilitation.js';
import { readState, replaceState, requireStateMutation, savePrUrl, stepDone } from './state.js';
import { readAllVerdicts, readVerdict } from './gate-verdicts.js';
import { resolveActiveChild } from './child-cursor.js';
import {
  observeStackDimension,
  pushChildClosure,
  readSealedPositions,
  readStackPublicationChildren,
  haltStackTipDiverged,
  verifyChildChainToLeaf,
  validateStackPayload,
} from './stack-publication.js';
import { activePublicationRecord, readPublicationRecord, writePublicationRecord, type PublicationMember } from './stack-publication-record.js';
import type { GitRunner as PublicationRecordGitRunner } from './rebase.js';
import { leafBranchFor } from './feature-branch-identity.js';
import { checkChildBodyPostconditions, renderChildBody, renderStackNavigation } from './stack-member-body.js';
import { splitStoryBlocks } from './story-criteria.js';
import { loadSliceTopology } from './slice-topology.js';
import { resolveFeaturePlanPath } from './artifacts.js';
import { resolveFeatureStoriesRef } from './plan-stories-reference.js';
import { gateSatisfied } from './selector.js';
import { worktreeManifestSource } from './feature-manifest-source.js';
import {
  dispatchFinishRecord,
  makeProductionFinishRecordRunners,
  type FinishRecordRunners,
} from './finish-record-cli.js';
import {
  advanceFinishPublication,
  observePublicationSnapshot,
  resolveInteractivePublicationIntent,
  resolveUnattendedPublicationIntent,
  StackPublicationHaltError,
  StackPublicationRetryError,
  PublicationOperationFailedError,
  PrProseAuthoringFailedError,
  type PublicationDisposition,
  type PrProseAuthoringRequest,
  type PrProseJudgmentRequest,
  type PrProseJudgmentResult,
  type ReleaseReadinessObservation,
} from './finish-publication.js';
import { createShipDraftPublicationDependencies, createTargetBoundGithubOperationRunner } from './ship-draft-pr.js';
import type { GithubMutationExecutionContext } from './tracker-client.js';
import { executeRemoteGit } from './remote-git-operations.js';
import { pushedTipRef } from './push-lease.js';
import { guardPublishedStackWrite } from './stack-tip-guard.js';
import { selectFinishPrerequisiteSteps } from './finish-custom-step-prerequisites.js';
import { buildStepRegistry } from './steps.js';
import { decodePrProseJudgment } from './finish-pr-prose-judgment.js';
import { applyAuthoredPrProse, clearPrProseHandoff, readPrProseHandoff } from './finish-pr-prose-handoff.js';
import { type BuildReviewAdvisoryFinding, upsertBuildReviewAcceptedRisk } from './build-review-accepted-risk.js';
import { maskProjectOwnedRegions, restoreRegion } from './pr-body-regions.js';
import { readRegionCaptures } from './pr-body-region-store.js';
import { BuildReviewDispositionStore, type BuildReviewDispositionRecord, type BuildReviewFeatureIdentity } from './build-review-dispositions.js';
import { resolveBuildReviewFeatureIdentity } from './build-review-effective.js';
import { currentBuildReviewSourceLinks, RemediationCaseStore, type RemediationCaseStoreReadResult } from './remediation-case-store.js';
import { listExistingChildren, type ChildId } from './child-context.js';
import { parseBuildReviewAggregate, projectBuildReviewAggregateSources } from './build-review-aggregate.js';
import { renderBuildReviewReducedCoverageEvidence } from './build-review-projections.js';
import {
  appendRecordedShipmentFindings,
  recordedShipmentFindings,
} from './shipment-association.js';
import { readAsBuiltVerdict } from './as-built-verdict-store.js';
import { readPrdAuditVerdict } from './prd-audit-verdict-store.js';
import { resolveShipmentIdentity } from './shipment-identity.js';
import {
  extractShipmentPlanDeclarations,
  upsertShipmentPlanDeclaration,
  withoutShipmentPlanDeclarations,
} from './shipment-plan-declaration.js';
import { runTrackerAmbientRead, runTrackerRepositoryRead, runTrackerUrlRead } from './tracker-client.js';
import type { ConductorEventEmitter } from './conductor-event-emitter.js';

export interface ProductionFinishPublicationCoordinator {
  requiresArtifactValidation: true;
  advance(input: {
    state: ConductState;
    mode: RunMode;
    daemon: boolean;
    dispatchJudgment(request: PrProseJudgmentRequest): Promise<StepRunResult>;
    /**
     * Dispatch the reader-facing authoring pass. Optional so existing callers
     * keep compiling; when absent the coordinator reports the unwired-effect
     * reason rather than letting an unauthored body reach judgment.
     */
    dispatchAuthoring?(request: PrProseAuthoringRequest): Promise<StepRunResult>;
    emit(event: FinishPublicationEvent): Promise<void>;
  }): Promise<PublicationDisposition>;
}

export interface ProductionFinishPublicationDeps {
  projectRoot: string;
  stateFilePath: string;
  /** Child executor's loaded engine identity, when FINISH runs in child mode. */
  engineVersionId?: string;
  /** Resolved PR base branch from the owning production composition root. */
  baseBranch: string;
  /** Loaded `.github/pull_request_template.md` bytes, when the project has one. */
  prTemplateBytes?: string;
  git: GitRunner;
  gh: GhRunner;
  /** The existing fail-closed finish-record entry, injectable for tests. */
  recordFinish?: typeof dispatchFinishRecord;
  finishRecordRunners?: FinishRecordRunners;
  /** The existing shipped-record entry, injectable for tests. */
  writeShippedRecord?: typeof dispatchShippedRecord;
  /** Release readiness is owned by the release gate; this is observation only. */
  observeReleaseReadiness?: (
    state: ConductState,
  ) => Promise<ReleaseReadinessObservation>;
  /** Interactive intent comes from the host conversation, never finish-record output. */
  acquireInteractiveIntent?: () => Promise<unknown>;
  /**
   * Test-only injection for the canonical guarded PR mutation boundary. In
   * production this is derived from the feature's committed provenance by
   * `createShipDraftPublicationDependencies`; an absent boundary is a
   * refusal, never permission to fall back to raw `gh` writes.
   */
  operations?: GithubOperationRunner;
  /** Test-only remote boundary authority; production derives this from committed provenance. */
  remoteMutation?: GithubMutationExecutionContext;
  /** Test-only terminal remote-Git seam; production uses executeRemoteGit. */
  remoteGit?: typeof executeRemoteGit;
  /** Canonical event spine; required for D9 warned operator-credential fallback. */
  events?: ConductorEventEmitter;
  /** Delivers completed external-process records without stopping the feature tail. */
  flushSessionEvents?: () => Promise<void>;
  /**
   * Production composition owns the ordered presentation repair.  Callers
   * inject the existing halt-rehabilitation/floor/ready composition so this
   * coordinator never silently reduces it to a `gh pr ready` flip.
   */
  repairPresentation?: (input: { prUrl: string; state: ConductState }) => Promise<void>;
  /** Task 38 seams: overridable in tests; production defaults resolve the real worktree identity and store. */
  resolveFeatureIdentity?: (projectRoot: string) => Promise<BuildReviewFeatureIdentity | undefined>;
  createDispositionStore?: (projectRoot: string) => Pick<BuildReviewDispositionStore, 'list' | 'listReducedCoverage'>;
  createCaseStore?: (projectRoot: string, feature: BuildReviewFeatureIdentity, child?: ChildId) => { read(): Promise<RemediationCaseStoreReadResult> };
}

export interface ProductionReleaseReadinessObserverInput {
  projectRoot: string;
  config?: HarnessConfig;
}

/** Applies the authoritative accepted-risk section to one already-retained PR. */
export async function publishAcceptedBuildReviewRiskToRetainedPr(input: {
  prUrl: string;
  body: string;
  /** A prior retained-PR projection may have changed the body before risk upsert. */
  originalBody?: string;
  records: readonly BuildReviewDispositionRecord[];
  caseRead?: RemediationCaseStoreReadResult;
  advisoryFindings?: readonly BuildReviewAdvisoryFinding[];
  operations?: GithubOperationRunner;
}): Promise<{ readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly message: string }> {
  const upserted = upsertBuildReviewAcceptedRisk(input.body, input.records, input.caseRead, input.advisoryFindings);
  if (!upserted.ok) return upserted;
  if (upserted.changed || (input.originalBody !== undefined && upserted.body !== input.originalBody)) {
    const mutation = await mutateRetainedPullRequest({
      operations: input.operations,
      prUrl: input.prUrl,
      operation: 'pull-request.edit',
      payload: { body: upserted.body },
    });
    if (!mutation.ok) return mutation;
  }
  return { ok: true, changed: upserted.changed };
}

/**
 * Projects the two durable advisory authorities into the PR-safe renderer.
 * Severity suppressions are written only by the effective-verdict path, while
 * settled advisory cases carry the adjudicator's lowered severity. Neither
 * authority exposes the adjudicator rationale to publication.
 */
function projectBuildReviewAdvisoryFindings(
  aggregate: ReturnType<typeof parseBuildReviewAggregate> | undefined,
  caseReads: readonly Extract<RemediationCaseStoreReadResult, { ok: true }>[],
): readonly BuildReviewAdvisoryFinding[] {
  if (!aggregate) return [];
  const sources = projectBuildReviewAggregateSources(aggregate);
  if (!sources) return [];
  const threshold = new Map<string, BuildReviewAdvisoryFinding>();
  const adjudicated = new Map<string, BuildReviewAdvisoryFinding>();
  for (const read of caseReads) {
    for (const entry of read.state.suppressions ?? []) {
      if (entry.kind !== 'severity' || entry.lastSeenLap !== aggregate.lapId) continue;
      const source = sources.find((candidate) => candidate.rubric === entry.rubric && candidate.findingId === entry.findingId);
      if (!source || source.severity === undefined) continue;
      threshold.set(`${source.rubric}:${source.findingId}`, {
        id: source.findingId, rubric: source.rubric, severity: source.severity,
        origin: 'threshold', reviewerSummary: source.summary,
      });
    }
    for (const [sourceId, { record, link }] of currentBuildReviewSourceLinks(read.state.cases)) {
      if (record.disposition !== 'advisory' || record.operatorResolution !== undefined || record.adjudicatedSeverity === undefined ||
        (link.outcome !== 'advisory' && link.outcome !== 'merged')) continue;
      const source = sources.find((candidate) => `${candidate.rubric}:${candidate.findingId}` === sourceId);
      if (!source) continue;
      adjudicated.set(sourceId, {
        id: source.findingId, rubric: source.rubric, severity: record.adjudicatedSeverity,
        origin: 'adjudicated', reviewerSummary: source.summary,
      });
    }
  }
  return [...threshold.values(), ...adjudicated.values()];
}

type RetainedPullRequestMutation =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * The only FINISH-owned retained-PR write seam. A malformed URL, unavailable
 * provenance-backed runner, refusal, or indeterminate runner result is a
 * non-success outcome. Callers propagate it to the core coordinator, which
 * re-observes rather than claiming the transition progressed.
 */
async function mutateRetainedPullRequest(input: {
  operations?: GithubOperationRunner;
  prUrl: string;
  operation: 'pull-request.edit' | 'pull-request.ready';
  payload?: { readonly title?: string; readonly body: string };
}): Promise<RetainedPullRequestMutation> {
  if (!input.operations) {
    return { ok: false, message: `guarded ${input.operation} unavailable: missing feature operation boundary` };
  }
  const match = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/([1-9]\d*)$/.exec(input.prUrl);
  if (!match) return { ok: false, message: `guarded ${input.operation} refused: invalid-target` };
  const result = await executeGithubOperation({
    operation: input.operation,
    repository: match[1],
    resource: { kind: 'pull-request', number: Number(match[2]) },
    context: { actor: 'finish-publication' },
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  }, input.operations);
  if (result.kind === 'executed') return { ok: true };
  if (result.kind === 'refused') {
    return { ok: false, message: `guarded ${input.operation} refused: ${result.reason}` };
  }
  if (result.kind === 'partial') {
    return { ok: false, message: `guarded ${input.operation} returned a partial result` };
  }
  return { ok: false, message: `guarded ${input.operation} failed: ${result.error}` };
}

type ChildPullRequest = {
  readonly number: number;
  readonly isDraft: boolean;
  readonly state: string;
  readonly base: string;
};

function repositoryAndNumber(prUrl: string): { repository: string; number: number } | undefined {
  const match = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/([1-9]\d*)\/?$/.exec(prUrl);
  return match === null ? undefined : { repository: match[1]!, number: Number(match[2]) };
}

type PullRequestBase = { readonly baseRefName?: unknown };

/** Read the sealed plan evidence used to author one child PR; no placeholders. */
async function sealedChildPresentation(input: {
  root: string;
  slug: string;
  position: number;
  branch: string;
  base: string;
  git: GitRunner;
}): Promise<{ slice: { position: number; name: string; taskIds: readonly string[]; storyIds: readonly string[] }; stories: readonly { id: string; title: string }[]; diffstat: string }> {
  // FINISH's historical Git seam requires a cwd while the topology reader's
  // shared seam owns cwd at construction. Adapt only the compatible read
  // options here so stack publication stays on its injected process boundary.
  const topology = await loadSliceTopology(input.root, input.slug, {
    git: async (args, options) => {
      const result = await input.git(args, {
        cwd: input.root,
        ...(options?.credential === undefined ? {} : { credential: options.credential }),
        ...(options?.endpoint === undefined ? {} : { endpoint: options.endpoint }),
        ...(options?.input === undefined ? {} : { input: options.input }),
      });
      return { exitCode: result.exitCode ?? 0, stdout: result.stdout, stderr: '' };
    },
  });
  if (topology.kind !== 'sliced') {
    const detail = topology.kind === 'unavailable' ? topology.cause : 'unsliced';
    throw new StackPublicationHaltError('stack_publication_precondition_failed', `sealed stack topology is unavailable: ${detail}`);
  }
  const title = topology.sliceMembership.titles[topology.positions.indexOf(input.position)];
  if (!title) throw new StackPublicationHaltError('stack_publication_precondition_failed', `sealed stack slice ${input.position} is missing`);
  const taskIds = Object.entries(topology.sliceMembership.taskSlices)
    .filter(([, position]) => position === input.position)
    .map(([taskId]) => taskId);
  const storyIds = Object.entries(topology.storyOwnership)
    .filter(([, position]) => position === input.position)
    .map(([storyId]) => storyId);
  if (taskIds.length === 0) throw new StackPublicationHaltError('stack_publication_precondition_failed', `sealed stack slice ${input.position} has no tasks`);
  const planPath = await resolveFeaturePlanPath(input.root, input.slug);
  const planText = planPath === undefined ? undefined : await readFile(planPath, 'utf8').catch(() => undefined);
  const storiesPath = planPath === undefined || planText === undefined
    ? null
    : await resolveFeatureStoriesRef(
      worktreeManifestSource(input.root),
      relative(input.root, planPath).replaceAll('\\', '/'),
      planText,
    );
  if (storiesPath === null) {
    throw new StackPublicationHaltError('stack_publication_precondition_failed', 'sealed stack stories path is unavailable');
  }
  const storiesText = await readFile(join(input.root, storiesPath), 'utf8').catch(() => '');
  const stories = splitStoryBlocks(storiesText).flatMap((story) => story.id === undefined ? [] : [{
    id: story.id,
    title: story.text.split('\n').find((line) => /^##\s+Story\s+/i.test(line))?.replace(/^##\s+Story\s+[^:]+:?\s*/i, '') || story.id,
  }]);
  const diff = await input.git(['diff', '--stat', `${input.base}...${input.branch}`], { cwd: input.root });
  return {
    slice: { position: input.position, name: title, taskIds, storyIds },
    stories,
    diffstat: diff.stdout.trim(),
  };
}

/** Replace only engine-owned stack navigation; all other bytes stay untouched. */
function replaceStackNavigation(body: string, navigation: string): string {
  const searchable = maskProjectOwnedRegions(body);
  const start = searchable.indexOf('## Stack\n');
  if (start < 0) return `${body.trimEnd()}\n\n${navigation}`;
  const nextHeading = searchable.indexOf('\n## ', start + '## Stack'.length);
  const nextRegion = body.indexOf('\n<!-- ai-conductor:step ', start + '## Stack'.length);
  const nextBoundary = nextHeading === -1 ? nextRegion
    : nextRegion === -1 ? nextHeading
      : Math.min(nextHeading, nextRegion);
  // Existing leaf prose can follow its Stack section without its own heading.
  // Consume only the navigation's blank and list lines, stopping before that
  // prose (or before the next structural boundary, whichever comes first).
  let next = start + '## Stack'.length;
  while (next < body.length && (nextBoundary < 0 || next < nextBoundary)) {
    if (body[next] !== '\n') break;
    const lineEnd = body.indexOf('\n', next + 1);
    const afterLine = lineEnd < 0 ? body.length : lineEnd;
    const line = body.slice(next + 1, afterLine);
    if (line !== '' && !line.startsWith('- ')) break;
    next = afterLine;
    if (lineEnd < 0) break;
  }
  if (nextBoundary >= 0 && next >= nextBoundary) next = nextBoundary;
  return `${body.slice(0, start)}${navigation}${body.slice(next)}`;
}

function publicationRecordGit(git: GitRunner, cwd: string): PublicationRecordGitRunner {
  return async (args, options) => {
    try {
      // The public PR GitRunner predates publication-record writes and omits
      // stdin/exit status from its narrow type. Preserve both when the
      // production adapter supplies them: `hash-object --stdin` is otherwise
      // handed an empty stream and a record can never become durable.
      const run = git as unknown as (argv: string[], opts: {
        cwd: string;
        credential?: 'operator' | 'write';
        endpoint?: 'https' | 'ssh';
        input?: string;
      }) => Promise<{ stdout: string; exitCode?: unknown; stderr?: unknown }>;
      const result = await run(args, {
        cwd,
        ...(options?.credential === undefined ? {} : { credential: options.credential }),
        ...(options?.endpoint === undefined ? {} : { endpoint: options.endpoint }),
        ...(options?.input === undefined ? {} : { input: options.input }),
      });
      return {
        exitCode: typeof result.exitCode === 'number' ? result.exitCode : 0,
        stdout: result.stdout,
        stderr: typeof result.stderr === 'string' ? result.stderr : '',
      };
    } catch (error) {
      return { exitCode: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
    }
  };
}

/** Stack API calls are bound to the latest durable record immediately before transport. */
async function executeValidatedStackOperation(input: {
  root: string;
  slug: string;
  git: PublicationRecordGitRunner;
  operations: GithubOperationRunner;
  /** Production binds stack reads/creates/adds to their own repository or stack target. */
  operationsForTarget?: (target: GithubOperationTarget) => GithubOperationRunner | undefined;
  request: Parameters<typeof executeGithubOperation>[0];
}) {
  const stored = await activePublicationRecord(input.root, input.slug, { git: input.git });
  if (!stored) throw new StackPublicationHaltError('stack_publication_precondition_failed', 'stack publication record is missing');
  const decodedRequest = decodeGithubOperationRequest(input.request);
  if (decodedRequest.kind === 'refused') {
    throw new StackPublicationHaltError('stack_publication_precondition_failed', `stack operation is malformed: ${decodedRequest.reason}`);
  }
  const decoded = validateStackPayload(stored.record, decodedRequest.request);
  if (decoded.kind === 'refused') {
    throw new StackPublicationHaltError('stack_publication_precondition_failed', `stack operation refused: ${decoded.reason}`);
  }
  const runner = input.operationsForTarget?.(decodedRequest.request.target) ?? input.operations;
  const result = await executeGithubOperation(input.request, runner);
  // A stack.read transport failure leaves the durable record untouched and
  // cannot establish (or contradict) membership. Let the core coordinator
  // retry that indeterminate observation; policy refusals remain a
  // fail-closed precondition halt below.
  if (result.kind === 'failed' && decodedRequest.request.operation === 'stack.read') {
    throw new Error(`stack.read could not be observed: ${result.error}`);
  }
  if (result.kind !== 'executed') {
    throw new StackPublicationHaltError('stack_publication_precondition_failed', `stack operation did not execute: ${result.kind}`);
  }
  return stored;
}

type NativeStackMember = {
  readonly number: number;
  readonly head: string;
};

function parseNativeStackMembers(value: unknown): readonly NativeStackMember[] | undefined {
  const stack = Array.isArray(value) ? value[0] : value;
  if (!stack || typeof stack !== 'object' || Array.isArray(stack)) return undefined;
  const rawMembers = (stack as { pull_requests?: unknown; pullRequests?: unknown }).pull_requests
    ?? (stack as { pullRequests?: unknown }).pullRequests;
  if (!Array.isArray(rawMembers)) return undefined;
  const members = rawMembers.map((member) => {
    if (!member || typeof member !== 'object' || Array.isArray(member)) return undefined;
    const candidate = member as {
      number?: unknown;
      head?: { sha?: unknown };
      headRefOid?: unknown;
      head_sha?: unknown;
    };
    const head = typeof candidate.head?.sha === 'string'
      ? candidate.head.sha
      : typeof candidate.headRefOid === 'string'
        ? candidate.headRefOid
        : typeof candidate.head_sha === 'string'
          ? candidate.head_sha
          : undefined;
    return Number.isInteger(candidate.number) && (candidate.number as number) > 0 && head && head.length > 0
      ? { number: candidate.number as number, head }
      : undefined;
  });
  return members.some((member) => member === undefined) ? undefined : members as NativeStackMember[];
}

/** A divergent publication fact is terminal: persist the operator stop before it reaches the coordinator. */
async function haltAndThrowStackTipDiverged(input: {
  root: string;
  events?: { emit(event: ConductorEvent): Promise<void> };
}, members: readonly { readonly pr: number; readonly position?: number }[], detail: string): Promise<never> {
  await haltStackTipDiverged(input.root, members, input.events, detail);
  throw new StackPublicationHaltError('stack_tip_diverged', detail, members);
}

/**
 * For a divergence whose detail does not itself name a position: the thrown
 * text becomes FINISH's final HALT reason, so it must name the mismatched
 * member positions just as the member-specific HALT does (ADR decision 11).
 */
async function haltAndThrowStackTipDivergedAtPositions(
  input: Parameters<typeof haltAndThrowStackTipDiverged>[0],
  members: readonly PublicationMember[],
  detail: string,
): Promise<never> {
  return haltAndThrowStackTipDiverged(input, members,
    `${detail} at positions: ${members.map((member) => member.position).join(', ')}`);
}

function mismatchedNativeMembers(
  expected: readonly PublicationMember[],
  observed: readonly NativeStackMember[] | undefined,
): readonly PublicationMember[] {
  const mismatched = expected.filter((member, index) => observed?.[index]?.number !== member.pr);
  // A foreign append has no corresponding durable position.  Preserve the
  // stack's recorded identities rather than emitting an anonymous HALT.
  return mismatched.length > 0 ? mismatched : expected;
}

/**
 * Re-read the native stack immediately before a ready flip. The durable record
 * supplies the required order while pushed-tip refs bind each native PR head to
 * the immutable closure that FINISH previously published.
 */
async function verifyStackBeforeReadyFlip(input: {
  root: string;
  slug: string;
  leaf: { readonly repository: string; readonly number: number };
  git: PublicationRecordGitRunner;
  gh: GhRunner;
  operations: GithubOperationRunner;
  /** The native stack read is a repository-targeted operation, not a leaf-PR operation. */
  operationsForTarget?: (target: GithubOperationTarget) => GithubOperationRunner | undefined;
  events?: Parameters<typeof haltStackTipDiverged>[2];
  position: number;
}): Promise<void> {
  const stored = await activePublicationRecord(input.root, input.slug, { git: input.git });
  if (!stored || stored.record.stack?.verified !== true) {
    throw new StackPublicationHaltError('stack_publication_precondition_failed', 'verified stack publication record is missing');
  }
  await executeValidatedStackOperation({
    root: input.root, slug: input.slug, git: input.git, operations: input.operations,
    operationsForTarget: input.operationsForTarget,
    request: {
      operation: 'stack.read', repository: input.leaf.repository, resource: { kind: 'repository' },
      context: { actor: 'finish-publication' }, payload: { pullRequest: input.leaf.number },
    },
  });
  const stdout = await runTrackerRepositoryRead(
    input.gh, input.root, 'repository.read', input.leaf.repository, { kind: 'repository' },
    ['api', `repos/${input.leaf.repository}/stacks?pull_request=${input.leaf.number}`],
  );
  const members = parseNativeStackMembers(JSON.parse(stdout));
  if (!members) throw new Error(`native stack membership is unreadable before position ${input.position}`);
  const expected = stored.record.members;
  const matchesMembers = members.length === expected.length
    && members.every((member, index) => member.number === expected[index]?.pr);
  if (!matchesMembers) {
    const mismatched = mismatchedNativeMembers(expected, members);
    await haltStackTipDiverged(input.root, mismatched, input.events, `published stack tip diverged before position ${input.position}`);
    throw new StackPublicationHaltError(
      'stack_tip_diverged',
      `native stack membership diverged at positions: ${mismatched.map((member) => member.position).join(', ')}`,
      mismatched,
    );
  }
  for (const [index, member] of expected.entries()) {
    const expectedTip = await input.git(['rev-parse', '--verify', '--quiet', pushedTipRef(input.slug, member.branch)]);
    if (expectedTip.exitCode !== 0 || expectedTip.stdout.trim() !== members[index]!.head) {
      await haltStackTipDiverged(input.root, [member], input.events, `published stack tip diverged at position ${member.position}`);
      throw new StackPublicationHaltError('stack_tip_diverged', `native stack head diverged at position ${member.position}`, [member]);
    }
  }
}

/** Ready dependent child PRs from top to bottom, after the retained leaf. */
export async function readyStackChildren(input: {
  root: string;
  slug: string;
  leafUrl: string;
  template?: string;
  git: PublicationRecordGitRunner;
  gh: GhRunner;
  operations?: GithubOperationRunner;
  /** Each stack read and child ready write needs its own exact provenance target. */
  operationsForTarget?: (target: GithubOperationTarget) => GithubOperationRunner | undefined;
  events?: Parameters<typeof haltStackTipDiverged>[2];
  /** The coordinator already proved durable child state before reading the receipt. */
  stacked?: boolean;
  /** Injected by tests so bounded ready retries never depend on wall time. */
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}): Promise<void> {
  if (input.stacked === false) return;
  const stored = await activePublicationRecord(input.root, input.slug, { git: input.git });
  // N=1 and non-stacked FINISH never need a publication-ref-dependent URL
  // parse or a stack read. Gate on durable child state first.
  if (!stored || stored.record.stack?.verified !== true) return;
  const leaf = repositoryAndNumber(input.leafUrl);
  if (!leaf) throw new StackPublicationHaltError('stack_publication_precondition_failed', 'retained leaf URL is invalid');
  if (!input.operations) throw new StackPublicationHaltError('stack_publication_precondition_failed', 'stack child ready boundary unavailable');
  for (const member of [...stored.record.members].slice(0, -1).reverse()) {
    await verifyStackBeforeReadyFlip({
      root: input.root, slug: input.slug, leaf, git: input.git, gh: input.gh,
      operations: input.operations, operationsForTarget: input.operationsForTarget,
      events: input.events, position: member.position,
    });
    const stdout = await runTrackerRepositoryRead(
      input.gh, input.root, 'pull-request.read', leaf.repository, { kind: 'pull-request', number: member.pr },
      ['pr', 'view', String(member.pr), '-R', leaf.repository, '--json', 'body,isDraft,state'],
    );
    const current: unknown = JSON.parse(stdout);
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      throw new StackPublicationHaltError('stack_publication_precondition_failed', `child position ${member.position} is unreadable`);
    }
    const body = (current as { body?: unknown }).body;
    const draft = (current as { isDraft?: unknown }).isDraft;
    const state = (current as { state?: unknown }).state;
    if (state !== 'OPEN' || typeof draft !== 'boolean' || typeof body !== 'string') {
      await haltStackTipDiverged(input.root, [member], input.events, `published stack tip diverged at position ${member.position}`);
      throw new StackPublicationHaltError('stack_tip_diverged', `child position ${member.position} is no longer an open draft`, [member]);
    }
    if (!draft) continue;
    const postcondition = checkChildBodyPostconditions(body, input.template, member.branch);
    if (!postcondition.ok) throw new StackPublicationHaltError('stack_publication_precondition_failed', postcondition.reason);
    const memberOperations = input.operationsForTarget?.({
      repository: leaf.repository, kind: 'pull-request', number: member.pr,
    }) ?? input.operations;
    if (!memberOperations) {
      throw new StackPublicationHaltError('stack_publication_precondition_failed', `child ready boundary unavailable at position ${member.position}`);
    }
    const childUrl = input.leafUrl.replace(/\/pull\/\d+$/, `/pull/${member.pr}`);
    const outcome = await ensureShipReady(
      input.gh, input.root, childUrl, input.log, input.sleep, memberOperations,
    );
    if (outcome === 'refused') {
      throw new StackPublicationHaltError('stack_publication_precondition_failed', `could not ready child position ${member.position}`);
    }
    // A partial guarded mutation is deliberately non-terminal. Its next
    // observation remains not-ready, which selects ready_pr again without
    // manufacturing a precondition halt from an eventually consistent read.
    if (outcome === 'partial') {
      throw new StackPublicationRetryError(`child ready flip remains unobserved at position ${member.position}`);
    }
  }
}

/** A verified stack is ready only after every still-open member is non-draft. */
export async function allStackMembersReady(input: {
  root: string;
  slug: string;
  repository: string;
  git: PublicationRecordGitRunner;
  gh: GhRunner;
}): Promise<boolean> {
  const stored = await activePublicationRecord(input.root, input.slug, { git: input.git });
  if (!stored || stored.record.stack?.verified !== true) return false;
  try {
    for (const member of stored.record.members) {
      const stdout = await runTrackerRepositoryRead(
        input.gh, input.root, 'pull-request.read', input.repository, { kind: 'pull-request', number: member.pr },
        ['pr', 'view', String(member.pr), '-R', input.repository, '--json', 'isDraft,state'],
      );
      const value: unknown = JSON.parse(stdout);
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || (value as { state?: unknown }).state !== 'OPEN'
        || (value as { isDraft?: unknown }).isDraft !== false) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Retarget the retained leaf only after recording the intended move.  The
 * durable record is the receipt for an interrupted GitHub mutation: every
 * retry reads the PR before it writes, so a base that already reached the
 * child is observed rather than retargeted a second time.
 *
 * Stack creation deliberately does not live here yet.  It follows this
 * journaled phase and can rely on the leaf's recorded, observed base.
 */
export async function assembleStack(input: {
  root: string;
  slug: string;
  leafUrl: string;
  baseBranch: string;
  git: PublicationRecordGitRunner;
  gh: GhRunner;
  operations?: GithubOperationRunner;
  operationsForTarget?: (target: GithubOperationTarget) => GithubOperationRunner | undefined;
  /** Production FINISH enables the post-membership body projection. */
  refreshMemberBodies?: boolean;
  /** Template defaults are the child-body postcondition authority. */
  template?: string;
  events?: { emit(event: ConductorEvent): Promise<void> };
}): Promise<void> {
  const leaf = repositoryAndNumber(input.leafUrl);
  if (!leaf || !input.operations) throw new Error('stack leaf retarget boundary unavailable');

  const readLeafBase = async (): Promise<string> => {
    const stdout = await runTrackerRepositoryRead(
      input.gh,
      input.root,
      'pull-request.read',
      leaf.repository,
      { kind: 'pull-request', number: leaf.number },
      ['pr', 'view', String(leaf.number), '-R', leaf.repository, '--json', 'baseRefName'],
    );
    const parsed: unknown = JSON.parse(stdout);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('retained leaf pull request is unreadable');
    const base = (parsed as PullRequestBase).baseRefName;
    if (typeof base !== 'string' || base.length === 0) throw new Error('retained leaf pull request base is unreadable');
    return base;
  };

  // Always observe before consulting the journal.  In particular, a crash
  // after GitHub accepted the retarget but before our observed CAS must never
  // repeat the mutation.
  const actualBase = await readLeafBase();
  let stored = await activePublicationRecord(input.root, input.slug, { git: input.git });
  if (!stored) throw new Error('stack publication record is missing');

  const leafIndex = stored.record.members.findIndex((member) => member.pr === leaf.number);
  if (leafIndex < 1 || leafIndex !== stored.record.members.length - 1) {
    throw new Error('stack publication record has no retained leaf tail');
  }
  const topChild = stored.record.members[leafIndex - 1]!;
  const existing = stored.record.retarget;
  if (existing && (existing.from !== input.baseBranch || existing.to !== topChild.branch)) {
    await haltAndThrowStackTipDivergedAtPositions(input, [stored.record.members[leafIndex]!], 'stack publication retarget journal diverged');
  }

  const writePhase = async (phase: 'intended' | 'observed'): Promise<void> => {
    const current = stored;
    if (!current) throw new Error('stack publication record is missing');
    const write = await writePublicationRecord(input.root, input.slug, current, {
      ...current.record,
      retarget: { from: input.baseBranch, to: topChild.branch, phase },
    }, { git: input.git });
    if (write.kind !== 'updated') throw new Error(`could not record stack leaf retarget as ${phase}`);
    stored = await activePublicationRecord(input.root, input.slug, { git: input.git });
    if (!stored) throw new Error('written stack publication record is unreadable');
  };

  if (actualBase === topChild.branch) {
    if (stored.record.retarget?.phase !== 'observed') await writePhase('observed');
  } else if (actualBase !== input.baseBranch) {
    await haltAndThrowStackTipDivergedAtPositions(input, [stored.record.members[leafIndex]!],
      `retained leaf pull request base diverged: expected ${input.baseBranch} or ${topChild.branch}, got ${actualBase}`);
  } else {
    if (stored.record.retarget === undefined) await writePhase('intended');
    if (stored.record.retarget?.phase === 'observed') {
      await haltAndThrowStackTipDivergedAtPositions(input, [stored.record.members[leafIndex]!],
        'observed stack leaf retarget does not match the retained leaf base');
    }

    // Retarget is a GitHub write, not a push, so it does not cross
    // executeRemoteGit. Apply the same all-member remote-tip fence here
    // before changing the leaf's base.
    const leafTip = await input.git(['rev-parse', '--verify', '--quiet', pushedTipRef(input.slug, leafBranchFor(input.slug))]);
    if (leafTip.exitCode !== 0) {
      throw new StackPublicationHaltError('stack_publication_precondition_failed', 'retarget tip receipt is unreadable');
    }
    const guard = await guardPublishedStackWrite({
      cwd: input.root,
      remote: 'origin',
      slug: input.slug,
      destination: `refs/heads/${leafBranchFor(input.slug)}`,
      source: leafTip.stdout.trim(),
      durableChildState: true,
      git: async (args, inputText) => {
        const result = await input.git([...args], inputText === undefined ? undefined : { input: inputText });
        return { stdout: result.stdout, exitCode: result.exitCode };
      },
      lsRemote: async (args) => {
        const result = await input.git([...args]);
        if (result.exitCode !== 0) throw new Error('could not read published stack tips');
        return { stdout: result.stdout };
      },
    });
    if (guard.kind === 'refuse') {
      await haltStackTipDiverged(input.root, guard.members, input.events,
        `published stack tip diverged at positions: ${guard.members.map((member) => member.position).join(', ')}`);
      throw new StackPublicationHaltError(
        'stack_tip_diverged',
        `published stack tip diverged at positions: ${guard.members.map((member) => member.position).join(', ')}`,
        guard.members,
      );
    }

    await executeValidatedStackOperation({
      root: input.root, slug: input.slug, git: input.git, operations: input.operations!, operationsForTarget: input.operationsForTarget,
      request: {
        operation: 'pull-request.retarget', repository: leaf.repository,
        resource: { kind: 'pull-request', number: leaf.number },
        context: { actor: 'finish-publication' }, payload: { base: topChild.branch },
      },
    });

    const observedBase = await readLeafBase();
    if (observedBase !== topChild.branch) {
      await haltAndThrowStackTipDivergedAtPositions(input, [stored.record.members[leafIndex]!], 'retained leaf retarget was not observed');
    }
    await writePhase('observed');
  }

  // Native stack discovery is anchored at member 1, rather than the retained
  // leaf.  A leaf may already have been attached elsewhere; querying it first
  // would turn that conflict into a new stack creation or an unsafe add.
  // `writePhase` owns the sole earlier mutation of `stored`; take its now
  // settled, non-optional record into the stack assembly flow.
  let publication = stored;
  const observeNativeStack = async (member: typeof publication.record.members[number]): Promise<{ number: number; members: readonly NativeStackMember[] } | undefined> => {
    const current = await executeValidatedStackOperation({
      root: input.root, slug: input.slug, git: input.git, operations: input.operations!, operationsForTarget: input.operationsForTarget,
      request: {
        operation: 'stack.read', repository: leaf.repository, resource: { kind: 'repository' },
        context: { actor: 'finish-publication' }, payload: { pullRequest: member.pr },
      },
    });
    const stdout = await runTrackerRepositoryRead(
      input.gh, input.root, 'repository.read', leaf.repository, { kind: 'repository' },
      ['api', `repos/${leaf.repository}/stacks?pull_request=${member.pr}`],
    );
    const raw: unknown = JSON.parse(stdout);
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const stack = value as { number?: unknown; pull_requests?: unknown; pullRequests?: unknown };
    if (!Number.isInteger(stack.number) || (stack.number as number) <= 0) return undefined;
    const members = parseNativeStackMembers(stack);
    if (members === undefined) return undefined;
    // The validated read above binds the observation to the current record; keep
    // this local reference so a future refactor cannot turn it into a raw lookup.
    void current;
    return { number: stack.number as number, members };
  };

  // Before either mutation, observe every member's native-stack ownership. A
  // later member can belong to another stack even when member 1 is unstacked.
  const memberships = await Promise.all(publication.record.members.map(observeNativeStack));
  let native = memberships[0];
  const foreignIndex = memberships.findIndex((membership) =>
    membership !== undefined && (native === undefined || membership.number !== native.number));
  if (foreignIndex >= 0) {
    const member = publication.record.members[foreignIndex]!;
    await haltAndThrowStackTipDiverged(input, [member], `native stack membership diverged at position ${member.position}`);
  }
  if (!native) {
    await executeValidatedStackOperation({
      root: input.root, slug: input.slug, git: input.git, operations: input.operations!, operationsForTarget: input.operationsForTarget,
      request: {
        operation: 'stack.create', repository: leaf.repository, resource: { kind: 'repository' },
        context: { actor: 'finish-publication' }, payload: { pullRequests: publication.record.members.map((member) => member.pr) },
      },
    });
    native = await observeNativeStack(publication.record.members[0]!);
  }
  if (!native) throw new StackPublicationHaltError('stack_publication_precondition_failed', 'native stack is unreadable after create');

  // An existing native stack is extendable only when it is the ordered prefix
  // of our immutable publication receipt.  Never "fill in" a foreign member
  // or reorder an existing stack by issuing stack.add.
  const isOrderedPrefix = native.members.length <= publication.record.members.length
    && native.members.every((member, index) => member.number === publication.record.members[index]?.pr);
  if (!isOrderedPrefix) {
    await haltAndThrowStackTipDivergedAtPositions(input, mismatchedNativeMembers(publication.record.members, native.members),
      'native stack belongs to another stack or is not an ordered publication prefix');
  }

  if (publication.record.stack?.number !== native.number) {
    const write = await writePublicationRecord(input.root, input.slug, publication, {
      ...publication.record, stack: { number: native.number, verified: false },
    }, { git: input.git });
    if (write.kind !== 'updated') throw new StackPublicationHaltError('stack_publication_precondition_failed', 'could not record native stack number');
    const reloaded = await activePublicationRecord(input.root, input.slug, { git: input.git });
    if (!reloaded) throw new StackPublicationHaltError('stack_publication_precondition_failed', 'written stack record is unreadable');
    publication = reloaded;
  }
  const missing = publication.record.members.map((member) => member.pr).filter((pr) => !native!.members.some((nativeMember) => nativeMember.number === pr));
  if (missing.length > 0) {
    await executeValidatedStackOperation({
      root: input.root, slug: input.slug, git: input.git, operations: input.operations, operationsForTarget: input.operationsForTarget,
      request: {
        operation: 'stack.add', repository: leaf.repository, resource: { kind: 'stack', number: native.number },
        context: { actor: 'finish-publication' }, payload: { pullRequests: missing },
      },
    });
    native = await observeNativeStack(publication.record.members[0]!);
  }
  if (!native || native.members.length !== publication.record.members.length
    || native.members.some((member, index) => member.number !== publication.record.members[index]?.pr)) {
    return haltAndThrowStackTipDivergedAtPositions(input, mismatchedNativeMembers(publication.record.members, native?.members), 'native stack membership or order diverged');
  }
  for (const [index, member] of publication.record.members.entries()) {
    const pushed = await input.git(['rev-parse', '--verify', '--quiet', pushedTipRef(input.slug, member.branch)]);
    if (pushed.exitCode !== 0 || pushed.stdout.trim() !== native.members[index]!.head) {
      await haltAndThrowStackTipDiverged(input, [member], `native stack head diverged at position ${member.position}`);
    }
    const stdout = await runTrackerRepositoryRead(
      input.gh, input.root, 'pull-request.read', leaf.repository,
      { kind: 'pull-request', number: member.pr },
      ['pr', 'view', String(member.pr), '-R', leaf.repository, '--json', 'baseRefName,headRefOid'],
    );
    const parsed: unknown = JSON.parse(stdout);
    const base = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as { baseRefName?: unknown }).baseRefName
      : undefined;
    const head = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as { headRefOid?: unknown }).headRefOid
      : undefined;
    const expectedBase = index === 0 ? input.baseBranch : publication.record.members[index - 1]!.branch;
    if (base !== expectedBase || head !== pushed.stdout.trim()) {
      await haltAndThrowStackTipDiverged(input, [member], `native stack base or head diverged at position ${member.position}`);
    }
  }
  const verified = await writePublicationRecord(input.root, input.slug, publication, {
    ...publication.record, stack: { number: native.number, verified: true },
  }, { git: input.git });
  if (verified.kind !== 'updated') throw new StackPublicationHaltError('stack_publication_precondition_failed', 'could not mark native stack verified');
  // Membership is final only now. Re-render the engine-owned navigation on
  // every PR from this durable list, never from a captured body or guessed
  // child URL. Project-owned regions remain byte-identical because this helper
  // replaces only the ## Stack span.
  if (!input.refreshMemberBodies) {
    await input.events?.emit({ type: 'stack_assembled', prs: publication.record.members.map((member) => member.pr) });
    return;
  }
  const members = publication.record.members;
  const navigationMembers = members.map((member) => ({
    position: member.position,
    name: member.branch,
    reference: `#${member.pr}`,
  }));
  for (const member of members) {
    const stdout = await runTrackerRepositoryRead(
      input.gh, input.root, 'pull-request.read', leaf.repository,
      { kind: 'pull-request', number: member.pr },
      ['pr', 'view', String(member.pr), '-R', leaf.repository, '--json', 'body'],
    );
    const observed: unknown = JSON.parse(stdout);
    const body = observed && typeof observed === 'object' && !Array.isArray(observed)
      ? (observed as { body?: unknown }).body
      : undefined;
    if (typeof body !== 'string') {
      throw new StackPublicationHaltError('stack_publication_precondition_failed', `stack member ${member.position} body is unreadable`);
    }
    let nextBody = replaceStackNavigation(body, renderStackNavigation(navigationMembers, member.position));
    const isLeaf = member.pr === leaf.number;
    if (!isLeaf) {
      const postcondition = checkChildBodyPostconditions(nextBody, input.template, member.branch);
      if (!postcondition.ok) throw new StackPublicationHaltError('stack_publication_precondition_failed', postcondition.reason);
    } else {
      const captures = await readRegionCaptures(input.root, input.leafUrl);
      for (const [key, bytes] of Object.entries(captures)) {
        nextBody = restoreRegion(nextBody, { key, bytes });
      }
    }
    const edited = await executeGithubOperation({
      operation: 'pull-request.edit', repository: leaf.repository,
      resource: { kind: 'pull-request', number: member.pr }, context: { actor: 'finish-publication' },
      payload: { body: nextBody },
    }, input.operationsForTarget?.({ repository: leaf.repository, kind: 'pull-request', number: member.pr }) ?? input.operations!);
    if (edited.kind !== 'executed') {
      throw new StackPublicationHaltError('stack_publication_precondition_failed', `could not re-render stack member ${member.position}`);
    }
  }
  await input.events?.emit({ type: 'stack_assembled', prs: publication.record.members.map((member) => member.pr) });
}

/**
 * The child publication effect is intentionally small and restart-safe.  Every
 * remote mutation is preceded by discovery, and a record write is a CAS; an
 * interrupted create is consequently adopted on the next pass rather than
 * created again.
 */
async function establishChildPrs(input: {
  root: string;
  slug: string;
  leafUrl: string;
  baseBranch: string;
  template?: string;
  git: GitRunner;
  gh: GhRunner;
  operations?: GithubOperationRunner;
  operationsForTarget?: (target: GithubOperationTarget) => GithubOperationRunner | undefined;
  remoteMutation?: GithubMutationExecutionContext;
  remoteMutationForTarget?: (target: Extract<GithubOperationTarget, { kind: 'remote-ref' }>) => GithubMutationExecutionContext | undefined;
  remoteGit?: typeof executeRemoteGit;
  events?: { emit(event: ConductorEvent): Promise<void> };
}): Promise<void> {
  const leaf = repositoryAndNumber(input.leafUrl);
  if (!leaf || !input.operations || !input.remoteMutation) throw new Error('stack child publication boundary unavailable');
  const stackGit = publicationRecordGit(input.git, input.root);
  const children = await readStackPublicationChildren(input.root, input.slug, { git: stackGit });
  if (children === 'unreadable') throw new Error('stack child positions are unreadable');
  const positions = await readSealedPositions(input.slug, stackGit);
  const leafPosition = Array.isArray(positions) ? positions.at(-1) : undefined;
  if (leafPosition === undefined) throw new StackPublicationHaltError('stack_publication_precondition_failed', 'sealed leaf position is unreadable');
  const chain = await verifyChildChainToLeaf(input.root, children, leafBranchFor(input.slug), { git: stackGit });
  if (chain.kind !== 'valid') throw new StackPublicationHaltError(
    'stack_publication_precondition_failed',
    chain.kind === 'broken' ? `stack child chain broken at position ${chain.position}` : 'stack child chain unreadable',
  );

  const list = async (head: string): Promise<ChildPullRequest[]> => {
    const stdout = await runTrackerRepositoryRead(
      input.gh, input.root, 'pull-request.read', leaf.repository, { kind: 'repository' },
      ['pr', 'list', '-R', leaf.repository, '--head', head, '--state', 'all', '--json', 'number,isDraft,state,baseRefName'],
    );
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) throw new Error(`invalid pull request list for ${head}`);
    return parsed.map((value) => {
      if (!value || typeof value !== 'object') throw new Error(`invalid pull request list for ${head}`);
      const candidate = value as Record<string, unknown>;
      if (!Number.isInteger(candidate.number) || typeof candidate.isDraft !== 'boolean'
        || typeof candidate.state !== 'string' || typeof candidate.baseRefName !== 'string') {
        throw new Error(`invalid pull request list for ${head}`);
      }
      return { number: candidate.number as number, isDraft: candidate.isDraft, state: candidate.state, base: candidate.baseRefName };
    });
  };
  const choose = async (prs: ChildPullRequest[], branch: string, expectedBase: string, position: number): Promise<ChildPullRequest | undefined> => {
    if (prs.length > 1) throw new Error(`ambiguous child pull request for ${branch}`);
    const pr = prs[0];
    if (!pr) return undefined;
    if (pr.state !== 'OPEN' || !pr.isDraft || pr.base !== expectedBase) {
      return haltAndThrowStackTipDiverged(input, [{ pr: pr.number, position }],
        `diverged child pull request at position ${position}`);
    }
    return pr;
  };

  // Validate the whole graph before a first push.  The repeated discovery in
  // the loop below is deliberate: it is the ambiguity recovery fence after a
  // create response is lost.
  const listedMembers = new Map<number, ChildPullRequest>();
  await Promise.all(children.map(async (child, index) => {
    const member = await choose(
      await list(child.branch),
      child.branch,
      index === 0 ? input.baseBranch : children[index - 1]!.branch,
      child.position,
    );
    if (member) listedMembers.set(child.position, member);
  }));
  const rawPrior = await readPublicationRecord(input.root, input.slug, { git: stackGit });
  const prior = rawPrior.kind === 'record' ? rawPrior : undefined;
  // A torn-down receipt is only the CAS predecessor for a new publication.
  // Its old membership is historical cleanup evidence, never input to a
  // republish: retaining it would manufacture position mismatches and append
  // the leaf twice.
  const reusingTornDownReceipt = prior?.record.tornDown === true;
  if (prior && !reusingTornDownReceipt
    && prior.record.members.some((member, index) => member.position !== [...children.map((child) => child.position), leafPosition][index])) {
    const expectedPositions = [...children.map((child) => child.position), leafPosition];
    const mismatched = prior.record.members.filter((member, index) => member.position !== expectedPositions[index]);
    const affected = mismatched.length > 0 ? mismatched : prior.record.members;
    await haltStackTipDiverged(input.root, affected, input.events, 'published stack tip diverged at sealed position');
    throw new StackPublicationHaltError(
      'stack_tip_diverged',
      `publication record has divergent sealed positions: ${affected.map((member) => member.position).join(', ')}`,
      affected,
    );
  }
  const leafView = await list(leafBranchFor(input.slug));
  const retained = leafView.find((candidate) => candidate.number === leaf.number);
  if (!retained) throw new Error('retained leaf pull request is unreadable');
  if (!retained.isDraft) {
    const leafOperations = input.operationsForTarget?.({ repository: leaf.repository, kind: 'pull-request', number: leaf.number }) ?? input.operations;
    const result = await executeGithubOperation({ operation: 'pull-request.draft', repository: leaf.repository,
      resource: { kind: 'pull-request', number: leaf.number }, context: { actor: 'finish-publication' } }, leafOperations);
    if (result.kind !== 'executed') throw new Error('could not re-draft retained leaf pull request');
    await input.events?.emit({ type: 'stack_member_redrafted', child: leafPosition, pr: leaf.number } as never);
  }

  let stored = prior;
  let freshMembership = reusingTornDownReceipt;
  for (const [index, child] of children.entries()) {
    const base = index === 0 ? input.baseBranch : children[index - 1]!.branch;
    const presentation = await sealedChildPresentation({
      root: input.root,
      slug: input.slug,
      position: child.position,
      branch: child.branch,
      base,
      git: input.git,
    });
    const body = renderChildBody({
      slice: presentation.slice,
      stories: presentation.stories,
      branch: child.branch,
      base,
      diffstat: presentation.diffstat,
      members: [...children.map((item) => ({ position: item.position, name: item.branch, reference: item.branch })),
        { position: leafPosition, name: leafBranchFor(input.slug), reference: `#${leaf.number}` }],
      template: input.template,
    });
    const bodyCheck = checkChildBodyPostconditions(body, input.template, child.branch);
    if (!bodyCheck.ok) throw new StackPublicationHaltError('stack_publication_precondition_failed', bodyCheck.reason);
    const pushed = await pushChildClosure(input.root, input.slug, child, {
      git: stackGit,
      remote: {
        mutation: input.remoteMutationForTarget?.({ repository: leaf.repository, kind: 'remote-ref', ref: `refs/heads/${child.branch}` }) ?? input.remoteMutation,
        events: input.events,
        config: async () => ({ stdout: (await input.git(['config', '--get', 'remote.origin.url'], { cwd: input.root })).stdout }),
        runRemoteGit: async (args, options) => ({ stdout: (await input.git(args, { cwd: options.cwd, credential: options.credential })).stdout }),
      },
      remoteGit: input.remoteGit,
    });
    if (pushed.kind === 'diverged') {
      const knownPr = stored?.record.members.find((member) => member.position === child.position)?.pr
        ?? listedMembers.get(child.position)?.number;
      await haltStackTipDiverged(input.root, [{ position: child.position, ...(knownPr === undefined ? {} : { pr: knownPr }) }], input.events,
        `published stack tip diverged at position ${child.position}`);
      throw new StackPublicationHaltError(
        'stack_tip_diverged',
        `child closure diverged at position ${child.position}`,
        [{ position: child.position, ...(knownPr === undefined ? {} : { pr: knownPr }) }],
      );
    }
    if (pushed.kind === 'read-failed') throw new Error(`child closure read failed at ${child.position}`);
    let member = await choose(await list(child.branch), child.branch, base, child.position);
    if (!member) {
      const created = await executeGithubOperation({ operation: 'pull-request.create', repository: leaf.repository,
        resource: { kind: 'repository', repository: leaf.repository }, context: { actor: 'finish-publication' },
        payload: { title: presentation.slice.name, body, head: child.branch, base, draft: true } },
      input.operationsForTarget?.({ repository: leaf.repository, kind: 'repository' }) ?? input.operations);
      if (created.kind !== 'executed') throw new Error(`could not create child pull request for ${child.branch}`);
      member = await choose(await list(child.branch), child.branch, base, child.position);
      if (!member) throw new Error(`created child pull request is not discoverable for ${child.branch}`);
    }
    const members = [...(freshMembership ? [] : stored?.record.members ?? []).filter((candidate) => candidate.position !== child.position),
      { position: child.position, branch: child.branch, pr: member.number }]
      .sort((left, right) => left.position - right.position);
    const next = { version: 1 as const, members };
    const write = await writePublicationRecord(input.root, input.slug, stored, next, { git: stackGit });
    if (write.kind !== 'updated') throw new Error(`could not record child pull request for ${child.branch}`);
    stored = await activePublicationRecord(input.root, input.slug, { git: stackGit });
    if (!stored) throw new Error('written stack publication record is unreadable');
    freshMembership = false;
    await input.events?.emit({ type: 'stack_member_published', child: child.position, pr: member.number } as never);
  }
  if (!stored) throw new Error('stack publication record is missing');
  const final = { version: 1 as const, members: [...stored.record.members.filter((member) => member.position !== leafPosition),
    { position: leafPosition, branch: leafBranchFor(input.slug), pr: leaf.number }].sort((left, right) => left.position - right.position) };
  const write = await writePublicationRecord(input.root, input.slug, stored, final, { git: stackGit });
  if (write.kind !== 'updated') throw new Error('could not record retained leaf pull request');
}

function upsertReducedCoverageEvidence(body: string, section: string | undefined): { ok: true; body: string; changed: boolean } | { ok: false; message: string } {
  const heading = '## Reduced build-review coverage';
  // Project-owned regions are opaque. Mask them at identical byte offsets so
  // the engine never mistakes a project heading for its own section.
  const searchable = maskProjectOwnedRegions(body);
  const start = searchable.indexOf(heading);
  const nextHeading = start === -1 ? -1 : searchable.indexOf('\n## ', start + heading.length);
  // The masked view deliberately hides project-owned regions, so it cannot be
  // used alone to find the end of an engine-owned section: a region appended
  // after the section would otherwise be included in the replacement span.
  const nextRegion = start === -1 ? -1 : body.indexOf('\n<!-- ai-conductor:step ', start + heading.length);
  const end = nextHeading === -1 ? nextRegion
    : nextRegion === -1 ? nextHeading
      : Math.min(nextHeading, nextRegion);
  const withoutExisting = start === -1
    ? body
    : `${body.slice(0, start).trimEnd()}${end === -1 ? '' : `\n\n${body.slice(end + 1).trimStart()}`}`.trimEnd();
  if (section === undefined) return { ok: true, body: withoutExisting, changed: withoutExisting !== body };
  const next = withoutExisting.trim().length === 0 ? section : `${withoutExisting}\n\n${section}`;
  return { ok: true, body: next, changed: next !== body };
}

/**
 * Resolve the configured pre-FINISH release-disposition evidence. Repositories
 * without that custom gate have no release-readiness prerequisite; a declared
 * gate must provide a regular-file marker written during the current feature
 * run. The feature-run floor survives process restarts, so a resumable FINISH
 * does not invalidate readiness merely because it entered a new session.
 */
export function createProductionReleaseReadinessObserver(
  input: ProductionReleaseReadinessObserverInput,
): (state: ConductState) => Promise<ReleaseReadinessObservation> {
  const config = input.config ?? {};
  const steps = selectFinishPrerequisiteSteps(config, buildStepRegistry(config));
  if (steps.length === 0) return async () => ({ observation: 'present', steps: [] });

  return async (state) => {
    const persisted = await readState(join(input.projectRoot, '.pipeline', 'conduct-state.json'));
    const persistedRunStartedAt = persisted.ok ? persisted.value.run_started_at : undefined;
    const runStartedAt = typeof persistedRunStartedAt === 'number' && Number.isFinite(persistedRunStartedAt)
      ? persistedRunStartedAt
      : undefined;

    const unsatisfied: string[] = [];
    let missing = false;
    let malformed = false;
    let stale = false;
    let unavailable = false;

    for (const step of steps) {
      if ((state as Record<string, unknown>)[step] !== 'done') {
        unsatisfied.push(step);
        missing = true;
        continue;
      }
      try {
        const artifact = await lstat(join(input.projectRoot, config.steps![step]!.completion_artifact!));
        if (!artifact.isFile()) {
          unsatisfied.push(step);
          malformed = true;
        } else if (runStartedAt === undefined) {
          unsatisfied.push(step);
          unavailable = true;
        } else if (artifact.mtimeMs < runStartedAt) {
          unsatisfied.push(step);
          stale = true;
        }
      } catch (error) {
        unsatisfied.push(step);
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') missing = true;
        else unavailable = true;
      }
    }
    if (unsatisfied.length === 0) return { observation: 'present', steps: [] };
    if (missing) return { observation: 'missing', steps: unsatisfied };
    if (malformed) return { observation: 'malformed', steps: unsatisfied };
    if (stale) return { observation: 'stale', steps: unsatisfied };
    if (unavailable) return { observation: 'unavailable', steps: unsatisfied };
    return { observation: 'present', steps: [] };
  };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

function prHaltState(title: unknown, body: unknown, rawLabels: unknown): boolean {
  const prTitle = typeof title === 'string' ? title : '';
  const prBody = typeof body === 'string' ? body : '';
  const labels = Array.isArray(rawLabels)
    ? rawLabels.map((label) => String((label as { name?: unknown } | null)?.name ?? ''))
    : [];
  return hasHaltSignal({ title: prTitle, body: prBody, labels, isDraft: false });
}

/** The shared floor predicate for observation and returned author prose. */
function isPlaceholderPrProse(title: string, body: string, templateBytes?: string): boolean {
  const text = `${title}\n${body}`.trim();
  return !text || isEngineFlooredBody(body, templateBytes) || /Draft opened automatically/i.test(maskProjectOwnedRegions(text));
}

function prProse(
  title: unknown,
  body: unknown,
  halted: boolean,
  verdict: 'accepted' | 'deficient' | 'none',
  templateBytes?: string,
): 'accepted' | 'revision_required' | 'stale' | 'placeholder' | 'halt' {
  const prTitle = typeof title === 'string' ? title : '';
  const prBody = typeof body === 'string' ? body : '';
  if (isPlaceholderPrProse(prTitle, prBody, templateBytes)) return 'placeholder';
  if (halted) return 'halt';
  // The floor marker is provenance, not a verdict: it is an invisible comment
  // an authoring pass can preserve while rewriting every word around it, and
  // marker-presence-alone classification then pinned genuine prose at
  // 'placeholder' until the non-advancing-transition guard halted FINISH
  // (#1703). `isEngineFlooredBody` reads the body content instead, so an
  // intact floor still classifies as a placeholder and authored prose does
  // not.
  // Existing prose is a judgment candidate until this coordinator either
  // authored that exact revision or received an accepted judgment for it.
  // The PR remains the observation authority; this cache only records the
  // bounded provider work performed by this coordinator lifetime.
  if (verdict === 'accepted') return 'accepted';
  if (verdict === 'deficient') return 'revision_required';
  return 'stale';
}

/**
 * Creates the single production coordinator used by foreground and daemon
 * constructors.  Every external effect is supplied as an existing boundary,
 * so ordinary tests can use fakes and never spawn git, gh, or a provider.
 */
export function createProductionFinishPublicationCoordinator(
  deps: ProductionFinishPublicationDeps,
): ProductionFinishPublicationCoordinator {
  const pipelineDir = dirname(deps.stateFilePath);
  const writeShippedRecord = deps.writeShippedRecord ?? dispatchShippedRecord;
  const recordFinish = deps.recordFinish ?? dispatchFinishRecord;
  // finish-record's own default is a fail-closed no-op reserved for tests that
  // assert zero gh/git spawns. Forwarding an absent bundle handed that no-op to
  // production, so every `record_outcome` attempt refused with "runGh not
  // implemented" and burned the FINISH retry budget instead of recording.
  const finishRecordRunners = deps.finishRecordRunners ?? makeProductionFinishRecordRunners();

  const copyRecordedReviewFindingsToShippedRecord = async (slug: string): Promise<void> => {
    const [prdAudit, asBuiltResult] = await Promise.all([
      readPrdAuditVerdict(deps.projectRoot),
      readAsBuiltVerdict(deps.projectRoot),
    ]);
    const findings = recordedShipmentFindings({
      prdAudit: prdAudit.kind === 'present' ? prdAudit.value : undefined,
      asBuilt: asBuiltResult.kind === 'present' ? asBuiltResult.value : undefined,
    });
    if (findings.length === 0) return;

    const relativeRecordPath = join('.docs', 'shipped', `${slug}.md`);
    const recordPath = join(deps.projectRoot, relativeRecordPath);
    const record = await readFile(recordPath, 'utf8');
    const next = appendRecordedShipmentFindings(record, findings);
    if (next === record) return;
    await writeFile(recordPath, next, 'utf8');
    const guarded = await commitEngineChangeWhenStacked({
      worktree: deps.projectRoot,
      slug,
      pathspec: [relativeRecordPath],
      message: `shipped record findings: ${slug}`,
      noVerify: true,
    });
    if (guarded === undefined) {
      await deps.git(['add', relativeRecordPath], { cwd: deps.projectRoot });
      await deps.git([
        'commit', '-m', withDaemonCoAuthorTrailer(`shipped record findings: ${slug}`), '--no-verify',
      ], { cwd: deps.projectRoot });
    } else if (guarded.kind === 'failed' || guarded.kind === 'refused') {
      throw new Error(`could not commit shipped record findings: ${guarded.reason}`);
    }
  };
  // A real provider session is expensive. Retain terminal prose verdicts for
  // the exact observed title/body revision; a changed revision earns one new
  // session, while an unchanged deficient one cannot burn retries.
  const proseRevisionByPr = new Map<string, string>();
  const judgmentByRevision = new Map<string, PrProseJudgmentResult>();
  // The retained verdicts must survive the coordinator: the daemon builds a
  // fresh coordinator per dispatch, and losing the map made an already-judged,
  // unchanged revision pay a new judgment session on every resume — the exact
  // extra attempt Outcome-style convergence guarantees forbid. Verdicts are
  // keyed by a digest of the revision (never raw title/body bytes) in a
  // .pipeline verdict artifact, the same durability pattern as the gate
  // verdicts. Persistence is best-effort: an unreadable or unwritable store
  // degrades to the old per-process behavior, never to a failed judgment.
  const judgmentStorePath = join(pipelineDir, 'prose-judgment.json');
  const revisionDigest = (revision: string): string =>
    createHash('sha256').update(revision, 'utf8').digest('hex');
  let judgmentStoreSeeded: Promise<void> | undefined;
  const seedJudgmentStore = (): Promise<void> =>
    (judgmentStoreSeeded ??= (async () => {
      try {
        const parsed: unknown = JSON.parse(await readFile(judgmentStorePath, 'utf8'));
        const records = (parsed as { records?: Record<string, PrProseJudgmentResult> }).records;
        if (records && typeof records === 'object') {
          for (const [digest, result] of Object.entries(records)) {
            if (result && typeof result.kind === 'string') judgmentByRevision.set(digest, result);
          }
        }
      } catch {
        // Missing or malformed store: start empty, exactly as before.
      }
    })());
  const persistJudgmentStore = async (): Promise<void> => {
    try {
      await writeFile(
        judgmentStorePath,
        JSON.stringify({ version: 1, records: Object.fromEntries(judgmentByRevision) }, null, 2),
        'utf8',
      );
    } catch {
      // Best-effort durability; the in-memory verdict still bounds this run.
    }
  };
  // A successful placeholder-authoring pass owns exactly one mandatory
  // re-observation. Its revision is accepted without a redundant judgment;
  // a rewrite of prose already judged deficient remains stale and is judged.
  const acceptedProseRevisionByPr = new Map<string, string>();
  const authoredPlaceholderProsePendingByPr = new Set<string>();
  const authoringOriginByPr = new Map<string, 'placeholder' | 'revision_required'>();
  // Retry guidance is intentionally process-local: the next attempt can use
  // the concrete handoff failure, while a restarted coordinator begins with
  // no unverifiable provider-side state.
  const authoringFailureGuidanceByPr = new Map<string, string>();
  const recordAuthoringFailure = (
    pullRequestUrl: string,
    cause: 'not_returned' | 'invalid',
    detail: string,
  ): never => {
    authoringFailureGuidanceByPr.set(
      pullRequestUrl,
      cause === 'not_returned'
        ? 'No PR-prose handoff was written to .pipeline/finish-pr-prose.json.'
        : detail,
    );
    throw new PrProseAuthoringFailedError(cause, detail);
  };
  // Once a retained PR exists, its finish pass observes one immutable sealed
  // topology. Reuse that cursor across its coordinator lifetime to avoid
  // repeating durable-child-state probes while retaining the loader's
  // all-cardinality position check for the observation.
  const retainedPrObservationChildByFeature = new Map<string, Promise<Awaited<ReturnType<typeof resolveActiveChild>>>>();
  let retainedPrFinish = false;
  // Interactive authority is acquired once per coordinator lifetime. A retry
  // must re-observe publication state, not ask the operator to re-authorize
  // the same requested outcome.
  let attendedRequestedOutcome: Promise<unknown> | undefined;
  // Task 38: the retained PR is the durable projection surface for accepted
  // build-review risk. Every retained-PR maintenance effect applies the
  // authoritative upsert, and an unrenderable or unwritable projection blocks
  // the effect instead of letting an accepted finding silently disappear.
  const projectAcceptedRiskToRetainedPr = async (prUrl: string, operations?: GithubOperationRunner) => {
    const feature = await (deps.resolveFeatureIdentity ?? resolveBuildReviewFeatureIdentity)(deps.projectRoot);
    // No feature identity means no feature-scoped disposition state can exist
    // (a non-worktree FINISH): there is nothing to project. Everything past
    // this point fails closed — an unreadable store or unrenderable section
    // blocks the effect instead of letting accepted risk disappear.
    if (!feature) return;
    const store = (deps.createDispositionStore
      ?? ((root: string) => new BuildReviewDispositionStore(root)))(deps.projectRoot);
    const listed = await store.list(feature);
    if (!listed.ok) throw new Error(`accepted-risk projection: ${listed.message}`);
    const createCaseStore = deps.createCaseStore
      ?? ((root: string, caseFeature: BuildReviewFeatureIdentity, child?: ChildId) => new RemediationCaseStore(root, caseFeature, child === undefined ? {} : { child }));
    const caseReads = await Promise.all([
      createCaseStore(deps.projectRoot, feature).read(),
      ...(await listExistingChildren(deps.projectRoot)).map((child) => createCaseStore(deps.projectRoot, feature, child).read()),
    ]);
    const unreadable = caseReads.find((read) => !read.ok);
    const readableCaseReads = caseReads.filter((read): read is Extract<RemediationCaseStoreReadResult, { ok: true }> => read.ok);
    const caseRead: RemediationCaseStoreReadResult = unreadable && !unreadable.ok
      ? unreadable
      : { ok: true, state: { ...readableCaseReads[0]!.state, cases: readableCaseReads.flatMap((read) => read.state.cases) } };
    const reducedCoverage = await store.listReducedCoverage(feature);
    if (!reducedCoverage.ok) throw new Error(`accepted-risk projection: ${reducedCoverage.message}`);
    const aggregate = await readFile(join(deps.projectRoot, '.pipeline', 'build-review.json'), 'utf8')
      .then((text) => parseBuildReviewAggregate(JSON.parse(text)))
      .catch(() => undefined);
    const advisoryFindings = projectBuildReviewAdvisoryFindings(aggregate, readableCaseReads);
    if (reducedCoverage.records.length > 0 && !aggregate) {
      throw new Error('accepted-risk projection: reduced build-review coverage has no renderable current-lap evidence');
    }
    const renderedReducedCoverage = renderBuildReviewReducedCoverageEvidence({
      state: 'known',
      records: reducedCoverage.records,
      currentFailures: aggregate === undefined
        ? []
        : [
            ...Object.values(aggregate.results).filter((result) => result.kind === 'infrastructure-failure'),
            ...(aggregate.currentCustomRubrics ?? []).flatMap((rubric) => {
              const member = aggregate.customResults?.[rubric];
              return member?.result.kind === 'infrastructure-failure' && member.declaration !== undefined
                ? [{ rubric, reason: member.result.reason, detail: member.result.detail, declaration: member.declaration }]
                : [];
            }),
          ],
    });
    if (!renderedReducedCoverage.ok) throw new Error(`accepted-risk projection: ${renderedReducedCoverage.message}`);
    const stdout = await runTrackerUrlRead(deps.gh, deps.projectRoot, 'pull-request', prUrl, ['pr', 'view', prUrl, '--json', 'body']);
    const body = (JSON.parse(stdout) as { body?: unknown }).body;
    const reducedCoverageBody = upsertReducedCoverageEvidence(
      typeof body === 'string' ? body : '',
      renderedReducedCoverage.section,
    );
    if (!reducedCoverageBody.ok) throw new Error(`accepted-risk projection: ${reducedCoverageBody.message}`);
    const published = await publishAcceptedBuildReviewRiskToRetainedPr({
      prUrl,
      body: reducedCoverageBody.body,
      originalBody: typeof body === 'string' ? body : '',
      records: listed.records,
      caseRead,
      advisoryFindings,
      operations,
    });
    if (!published.ok) throw new Error(`accepted-risk projection: ${published.message}`);
  };
  const projectShipmentPlanDeclarationToRetainedPr = async (
    prUrl: string,
    requestedSlug: string,
    operations?: GithubOperationRunner,
  ) => {
    const planPaths = (await readdir(join(deps.projectRoot, '.docs', 'plans')))
      .filter((name) => name.endsWith('.md'))
      .map((name) => join('.docs', 'plans', name));
    const resolution = resolveShipmentIdentity(requestedSlug, planPaths);
    if (resolution.kind !== 'resolved') {
      const detail = resolution.kind === 'ambiguous'
        ? `ambiguous plan candidates: ${resolution.candidates.join(', ')}`
        : `plan not found: ${resolution.expected}`;
      throw new Error(`shipment plan declaration: ${detail}`);
    }
    const stdout = await runTrackerUrlRead(deps.gh, deps.projectRoot, 'pull-request', prUrl, ['pr', 'view', prUrl, '--json', 'body']);
    const body = (JSON.parse(stdout) as { body?: unknown }).body;
    if (typeof body !== 'string') throw new Error('shipment plan declaration: PR body is malformed');
    const next = upsertShipmentPlanDeclaration(body, resolution.identity.slug);
    if (next !== body) {
      const mutation = await mutateRetainedPullRequest({
        operations,
        prUrl,
        operation: 'pull-request.edit',
        payload: { body: next },
      });
      if (!mutation.ok) throw new Error(`shipment plan declaration: ${mutation.message}`);
    }
  };

  return {
    requiresArtifactValidation: true,
    async advance({ state, mode, daemon, dispatchJudgment, dispatchAuthoring, emit }) {
      retainedPrFinish ||= state.pr_url !== undefined;
      const attended = !daemon && (mode === 'default' || mode === 'interactive');
      const requestedOutcome = attended
        ? await (attendedRequestedOutcome ??= Promise.resolve().then(
            () => deps.acquireInteractiveIntent?.(),
          ))
        : await readFile(join(pipelineDir, 'finish-choice'), 'utf8')
          .then((value) => value.trim())
          .catch(() => undefined);
      const intent =
        attended
          ? resolveInteractivePublicationIntent(requestedOutcome)
          : await (async () => {
              let remote: 'configured' | 'missing' = 'missing';
              let authentication: 'authenticated' | 'unavailable' = 'unavailable';
              try {
                remote = (await deps.git(['remote'], { cwd: deps.projectRoot })).stdout.trim()
                  ? 'configured'
                  : 'missing';
              } catch {
                // Missing/indeterminate remote is safe only for foreground keep.
              }
              try {
                await runTrackerAmbientRead(deps.gh, deps.projectRoot, 'ambient.identity.read', ['auth', 'status']);
                authentication = 'authenticated';
              } catch {
                // The policy maps unavailable auth to the safe foreground outcome.
              }
              return resolveUnattendedPublicationIntent({
                mode: daemon ? 'daemon' : 'foreground-auto',
                capabilities: { remote, authentication },
                requestedOutcome,
              });
            })();

      if ('kind' in intent) return intent;

      // Intent is the first publication fence. Resolving provenance can read
      // local Git and GitHub identity, but it must not happen before an
      // attended operator has chosen a publishable outcome.
      const publication = await createShipDraftPublicationDependencies({
        cwd: deps.projectRoot,
        branch: state.worktree_branch,
        baseBranch: deps.baseBranch,
        featureDesc: state.feature_desc,
        git: deps.git,
        gh: deps.gh,
        events: deps.events,
      });
      const operations = deps.operations ?? publication?.operations;
      const publicationMutation = deps.remoteMutation ?? publication?.remoteMutation;
      // Stacked publication changes targets on every write. Do not reuse the
      // leaf-ref runner: the policy intentionally rejects that escalation.
      const operationsForTarget = (target: GithubOperationTarget): GithubOperationRunner | undefined =>
        deps.operations ?? (publicationMutation === undefined ? undefined : createTargetBoundGithubOperationRunner({
          mutation: publicationMutation,
          target,
          gh: deps.gh,
          cwd: deps.projectRoot,
          events: deps.events,
        }));
      const mutationForRemoteRef = (target: Extract<GithubOperationTarget, { kind: 'remote-ref' }>) =>
        publicationMutation === undefined ? undefined : {
          ...publicationMutation,
          provenance: { ...publicationMutation.provenance, target },
        };
      // Publication starts with authority for the branch ref. Every later
      // retained-PR write needs a new, exact PR binding instead; a branch
      // target must never become repository-wide PR authority.
      const retainedOperations = async (prUrl: string): Promise<GithubOperationRunner | undefined> => {
        if (deps.operations) return deps.operations;
        const retained = await createShipDraftPublicationDependencies({
          cwd: deps.projectRoot,
          branch: state.worktree_branch,
          baseBranch: deps.baseBranch,
          featureDesc: state.feature_desc,
          prUrl,
          git: deps.git,
          gh: deps.gh,
          events: deps.events,
        });
        return retained?.operations;
      };

      let activeChildForObservation: Awaited<ReturnType<typeof resolveActiveChild>> | undefined;
      const resolveObservationChild = async () => {
        if (state.feature_desc === undefined) return { kind: 'no-child' as const };
        if (retainedPrFinish) {
          let cursor = retainedPrObservationChildByFeature.get(state.feature_desc);
          if (cursor === undefined) {
            cursor = resolveActiveChild(deps.projectRoot, state.feature_desc, { reuseDurableChildState: true });
            retainedPrObservationChildByFeature.set(state.feature_desc, cursor);
          }
          return cursor;
        }
        if (activeChildForObservation === undefined) {
          activeChildForObservation = await resolveActiveChild(deps.projectRoot, state.feature_desc);
        }
        return activeChildForObservation;
      };
      const observeStackReadiness = async (prUrl: string, leafReady: boolean): Promise<boolean> => {
        if (!leafReady) return false;
        const cursor = await resolveObservationChild();
        if (cursor.kind === 'no-child') return true;
        if (!state.feature_desc) return false;
        const leaf = repositoryAndNumber(prUrl);
        if (!leaf) return false;
        return allStackMembersReady({
          root: deps.projectRoot,
          slug: state.feature_desc,
          repository: leaf.repository,
          git: publicationRecordGit(deps.git, deps.projectRoot),
          gh: deps.gh,
        });
      };
      const observationInput = {
        mode: intent.authority.kind === 'operator_confirmed' ? 'interactive' : intent.authority.mode,
        intent,
        ports: {
          filesystem: {
            // FINISH must ask the same verdict-first question that selected
            // these gates. A gate can be satisfied without dispatching, so it
            // may have no state key at all. One tolerant store read per
            // observation preserves selector fallback behavior for missing or
            // malformed verdicts without manufacturing state.
            observeImplementationEvidence: async () => {
              const cursor = await resolveObservationChild();
              const verdicts = cursor.kind === 'active' && cursor.isLeaf
                ? {
                  build_review: (await readVerdict(deps.projectRoot, 'build_review', cursor.child)) ?? undefined,
                  test_suite: (await readVerdict(deps.projectRoot, 'test_suite', cursor.child)) ?? undefined,
                }
                : await readAllVerdicts(deps.projectRoot);
              const buildReviewSatisfied = gateSatisfied('build_review', state, verdicts);
              const testSuiteSatisfied = gateSatisfied('test_suite', state, verdicts);
              if (buildReviewSatisfied && testSuiteSatisfied) return { state: 'present' };
              if (!buildReviewSatisfied && !testSuiteSatisfied) {
                return {
                  state: 'missing',
                  unsatisfiedMembers: ['build_review', 'test_suite'],
                };
              }
              return !buildReviewSatisfied
                ? { state: 'missing', unsatisfiedMembers: ['build_review'] }
                : { state: 'missing', unsatisfiedMembers: ['test_suite'] };
            },
            observeShipEvidence: async () =>
              stepDone(state, 'manual_test') && stepDone(state, 'architecture_review_as_built')
                ? 'present'
                : 'missing',
            observeOutcomeRecord: async () =>
              (await exists(join(pipelineDir, 'finish-choice'))) ? 'present' : 'missing',
          },
          git: {
            observePushEvidence: async () => {
              const pushed = await headPushedToUpstream(deps.git, deps.projectRoot);
              return pushed === true ? 'pushed' : pushed === false ? 'unpushed' : 'unavailable';
            },
          },
          github: {
            observePullRequest: async () => {
              if (!state.pr_url) return { state: 'missing' };
              try {
                const stdout = await runTrackerUrlRead(deps.gh, deps.projectRoot, 'pull-request', state.pr_url, ['pr', 'view', state.pr_url, '--json', 'url,title,body,isDraft,labels']);
                const pr = JSON.parse(stdout) as {
                  url?: unknown;
                  title?: unknown;
                  body?: unknown;
                  isDraft?: unknown;
                  labels?: unknown;
                };
                if (typeof pr.url === 'string') {
                  const ready = await observeStackReadiness(pr.url, pr.isDraft === false);
                  const halted = prHaltState(pr.title, pr.body, pr.labels);
                  // The declaration is mechanically maintained shipment
                  // metadata, not reader-facing prose. Its append/replacement
                  // must not invalidate the verdict for an otherwise identical
                  // title/body revision and trigger another provider judgment.
                  const proseBody = typeof pr.body === 'string'
                    ? extractShipmentPlanDeclarations(pr.body).length === 0
                      ? pr.body
                      : withoutShipmentPlanDeclarations(pr.body).trimEnd()
                    : pr.body ?? '';
                  const revision = `${pr.url}\u0000${JSON.stringify([pr.title ?? '', proseBody])}`;
                  proseRevisionByPr.set(pr.url, revision);
                  await seedJudgmentStore();
                  if (authoredPlaceholderProsePendingByPr.delete(pr.url) && !halted) {
                    const observedProse = prProse(pr.title, pr.body, false, 'none', deps.prTemplateBytes);
                    if (observedProse !== 'placeholder') {
                      // The authoring pass, not an independently observed
                      // reader-facing revision, owns this exact replacement.
                      // Retain the result across the next daemon dispatch so
                      // a healthy placeholder path does not pay a redundant
                      // judgment provider pass.
                      acceptedProseRevisionByPr.set(pr.url, revision);
                      judgmentByRevision.set(revisionDigest(revision), { kind: 'accepted' });
                      await persistJudgmentStore();
                    }
                  }
                  const judgment = judgmentByRevision.get(revisionDigest(revision));
                  if (judgment?.kind === 'accepted') {
                    acceptedProseRevisionByPr.set(pr.url, revision);
                  }
                  const verdict =
                    acceptedProseRevisionByPr.get(pr.url) === revision || judgment?.kind === 'accepted'
                      ? 'accepted' as const
                      : judgment?.kind === 'revision_required' &&
                          (judgment.reason === 'placeholder' || judgment.reason === 'structurally_incomplete')
                        ? 'deficient' as const
                        : 'none' as const;
                  const revisionGuidance =
                    verdict === 'deficient' && judgment?.kind === 'revision_required'
                      ? judgment.detail
                      : undefined;
                  const prose = prProse(
                    pr.title,
                    pr.body,
                    halted,
                    verdict,
                    deps.prTemplateBytes,
                  );
                  if (prose === 'placeholder' || prose === 'revision_required') {
                    authoringOriginByPr.set(pr.url, prose);
                  } else {
                    authoringOriginByPr.delete(pr.url);
                  }
                  return {
                      state: 'one' as const,
                      url: pr.url,
                      prose,
                      ...(halted ? { halted: true as const } : {}),
                      ...(revisionGuidance === undefined ? {} : { revisionGuidance }),
                      ready,
                    };
                }
                return { state: 'malformed' as const };
              } catch {
                return { state: 'unavailable' as const };
              }
            },
          },
          shippedRecord: {
            observeShippedRecord: async () => {
              if (!state.feature_desc) return 'missing';
              const planPaths = (await readdir(join(deps.projectRoot, '.docs', 'plans')).catch((error: NodeJS.ErrnoException) => {
                if (error.code === 'ENOENT') return [];
                throw error;
              }))
                .filter((name) => name.endsWith('.md'))
                .map((name) => join('.docs', 'plans', name));
              const resolution = resolveShipmentIdentity(state.feature_desc, planPaths);
              if (resolution.kind === 'ambiguous') return 'malformed';
              const recordPath = resolution.kind === 'resolved'
                ? resolution.identity.recordPath
                : join('.docs', 'shipped', `${state.feature_desc}.md`);
              const canonicalSlug = resolution.kind === 'resolved'
                ? resolution.identity.slug
                : state.feature_desc;
              const absoluteRecordPath = join(deps.projectRoot, recordPath);
              if (!await exists(absoluteRecordPath)) return 'missing';
              const record = await readFile(absoluteRecordPath, 'utf8').catch(() => undefined);
              if (record === undefined) return 'unavailable';
              const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(record);
              const slug = frontmatter && /^slug:\s*(.*?)\s*$/m.exec(frontmatter[1]);
              return slug?.[1].trim() === canonicalSlug ? 'present' : 'malformed';
            },
          },
          releaseReadiness: {
            observeReleaseReadiness: async () => {
              if (deps.observeReleaseReadiness === undefined) throw new Error('release-readiness observer unavailable');
              return deps.observeReleaseReadiness(state);
            },
          },
          stack: {
            observeStackDimension: async () => {
              if (!state.feature_desc) return 'not-applicable';
              const cursor = await resolveObservationChild();
              // The leaf URL is the authoritative repository binding. Before
              // the ordinary establish-PR transition finishes, the stack is
              // deliberately indeterminate rather than guessed from cwd.
              const match = state.pr_url === undefined
                ? undefined
                : /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/[1-9]\d*$/.exec(state.pr_url);
              if (!match) return cursor.kind === 'no-child' ? 'not-applicable' : 'indeterminate';
              return observeStackDimension(deps.projectRoot, state.feature_desc, cursor, {
                git: publicationRecordGit(deps.git, deps.projectRoot),
                gh: deps.gh,
                repository: match[1],
                baseBranch: deps.baseBranch,
                onDiverged: async (members, detail) => haltStackTipDiverged(
                  deps.projectRoot,
                  members,
                  deps.events,
                  detail,
                ),
              });
            },
          },
        },
      };
      const result = await advanceFinishPublication({
        // Re-read every boundary after an effect. The ports close over the
        // current filesystem/GitHub state, so no successful write is trusted
        // merely because its caller received a response.
        observe: async () => {
          // The snapshot ports are evaluated in a fixed order. Reuse the
          // cursor within one observation so adding the stack dimension does
          // not add duplicate N=1 Git discovery. A retained PR keeps its
          // sealed cursor for the whole coordinator pass; a new PR rechecks
          // after each effect because branch publication can change state.
          activeChildForObservation = undefined;
          return observePublicationSnapshot(
            observationInput as Parameters<typeof observePublicationSnapshot>[0],
          );
        },
        emit,
        effects: {
          // Authoring is dispatched only when the engine itself observed an
          // unauthored body. The provider returns a handoff; the engine alone
          // re-splices, validates, and publishes it before re-observation
          // decides whether the transition progressed.
          ...(dispatchAuthoring
            ? {
                authorProse: async (request: PrProseAuthoringRequest) => {
                  await clearPrProseHandoff(pipelineDir);
                  const failureGuidance = authoringFailureGuidanceByPr.get(request.pullRequestUrl);
                  const authoringRequest = failureGuidance === undefined
                    ? request
                    : {
                        ...request,
                        revisionGuidance: [request.revisionGuidance, failureGuidance]
                          .filter((guidance): guidance is string => guidance !== undefined)
                          .join('\n\n'),
                      };
                  const dispatched = await dispatchAuthoring(authoringRequest);
                  // A failed provider run returns, it does not throw. Passing
                  // it through as a completed pass made the coordinator's
                  // fixed-point guard read an aborted attempt as "authoring
                  // left the placeholder unchanged" and halt needs-human.
                  // Raise it so the transient-dispatch retry path owns it.
                  if (!dispatched.success) {
                    throw new Error('PR prose authoring dispatch did not complete successfully');
                  }
                  const handoff = await readPrProseHandoff(pipelineDir);
                  const prose = handoff.kind === 'returned'
                    ? handoff.prose
                    : recordAuthoringFailure(
                      request.pullRequestUrl,
                      handoff.kind,
                      handoff.kind === 'not_returned'
                        ? 'PR-prose handoff was not returned.'
                        : handoff.detail,
                    );
                  const stdout = await runTrackerUrlRead(
                    deps.gh,
                    deps.projectRoot,
                    'pull-request',
                    request.pullRequestUrl,
                    ['pr', 'view', request.pullRequestUrl, '--json', 'title,body'],
                  );
                  const retained = JSON.parse(stdout) as { title?: unknown; body?: unknown };
                  const retainedBody = typeof retained.title === 'string' && typeof retained.body === 'string'
                    ? retained.body
                    : recordAuthoringFailure(
                        request.pullRequestUrl,
                        'invalid',
                        'retained PR title or body is malformed.',
                      );
                  const applied = applyAuthoredPrProse({
                    currentBody: retainedBody,
                    prose,
                    isPlaceholder: (title, body) => isPlaceholderPrProse(title, body, deps.prTemplateBytes),
                  });
                  const appliedProse = applied.kind === 'apply'
                    ? applied
                    : recordAuthoringFailure(request.pullRequestUrl, 'invalid', applied.detail);
                  const operations = await retainedOperations(request.pullRequestUrl);
                  const mutation = await mutateRetainedPullRequest({
                    operations,
                    prUrl: request.pullRequestUrl,
                    operation: 'pull-request.edit',
                    payload: { title: appliedProse.title, body: appliedProse.body },
                  });
                  if (!mutation.ok) {
                    throw new PublicationOperationFailedError('pull-request.edit', mutation.message);
                  }
                  authoringFailureGuidanceByPr.delete(request.pullRequestUrl);
                  if (authoringOriginByPr.get(request.pullRequestUrl) === 'placeholder') {
                    authoredPlaceholderProsePendingByPr.add(request.pullRequestUrl);
                  }
                },
              }
            : {}),
          dispatchJudgment: async (request) => {
            await seedJudgmentStore();
            const revision = proseRevisionByPr.get(request.pullRequestUrl);
            const digest = revision === undefined ? undefined : revisionDigest(revision);
            const cached = digest === undefined ? undefined : judgmentByRevision.get(digest);
            if (cached) {
              // A persisted acceptance must also restore the prose-state
              // tracking a fresh coordinator lost, or the re-observed verdict
              // says "accepted" while classification still reads stale.
              if (cached.kind === 'accepted' && revision !== undefined) {
                acceptedProseRevisionByPr.set(request.pullRequestUrl, revision);
              }
              return cached;
            }
            const result = decodePrProseJudgment(await dispatchJudgment(request));
            if (revision !== undefined && result.kind === 'accepted') {
              acceptedProseRevisionByPr.set(request.pullRequestUrl, revision);
            }
            if (digest !== undefined && (result.kind === 'accepted' || result.kind === 'revision_required' || result.kind === 'refused')) {
              judgmentByRevision.set(digest, result);
              await persistJudgmentStore();
            }
            return result;
          },
          establishPr: {
            git: deps.git,
            gh: deps.gh,
            cwd: deps.projectRoot,
            branch: state.worktree_branch,
            baseBranch: deps.baseBranch,
            featureDesc: state.feature_desc,
            prTemplateBytes: deps.prTemplateBytes,
            remoteMutation: deps.remoteMutation ?? publication?.remoteMutation,
            remoteGit: deps.remoteGit,
            operations,
            events: deps.events,
            // FINISH runs AFTER the finish-time `rebase` step, which rewrites
            // the feature branch's history — same work, new SHAs. The branch
            // therefore diverges from its own remote by construction, and a
            // plain push is rejected non-fast-forward on every attempt, which
            // used to burn the whole publication retry budget and HALT the
            // feature. Publish with a lease so the expected self-inflicted
            // divergence goes through while an actually-moved remote is still
            // refused (`lease-rejected`, never a bare `--force`).
            pushMode: 'lease',
          },
          establishChildPrs: async () => {
            if (!state.feature_desc || !state.pr_url) throw new Error('missing stack publication identity');
            await establishChildPrs({
              root: deps.projectRoot,
              slug: state.feature_desc,
              leafUrl: state.pr_url,
              baseBranch: deps.baseBranch,
              template: deps.prTemplateBytes,
              git: deps.git,
              gh: deps.gh,
              operations,
              operationsForTarget,
              remoteMutation: publicationMutation,
              remoteMutationForTarget: mutationForRemoteRef,
              remoteGit: deps.remoteGit,
              events: deps.events,
            });
          },
          persistEstablishedPrUrl: async (prUrl) => {
            // A production run normally has a state file already. Preserve
            // the supplied current state if an isolated coordinator reaches
            // FINISH before that file has been materialized.
            if (!await exists(deps.stateFilePath)) {
              requireStateMutation(
                await replaceState(
                  deps.stateFilePath,
                  state,
                  'materialize missing finish publication state',
                ),
                'Finish publication state materialization',
              );
            }
            await savePrUrl(deps.stateFilePath, prUrl);
            state.pr_url = prUrl;
          },
          createShippedRecord: async () => {
            if (!state.feature_desc || !state.pr_url) throw new Error('missing shipment identity');
            const status = await writeShippedRecord({
              kind: 'write', slug: state.feature_desc, pr: state.pr_url,
              ...(deps.engineVersionId === undefined ? {} : { engineVersion: deps.engineVersionId }),
            }, deps.projectRoot);
            if (status !== 0) throw new Error('required shipped-record accepted-risk evidence could not be published');
            await copyRecordedReviewFindingsToShippedRecord(state.feature_desc);
          },
          assembleStack: async () => {
            if (!state.feature_desc || !state.pr_url) throw new Error('missing stack publication identity');
            await assembleStack({
              root: deps.projectRoot,
              slug: state.feature_desc,
              leafUrl: state.pr_url,
              baseBranch: deps.baseBranch,
              git: publicationRecordGit(deps.git, deps.projectRoot),
              gh: deps.gh,
              operations,
              operationsForTarget,
              refreshMemberBodies: true,
              template: deps.prTemplateBytes,
              events: deps.events,
            });
          },
          repairPresentation: async () => {
            if (!state.pr_url) throw new Error('missing PR identity');
            const prOperations = await retainedOperations(state.pr_url);
            if (!state.feature_desc) throw new Error('missing stack publication identity');
            const stackGit = publicationRecordGit(deps.git, deps.projectRoot);
            const cursor = await resolveObservationChild();
            const publicationRecord = cursor.kind === 'no-child'
              ? undefined
              : await activePublicationRecord(deps.projectRoot, state.feature_desc, { git: stackGit });
            const leaf = publicationRecord?.record.stack?.verified === true
              ? repositoryAndNumber(state.pr_url)
              : undefined;
            if (publicationRecord?.record.stack?.verified === true) {
              if (!leaf) throw new StackPublicationHaltError('stack_publication_precondition_failed', 'retained leaf URL is invalid');
              if (!prOperations) {
                throw new StackPublicationHaltError('stack_publication_precondition_failed', 'stack leaf ready boundary unavailable');
              }
              const leafMember = publicationRecord.record.members.at(-1);
              if (!leafMember || leafMember.pr !== leaf.number) {
                throw new StackPublicationHaltError('stack_publication_precondition_failed', 'stack publication record has no retained leaf tail');
              }
              await verifyStackBeforeReadyFlip({
                root: deps.projectRoot,
                slug: state.feature_desc,
                leaf,
                git: stackGit,
                gh: deps.gh,
                operations: prOperations,
                operationsForTarget,
                events: deps.events,
                position: leafMember.position,
              });
            }
            // The leaf retains the existing presentation repair, including its
            // release metadata and risk projections. Child-only work begins
            // only after that leaf flip has completed.
            await projectAcceptedRiskToRetainedPr(state.pr_url, prOperations);
            if (deps.repairPresentation) {
              await deps.repairPresentation({ prUrl: state.pr_url, state });
            } else {
              const mutation = await mutateRetainedPullRequest({
                operations: prOperations,
                prUrl: state.pr_url,
                operation: 'pull-request.ready',
              });
              if (!mutation.ok) throw new Error(mutation.message);
            }
            await readyStackChildren({
              root: deps.projectRoot,
              slug: state.feature_desc,
              leafUrl: state.pr_url,
              template: deps.prTemplateBytes,
              git: stackGit,
              gh: deps.gh,
              operations: prOperations,
              operationsForTarget,
              events: deps.events,
              stacked: publicationRecord?.record.stack?.verified === true,
            });
            if (!state.feature_desc) throw new Error('missing shipment identity');
            await projectShipmentPlanDeclarationToRetainedPr(state.pr_url, state.feature_desc, prOperations);
          },
          recordOutcome: async (request) => {
            if (request.choice === 'pr') {
              const prOperations = await retainedOperations(request.prUrl);
              await projectAcceptedRiskToRetainedPr(request.prUrl, prOperations);
              // AB-1: repairPresentation is NOT the only route to a completed PR
              // outcome. The selector returns record_outcome directly whenever the
              // retained PR is already non-draft (finish-publication.ts, `if
              // (!snapshot.pr.ready) return 'ready_pr'`), which covers both a PR
              // findOrCreatePr reused in ready state and a retry after a ready_pr
              // effect that marked the PR ready but then failed at declaration
              // maintenance — that retry observes `ready: !pr.isDraft` and skips
              // repairPresentation entirely. Binding the declaration to the same
              // choice === 'pr' rung the accepted-risk projection already occupies
              // makes the guard unconditional for a PR outcome. The upsert is
              // idempotent and edits only when the body changes, so the repaired
              // path re-reads here and issues no second edit. The keep rung
              // deliberately projects nothing.
              if (!state.feature_desc) throw new Error('missing shipment identity');
              await projectShipmentPlanDeclarationToRetainedPr(request.prUrl, state.feature_desc, prOperations);
            }
            // finish-record signals every fail-closed refusal as a non-zero exit
            // code, never a throw. Discarding it turned a refusal into a silent
            // no-op, so the loop halted on the generic "record_outcome left
            // outcomeRecord unchanged at missing" with the actual reason only
            // ever reaching the daemon log. Raise it so the failure is
            // attributed to the recorder that refused.
            const exitCode = await recordFinish(
              request.choice === 'pr'
                ? { kind: 'record', choice: 'pr', prUrl: request.prUrl, pipelineDir }
                : { kind: 'record', choice: 'keep', pipelineDir },
              deps.projectRoot,
              finishRecordRunners,
            );
            if (exitCode !== 0) {
              throw new Error(
                `finish-record refused to record the ${request.choice} outcome (exit ${exitCode}); `
                  + 'see the finish-record diagnostic in the run log for the refusal reason',
              );
            }
          },
        },
      });

      // A transition is intentionally one effect per attempt. The core
      // coordinator has verified the effect before reporting an advance. Keep
      // a completed prose-authoring transition observable to callers; it is
      // still routed as FINISH progress and therefore does not spend a retry.
      if (result.kind === 'advanced') {
        if (result.transition === 'author_pr_prose') return result;
        return {
          kind: 'publication_progress',
          transition: result.transition,
        };
      }
      return result;
    },
  };
}
