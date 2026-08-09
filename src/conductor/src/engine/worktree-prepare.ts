/**
 * Worktree-prepare module — owns **both** sides of the project-script boundary,
 * not preparation alone.
 *
 * A consumer project may supply two conventional entrypoints, and this module
 * is the sole runner for each: `bin/setup` (`SETUP_SCRIPT`, via
 * `runProjectSetup`) provisions whatever a feature build needs before it
 * starts, and `bin/teardown` (`TEARDOWN_SCRIPT`, via `runProjectTeardown`)
 * releases it immediately before the worktree is removed. Setup acquires,
 * teardown releases; keeping the pair here is what lets them share one
 * execution contract — the same executable resolution, the same
 * `sanitizeNamespace(basename(worktreePath))` namespace derivation, the same
 * `CI: 'true'` non-interactive environment, and the same output-tail helper —
 * rather than drifting apart in two modules.
 *
 * The module name says "prepare" while teardown is a removal-time concern.
 * That mismatch is a known, accepted cost of co-location, recorded as Option
 * A's con in `adr-2026-08-07-project-teardown-hook-contract-and-containment`
 * §3; this docblock is the mitigation the ADR requires in its place. Read the
 * name as "the project-script boundary", not "the pre-build step".
 *
 * Two divergences between the two runners are deliberate and easy to erase by
 * copying one onto the other (ADR §1, §2):
 *
 * - **The absent-script path is silent on the teardown side** and logs a skip
 *   notice on the setup side. FR-4 promises a non-adopting project
 *   byte-identical log output, so teardown emits no line at all when
 *   `bin/teardown` is absent.
 * - **Only teardown is time-bound**, via `execa`'s `timeout` (default 120s,
 *   overridable by `teardown_timeout_seconds`). There is deliberately no way
 *   to disable the bound — an unbounded project script sits in the daemon's
 *   critical path, which is the failure the ADR exists to prevent.
 *
 * `runProjectTeardown` is structurally contained (ADR §4): every failure mode
 * — non-zero exit, timeout, spawn error, missing execute permission — is
 * caught inside it and converted to a log entry. Its return type carries no
 * error and it never throws, so each of its three call sites invokes it as a
 * plain statement with no `try`/`catch` and still reaches removal on every
 * branch. Preserve that property when editing: moving a throw out of the
 * runner silently breaks all three callers at once.
 */
