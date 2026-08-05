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
 *   - **Never force-pushes.** Only a plain `git push -u origin <branch>`. A
 *     non-fast-forward rejection is reported, not forced through.
 */

import {
  findOrCreatePr,
  makeProductionGh,
  makeProductionGit,
  type GhRunner,
  type GitRunner,
} from './pr-labels.js';
import { PR_BODY_FLOOR_MARKER, branchToFeatureDesc } from './halt-pr-rehabilitation.js';

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
  log?: (msg: string) => void;
}

export type OpenShipDraftPrResult =
  /** Preconditions unmet (no branch, detached HEAD, no base) — nothing attempted. */
  | { outcome: 'skipped'; reason: string }
  /** Branch has nothing over base — never `gh pr create` on an empty branch. */
  | { outcome: 'no-commits' }
  /** The plain push was rejected — no PR is opened off an unpushed branch. */
  | { outcome: 'push-failed'; reason: string }
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

    // Plain push only. A rejection means the remote moved; forcing here would
    // race the build's own later pushes and the finish-time rebase.
    try {
      await git(['push', '-u', 'origin', branch], { cwd });
    } catch (err) {
      const reason = String(err);
      log(
        `[ship-draft-pr] push of ${branch} failed — no draft PR opened (advisory, build continues): ${reason}`,
      );
      return { outcome: 'push-failed', reason };
    }

    const featureDesc = deps.featureDesc?.trim() || branchToFeatureDesc(branch);
    const title = `feat: ${featureDesc}`;
    const body = shipDraftPrBody(featureDesc);

    const opts = { branch, base: baseBranch, draft: true, title, body };
    let { prUrl } = await findOrCreatePr(gh, cwd, opts, log);
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
