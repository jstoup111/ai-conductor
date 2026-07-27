import { createHash } from 'node:crypto';
import { readdir, readFile, readlink } from 'node:fs/promises';
import { join, relative } from 'node:path';

interface Surface { root: string; label: string; exclude: readonly string[]; manifest: readonly Entry[]; }
interface Entry { path: string; digest: string; }
export interface LiveBoundarySnapshot { readonly surfaces: readonly Surface[]; }

/**
 * Volatile paths the harness WRITES ITSELF while a self-hosted build runs.
 * Fingerprinting them made the guard fail on its own bookkeeping (#985) — the
 * canary halted at the exact millisecond the daemon appended to `.daemon/`:
 *   `.git`       — the shared git dir; commits/fetches made from inside the
 *                  sandboxed worktree rewrite objects/refs/logs/index here.
 *   `.daemon`    — daemon runtime state; `daemon.log` is appended continuously.
 *   `.worktrees` — the per-feature checkouts the build is SUPPOSED to mutate;
 *                  they only fall inside this surface because the live checkout
 *                  and the project root are the same directory.
 *   `.pipeline`  — per-run pipeline state (task-status, evidence sidecar, gate
 *                  verdicts, `.memory-count-at-start`). The daemon writes into
 *                  the LIVE checkout's own `.pipeline/` while a self-host build
 *                  is in flight, so fingerprinting it halts the run on the
 *                  harness's own bookkeeping.
 *   `.claude/worktrees`
 *                — the throwaway checkouts agents isolate into. They live under
 *                  the live checkout but are NOT reached by `.worktrees` above,
 *                  so isolating an agent tripped the guard mid-run. Scoped to
 *                  this SUBTREE deliberately: `.claude/settings.json` and
 *                  `.claude/hooks/` are harness state the guard must protect,
 *                  and excluding all of `.claude` would blind it to them.
 * None of these is harness SOURCE, so everything the guard exists to protect
 * stays fingerprinted: adding, modifying or deleting a tracked source file
 * under the live checkout still trips it.
 */
const LIVE_CHECKOUT_VOLATILE: readonly string[] = [
  '.git', '.daemon', '.worktrees', '.pipeline', '.claude/worktrees',
];

/**
 * Noise the CURRENT provider's home accumulates from parties OTHER than the
 * sandboxed build: an unrelated interactive session sharing the machine, or a
 * background job the provider CLI runs on its own schedule. Unlike
 * `LIVE_CHECKOUT_VOLATILE` above, this surface is a LEAK DETECTOR — the
 * sandboxed build gets a throwaway provider home, so the LIVE home should
 * never change at all. Excluding a path here therefore trades away real
 * detection power, not just harness self-bookkeeping; see
 * `.docs/architecture/sequences/provider-neutral-self-host-isolation-907.md`.
 *
 * Every entry below is usage/log/cache telemetry that a genuine leak would
 * not plausibly announce itself through on its own — it is written by any
 * concurrent Claude process regardless of whether a self-host build is
 * running. Verified for #907: 18 files under a live `~/.claude` changed in a
 * 12-minute window during a real self-host run, written by an unrelated
 * interactive session and background jobs, not the sandboxed build:
 * `settings.json`, `history.jsonl`, `.last-cleanup`,
 * `plugins/known_marketplaces.json`, `shell-snapshots/*`, `backups/*`,
 * `sessions/*`. The remaining entries are the same category of noise,
 * confirmed by read-only inspection of a live `~/.claude` (file purpose +
 * observed churn), not by a second incident.
 *
 * DELIBERATELY NOT excluded, despite being verified noise in that same
 * incident: `settings.json`. It is genuinely ambiguous — most of the time an
 * unrelated interactive session changing a permission or hook setting, but a
 * self-host process reaching back and rewriting operator config/hooks is
 * exactly what this surface exists to catch. There is no clean way to tell
 * those apart from a diff alone. Excluding it would blind the guard to a
 * real leak into the most sensitive file this surface protects; keeping it
 * fingerprinted means an interactive settings change can trip a concurrent
 * build. This implementation keeps detection: `settings.json`,
 * `settings.local.json`, `CLAUDE.md`, `rules/`, `skills/`, and any other
 * config-like path not listed below stay fingerprinted.
 */
const CLAUDE_PROVIDER_STATE_VOLATILE: readonly string[] = [
  'history.jsonl',                    // append-only prompt/response log for every session on the machine
  '.last-cleanup',                    // background cleanup job's last-run timestamp
  'plugins/known_marketplaces.json',  // marketplace list cache refreshed by CLI startup/polling
  'shell-snapshots',                  // per-session recorded shell env for the Bash tool
  'backups',                          // rolling `.claude.json.backup.*` snapshots the CLI writes on its own save cycle
  'sessions',                         // per-process session index files, one per running Claude process
  'session-env',                      // per-session scratch env directories; churns continuously with any session
  'projects',                         // per-project session transcripts, appended on every turn of every session
  'tasks',                            // background task/loop bookkeeping (.lock/.highwatermark), unrelated to the build
  '.last-update-result.json',         // auto-updater's last-run result stamp
  'stats-cache.json',                 // usage/statistics aggregation cache
  'mcp-needs-auth-cache.json',        // cache of which MCP servers still need an auth prompt
  'cache',                            // misc read-through caches (issue lists, changelog mirrors, etc.)
];

