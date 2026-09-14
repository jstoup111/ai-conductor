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
import { dirname, join } from 'node:path';
import type { ConductState, FinishPublicationEvent, RunMode } from '../types/index.js';
import type { HarnessConfig } from '../types/config.js';
import type { StepRunResult } from './conductor.js';
import { type GhRunner, type GitRunner } from './pr-labels.js';
import { executeGithubOperation, type GithubOperationRunner } from './github-operations.js';
import { headPushedToUpstream } from './push-evidence.js';
import { dispatchShippedRecord } from './shipped-record-cli.js';
import { hasHaltSignal, isEngineFlooredBody } from './halt-pr-rehabilitation.js';
import { replaceState, requireStateMutation, savePrUrl, stepDone } from './state.js';
import { readAllVerdicts } from './gate-verdicts.js';
import { gateSatisfied } from './selector.js';
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
  type PublicationDisposition,
  type PrProseAuthoringRequest,
  type PrProseJudgmentRequest,
  type PrProseJudgmentResult,
} from './finish-publication.js';
import { createShipDraftPublicationDependencies } from './ship-draft-pr.js';
import { decodePrProseJudgment } from './finish-pr-prose-judgment.js';
import { upsertBuildReviewAcceptedRisk } from './build-review-accepted-risk.js';
import { BuildReviewDispositionStore, type BuildReviewDispositionRecord, type BuildReviewFeatureIdentity } from './build-review-dispositions.js';
import { resolveBuildReviewFeatureIdentity } from './build-review-effective.js';
import { parseBuildReviewAggregate } from './build-review-aggregate.js';
import { renderBuildReviewReducedCoverageEvidence } from './build-review-projections.js';
import {
  appendRecordedShipmentFindings,
  recordedShipmentFindings,
} from './shipment-association.js';
import { resolveShipmentIdentity } from './shipment-identity.js';
import {
  extractShipmentPlanDeclarations,
  upsertShipmentPlanDeclaration,
  withoutShipmentPlanDeclarations,
} from './shipment-plan-declaration.js';

export interface ProductionFinishPublicationCoordinator {
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
  /** Resolved PR base branch from the owning production composition root. */
  baseBranch: string;
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
  ) => Promise<'present' | 'missing' | 'stale' | 'malformed' | 'unavailable'>;
  /** Interactive intent comes from the host conversation, never finish-record output. */
  acquireInteractiveIntent?: () => Promise<unknown>;
  /**
   * Test-only injection for the canonical guarded PR mutation boundary. In
   * production this is derived from the feature's committed provenance by
   * `createShipDraftPublicationDependencies`; an absent boundary is a
   * refusal, never permission to fall back to raw `gh` writes.
   */
  operations?: GithubOperationRunner;
  /**
   * Production composition owns the ordered presentation repair.  Callers
   * inject the existing halt-rehabilitation/floor/ready composition so this
   * coordinator never silently reduces it to a `gh pr ready` flip.
   */
  repairPresentation?: (input: { prUrl: string; state: ConductState }) => Promise<void>;
  /** Task 38 seams: overridable in tests; production defaults resolve the real worktree identity and store. */
  resolveFeatureIdentity?: (projectRoot: string) => Promise<BuildReviewFeatureIdentity | undefined>;
  createDispositionStore?: (projectRoot: string) => Pick<BuildReviewDispositionStore, 'list' | 'listReducedCoverage'>;
}

export interface ProductionReleaseReadinessObserverInput {
  projectRoot: string;
  config?: HarnessConfig;
}

