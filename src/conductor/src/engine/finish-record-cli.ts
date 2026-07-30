// `conduct finish-record --choice <pr|keep|discard> [--pr-url <url>] --pipeline-dir <dir>`
// — argv detection for the finish-record subcommand (flag parser copied from
// shipped-record-cli.ts's `flag` helper).

import { isAbsolute, dirname, join } from 'node:path';
import { stat, writeFile } from 'node:fs/promises';
import { makeProductionGh, makeProductionGit } from './pr-labels.js';
import { headPushedToUpstream } from './push-evidence.js';
import { readState, writeState } from './state.js';
// Single source of truth for the daemon's own branch shape (`feat/daemon-<slug>`,
// cut by `daemon-deps.ts` createWorktree). Reused rather than re-hardcoded here so
// the prefix literal cannot drift between the halt-PR sweep and finish-record.
import { featureSlugFromDaemonBranch } from './halt-pr-reconciliation.js';
import {
  evaluateShipmentEvidence,
  resolveImplementationPrBinding,
  type ShipmentEvidenceDependencies,
  type ShipmentEvidenceInput,
  type ShipmentEvidenceResult,
} from './shipment-evidence.js';

export type FinishRecordDispatch =
  | { kind: 'record'; choice: string; prUrl?: string; pipelineDir: string }
  | { kind: 'guide' };

// The only choices `dispatchFinishRecord` knows how to record. `discard` and
// any other value are recognized-but-unsupported here — they must guide, not
// silently fall through to the pipeline launcher (the render-diagrams lesson,
// bug #178).
const VALID_CHOICES = new Set(['pr', 'keep']);

export const FINISH_RECORD_USAGE =
  'conduct finish-record --choice <pr|keep> [--pr-url <url>] --pipeline-dir <dir>\n' +
  '  --choice pr      requires --pr-url <url>; writes pr_url into conduct-state.json\n' +
  '                   then the finish-choice marker.\n' +
  '  --choice keep    must NOT be paired with --pr-url; writes the finish-choice\n' +
  '                   marker only.\n' +
  '  --pipeline-dir   absolute path to the pipeline directory (required).';

/**
 * Parse argv for the `finish-record` subcommand.
 *   conduct finish-record --choice <pr|keep> [--pr-url <url>] --pipeline-dir <dir>
 *     → {kind:'record', choice, prUrl, pipelineDir}
 *   conduct finish-record [anything malformed]  → {kind:'guide'}
 *   (any other sub)                             → null
 *
 * Malformed args return `guide` (never null): a recognized-but-misused
 * subcommand must never fall through to the pipeline launcher.
 */
export function detectFinishRecordCommand(argv: string[]): FinishRecordDispatch | null {
  if (argv[2] !== 'finish-record') return null;
  const rest = argv.slice(3);
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(name);
    if (i === -1) return undefined;
    const v = rest[i + 1];
    return v && !v.startsWith('--') ? v : undefined;
  };
  const choice = flag('--choice');
  const prUrl = flag('--pr-url');
  const pipelineDir = flag('--pipeline-dir');
  if (!choice || !pipelineDir) return { kind: 'guide' };
  if (!VALID_CHOICES.has(choice)) return { kind: 'guide' };
  if (choice === 'pr' && !prUrl) return { kind: 'guide' };
  if (choice === 'keep' && prUrl) return { kind: 'guide' };
  return { kind: 'record', choice, prUrl, pipelineDir };
}

/**
 * Guide-only dispatch for this task's scope: prints usage and exits 1 for
 * `{kind:'guide'}`. The `{kind:'record'}` verification/write path is built out
 * in later tasks of the finish-record plan.
 */
export function dispatchFinishRecordGuide(cmd: FinishRecordDispatch): number {
  if (cmd.kind !== 'guide') return 0;
  console.error(FINISH_RECORD_USAGE);
  return 1;
}

/** Injectable spawn points so tests can assert zero gh/git invocations on refusal. */
export interface FinishRecordRunners {
  runGh: (args: string[], opts?: { cwd: string }) => Promise<{ stdout: string } | unknown>;
  runGit: (args: string[], opts?: { cwd: string }) => Promise<{ stdout: string }>;
  evaluateEvidence?: (
    input: ShipmentEvidenceInput,
    dependencies: ShipmentEvidenceDependencies,
  ) => Promise<ShipmentEvidenceResult>;
}