import { execa } from 'execa';
import { access, readFile, writeFile, mkdir, chmod, constants, rename, rm, stat, lstat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { PRE_COMMIT_HOOK, PREPARE_COMMIT_MSG_HOOK, COMMIT_MSG_HOOK } from './git-hook-assets.js';
import {
  PRE_DISPATCH_HOOK,
  DOCS_GUARD_HOOK,
} from './session-hook-assets.js';
import { resolveTeardownTimeoutSeconds } from './resolved-config.js';

/** Conventional, project-supplied setup entrypoint run before a feature build. */
export const SETUP_SCRIPT = join('bin', 'setup');

/** Conventional, project-supplied teardown entrypoint run before worktree removal. */
export const TEARDOWN_SCRIPT = join('bin', 'teardown');

/**
 * Skills declaring `operator_only: true` in their SKILL.md frontmatter.
 *
 * These exist for an operator debugging the harness from the outside; loading
 * one inside a dispatched step is a category error (a step that triages itself
 * reads its own in-flight state as evidence of failure). `bin/install` symlinks
 * every skill to user scope, so a step session would otherwise see them — the
 * suppression has to happen per-worktree, at dispatch, which is what
 * `wireSessionHookSettings` does via `skillOverrides`.
 *
 * Kept as an engine constant rather than parsed from frontmatter at dispatch
 * time: the engine has no reliable handle on the harness checkout from inside a
 * consumer's worktree. `test/test_harness_integrity.sh` asserts this list and
 * the frontmatter agree in both directions, so drift fails the build rather
 * than silently un-suppressing a skill.
 */
export const OPERATOR_ONLY_SKILLS: readonly string[] = ['daemon-triage'];

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

export interface SessionHookRepairOutcome {
  repaired: string[];
  failed: Array<{ file: string; error: string }>;
}

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
 * @param opts.verbose When true, echo `bin/setup`'s full output line-by-line
 *   into the log. Default (false) logs a one-line summary instead — a
 *   successful setup's output is dependency-manager chatter, and it dominated
 *   the daemon log (55% of lines) at no diagnostic value. Failures are
 *   unaffected: `SetupFailureError` still carries a 50-line output tail.
 */
export async function prepareWorktree(
  worktreePath: string,
  log?: (msg: string) => void,
  opts?: { verbose?: boolean },
): Promise<void> {
  const namespace = sanitizeNamespace(basename(worktreePath));
  await writeNamespaceEnv(worktreePath, namespace, log);
  // Write git hooks before setup so they exist even if setup fails
  await writeGitHooksAndWire(worktreePath, log);
  await ensureSessionHooks(worktreePath, log);
  await excludeEngineArtifacts(worktreePath, log);
  await runProjectSetup(worktreePath, namespace, log, opts?.verbose ?? false);
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
 * Merge active session hook entries into the worktree's
 * `.claude/settings.local.json`, preserving
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
): Promise<{ file: string; error: string } | undefined> {
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

    // Remove retired attribution-enforcement hooks from previously prepared
    // worktrees. They became no-ops under #773 and should not keep spawning a
    // shell process for every dispatch or mutation.
    hooks.PreToolUse = removeSessionHookEntries(hooks.PreToolUse, ['mutation-gate.sh']);
    hooks.PostToolUse = removeSessionHookEntries(hooks.PostToolUse, ['post-dispatch.sh']);

    hooks.PreToolUse = replaceSessionHookEntry(
      hooks.PreToolUse,
      'pre-dispatch.sh',
      { matcher: 'Task|Agent', hooks: [{ type: 'command', command: preDispatchPath }] },
    );
    // Docs-guard (#788): its own independent PreToolUse entry.
    const docsGuardPath = join(worktreePath, '.pipeline', 'session-hooks', 'docs-guard.sh');
    hooks.PreToolUse = replaceSessionHookEntry(
      hooks.PreToolUse,
      'docs-guard.sh',
      { matcher: 'Edit|Write|NotebookEdit', hooks: [{ type: 'command', command: docsGuardPath }] },
    );

    // Operator-only skills are suppressed for this dispatched-step session.
    // Merge-preserve: only the keys this engine owns are set, so an operator's
    // own skillOverrides entries in the worktree survive untouched.
    if (OPERATOR_ONLY_SKILLS.length > 0) {
      if (!settings.skillOverrides || typeof settings.skillOverrides !== 'object') {
        settings.skillOverrides = {};
      }
      const overrides = settings.skillOverrides as Record<string, unknown>;
      for (const skill of OPERATOR_ONLY_SKILLS) {
        overrides[skill] = 'off';
      }
    }

    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    log?.('session hook settings: wired into .claude/settings.local.json');
    if (OPERATOR_ONLY_SKILLS.length > 0) {
      log?.(`operator-only skills suppressed for this session: ${OPERATOR_ONLY_SKILLS.join(', ')}`);
    }
    return undefined;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.(`session hook settings: skipped (${msg})`);
    return { file: '.claude/settings.local.json', error: msg };
  }
}

