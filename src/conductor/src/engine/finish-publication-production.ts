/**
 * Production composition for the engine-owned FINISH coordinator.
 *
 * All process and GitHub work stays behind the runners supplied here.  The
 * coordinator itself remains the pure/resumable lifecycle in
 * `finish-publication.ts`; this module is deliberately only its real-boundary
 * adapter.
 */
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ConductState, FinishPublicationEvent, RunMode } from '../types/index.js';
import type { StepRunResult } from './conductor.js';
import { HALT_PR_BANNER_SENTINEL, type GhRunner, type GitRunner } from './pr-labels.js';
import { headPushedToUpstream } from './push-evidence.js';
import { dispatchShippedRecord } from './shipped-record-cli.js';
import { NEEDS_REMEDIATION_TITLE_PREFIX } from './halt-pr-rehabilitation.js';
import { savePrUrl, writeState } from './state.js';
import {
  dispatchFinishRecord,
  type FinishRecordRunners,
} from './finish-record-cli.js';
import {
  advanceFinishPublication,
  observePublicationSnapshot,
  resolveInteractivePublicationIntent,
  resolveUnattendedPublicationIntent,
  type PublicationDisposition,
  type PrProseJudgmentRequest,
} from './finish-publication.js';

export interface ProductionFinishPublicationCoordinator {
  advance(input: {
    state: ConductState;
    mode: RunMode;
    daemon: boolean;
    dispatchJudgment(request: PrProseJudgmentRequest): Promise<StepRunResult>;
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
  observeReleaseReadiness?: () => Promise<'present' | 'missing' | 'stale' | 'malformed' | 'unavailable'>;
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
  if (/AI_CONDUCTOR_PR_BODY_FLOOR|Draft opened automatically/i.test(text)) return 'placeholder';
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

  return {
    async advance({ state, mode, daemon, dispatchJudgment, emit }) {
      const requestedOutcome = await readFile(join(pipelineDir, 'finish-choice'), 'utf8')
        .then((value) => value.trim())
        .catch(() => undefined);
      const intent =
        mode === 'interactive'
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
            observeImplementationEvidence: async () =>
              state.build_review === 'done' && state.test_suite === 'done' ? 'present' : 'missing',
            observeShipEvidence: async () =>
              state.manual_test === 'done' && state.architecture_review_as_built === 'done'
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
                return typeof pr.url === 'string'
                  ? {
                      state: 'one' as const,
                      url: pr.url,
                      prose: prProse(pr.title, pr.body),
                      ready: !pr.isDraft,
                    }
                  : { state: 'malformed' as const };
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
            observeReleaseReadiness: deps.observeReleaseReadiness ?? (async () => 'present'),
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
          dispatchJudgment: async (request) => {
            const result = await dispatchJudgment(request);
            return result.success ? { kind: 'accepted' } : { kind: 'provider_unavailable' };
          },
          establishPr: {
            git: deps.git,
            gh: deps.gh,
            cwd: deps.projectRoot,
            branch: state.worktree_branch,
            baseBranch: deps.baseBranch,
            featureDesc: state.feature_desc,
          },
          persistEstablishedPrUrl: async (prUrl) => {
            // A production run normally has a state file already. Preserve
            // the supplied current state if an isolated coordinator reaches
            // FINISH before that file has been materialized.
            if (!await exists(deps.stateFilePath)) {
              await writeState(deps.stateFilePath, state);
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
            await deps.gh(['pr', 'ready', state.pr_url], { cwd: deps.projectRoot });
          },
          recordOutcome: async (request) => {
            await recordFinish(
              request.choice === 'pr'
                ? { kind: 'record', choice: 'pr', prUrl: request.prUrl, pipelineDir }
                : { kind: 'record', choice: 'keep', pipelineDir },
              deps.projectRoot,
              deps.finishRecordRunners,
            );
          },
        },
      });

      // A transition is intentionally one effect per attempt. Re-enter FINISH
      // with a fresh observation instead of manufacturing completion from an
      // unverified write.
      if (result.kind === 'advanced') {
        return {
          kind: 'publication_retry',
          transition: result.transition,
          reason:
            result.transition === 'establish_pr'
              ? 'pr_identity_not_verified_after_establish'
              : result.transition === 'write_shipped_record'
                ? 'shipped_record_not_verified_after_write'
                : result.transition === 'judge_pr_prose'
                  ? 'judgment_provider_unavailable'
                  : result.transition === 'ready_pr'
                    ? 'presentation_not_verified_after_repair'
                    : 'outcome_record_not_verified_after_write',
        };
      }
      return result;
    },
  };
}
