import { execa } from 'execa';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Conventional, project-supplied infrastructure bring-up script. The daemon
 * looks for this executable at the worktree root before building a feature.
 */
export const PREFLIGHT_SCRIPT = join('bin', 'daemon-preflight');

/**
 * Run a project's infrastructure preflight inside a feature worktree, before the
 * conductor's gate loop builds against it.
 *
 * This is the harness's *opt-in, no-assumptions* infra hook. The daemon itself
 * stays stack-agnostic: it knows nothing about Docker, Postgres, Redis, or any
 * particular service. It only knows the convention — if a project ships an
 * executable `bin/daemon-preflight`, run it in the worktree first; otherwise do
 * nothing and proceed exactly as before.
 *
 * That convention is what lets one daemon serve *any* project setup:
 *   - Projects with shared, namespaced infra put their `docker compose up -d`,
 *     readiness wait, and per-worktree `DATABASE_URL`/namespace generation in
 *     the script. Two worktrees can build concurrently without colliding.
 *   - Projects with no infra (a static site, a pure library, a different stack)
 *     simply don't ship the script — the daemon never assumes one exists.
 *
 * Failure discipline: a non-zero exit (or a non-executable script) throws. The
 * caller (`makeRunFeature`) catches it, keeps the worktree for inspection, and
 * reports the feature as errored — which is correct. Building against infra that
 * failed to come up would only produce a misleading cascade of test failures
 * and burn a full build cycle; failing loudly here surfaces the real cause.
 *
 * The script runs with the worktree as its working directory, so it can derive a
 * per-worktree namespace from its own location (e.g. `basename "$PWD"`).
 *
 * @param worktreePath Absolute path to the feature worktree (the script's cwd).
 * @param log Optional progress sink (daemon log).
 */
export async function runInfraPreflight(
  worktreePath: string,
  log?: (msg: string) => void,
): Promise<void> {
  const script = join(worktreePath, PREFLIGHT_SCRIPT);

  // Opt-in: a project that ships no preflight script is left untouched. We treat
  // "absent" as the signal to no-op so the daemon stays infra-agnostic by
  // default. A script that exists but is broken (non-executable, non-zero exit)
  // is NOT silently skipped — execa surfaces it as a throw below.
  try {
    await access(script);
  } catch {
    return;
  }

  log?.(`preflight: running ${PREFLIGHT_SCRIPT}`);
  try {
    const result = await execa(script, [], { cwd: worktreePath, all: true });
    if (result.all && result.all.trim()) {
      for (const line of result.all.trim().split('\n')) log?.(`preflight: ${line}`);
    }
    log?.('preflight: ok');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`infra preflight (${PREFLIGHT_SCRIPT}) failed: ${detail}`);
  }
}