/** Codex counterpart of `CLAUDE_PROVIDER_STATE_VOLATILE` — same leak-detector caveat applies. */
const CODEX_PROVIDER_STATE_VOLATILE: readonly string[] = [
  'history.jsonl',        // append-only prompt/response log for every session on the machine
  'sessions',              // per-day session transcripts under sessions/YYYY/MM/DD
  'shell_snapshots',       // per-session recorded shell env for the exec tool
  'cache',                 // read-through app-directory/server-info/tools/plugin-catalog caches
  'plugins/cache',         // installed-plugin cache refreshed on CLI startup
  'plugins/.remote-plugin-install-staging', // transient staging dir for plugin installs
  'mcp-oauth-locks',       // ephemeral lock files for the MCP oauth flow, not credential material
  '.tmp',                  // plugin-sync staging/lock files written by the CLI's own updater
  'tmp',                   // scratch dir (e.g. `arg0`) written by the CLI at startup
  'packages/standalone',   // self-update installer bookkeeping (current release, install lock)
  'models_cache.json',     // cache of available models, refreshed periodically
  'goals_1.sqlite', 'goals_1.sqlite-shm', 'goals_1.sqlite-wal',       // Codex's own goal-tracking DB, written by any running session
  'logs_2.sqlite', 'logs_2.sqlite-shm', 'logs_2.sqlite-wal',          // Codex's own internal log DB, written continuously
  'memories_1.sqlite', 'memories_1.sqlite-shm', 'memories_1.sqlite-wal', // Codex's own memory-store DB
  'state_5.sqlite', 'state_5.sqlite-shm', 'state_5.sqlite-wal',       // Codex's own session-state DB
];

/**
 * DELIBERATELY NOT excluded for Codex, for the same reason as Claude's
 * `settings.json`: `config.toml` (provider config) and `hooks.json` (hook
 * wiring — executes code) stay fingerprinted even though an unrelated
 * interactive Codex session editing either of them will trip a concurrent
 * build. `rules/`, `.sandbox_migration`, `installation_id`, and
 * `version.json` also stay fingerprinted: no churn was observed for them, so
 * excluding them buys no false-positive relief and would only cost
 * detection.
 */
function providerStateVolatile(provider: 'claude' | 'codex' | undefined): readonly string[] {
  if (provider === 'codex') return CODEX_PROVIDER_STATE_VOLATILE;
  if (provider === 'claude') return CLAUDE_PROVIDER_STATE_VOLATILE;
  return [];
}

/** True iff `path` (root-relative, POSIX-ish) is an excluded path or sits under one. */
function isExcluded(path: string, exclude: readonly string[]): boolean {
  return exclude.some(ex => path === ex || path.startsWith(`${ex}/`));
}

async function manifest(root: string, exclude: readonly string[]): Promise<Entry[]> {
  // Filter DURING the walk: an excluded subtree is never descended into, so
  // `.git` is neither hashed nor a source of transient mid-run read errors.
  const walk = async (dir: string): Promise<string[]> => {
    const entries = (await readdir(dir, { withFileTypes: true }))
      .filter(entry => !isExcluded(relative(root, join(dir, entry.name)), exclude));
    // `async` on the callback is load-bearing for lint, not for behaviour: it makes
    // every element a promise so `Promise.all` is not handed a mixed array.
    return (await Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(async entry =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
  };
  let files: string[];
  try {
    files = await walk(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [{ path: '<absent>', digest: '' }];
    throw error;
  }
  return Promise.all(files.map(async file => {
    const path = relative(root, file);
    const bytes = await readFile(file).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code === 'EISDIR' || error.code === 'ENOENT') return readlink(file);
      throw error;
    });
    return { path, digest: createHash('sha256').update(bytes).digest('hex') };
  })).then(entries => entries.filter(entry => !exclude.includes(entry.path)).sort((a, b) => a.path.localeCompare(b.path)));
}

export async function fingerprintLiveBoundary(args: {
  liveCheckout: string; unrelatedProviderState: string;
  provider?: 'claude' | 'codex'; selectedAuthPaths?: readonly string[];
}): Promise<LiveBoundarySnapshot> {
  const excluded = [...providerStateVolatile(args.provider), ...(args.selectedAuthPaths ?? [])];
  return { surfaces: [
    { root: args.liveCheckout, label: 'live checkout', exclude: LIVE_CHECKOUT_VOLATILE, manifest: await manifest(args.liveCheckout, LIVE_CHECKOUT_VOLATILE) },
    { root: args.unrelatedProviderState, label: 'provider state', exclude: excluded, manifest: await manifest(args.unrelatedProviderState, excluded) },
  ] };
}

export async function verifyLiveBoundary(snapshot: LiveBoundarySnapshot): Promise<{ ok: boolean; reason?: string }> {
  for (const surface of snapshot.surfaces) {
    const current = await manifest(surface.root, surface.exclude);
    if (JSON.stringify(current) !== JSON.stringify(surface.manifest)) {
      return { ok: false, reason: `${surface.label} changed during self-host execution.` };
    }
  }
  return { ok: true };
}
