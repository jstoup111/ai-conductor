import { execa } from 'execa';
import { access, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** Conventional, project-supplied setup entrypoint run before a feature build. */
export const SETUP_SCRIPT = join('bin', 'setup');

/**
 * The env var the daemon writes into each worktree's `.env` to carry that
 * worktree's identity. Projects translate it into whatever per-worktree
 * resource naming they need (database name, redis namespace, …) in their own
 * config / `bin/setup`. Keeping it generic is what keeps the daemon
 * stack-agnostic.
 */
export const NAMESPACE_VAR = 'WORKTREE_NAMESPACE';

/**
 * Make a freshly-created feature worktree ready to build, before the conductor's
 * gate loop runs in it.
 *
 * Two responsibilities, both the *daemon's* (worktree creation is the daemon's
 * job, so the namespacing that flows from it is too):
 *
 *  1. **Write the namespace.** Set `WORKTREE_NAMESPACE=<worktree>` in the
 *     worktree's `.env` (idempotent). This is the single place per-worktree
 *     identity is established; the project's normal config consumes it (e.g.
 *     `database.yml` builds `app_<env>_<namespace>`), so concurrent worktrees
 *     never collide on one shared database.
 *  2. **Run the project's setup.** Execute the conventional `bin/setup` in the
 *     worktree with `CI=true` (so setup scripts skip interactive steps like
 *     starting a dev server) and `WORKTREE_NAMESPACE` exported. No `bin/setup`
 *     → no-op: the daemon stays infra-agnostic for projects that need nothing.
 *
 * Reusing the standard `bin/setup` (rather than a bespoke daemon-only script)
 * means the daemon runs exactly what a human / CI runs — `db:prepare` already
 * creates the namespaced database, dependencies install the same way, and there
 * is no second setup path to drift.
 *
 * Failure discipline: a non-zero exit from `bin/setup` throws. The caller
 * (`makeRunFeature`) catches it, keeps the worktree, and reports the feature as
 * errored — never building against a half-prepared environment.
 *
 * @param worktreePath Absolute path to the feature worktree.
 * @param log Optional progress sink (daemon log).
 */
export async function prepareWorktree(
  worktreePath: string,
  log?: (msg: string) => void,
): Promise<void> {
  const namespace = sanitizeNamespace(basename(worktreePath));
  await writeNamespaceEnv(worktreePath, namespace, log);
  await runProjectSetup(worktreePath, namespace, log);
}

/** Reduce a worktree dir name to a token safe as a database / resource name. */
export function sanitizeNamespace(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, '_');
}

/**
 * Idempotently set `WORKTREE_NAMESPACE=<namespace>` in the worktree's `.env`,
 * preserving any other entries (a fresh worktree usually has none, since `.env`
 * is gitignored and not materialized). Replaces an existing line rather than
 * appending a duplicate.
 */
async function writeNamespaceEnv(
  worktreePath: string,
  namespace: string,
  log?: (msg: string) => void,
): Promise<void> {
  const envPath = join(worktreePath, '.env');

  let existing = '';
  try {
    existing = await readFile(envPath, 'utf-8');
  } catch {
    // No .env yet — we'll create it.
  }

  const kept = existing.split('\n').filter((l) => !l.startsWith(`${NAMESPACE_VAR}=`));
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
  kept.push(`${NAMESPACE_VAR}=${namespace}`, '');

  await writeFile(envPath, kept.join('\n'), 'utf-8');
  log?.(`worktree env: ${NAMESPACE_VAR}=${namespace}`);
}

/** Run the project's `bin/setup` if present; no-op otherwise; throw on failure. */
async function runProjectSetup(
  worktreePath: string,
  namespace: string,
  log?: (msg: string) => void,
): Promise<void> {
  const script = join(worktreePath, SETUP_SCRIPT);

  try {
    await access(script);
  } catch {
    log?.('no bin/setup — skipping project setup');
    return;
  }

  log?.(`running ${SETUP_SCRIPT}`);
  try {
    const result = await execa(script, [], {
      cwd: worktreePath,
      all: true,
      env: { CI: 'true', [NAMESPACE_VAR]: namespace },
    });
    if (result.all && result.all.trim()) {
      for (const line of result.all.trim().split('\n')) log?.(`setup: ${line}`);
    }
    log?.('setup: ok');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`project setup (${SETUP_SCRIPT}) failed: ${detail}`);
  }
}
