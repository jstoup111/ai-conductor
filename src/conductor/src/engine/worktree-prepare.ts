import { execa } from 'execa';
import { access, readFile, writeFile, mkdir, chmod, constants } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { PREPARE_COMMIT_MSG_HOOK, COMMIT_MSG_HOOK } from './git-hook-assets.js';

/** Conventional, project-supplied setup entrypoint run before a feature build. */
export const SETUP_SCRIPT = join('bin', 'setup');

/**
 * Thrown when `bin/setup` fails to run or exits non-zero. Carries the tail of
 * the script's output (last 50 lines) for triage.
 */
export class SetupFailureError extends Error {
  outputTail: string;

  constructor(message: string, outputTail: string) {
    super(message);
    this.name = 'SetupFailureError';
    this.outputTail = outputTail;
  }
}

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
  // Write git hooks before setup so they exist even if setup fails
  await writeGitHooksAndWire(worktreePath, log);
  await runProjectSetup(worktreePath, namespace, log);
}

/**
 * Write git hook scripts to the worktree and wire them via git config.
 * Fail-open: logs and continues on any error, never throwing.
 */
async function writeGitHooksAndWire(
  worktreePath: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    await writeGitHooks(worktreePath, log);
    await wireGitHooks(worktreePath, log);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.(`git hooks: skipped (${msg})`);
  }
}

/**
 * Write the two attribution hook scripts to .pipeline/git-hooks/ and make them executable.
 */
async function writeGitHooks(
  worktreePath: string,
  log?: (msg: string) => void,
): Promise<void> {
  const hooksDir = join(worktreePath, '.pipeline', 'git-hooks');
  await mkdir(hooksDir, { recursive: true });

  const prepareCommitMsgPath = join(hooksDir, 'prepare-commit-msg');
  await writeFile(prepareCommitMsgPath, PREPARE_COMMIT_MSG_HOOK, 'utf-8');
  await chmod(prepareCommitMsgPath, 0o755);

  const commitMsgPath = join(hooksDir, 'commit-msg');
  await writeFile(commitMsgPath, COMMIT_MSG_HOOK, 'utf-8');
  await chmod(commitMsgPath, 0o755);

  log?.('git hooks: written to .pipeline/git-hooks/');
}

/**
 * Wire the git hooks via git config: set extensions.worktreeConfig and core.hooksPath
 * to use the worktree-scoped .pipeline/git-hooks/ directory.
 *
 * Note: extensions.worktreeConfig must be enabled in the shared repository config
 * before we can use --worktree flag to set worktree-scoped configs.
 */
async function wireGitHooks(
  worktreePath: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    // Check if we have write access to the worktree's .git before attempting config changes.
    // This allows us to fail-open gracefully if .git is inaccessible or read-only.
    const worktreeGit = join(worktreePath, '.git');
    try {
      await access(worktreeGit, constants.W_OK);
    } catch {
      throw new Error(`no write access to git: ${worktreeGit}`);
    }

    // Enable extensions.worktreeConfig in the shared repository config.
    // This must be done once, not per worktree, before --worktree flags work.
    try {
      // Set it without --worktree to enable it in the shared (local) config
      await execa('git', ['-C', worktreePath, 'config', 'extensions.worktreeConfig', 'true'], { all: true });
    } catch {
      // If this fails, it might already be set or the repo might not support it.
      // We'll continue and ensure the worktree-scoped config is also set.
    }

    // Set extensions.worktreeConfig in the worktree-scoped config (redundant safety measure)
    await execa('git', ['-C', worktreePath, 'config', '--worktree', 'extensions.worktreeConfig', 'true'], { all: true });

    // Set core.hooksPath to the absolute path of the hooks directory (worktree-scoped only)
    const hooksPath = join(worktreePath, '.pipeline', 'git-hooks');
    await execa('git', ['-C', worktreePath, 'config', '--worktree', 'core.hooksPath', hooksPath], { all: true });

    log?.('git hooks: wired via core.hooksPath');
  } catch (err) {
    // Re-throw so the caller (writeGitHooksAndWire) can catch and log fail-open
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git config failed: ${msg}`);
  }
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
    // Extract output tail from the error (last 50 lines of combined stdout/stderr).
    // If there's no captured output (e.g., spawn failure), use the error message itself.
    let outputText = (err as any).all || '';
    if (!outputText.trim()) {
      outputText = detail;
    }
    const outputTail = extractTail(outputText, 50);

    throw new SetupFailureError(
      `project setup (${SETUP_SCRIPT}) failed: ${detail}`,
      outputTail,
    );
  }
}

/**
 * Extract the last `lines` lines from text, or all text if shorter.
 */
function extractTail(text: string, lines: number): string {
  const allLines = text.split('\n');
  const tail = allLines.slice(Math.max(0, allLines.length - lines));
  return tail.join('\n');
}