const noopRunners: FinishRecordRunners = {
  runGh: async () => {
    throw new Error('runGh not implemented');
  },
  runGit: async () => {
    throw new Error('runGit not implemented');
  },
};

/** Production runners: real gh/git, mirroring the pr-labels.ts injectable-seam
 * pattern (single production factory, defaulted so call-sites need no wiring). */
export function makeProductionFinishRecordRunners(): FinishRecordRunners {
  const gh = makeProductionGh();
  return {
    runGh: async (args: string[], opts?: { cwd: string }) => gh(args, { cwd: opts?.cwd ?? process.cwd() }),
    runGit: async (args: string[], opts?: { cwd: string }) => makeProductionGit()(args, { cwd: opts?.cwd ?? process.cwd() }),
  };
}

/**
 * Dispatches a `{kind:'record'}` finish-record command.
 *
 * Guard, checked FIRST, before any gh/git spawn or filesystem write:
 *   --pipeline-dir must be an absolute path to an existing directory. A
 *   relative path or a non-existent/non-directory absolute path causes an
 *   immediate refusal — exit 1, stderr explains an absolute existing
 *   directory is required, and neither gh nor git is ever spawned.
 *
 * Later tasks in this plan extend this function with the actual
 * verification/write logic for the `record` case.
 */
