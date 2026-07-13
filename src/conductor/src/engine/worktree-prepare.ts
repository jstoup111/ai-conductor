import { execa } from 'execa';
import { access, readFile, writeFile, mkdir, chmod, constants, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { PREPARE_COMMIT_MSG_HOOK, COMMIT_MSG_HOOK } from './git-hook-assets.js';
import {
  PRE_DISPATCH_HOOK,
  POST_DISPATCH_HOOK,
  MUTATION_GATE_HOOK,
  ENGINE_OWNED_DENY_RULES,
} from './session-hook-assets.js';

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
  await writeSessionHooks(worktreePath, log);
  await wireSessionHookSettings(worktreePath, log);
  await excludeEngineArtifacts(worktreePath, log);
  await runProjectSetup(worktreePath, namespace, log);
}

/**
 * Ensure the engine's own provisioned artifacts (`.claude/` for the session
 * hook settings) are invisible to git via the worktree's `info/exclude`.
 * Without this, a freshly-prepared worktree reads as dirty (`?? .claude/`) to
 * any porcelain-based consumer — most critically the setup-triage tree
 * classifier, which would mis-classify a clean tree as dirty and engage
 * quarantine machinery on the engine's own bookkeeping.
 *
 * Idempotent (skips entries already present) and fail-open like its siblings:
 * an exclusion failure never blocks worktree setup.
 */
