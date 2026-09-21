/**
 * SHIP-phase-entry draft PR publisher.
 *
 * The implementation PR used to be born at `finish`, at the very end of the
 * run. Opening it at SHIP entry lets the remaining ship steps work against the
 * same draft while the implementation branch stays out of release-artifact
 * maintenance.
 *
 * So the PR is now opened as a **draft** at the START of the SHIP phase and the
 * finish step flips it ready-for-review (`ensureShipReady`, already wired
 * through `repairFinishPr` in conductor.ts and verified by the ship-readiness
 * check in `artifacts.ts`). A draft PR cannot be merged and is excluded from
 * autoresolve/CI-fix remediation in `mergeable-sweep.ts`, so nothing downstream
 * acts on the feature until finish has flipped it.
 *
 * Design constraints (mirrors `pr-labels.ts`):
 *   - Injected `GhRunner` / `GitRunner` — no raw `execFile`, no real binary in
 *     tests.
 *   - **Advisory**: every failure logs one loud line and returns an outcome.
 *     Nothing here ever throws into the conductor loop; only the finish-time
 *     publish is load-bearing.
 *   - **Never bare-force-pushes.** The default is a plain
 *     `git push -u origin <branch>`; a non-fast-forward rejection is reported,
 *     not forced through. A caller that has itself rewritten the branch's
 *     history may opt into `pushMode: 'lease'`, which adds
 *     `--force-with-lease` — never a bare `--force`, so a genuinely-moved
 *     remote still fails closed. See {@link OpenShipDraftPrDeps.pushMode}.
 */

import {
  makeProductionGh,
  makeProductionGit,
  type GhRunner,
  type GitRunner,
} from './pr-labels.js';
import { PR_BODY_FLOOR_MARKER, branchToFeatureDesc } from './halt-pr-rehabilitation.js';
import {
  executeGithubOperation,
  type GithubOperationEventEmitter,
  type GithubOperationRunner,
} from './github-operations.js';
import { executeRemoteGit } from './remote-git-operations.js';
import { createGuardedGithubOperationRunner, type GithubMutationExecutionContext } from './tracker-client.js';
import { readMachineOwnerConfig } from './owner-gate/machine-identity.js';
import { resolveDaemonOwner } from './owner-gate/identity.js';

/**
 * Human-readable note stamped into the placeholder body so a reader who lands
 * on the PR mid-build knows why it looks empty.
 */
export const SHIP_DRAFT_PR_NOTE =
  'Draft opened automatically at the start of the SHIP phase so the PR number exists ' +
  'for the remaining ship steps. The `/finish` step authors the real title and body and ' +
  'marks this PR ready for review.';

/**
 * Compose the placeholder body for a SHIP-entry draft PR.
 *
 * The shape is the `/pr` skill's body template — `## Why` / `## What Changed` /
 * `## Testing`, plus the issue-linking reference — because that is exactly what
 * the finish completion gate demands before a PR may ship. The draft used to
 * emit a lone `## Summary`, which is not that template: a reader landing on the
 * PR mid-build, and the finish agent reading it back, both saw the WRONG
 * section shape, and the gate's refusal named a template neither had ever been
 * shown.
 *
 * It is still unmistakably a placeholder:
 *   - {@link PR_BODY_FLOOR_MARKER} keeps it mechanically detectable
 *     (`readFlooredBody`) so `finish` can never mistake it for authored prose;
 *   - each section carries a visible "not yet authored" line, so a human reader
 *     is never misled into thinking the prose is real.
 *
 * The `Closes` reference is named as an HTML comment rather than a live line:
 * `injectIssueRef` appends the REAL `Closes owner/repo#N` right after this body
 * is published (via `makeRetainedShipPrPresentable`), and a literal placeholder
 * `Closes` line would either render broken or defeat that helper's idempotency
 * probe.
 *
 * Deliberately carries NO release metadata: choosing a release disposition is
 * the pre-finish `release-disposition` step's job, judged from the real diff.
 */
export function shipDraftPrBody(featureDesc: string): string {
  const placeholder = '_Not yet authored — `/finish` replaces this placeholder with the real body._';
  return [
    PR_BODY_FLOOR_MARKER,
    '',
    '## Why',
    '',
    featureDesc,
    '',
    placeholder,
    '',
    '## What Changed',
    '',
    placeholder,
    '',
    '## Testing',
    '',
    placeholder,
    '',
    '<!-- Closes <owner/repo#N> — added automatically when this feature came from an intake issue. -->',
    '',
    '---',
    '',
    SHIP_DRAFT_PR_NOTE,
    '',
  ].join('\n');
}