export async function dispatchFinishRecord(
  cmd: FinishRecordDispatch,
  _cwd: string,
  deps: FinishRecordRunners = noopRunners,
): Promise<number> {
  if (cmd.kind !== 'record') return dispatchFinishRecordGuide(cmd);

  if (!isAbsolute(cmd.pipelineDir)) {
    console.error(
      `finish-record: --pipeline-dir must be an absolute path (got "${cmd.pipelineDir}")`,
    );
    return 1;
  }

  let dirStat;
  try {
    dirStat = await stat(cmd.pipelineDir);
  } catch {
    console.error(
      `finish-record: --pipeline-dir "${cmd.pipelineDir}" does not exist; an absolute path to an existing directory is required`,
    );
    return 1;
  }

  if (!dirStat.isDirectory()) {
    console.error(
      `finish-record: --pipeline-dir "${cmd.pipelineDir}" is not a directory; an absolute path to an existing directory is required`,
    );
    return 1;
  }

  // Deterministic daemon-safety gate (Daemon Operations Safety rule 4: "a
  // manual PR is NOT a harness finish"): step-runners.ts sets
  // CONDUCT_DAEMON_AUTO_FINISH=1 in the environment for the WHOLE finish-step
  // process tree whenever the conductor is running the finish step in
  // unattended (auto/daemon) mode — before any agent prompt or shell command
  // runs. That makes this a machinery check, not prompt discipline: an agent
  // cannot avoid it by omitting a flag or misjudging remote/gh state, because
  // this process inherited the marker regardless of what command line it types.
  //
  // When that marker is present AND `choice=keep` AND the repo has at least
  // one configured git remote, refuse — daemon finishes with a remote MUST
  // resolve to an opened PR (`choice=pr`), never silently fall back to keep.
  // No remote configured is a legitimately different case (can't open a PR
  // with nothing to push to) and is left unaffected, as is any invocation
  // where the marker is absent (interactive/default-mode finishes, where a
  // human explicitly choosing Keep is a valid choice).
  if (cmd.choice === 'keep' && process.env.CONDUCT_DAEMON_AUTO_FINISH === '1') {
    const repoDir = dirname(cmd.pipelineDir);
    let remoteOutput: string;
    try {
      remoteOutput = (await deps.runGit(['remote'], { cwd: repoDir })).stdout;
    } catch (err) {
      console.error(
        `finish-record: unable to check configured git remotes (${err instanceof Error ? err.message : String(err)}) ` +
          '— refusing to record "keep" in unattended (auto/daemon) mode; a remote check must succeed before ' +
          'falling back to keep',
      );
      return 1;
    }
    if (remoteOutput.trim().length > 0) {
      console.error(
        'finish-record: refusing to record choice "keep" — a git remote is configured and this run is in ' +
          'unattended (auto/daemon) mode. Per Daemon Operations Safety rule 4 ("a manual PR is NOT a harness ' +
          'finish"), an unattended finish with a remote configured MUST resolve to an opened PR. Push the ' +
          'branch, open the PR with `gh pr create` (or reuse an existing one), and re-run with ' +
          '`--choice pr --pr-url <url>`. If PR creation itself fails, HALT for human review — do not fall ' +
          'back to keep.',
      );
      return 1;
    }
  }

  // choice='pr' verification: the PR named by --pr-url must actually exist on
  // GitHub before anything is written. Fail-closed on ANY error — empty
  // stdout, a thrown gh error (missing binary → ENOENT, non-zero exit, etc.)
  // — never falls back to writing the keep/finish-choice marker anyway.
  if (cmd.choice === 'pr') {
    const repoDir = dirname(cmd.pipelineDir);
    let implementationBinding;
    try {
      implementationBinding = await resolveImplementationPrBinding(
        async (args, opts) => {
          const result = await deps.runGh(args, opts);
          const stdout = (result as { stdout?: string } | undefined)?.stdout;
          return { stdout: stdout ?? '' };
        },
        repoDir,
        cmd.prUrl!,
      );
    } catch (err) {
      console.error(
        `finish-record: gh pr view failed (${err instanceof Error ? err.message : String(err)}) — cannot verify PR ${cmd.prUrl} identity and head; refusing to record`,
      );
      return 1;
    }

    if (implementationBinding.url !== cmd.prUrl || !implementationBinding.headRefOid) {
      console.error(
        `finish-record: gh pr view did not return the requested PR URL and head — refusing to record PR ${cmd.prUrl}`,
      );
      return 1;
    }

    // choice='pr' verification, second guard: the current HEAD must actually
    // have been pushed to its upstream tracking branch. Reuses the shared
    // push-evidence gate (local git only, no network) rather than
    // reimplementing merge-base ancestry logic here. Both `false` (not
    // pushed) and `null` (indeterminate — git error, no upstream, etc.)
    // refuse; fail-closed.
    const pushed = await headPushedToUpstream(deps.runGit, dirname(cmd.pipelineDir));
    if (pushed !== true) {
      console.error(
        `finish-record: HEAD has not been verified as pushed to its upstream branch (push-evidence check returned ${String(pushed)}) — refusing to record PR ${cmd.prUrl}`,
      );
      return 1;
    }

    // A PR URL and pushed HEAD only establish that a PR exists. The durable
    // shipment contract additionally requires the record committed on that
    // PR head to pass the shared strict evaluator before any terminal write.
    const statePath = join(cmd.pipelineDir, 'conduct-state.json');
    const stateResult = await readState(statePath);
    if (!stateResult.ok) {
      console.error(
        `finish-record: cannot read feature state from "${statePath}" (${stateResult.error.message}) — refusing to record PR ${cmd.prUrl}`,
      );
      return 1;
    }
    // Three sanctioned worktree-branch shapes, all recorded verbatim into
    // conduct-state.json at worktree-creation time:
    //   spec/<slug>, feature/<slug>  — interactive `WorktreeManager.create()`
    //   feat/daemon-<slug>           — daemon `createWorktree` (daemon-deps.ts)
    // Note `feat/` alone is NOT a sanctioned prefix: `feat/some-hand-cut-branch`
    // is a legitimate human branch name whose slug we must refuse to guess. The
    // distinguishing literal is the full `feat/daemon-`.
    const worktreeBranch = stateResult.value.worktree_branch;
    const branchSlug =
      worktreeBranch === undefined
        ? undefined
        : (worktreeBranch.match(/^(?:spec|feature)\/(.+)$/)?.[1] ??
          featureSlugFromDaemonBranch(worktreeBranch) ??
          undefined);
    if (worktreeBranch !== undefined && !branchSlug) {
      console.error(
        `finish-record: worktree_branch "${worktreeBranch}" is not a valid spec/<slug>, feature/<slug>, or feat/daemon-<slug> branch identity — refusing to record PR ${cmd.prUrl}`,
      );
      return 1;
    }
    const featureSlug = branchSlug ?? stateResult.value.feature_desc;
    if (!featureSlug) {
      console.error(
        `finish-record: cannot determine the feature slug from "${statePath}" — refusing to record PR ${cmd.prUrl}`,
      );
      return 1;
    }

    let candidateCommit: string;
    try {
      candidateCommit = (await deps.runGit(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
    } catch (err) {
      console.error(
        `finish-record: cannot resolve the PR head for durable evidence (${err instanceof Error ? err.message : String(err)}) — refusing to record PR ${cmd.prUrl}`,
      );
      return 1;
    }

    let evidence: ShipmentEvidenceResult;
    try {
      evidence = await (deps.evaluateEvidence ?? evaluateShipmentEvidence)(
        {
          repoDir,
          slug: featureSlug,
          implementationPr: cmd.prUrl!,
          candidateCommit,
        },
        {
          gitRunner: async (args) => {
            try {
              const result = await deps.runGit(args, { cwd: repoDir });
              return isMergeBaseAncestor(args) ? 'true' : result.stdout;
            } catch (error) {
              if (isMergeBaseAncestor(args) && exitCode(error) === 1) return 'false';
              throw error;
            }
          },
          githubRunner: async (implementationPr) => {
            if (implementationPr !== cmd.prUrl) {
              throw new Error(`unexpected implementation PR binding request: ${implementationPr}`);
            }
            return implementationBinding;
          },
        },
      );
    } catch (err) {
      console.error(
        `finish-record: durable shipment evidence is unavailable (${err instanceof Error ? err.message : String(err)}) — refusing to record PR ${cmd.prUrl}`,
      );
      return 1;
    }
    if (evidence.kind !== 'valid') {
      const detail =
        evidence.kind === 'refusal'
          ? `${evidence.code}: expected ${evidence.expected}, observed ${evidence.observed ?? 'none'}`
          : evidence.reason;
      console.error(
        `finish-record: durable shipment evidence refused (${detail}) — refusing to record PR ${cmd.prUrl}`,
      );
      return 1;
    }
  }

  // Ordered writes — commit point last. For `pr`, read-modify-write
  // conduct-state.json (preserving unknown fields, adding pr_url) BEFORE
  // writing the finish-choice marker; `keep` skips state entirely and
  // writes the marker only.
  //
  // Two guards protect against corrupting or partially committing state:
  //   1. Existing state JSON must parse before any write is attempted —
  //      corrupt JSON refuses immediately, leaving the file byte-identical
  //      (never silently coerced to `{}` and overwritten).
  //   2. If the state write throws (permissions, disk full, etc.), the
  //      finish-choice marker is never written — the marker is the commit
  //      point, and a failed state write means the commit never happened.
  const statePath = join(cmd.pipelineDir, 'conduct-state.json');
  const markerPath = join(cmd.pipelineDir, 'finish-choice');

  if (cmd.choice === 'pr') {
    const result = await readState(statePath);
    if (!result.ok) {
      console.error(
        `finish-record: existing state file "${statePath}" is corrupt (${result.error.message}) — refusing to record; file left untouched`,
      );
      return 1;
    }
    const state = result.value;
    state.pr_url = cmd.prUrl;
    try {
      await writeState(statePath, state);
    } catch (err) {
      console.error(
        `finish-record: failed to write state file "${statePath}" (${err instanceof Error ? err.message : String(err)}) — refusing to record; finish-choice marker not written`,
      );
      return 1;
    }
  }

  await writeFile(markerPath, `${cmd.choice}\n`, 'utf-8');

  if (cmd.choice === 'pr') {
    await writeFile(join(cmd.pipelineDir, 'DONE'), '', 'utf-8');
  }

  return 0;
}

function isMergeBaseAncestor(args: string[]): boolean {
  return args[0] === 'merge-base' && args[1] === '--is-ancestor';
}

function exitCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error &&
    typeof (error as { code?: unknown }).code === 'number'
    ? (error as { code: number }).code
    : undefined;
}