async function excludeEngineArtifacts(
  worktreePath: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    const { stdout } = await execa(
      'git',
      ['-C', worktreePath, 'rev-parse', '--git-path', 'info/exclude'],
      { all: true },
    );
    const rel = stdout.trim();
    const excludePath = rel.startsWith('/') ? rel : join(worktreePath, rel);

    let existing = '';
    try {
      existing = await readFile(excludePath, 'utf-8');
    } catch {
      // No exclude file yet — start fresh.
    }
    const lines = new Set(existing.split('\n').map((l) => l.trim()));
    const wanted = ['.claude/'];
    const missing = wanted.filter((w) => !lines.has(w));
    if (missing.length === 0) {
      return;
    }
    await mkdir(join(excludePath, '..'), { recursive: true });
    const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    await writeFile(excludePath, `${existing}${sep}${missing.join('\n')}\n`, 'utf-8');
    log?.(`git exclude: engine artifacts excluded (${missing.join(', ')})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.(`git exclude: skipped (${msg})`);
  }
}

/**
 * Merge the session-lifecycle hook entries (pre-dispatch / post-dispatch /
 * mutation-gate) into the worktree's `.claude/settings.local.json`, preserving
 * any unrelated
 * settings already present. `.claude/settings.local.json` is untracked, so
 * this is safe to write directly.
 *
 * Merge-preserve semantics: replace only the hook entries whose command
 * points into `.pipeline/session-hooks/` (identified by matcher + command
 * substring), leaving every other key and hook entry untouched. Re-running
 * this is idempotent — a second pass replaces the same entries rather than
 * duplicating them.
 *
 * Fail-open: logs and continues on any error, never throwing — provisioning
 * failures here must never block worktree setup.
 */
async function wireSessionHookSettings(
  worktreePath: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    const claudeDir = join(worktreePath, '.claude');
    await mkdir(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, 'settings.local.json');

    let settings: Record<string, unknown> = {};
    try {
      const raw = await readFile(settingsPath, 'utf-8');
      settings = JSON.parse(raw);
    } catch (parseErr) {
      // No file yet is fine — start fresh silently. A file that exists but
      // fails to parse is corrupt: back it up rather than discarding it
      // silently, then continue with a fresh, valid settings object.
      let existed = true;
      try {
        await access(settingsPath);
      } catch {
        existed = false;
      }
      if (existed) {
        const backupPath = `${settingsPath}.bak-${Date.now()}`;
        await rename(settingsPath, backupPath);
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        log?.(
          `session hook settings: settings.local.json was corrupt/malformed (${msg}) — backed up to ${backupPath}`,
        );
      }
      settings = {};
    }

    if (!settings.hooks || typeof settings.hooks !== 'object') {
      settings.hooks = {};
    }
    const hooks = settings.hooks as Record<string, unknown>;

    const preDispatchPath = join(worktreePath, '.pipeline', 'session-hooks', 'pre-dispatch.sh');
    const postDispatchPath = join(worktreePath, '.pipeline', 'session-hooks', 'post-dispatch.sh');
    const mutationGatePath = join(worktreePath, '.pipeline', 'session-hooks', 'mutation-gate.sh');

    hooks.PreToolUse = replaceSessionHookEntry(
      hooks.PreToolUse,
      'pre-dispatch.sh',
      { matcher: 'Task|Agent', hooks: [{ type: 'command', command: preDispatchPath }] },
    );
    hooks.PostToolUse = replaceSessionHookEntry(
      hooks.PostToolUse,
      'post-dispatch.sh',
      { matcher: 'Task|Agent', hooks: [{ type: 'command', command: postDispatchPath }] },
    );
    // Mutation gate (#505 Surface B): two matcher entries sharing one script,
    // both on PreToolUse. Matched by matcher identity (not just command
    // substring) so adding/replacing one never evicts the other — both
    // entries' commands point at the same mutation-gate.sh.
    hooks.PreToolUse = replaceSessionHookEntry(
      hooks.PreToolUse,
      'mutation-gate.sh',
      { matcher: 'Edit|Write|NotebookEdit', hooks: [{ type: 'command', command: `${mutationGatePath} write` }] },
    );
    hooks.PreToolUse = replaceSessionHookEntry(
      hooks.PreToolUse,
      'mutation-gate.sh',
      { matcher: 'Bash', hooks: [{ type: 'command', command: `${mutationGatePath} bash` }] },
    );

    // #627 defense-in-depth: declarative deny rules for the engine-owned
    // .pipeline set. Docs-verified: permissions.deny applies in EVERY mode,
    // including bypassPermissions / --dangerously-skip-permissions (semantics
    // documented for v2.1.200+), so this layer is live in daemon builds. The
    // mutation-gate hook above stays PRIMARY — deny rules only see declared
    // tool inputs (file_path) and cannot inspect Bash heredoc/tee/interpreter
    // writes. Merge-preserve: existing deny rules are kept, ours are appended
    // deduped (idempotent across re-provisioning).
    const permissions =
      settings.permissions && typeof settings.permissions === 'object'
        ? (settings.permissions as Record<string, unknown>)
        : {};
    settings.permissions = permissions;
    const deny = Array.isArray(permissions.deny) ? (permissions.deny as unknown[]) : [];
    for (const rule of ENGINE_OWNED_DENY_RULES) {
      if (!deny.includes(rule)) deny.push(rule);
    }
    permissions.deny = deny;

    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    log?.('session hook settings: wired into .claude/settings.local.json');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.(`session hook settings: skipped (${msg})`);
  }
}

/**
 * Return a copy of `existing` (a hooks array, or anything else on a fresh /
 * malformed file) with any entry that has the *same matcher* AND a command
 * containing `marker` removed, then `entry` appended. Matching on matcher +
 * marker together (not marker alone) means several engine-owned entries can
 * share one hook script (e.g. the mutation-gate hook is wired under both an
 * `Edit|Write|NotebookEdit` and a `Bash` matcher) without one replace call
 * evicting the other's entry. Non-matching entries (e.g. an operator's own
 * hooks, or another engine entry with a different matcher) are preserved
 * untouched.
 */
function replaceSessionHookEntry(
  existing: unknown,
  marker: string,
  entry: Record<string, unknown>,
): Record<string, unknown>[] {
  const arr = Array.isArray(existing) ? (existing as Record<string, unknown>[]) : [];
  const entryMatcher = (entry as { matcher?: unknown }).matcher;
  const kept = arr.filter((e) => {
    const eMatcher = (e as { matcher?: unknown }).matcher;
    if (eMatcher !== entryMatcher) return true;
    const entryHooks = (e as { hooks?: Array<{ command?: string }> }).hooks;
    return !entryHooks?.some((h) => typeof h.command === 'string' && h.command.includes(marker));
  });
  kept.push(entry);
  return kept;
}

/**
 * Write the session-lifecycle hook scripts (pre-dispatch.sh, post-dispatch.sh,
 * mutation-gate.sh) to .pipeline/session-hooks/ and make them executable.
 * Fail-open: logs and continues on any error, never throwing — provisioning
 * failures here must never block worktree setup.
 */
async function writeSessionHooks(
  worktreePath: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    const hooksDir = join(worktreePath, '.pipeline', 'session-hooks');
    await mkdir(hooksDir, { recursive: true });

    const preDispatchPath = join(hooksDir, 'pre-dispatch.sh');
    await writeFile(preDispatchPath, PRE_DISPATCH_HOOK, 'utf-8');
    await chmod(preDispatchPath, 0o755);

    const postDispatchPath = join(hooksDir, 'post-dispatch.sh');
    await writeFile(postDispatchPath, POST_DISPATCH_HOOK, 'utf-8');
    await chmod(postDispatchPath, 0o755);

    const mutationGatePath = join(hooksDir, 'mutation-gate.sh');
    await writeFile(mutationGatePath, MUTATION_GATE_HOOK, 'utf-8');
    await chmod(mutationGatePath, 0o755);

    log?.('session hooks: written to .pipeline/session-hooks/');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.(`session hooks: skipped (${msg})`);
  }
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