export interface OpenShipDraftPrDeps {
  gh?: GhRunner;
  git?: GitRunner;
  /** Repository (or worktree) root — cwd for every git/gh invocation. */
  cwd: string;
  /** The feature branch to publish. */
  branch: string | undefined;
  /** The PR base branch. */
  baseBranch: string | undefined;
  /** Feature description used for the placeholder title. */
  featureDesc?: string;
  /**
   * How the feature branch is published. Defaults to `'plain'`.
   *
   * This publisher is reached at two moments with DIFFERENT safety properties:
   *
   *   - **SHIP start** (`conductor.ts`, before/during the build) — the branch's
   *     history is untouched, so a rejection genuinely means the REMOTE moved.
   *     Forcing there would race the build's own later pushes. `'plain'`.
   *   - **FINISH `establish_pr`** (`finish-publication.ts`) — the finish-time
   *     `rebase` step has just rewritten the branch (same work, new SHAs), so
   *     divergence from its own remote is EXPECTED and self-inflicted and a
   *     plain push can never succeed. Before this opt-in existed, that push was
   *     rejected on every attempt, burned the whole publication retry budget,
   *     and HALTed the feature. `'lease'`.
   *
   * `'lease'` adds `--force-with-lease`, never a bare `--force`: if the remote
   * really did move under us, the lease is rejected and reported as
   * {@link OpenShipDraftPrResult} `lease-rejected` rather than clobbering it.
   */
  pushMode?: 'plain' | 'lease';
  /**
   * The guarded remote-write seam. Absent provenance is deliberately passed to
   * the guard and therefore refuses before the injected Git process boundary.
   */
  remoteGit?: typeof executeRemoteGit;
  remoteMutation?: GithubMutationExecutionContext;
  /** Existing event spine for refusal telemetry from the guarded push. */
  events?: GithubOperationEventEmitter;
  /** Guarded PR creation; an absent runner is a refusal, never a raw gh fallback. */
  operations?: GithubOperationRunner;
  log?: (msg: string) => void;
}

/** A production composition has these exact per-feature authorization seams. */
export interface ShipDraftPublicationDependencies {
  readonly remoteMutation: GithubMutationExecutionContext;
  readonly operations: GithubOperationRunner;
}

