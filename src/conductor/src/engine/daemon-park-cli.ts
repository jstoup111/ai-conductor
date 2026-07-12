// daemon-park-cli.ts — filesystem-direct, pre-boot CLI verbs for the
// operator-park marker: `conduct daemon park <slug>` and
// `conduct daemon unpark <slug>`.
//
// Both verbs act directly on `.daemon/parked/<slug>` via park-marker.ts —
// they never start the daemon/supervisor. This mirrors
// daemon-observe-cli.ts's detect/dispatch pattern (hand-rolled argv parsing,
// no heavy imports in the detector) so index.ts can decide whether to
// dispatch before the pipeline boots.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { writeOperatorPark, removeOperatorPark, isOperatorParked, getProvenanceType } from './park-marker.js';
import { resetNoEvidenceAttempts } from './task-evidence.js';

const execFile = promisify(execFileCb);

/**
 * Resolve the main repo root (the parent of `.git`) from any cwd — the
 * project root itself, or any directory inside a linked worktree.
 * `git rev-parse --git-common-dir` returns the same common `.git` dir for
 * the main checkout and every linked worktree, so its parent is the stable
 * "main repo root" regardless of which worktree/cwd we were invoked from.
 */
export async function resolveMainRepoRoot(
  startCwd: string,
): Promise<{ root: string } | { error: string }> {
  const NOT_A_PROJECT_ERROR =
    "not inside a conduct project — run 'daemon park <slug>' from the project root or any directory inside it";
  try {
    const { stdout } = await execFile('git', ['rev-parse', '--git-common-dir'], {
      cwd: startCwd,
    });
    const raw = stdout.trim();
    if (!raw) {
      return { error: NOT_A_PROJECT_ERROR };
    }
    const absoluteCommonDir = isAbsolute(raw) ? raw : resolve(startCwd, raw);
    return { root: dirname(absoluteCommonDir) };
  } catch {
    return { error: NOT_A_PROJECT_ERROR };
  }
}

export type DaemonParkDispatch =
  | { kind: 'park'; slug: string }
  | { kind: 'unpark'; slug: string };

/**
 * Detect a `conduct daemon park <slug>` / `conduct daemon unpark <slug>`
 * command. Returns null for anything else — including a bare `daemon park`
 * with no slug, which is not actionable. `argv` is `process.argv`
 * (`[node, entry, 'daemon', 'park'|'unpark', slug, ...]`).
 */
export function detectDaemonParkCommand(argv: string[]): DaemonParkDispatch | null {
  const args = argv.slice(2);
  if (args[0] !== 'daemon') return null;
  const sub = args[1];
  if (sub !== 'park' && sub !== 'unpark') return null;
  const slug = args[2];
  if (!slug) return null;
  return { kind: sub, slug };
}

/**
 * Validate that `slug` refers to a real unit of work before we let `park`
 * write a marker for it. A slug is considered known if either its plan file
 * (`.docs/plans/<slug>.md`) or its worktree directory (`.worktrees/<slug>`)
 * exists — either one alone is sufficient. This guards against typo'd or
 * stale slugs silently parking nothing.
 */
export function validateSlug(slug: string, cwd: string = process.cwd()): boolean {
  const planPath = join(cwd, '.docs', 'plans', `${slug}.md`);
  const worktreePath = join(cwd, '.worktrees', slug);
  return existsSync(planPath) || existsSync(worktreePath);
}

export interface DaemonParkDeps {
  /** Project/repo root the marker is written under (tests inject a tmp dir). */
  cwd?: string;
  /** Output sink (tests capture lines; default: console.log). */
  out?: (line: string) => void;
}

/**
 * Execute a `park`/`unpark` verb against the park-marker primitives.
 *
 * Never throws: any error (e.g. the root is unwritable) is caught, reported
 * via `out`, and surfaced as a non-zero exit code so the caller can
 * `process.exit(code)` without a thrown escape — mirroring
 * dispatchDaemonSupervisor's error handling.
 */
export async function dispatchDaemonPark(
  cmd: DaemonParkDispatch,
  deps: DaemonParkDeps = {},
): Promise<number> {
  const cwd = deps.cwd ?? process.cwd();
  const out = deps.out ?? ((l: string) => console.log(l));

  try {
    if (cmd.kind === 'park') {
      if (!validateSlug(cmd.slug, cwd)) {
        out(
          `error: slug '${cmd.slug}' not found under ${cwd} (no .docs/plans/${cmd.slug}.md or .worktrees/${cmd.slug})`,
        );
        return 1;
      }
      const alreadyParked = await isOperatorParked(cwd, cmd.slug);
      await writeOperatorPark(cwd, cmd.slug);
      if (alreadyParked) {
        const markerPath = join(cwd, '.daemon', 'parked', cmd.slug);
        let since = '';
        try {
          const body = await readFile(markerPath, 'utf-8');
          const firstLine = body.split('\n')[0]?.trim();
          if (firstLine) since = ` (originally parked at ${firstLine})`;
        } catch {
          // Best-effort — marker is present (we just confirmed via
          // isOperatorParked), but if it can't be read, omit the timestamp.
        }
        out(`'${cmd.slug}' is already parked${since} — no change.`);
      } else {
        out(
          `Parked '${cmd.slug}' — it will not be dispatched or re-kicked until unparked.`,
        );
      }
    } else {
      const wasParked = await isOperatorParked(cwd, cmd.slug);
      if (!wasParked) {
        out(`'${cmd.slug}' was not operator-parked — nothing to do.`);
        return 0;
      }

      // Check if this is an auto-parked feature (not operator-parked)
      // If so, reset the no-evidence counter when unparking
      const provenance = await getProvenanceType(cwd, cmd.slug);
      if (provenance === 'auto') {
        await resetNoEvidenceAttempts(cwd);
        out(`Unparked '${cmd.slug}' and reset no-evidence counter — normal dispatch and re-kick resume.`);
      } else {
        out(`Unparked '${cmd.slug}' — normal dispatch and re-kick resume.`);
      }

      await removeOperatorPark(cwd, cmd.slug);
    }
    return 0;
  } catch (err) {
    out(`Could not ${cmd.kind} '${cmd.slug}': ${(err as Error).message}`);
    return 1;
  }
}