/** Applies the authoritative accepted-risk section to one already-retained PR. */
export async function publishAcceptedBuildReviewRiskToRetainedPr(input: {
  prUrl: string;
  body: string;
  records: readonly BuildReviewDispositionRecord[];
  operations?: GithubOperationRunner;
}): Promise<{ readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly message: string }> {
  const upserted = upsertBuildReviewAcceptedRisk(input.body, input.records);
  if (!upserted.ok) return upserted;
  if (upserted.changed) {
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
  payload?: { readonly body: string };
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

function upsertReducedCoverageEvidence(body: string, section: string | undefined): { ok: true; body: string; changed: boolean } | { ok: false; message: string } {
  const heading = '## Reduced build-review coverage';
  const start = body.indexOf(heading);
  const end = start === -1 ? -1 : body.indexOf('\n## ', start + heading.length);
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
): (state: ConductState) => Promise<'present' | 'missing' | 'stale' | 'malformed' | 'unavailable'> {
  const releaseStep = input.config?.steps?.['release-disposition'];
  if (releaseStep === undefined) return async () => 'present';

  const completionArtifact = releaseStep.completion_artifact;
  if (completionArtifact === undefined) return async () => 'malformed';
  const artifactPath = join(input.projectRoot, completionArtifact);

  return async (state) => {
    if ((state as Record<string, unknown>)['release-disposition'] !== 'done') return 'missing';
    if (!Number.isFinite(state.run_started_at)) return 'unavailable';
    try {
      const artifact = await lstat(artifactPath);
      if (!artifact.isFile()) return 'malformed';
      return artifact.mtimeMs < state.run_started_at! ? 'stale' : 'present';
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable';
    }
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

function prProse(
  title: unknown,
  body: unknown,
  halted: boolean,
  verdict: 'accepted' | 'deficient' | 'none',
): 'accepted' | 'revision_required' | 'stale' | 'placeholder' | 'halt' {
  const prTitle = typeof title === 'string' ? title : '';
  const prBody = typeof body === 'string' ? body : '';
  const text = `${prTitle}\n${prBody}`.trim();
  if (!text) return 'placeholder';
  if (halted) return 'halt';
  // The floor marker is provenance, not a verdict: it is an invisible comment
  // an authoring pass can preserve while rewriting every word around it, and
  // marker-presence-alone classification then pinned genuine prose at
  // 'placeholder' until the non-advancing-transition guard halted FINISH
  // (#1703). `isEngineFlooredBody` reads the body content instead, so an
  // intact floor still classifies as a placeholder and authored prose does
  // not.
  if (isEngineFlooredBody(prBody) || /Draft opened automatically/i.test(text)) {
    return 'placeholder';
  }
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
    const pipeline = join(deps.projectRoot, '.pipeline');
    const [prdAudit, asBuilt] = await Promise.all([
      readFile(join(pipeline, 'prd-audit.md'), 'utf8').catch(() => undefined),
      readFile(join(pipeline, 'architecture-review-as-built.md'), 'utf8').catch(() => undefined),
    ]);
    const findings = recordedShipmentFindings({ prdAudit, asBuilt });
    if (findings.length === 0) return;

    const relativeRecordPath = join('.docs', 'shipped', `${slug}.md`);
    const recordPath = join(deps.projectRoot, relativeRecordPath);
    const record = await readFile(recordPath, 'utf8');
    const next = appendRecordedShipmentFindings(record, findings);
    if (next === record) return;
    await writeFile(recordPath, next, 'utf8');
    await deps.git(['add', relativeRecordPath], { cwd: deps.projectRoot });
    await deps.git([
      'commit', '-m', `shipped record findings: ${slug}`, '--no-verify',
    ], { cwd: deps.projectRoot });
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
    const reducedCoverage = await store.listReducedCoverage(feature);
    if (!reducedCoverage.ok) throw new Error(`accepted-risk projection: ${reducedCoverage.message}`);
    const aggregate = await readFile(join(deps.projectRoot, '.pipeline', 'build-review.json'), 'utf8')
      .then((text) => parseBuildReviewAggregate(JSON.parse(text)))
      .catch(() => undefined);
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
    const { stdout } = await deps.gh(['pr', 'view', prUrl, '--json', 'body'], { cwd: deps.projectRoot });
    const body = (JSON.parse(stdout) as { body?: unknown }).body;
    const reducedCoverageBody = upsertReducedCoverageEvidence(
      typeof body === 'string' ? body : '',
      renderedReducedCoverage.section,
    );
    if (!reducedCoverageBody.ok) throw new Error(`accepted-risk projection: ${reducedCoverageBody.message}`);
    const acceptedRiskBody = upsertBuildReviewAcceptedRisk(reducedCoverageBody.body, listed.records);
    if (!acceptedRiskBody.ok) throw new Error(`accepted-risk projection: ${acceptedRiskBody.message}`);
    if (acceptedRiskBody.body !== (typeof body === 'string' ? body : '')) {
      const mutation = await mutateRetainedPullRequest({
        operations,
        prUrl,
        operation: 'pull-request.edit',
        payload: { body: acceptedRiskBody.body },
      });
      if (!mutation.ok) throw new Error(`accepted-risk projection: ${mutation.message}`);
    }
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
    const { stdout } = await deps.gh(['pr', 'view', prUrl, '--json', 'body'], { cwd: deps.projectRoot });
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
    async advance({ state, mode, daemon, dispatchJudgment, dispatchAuthoring, emit }) {
      const publication = await createShipDraftPublicationDependencies({
        cwd: deps.projectRoot,
        branch: state.worktree_branch,
        baseBranch: deps.baseBranch,
        featureDesc: state.feature_desc,
        git: deps.git,
        gh: deps.gh,
      });
      const operations = deps.operations ?? publication?.operations;
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
                await deps.gh(['auth', 'status'], { cwd: deps.projectRoot });
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
              const verdicts = await readAllVerdicts(deps.projectRoot);
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
                const { stdout } = await deps.gh(
                  ['pr', 'view', state.pr_url, '--json', 'url,title,body,isDraft,labels'],
                  { cwd: deps.projectRoot },
                );
                const pr = JSON.parse(stdout) as {
                  url?: unknown;
                  title?: unknown;
                  body?: unknown;
                  isDraft?: unknown;
                  labels?: unknown;
                };
                if (typeof pr.url === 'string') {
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
                    const observedProse = prProse(pr.title, pr.body, false, 'none');
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
                      ready: !pr.isDraft,
                    };
                }
                return { state: 'malformed' as const };
              } catch {
                return { state: 'unavailable' as const };
              }
            },
          },
          shippedRecord: {
            observeShippedRecord: async () =>
              state.feature_desc && await exists(join(deps.projectRoot, '.docs/shipped', `${state.feature_desc}.md`))
                ? 'present'
                : 'missing',
          },
          releaseReadiness: {
            observeReleaseReadiness: async () => {
              if (deps.observeReleaseReadiness === undefined) throw new Error('release-readiness observer unavailable');
              return deps.observeReleaseReadiness(state);
            },
          },
        },
      };
      const result = await advanceFinishPublication({
        // Re-read every boundary after an effect. The ports close over the
        // current filesystem/GitHub state, so no successful write is trusted
        // merely because its caller received a response.
        observe: async () =>
          observePublicationSnapshot(
            observationInput as Parameters<typeof observePublicationSnapshot>[0],
          ),
        emit,
        effects: {
          // Authoring is dispatched only when the engine itself observed an
          // unauthored body. The provider's reply is not inspected at all: the
          // coordinator re-observes the PR and only a body that no longer
          // carries the placeholder classification counts as progress.
          ...(dispatchAuthoring
            ? {
                authorProse: async (request: PrProseAuthoringRequest) => {
                  await dispatchAuthoring(request);
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
            remoteMutation: publication?.remoteMutation,
            operations: publication?.operations,
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
            const status = await writeShippedRecord({ kind: 'write', slug: state.feature_desc, pr: state.pr_url }, deps.projectRoot);
            if (status !== 0) throw new Error('required shipped-record accepted-risk evidence could not be published');
            await copyRecordedReviewFindingsToShippedRecord(state.feature_desc);
          },
          repairPresentation: async () => {
            if (!state.pr_url) throw new Error('missing PR identity');
            await projectAcceptedRiskToRetainedPr(state.pr_url, operations);
            if (deps.repairPresentation) {
              await deps.repairPresentation({ prUrl: state.pr_url, state });
            } else {
              const mutation = await mutateRetainedPullRequest({
                operations,
                prUrl: state.pr_url,
                operation: 'pull-request.ready',
              });
              if (!mutation.ok) throw new Error(mutation.message);
            }
            if (!state.feature_desc) throw new Error('missing shipment identity');
            await projectShipmentPlanDeclarationToRetainedPr(state.pr_url, state.feature_desc, operations);
          },
          recordOutcome: async (request) => {
            if (request.choice === 'pr') {
              await projectAcceptedRiskToRetainedPr(request.prUrl, operations);
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
              await projectShipmentPlanDeclarationToRetainedPr(request.prUrl, state.feature_desc, operations);
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
      // coordinator has verified the effect before reporting an advance, so
      // re-enter FINISH without charging it to the retry budget.
      if (result.kind === 'advanced') {
        return {
          kind: 'publication_progress',
          transition: result.transition,
        };
      }
      return result;
    },
  };
}