/**
 * Return a copy of `existing` (a hooks array, or anything else on a fresh /
 * malformed file) with any entry that has the *same matcher* AND a command
 * containing `marker` removed, then `entry` appended. Matching on matcher +
 * marker together (not marker alone) keeps independently matched engine
 * entries isolated. Non-matching entries (e.g. an operator's own
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

function removeSessionHookEntries(existing: unknown, markers: string[]): Record<string, unknown>[] {
  const arr = Array.isArray(existing) ? (existing as Record<string, unknown>[]) : [];
  return arr.filter((entry) => {
    const entryHooks = (entry as { hooks?: Array<{ command?: string }> }).hooks;
    return !entryHooks?.some(
      (hook) => typeof hook.command === 'string' && markers.some((marker) => hook.command!.includes(marker)),
    );
  });
}

/**
 * Write the active session hook scripts to .pipeline/session-hooks/ and make
 * them executable. Retired no-op hook assets are removed from old worktrees.
 * Fail-open: logs and continues on any error, never throwing — provisioning
 * failures here must never block worktree setup.
 */
async function writeSessionHooks(
  worktreePath: string,
  log?: (msg: string) => void,
): Promise<SessionHookRepairOutcome> {
  const assets = [
    ['pre-dispatch.sh', PRE_DISPATCH_HOOK],
    ['docs-guard.sh', DOCS_GUARD_HOOK],
  ] as const;
  const outcome: SessionHookRepairOutcome = { repaired: [], failed: [] };
  const hooksDir = join(worktreePath, '.pipeline', 'session-hooks');

  try {
    await mkdir(hooksDir, { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.(`session hooks: skipped (${msg})`);
    return {
      repaired: [],
      failed: assets.map(([file]) => ({ file, error: msg })),
    };
  }

  for (const retired of ['post-dispatch.sh', 'mutation-gate.sh']) {
    try {
      await rm(join(hooksDir, retired), { force: true });
    } catch (err) {
      outcome.failed.push({
        file: retired,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const [file, content] of assets) {
    const path = join(hooksDir, file);
    try {
      const repaired = await sessionHookNeedsRepair(path, content);
      if (repaired) {
        await writeFile(path, content, 'utf-8');
        await chmod(path, 0o755);
        outcome.repaired.push(file);
      }
    } catch (err) {
      outcome.failed.push({
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (outcome.failed.length > 0) {
    log?.(`session hooks: skipped (${outcome.failed.map(({ error }) => error).join('; ')})`);
  } else {
    log?.('session hooks: written to .pipeline/session-hooks/');
  }
  return outcome;
}

async function sessionHookNeedsRepair(path: string, expectedContent: string): Promise<boolean> {
  try {
    const [content, metadata] = await Promise.all([readFile(path, 'utf-8'), stat(path)]);
    return content !== expectedContent || (metadata.mode & 0o777) !== 0o755;
  } catch {
    return true;
  }
}

/**
 * Re-provision the session-hook scripts and their settings wiring without
 * allowing a provisioning error to block the caller. The outcome identifies
 * scripts that changed and every file that could not be restored.
 */
export async function ensureSessionHooks(
  worktreeRoot: string,
  log?: (msg: string) => void,
): Promise<SessionHookRepairOutcome> {
  const scripts = await writeSessionHooks(worktreeRoot, log);
  const settingsFailure = await wireSessionHookSettings(worktreeRoot, log);
  return {
    repaired: scripts.repaired,
    failed: settingsFailure ? [...scripts.failed, settingsFailure] : scripts.failed,
  };
}

/**
 * Attribution hooks fail open, while the preventive pre-commit control fails
 * closed: a worktree without it must never enter BUILD/SHIP.
 */
async function writeGitHooksAndWire(
  worktreePath: string,
  log?: (msg: string) => void,
): Promise<void> {
  // Some unit-level setup tests exercise the project-script boundary in a
  // plain temporary directory rather than a Git worktree. There is no commit
  // surface to protect in that shape, so leave the historical no-op intact.
  // A present but inaccessible .git is different: it claims to be a checkout
  // but cannot receive the preventive hook, so fail closed before BUILD/SHIP.
  try {
    await lstat(join(worktreePath, '.git'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`preventive git hook installation failed: unable to inspect .git metadata: ${msg}`);
  }
  try {
    await stat(join(worktreePath, '.git'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`preventive git hook installation failed: unable to access .git metadata: ${msg}`);
  }
  try {
    await writeGitHooks(worktreePath, log);
    await wireGitHooks(worktreePath, log);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`preventive git hook installation failed: ${msg}`);
  }
}

/**
 * Write attribution and preventive hook scripts to .pipeline/git-hooks/.
 */
async function writeGitHooks(
  worktreePath: string,
  log?: (msg: string) => void,
): Promise<void> {
  const hooksDir = join(worktreePath, '.pipeline', 'git-hooks');
  await mkdir(hooksDir, { recursive: true });

  const preCommitPath = join(hooksDir, 'pre-commit');
  await writeFile(preCommitPath, PRE_COMMIT_HOOK, 'utf-8');
  await chmod(preCommitPath, 0o755);

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

/**
 * Run the project's `bin/teardown` if present. Like setup, teardown gets the
 * worktree's isolated namespace and a non-interactive CI environment.
 */
export async function runProjectTeardown(
  worktreePath: string,
  log?: (msg: string) => void,
  opts?: { verbose?: boolean; timeoutSeconds?: number },
): Promise<void> {
  const namespace = sanitizeNamespace(basename(worktreePath));
  const timeoutSeconds = opts?.timeoutSeconds ?? resolveTeardownTimeoutSeconds();

  try {
    await access(join(worktreePath, TEARDOWN_SCRIPT));
  } catch {
    return;
  }

  try {
    const result = await execa(join(worktreePath, TEARDOWN_SCRIPT), [], {
      cwd: worktreePath,
      all: true,
      env: {
        CI: 'true',
        [NAMESPACE_VAR]: namespace,
      },
      timeout: timeoutSeconds * 1000,
    });
    const lines = (result.all ?? '').split('\n').filter((line) => line.trim() !== '');
    if (opts?.verbose) {
      for (const line of lines) log?.(`teardown: ${line}`);
    } else if (lines.length > 0) {
      log?.(
        `teardown: ${lines.length} line(s) of output suppressed ` +
          `(set daemon_verbose: true to echo them)`,
      );
    }
  } catch (err) {
    if ((err as { timedOut?: unknown }).timedOut === true) {
      const detail = err instanceof Error ? err.message : String(err);
      const outputText =
        err !== null && typeof err === 'object' ? (err as { all?: unknown }).all : undefined;
      const outputTail = extractTail(
        typeof outputText === 'string' && outputText.trim() ? outputText : detail,
        50,
      );
      log?.(
        `teardown: timed out in ${worktreePath} after ${timeoutSeconds} second(s): ${outputTail}`,
      );
      return;
    }
    const detail = err instanceof Error ? err.message : String(err);
    const outputText = (err as { all?: unknown }).all;
    const outputTail = extractTail(
      typeof outputText === 'string' && outputText.trim() ? outputText : detail,
      50,
    );
    log?.(`teardown: failed in ${worktreePath}: ${outputTail}`);
  }
}

/** Run the project's `bin/setup` if present; no-op otherwise; throw on failure. */
async function runProjectSetup(
  worktreePath: string,
  namespace: string,
  log?: (msg: string) => void,
  verbose = false,
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
    // On success, `bin/setup`'s output is install/build chatter (npm audit
    // notices, blank spacer lines, publish-engine's machine-readable JSON).
    // Echoing it verbatim made setup passthrough 55% of the daemon log — and
    // it is only ever read when setup FAILS, where the 50-line tail on
    // SetupFailureError already carries it. Default to a one-line summary;
    // `daemon_verbose` restores the full echo. Blank lines are always dropped.
    if (result.all && result.all.trim()) {
      const lines = result.all
        .trim()
        .split('\n')
        .filter((line) => line.trim() !== '');
      if (verbose) {
        for (const line of lines) log?.(`setup: ${line}`);
      } else if (lines.length > 0) {
        log?.(
          `setup: ${lines.length} line(s) of output suppressed ` +
            `(set daemon_verbose: true to echo them)`,
        );
      }
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
