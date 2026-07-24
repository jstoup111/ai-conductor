// `conduct finish-record --choice <pr|keep|discard> [--pr-url <url>] --pipeline-dir <dir>`
// — argv detection for the finish-record subcommand (flag parser copied from
// shipped-record-cli.ts's `flag` helper).

import { isAbsolute, dirname, join } from 'node:path';
import { stat, writeFile } from 'node:fs/promises';
import { makeProductionGh, makeProductionGit } from './pr-labels.js';
import { headPushedToUpstream } from './push-evidence.js';
import { readState, writeState } from './state.js';

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

  // choice='pr' verification: the PR named by --pr-url must actually exist on
  // GitHub before anything is written. Fail-closed on ANY error — empty
  // stdout, a thrown gh error (missing binary → ENOENT, non-zero exit, etc.)
  // — never falls back to writing the keep/finish-choice marker anyway.
  if (cmd.choice === 'pr') {
    let stdout: string | undefined;
    try {
      const result = await deps.runGh(['pr', 'view', '--json', 'url', '-q', '.url'], {
        cwd: dirname(cmd.pipelineDir),
      });
      stdout = (result as { stdout?: string } | undefined)?.stdout;
    } catch (err) {
      console.error(
        `finish-record: gh pr view failed (${err instanceof Error ? err.message : String(err)}) — cannot verify PR ${cmd.prUrl} exists; refusing to record`,
      );
      return 1;
    }

    if (!stdout || !stdout.trim()) {
      console.error(
        `finish-record: gh pr view returned no URL — cannot verify PR ${cmd.prUrl} exists; refusing to record`,
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