function repositoryFromOrigin(value: string): string | undefined {
  const remote = value.trim();
  const match = /^(?:git@github\.com:|https:\/\/github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(remote);
  if (!match) return undefined;
  return `${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
}

/**
 * A branch publication and a retained PR are different mutation targets. Keep
 * the ref binding for `git push`, but bind PR presentation writes to the exact
 * PR URL the caller has just resolved. A feature's provenance is never a
 * repository-wide capability.
 */
function pullRequestTargetFromUrl(
  prUrl: string,
  repository: string,
): { repository: string; kind: 'pull-request'; number: number } | undefined {
  const match = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/([1-9]\d*)\/?$/.exec(prUrl);
  if (!match || match[1].toLowerCase() !== repository.toLowerCase()) return undefined;
  return { repository, kind: 'pull-request', number: Number(match[2]) };
}

/**
 * Construct production-only authorization context from committed feature
 * evidence. The caller retains a typed absence when either remote identity or
 * feature provenance cannot be resolved; `openShipDraftPr` then refuses before
 * it can reach a write transport.
 */
export async function createShipDraftPublicationDependencies(input: {
  readonly cwd: string;
  readonly branch: string | undefined;
  readonly baseBranch: string | undefined;
  readonly featureDesc: string | undefined;
  /** When present, bind GitHub mutations to this retained PR rather than the branch ref. */
  readonly prUrl?: string;
  readonly git: GitRunner;
  readonly gh: GhRunner;
  readonly events?: GithubOperationEventEmitter;
}): Promise<ShipDraftPublicationDependencies | undefined> {
  if (!input.branch || input.branch === 'HEAD' || !input.baseBranch || !input.featureDesc) return undefined;
  let repository: string | undefined;
  try {
    repository = repositoryFromOrigin((await input.git(['config', '--get', 'remote.origin.url'], { cwd: input.cwd })).stdout);
  } catch {
    return undefined;
  }
  if (!repository) return undefined;
  const target = input.prUrl === undefined
    ? { repository, kind: 'remote-ref' as const, ref: `refs/heads/${input.branch}` }
    : pullRequestTargetFromUrl(input.prUrl, repository);
  if (!target) return undefined;
  const featureMarker = `.docs/intake/${input.featureDesc}.md`;
  const remoteMutation: GithubMutationExecutionContext = {
    provenance: {
      repository,
      defaultBranch: input.baseBranch,
      specBranch: input.branch,
      featureMarker,
      publication: 'initial',
      target,
    },
    dependencies: {
      resolveMachineOwner: async () => resolveDaemonOwner(
        await readMachineOwnerConfig(), input.gh, input.cwd,
      ),
      provenanceDiscovery: {
        readCommittedRecords: async ({ ref }) => {
          const { stdout } = await input.git(['show', `${ref}:${featureMarker}`], { cwd: input.cwd });
          return [{ path: featureMarker, content: stdout }];
        },
      },
    },
  };
  return {
    remoteMutation,
    operations: createGuardedGithubOperationRunner(input.gh, {
      cwd: input.cwd,
      mutation: remoteMutation,
      events: input.events,
    }),
  };
}

export type OpenShipDraftPrResult =
  /** Preconditions unmet (no branch, detached HEAD, no base) — nothing attempted. */
  | { outcome: 'skipped'; reason: string }
  /** Branch has nothing over base — never `gh pr create` on an empty branch. */
  | { outcome: 'no-commits' }
  /** The push was rejected or errored — no PR is opened off an unpushed branch. */
  | { outcome: 'push-failed'; reason: string }
  /**
   * `pushMode: 'lease'` only: the lease was rejected, i.e. the remote branch
   * carries work this checkout has never observed. Distinct from `push-failed`
   * on purpose — it names a genuinely-moved remote (someone or something else
   * pushed) rather than a transport/permission failure, and forcing past it
   * would destroy that work.
   */
  | { outcome: 'lease-rejected'; reason: string }
  /** A draft PR now exists for the branch (freshly created or already open). */
  | { outcome: 'published'; prUrl: string }
  /** gh could not publish — advisory failure, the build continues. */
  | { outcome: 'failed'; reason: string };

/**
 * Count commits on HEAD that are not on `base`. Tries the local base ref first
 * and falls back to `origin/<base>` (daemon worktrees frequently have no local
 * branch for the base). Returns null when neither ref resolves.
 */
async function commitsAheadOfBase(
  git: GitRunner,
  cwd: string,
  base: string,
  log: (msg: string) => void,
): Promise<number | null> {
  for (const ref of [base, `origin/${base}`]) {
    try {
      const { stdout } = await git(['rev-list', '--count', `${ref}..HEAD`], { cwd });
      const count = Number.parseInt(stdout.trim(), 10);
      if (Number.isFinite(count)) return count;
    } catch (err) {
      log(`[ship-draft-pr] rev-list against ${ref} failed: ${err}`);
    }
  }
  return null;
}

/**
 * Re-observe an OPEN PR without creating one. This is used only after an
 * indeterminate create-capable attempt, where another create could duplicate
 * an identity whose response was lost.
 */
async function reobserveOpenPr(
  gh: GhRunner,
  cwd: string,
  branch: string,
  log: (msg: string) => void,
): Promise<string | undefined> {
  try {
    const { stdout } = await gh(['pr', 'view', branch, '--json', 'url,state'], { cwd });
    const data: { url?: unknown; state?: unknown } = JSON.parse(stdout);
    return data.state === 'OPEN' && typeof data.url === 'string' && data.url.length > 0
      ? data.url
      : undefined;
  } catch (err) {
    log(`[ship-draft-pr] re-observation for ${branch} failed: ${err}`);
    return undefined;
  }
}

/**
 * Recognise git's stale-lease refusal. Mirrors the detection
 * `pushRefreshedBranch` (autoresolve.ts) already uses for the same lease push:
 * git reports `! [rejected] <ref> (stale info)` when the remote-tracking ref no
 * longer matches the remote.
 */
function isLeaseRejection(reason: string): boolean {
  return /stale info|stale-info|stale/i.test(reason);
}

/**
 * Push the feature branch and ensure an OPEN **draft** PR exists for it.
 *
 * Idempotent: `findOrCreatePr` returns an already-open PR untouched, so
 * re-entering SHIP (resume, kickback, rework) never opens a second PR and
 * never re-drafts a PR that finish already marked ready.
 */
export async function openShipDraftPr(
  deps: OpenShipDraftPrDeps,
): Promise<OpenShipDraftPrResult> {
  const log = deps.log ?? (() => {});
  const gh = deps.gh ?? makeProductionGh();
  const git = deps.git ?? makeProductionGit();
  const { cwd, branch, baseBranch } = deps;

  if (!branch || branch === 'HEAD') {
    const reason = branch ? 'detached HEAD' : 'no feature branch recorded';
    log(`[ship-draft-pr] skipping ship-start draft PR: ${reason}`);
    return { outcome: 'skipped', reason };
  }
  if (!baseBranch) {
    const reason = 'no base branch resolved';
    log(`[ship-draft-pr] skipping ship-start draft PR for ${branch}: ${reason}`);
    return { outcome: 'skipped', reason };
  }

  try {
    const ahead = await commitsAheadOfBase(git, cwd, baseBranch, log);
    if (ahead === null) {
      const reason = `cannot compare ${branch} against ${baseBranch}`;
      log(`[ship-draft-pr] skipping ship-start draft PR: ${reason}`);
      return { outcome: 'skipped', reason };
    }
    if (ahead === 0) {
      log(`[ship-draft-pr] ${branch} has no commits over ${baseBranch} — no draft PR opened`);
      return { outcome: 'no-commits' };
    }

    // Plain push by default: at SHIP start a rejection means the REMOTE moved,
    // and forcing would race the build's own later pushes. Only a caller that
    // has itself rewritten this branch's history (the FINISH-time rebase, via
    // `pushMode: 'lease'`) publishes with a lease — and a lease, never a bare
    // force, so an actually-moved remote is still refused.
    const lease = deps.pushMode === 'lease';
    const pushArgs = lease
      ? ['push', '-u', 'origin', `HEAD:refs/heads/${branch}`, '--force-with-lease']
      : ['push', '-u', 'origin', `HEAD:refs/heads/${branch}`];
    const pushed = await (deps.remoteGit ?? executeRemoteGit)(pushArgs, {
      cwd,
      config: (args) => git(args, { cwd }),
      runRemoteGit: git,
      mutation: deps.remoteMutation,
      events: deps.events,
    });
    if (pushed.kind !== 'executed') {
      const reason = pushed.kind === 'failed'
        ? pushed.error
        : pushed.kind === 'refused'
          ? `guarded remote publication refused: ${pushed.reason}`
          : 'guarded remote publication did not resolve an explicit destination';
      if (lease && isLeaseRejection(reason)) {
        log(
          `[ship-draft-pr] lease push of ${branch} was REJECTED — the remote carries unseen work; ` +
            `no draft PR opened and nothing was overwritten: ${reason}`,
        );
        return { outcome: 'lease-rejected', reason };
      }
      log(
        `[ship-draft-pr] push of ${branch} failed — no draft PR opened (advisory, build continues): ${reason}`,
      );
      return { outcome: 'push-failed', reason };
    }

    const featureDesc = deps.featureDesc?.trim() || branchToFeatureDesc(branch);
    const title = `feat: ${featureDesc}`;
    const body = shipDraftPrBody(featureDesc);

    let prUrl = await reobserveOpenPr(gh, cwd, branch, log);
    if (!prUrl) {
      if (!deps.operations) {
        const reason = 'guarded pull-request creation is unavailable';
        log(`[ship-draft-pr] ${reason}; no raw gh fallback was attempted`);
        return { outcome: 'failed', reason };
      }
      const created = await executeGithubOperation({
        operation: 'pull-request.create',
        repository: pushed.targets[0]!.repository,
        resource: { kind: 'repository' },
        context: { actor: 'ship-draft-pr', feature: deps.featureDesc },
        payload: { title, body, head: branch, base: baseBranch, draft: true },
      }, deps.operations);
      if (created.kind === 'refused') {
        const reason = `guarded pull-request creation refused: ${created.reason}`;
        log(`[ship-draft-pr] ${reason}`);
        return { outcome: 'failed', reason };
      }
      if (created.kind === 'partial') {
        const reason = 'guarded pull-request creation returned a partial result';
        log(`[ship-draft-pr] ${reason}`);
        return { outcome: 'failed', reason };
      }
      // A transport failure can happen after GitHub accepted the create. Do
      // not repeat that create-capable request; the lookup below is the only
      // safe recovery and distinguishes a lost response from a true failure.
      if (created.kind === 'failed') {
        log(`[ship-draft-pr] guarded pull-request creation response was unavailable: ${created.error}; re-observing once`);
      }
    }
    // GitHub can complete `pr create` and lose the response before the
    // runner receives a URL. Re-observe the branch without another
    // create-capable call: an unknown write outcome must never retry create.
    if (!prUrl) {
      prUrl = await reobserveOpenPr(gh, cwd, branch, log);
    }
    if (!prUrl) {
      const reason = `gh could not open or resolve a draft PR for ${branch}`;
      log(`[ship-draft-pr] ${reason} (advisory, build continues)`);
      return { outcome: 'failed', reason };
    }

    log(`[ship-draft-pr] ship-phase draft PR for ${branch}: ${prUrl}`);
    return { outcome: 'published', prUrl };
  } catch (err) {
    const reason = String(err);
    log(`[ship-draft-pr] ship-start draft PR failed for ${branch} (advisory): ${reason}`);
    return { outcome: 'failed', reason };
  }
}
