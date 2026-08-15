/**
 * Production composition for the engine-owned FINISH coordinator.
 *
 * All process and GitHub work stays behind the runners supplied here.  The
 * coordinator itself remains the pure/resumable lifecycle in
 * `finish-publication.ts`; this module is deliberately only its real-boundary
 * adapter.
 */
import { access, lstat, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ConductState, FinishPublicationEvent, RunMode } from '../types/index.js';
import type { HarnessConfig } from '../types/config.js';
import type { StepRunResult } from './conductor.js';
import { HALT_PR_BANNER_SENTINEL, type GhRunner, type GitRunner } from './pr-labels.js';
import { headPushedToUpstream } from './push-evidence.js';
import { dispatchShippedRecord } from './shipped-record-cli.js';
import {
  NEEDS_REMEDIATION_TITLE_PREFIX,
  PR_BODY_FLOOR_MARKER,
} from './halt-pr-rehabilitation.js';
import { replaceState, requireStateMutation, savePrUrl, stepDone } from './state.js';
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
import { decodePrProseJudgment } from './finish-pr-prose-judgment.js';
import { upsertBuildReviewAcceptedRisk } from './build-review-accepted-risk.js';
import { BuildReviewDispositionStore, type BuildReviewDispositionRecord, type BuildReviewFeatureIdentity } from './build-review-dispositions.js';
import { resolveBuildReviewFeatureIdentity } from './build-review-effective.js';

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
   * Production composition owns the ordered presentation repair.  Callers
   * inject the existing halt-rehabilitation/floor/ready composition so this
   * coordinator never silently reduces it to a `gh pr ready` flip.
   */
  repairPresentation?: (input: { prUrl: string; state: ConductState }) => Promise<void>;
  /** Task 38 seams: overridable in tests; production defaults resolve the real worktree identity and store. */
  resolveFeatureIdentity?: (projectRoot: string) => Promise<BuildReviewFeatureIdentity | undefined>;
  createDispositionStore?: (projectRoot: string) => Pick<BuildReviewDispositionStore, 'list'>;
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
  gh: GhRunner;
  cwd: string;
}): Promise<{ readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly message: string }> {
  const upserted = upsertBuildReviewAcceptedRisk(input.body, input.records);
  if (!upserted.ok) return upserted;
  if (upserted.changed) await input.gh(['pr', 'edit', input.prUrl, '--body', upserted.body], { cwd: input.cwd });
  return { ok: true, changed: upserted.changed };
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

function prProse(title: unknown, body: unknown): 'accepted' | 'stale' | 'placeholder' | 'halt' {
  const prTitle = typeof title === 'string' ? title : '';
  const prBody = typeof body === 'string' ? body : '';
  const text = `${prTitle}\n${prBody}`.trim();
  if (!text) return 'placeholder';
  if (
    prTitle.toLowerCase().startsWith(NEEDS_REMEDIATION_TITLE_PREFIX) ||
    prBody.includes(HALT_PR_BANNER_SENTINEL)
  ) return 'halt';
  if (prBody.includes(PR_BODY_FLOOR_MARKER) || /Draft opened automatically/i.test(text)) {
    return 'placeholder';
  }
  return 'accepted';
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
  // A real provider session is expensive. Retain terminal prose verdicts for
  // the exact observed title/body revision; a changed revision earns one new
  // session, while an unchanged deficient one cannot burn retries.
  const proseRevisionByPr = new Map<string, string>();
  const judgmentByRevision = new Map<string, PrProseJudgmentResult>();
  // Interactive authority is acquired once per coordinator lifetime. A retry
  // must re-observe publication state, not ask the operator to re-authorize
  // the same requested outcome.
  let attendedRequestedOutcome: Promise<unknown> | undefined;
  // Task 38: the retained PR is the durable projection surface for accepted
  // build-review risk. Every retained-PR maintenance effect applies the
  // authoritative upsert, and an unrenderable or unwritable projection blocks
  // the effect instead of letting an accepted finding silently disappear.
  const projectAcceptedRiskToRetainedPr = async (prUrl: string) => {
    const feature = await (deps.resolveFeatureIdentity ?? resolveBuildReviewFeatureIdentity)(deps.projectRoot);
    // No feature identity means no feature-scoped disposition state can exist
    // (a non-worktree FINISH): there is nothing to project. Everything past
    // this point fails closed — an unreadable store or unrenderable section
    // blocks the effect instead of letting accepted risk disappear.
    if (!feature) return;
    const listed = await (deps.createDispositionStore
      ?? ((root: string) => new BuildReviewDispositionStore(root)))(deps.projectRoot).list(feature);
    if (!listed.ok) throw new Error(`accepted-risk projection: ${listed.message}`);
    const { stdout } = await deps.gh(['pr', 'view', prUrl, '--json', 'body'], { cwd: deps.projectRoot });
    const body = (JSON.parse(stdout) as { body?: unknown }).body;
    const published = await publishAcceptedBuildReviewRiskToRetainedPr({
      prUrl,
      body: typeof body === 'string' ? body : '',
      records: listed.records,
      gh: deps.gh,
      cwd: deps.projectRoot,
    });
    if (!published.ok) throw new Error(`accepted-risk projection: ${published.message}`);
  };

  return {
    async advance({ state, mode, daemon, dispatchJudgment, dispatchAuthoring, emit }) {
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
            // A step the engine resolved by SKIPPING is resolved evidence, not
            // absent evidence: `stepDone` is the same 'done' || 'skipped'
            // predicate every other resolution site uses. Comparing to 'done'
            // alone reported a legitimately skipped step as missing, which
            // preflight maps to `*_evidence_invalid` — a disposition the router
            // deliberately has no rule for, so every technical-track feature
            // (no manual_test, no prd_audit) halted at FINISH with all work
            // green.
            observeImplementationEvidence: async () =>
              stepDone(state, 'build_review') && stepDone(state, 'test_suite')
                ? 'present'
                : 'missing',
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
                  ['pr', 'view', state.pr_url, '--json', 'url,title,body,isDraft'],
                  { cwd: deps.projectRoot },
                );
                const pr = JSON.parse(stdout) as { url?: unknown; title?: unknown; body?: unknown; isDraft?: unknown };
                if (typeof pr.url === 'string') {
                  proseRevisionByPr.set(pr.url, `${pr.url}\u0000${JSON.stringify([pr.title ?? '', pr.body ?? ''])}`);
                  return {
                      state: 'one' as const,
                      url: pr.url,
                      prose: prProse(pr.title, pr.body),
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
                },
              }
            : {}),
          dispatchJudgment: async (request) => {
            const revision = proseRevisionByPr.get(request.pullRequestUrl);
            const cached = revision === undefined ? undefined : judgmentByRevision.get(revision);
            if (cached) return cached;
            const result = decodePrProseJudgment(await dispatchJudgment(request));
            if (revision !== undefined && (result.kind === 'accepted' || result.kind === 'revision_required' || result.kind === 'refused')) {
              judgmentByRevision.set(revision, result);
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
            await writeShippedRecord({ kind: 'write', slug: state.feature_desc, pr: state.pr_url }, deps.projectRoot);
          },
          repairPresentation: async () => {
            if (!state.pr_url) throw new Error('missing PR identity');
            await projectAcceptedRiskToRetainedPr(state.pr_url);
            if (deps.repairPresentation) {
              await deps.repairPresentation({ prUrl: state.pr_url, state });
              return;
            }
            await deps.gh(['pr', 'ready', state.pr_url], { cwd: deps.projectRoot });
          },
          recordOutcome: async (request) => {
            if (request.choice === 'pr') await projectAcceptedRiskToRetainedPr(request.prUrl);
            await recordFinish(
              request.choice === 'pr'
                ? { kind: 'record', choice: 'pr', prUrl: request.prUrl, pipelineDir }
                : { kind: 'record', choice: 'keep', pipelineDir },
              deps.projectRoot,
              finishRecordRunners,
            );
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
