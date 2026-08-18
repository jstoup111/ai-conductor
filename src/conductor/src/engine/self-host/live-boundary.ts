import { createHash } from 'node:crypto';
import { execFile as execFileCb } from 'node:child_process';
import { readdir, readFile, readlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { redactSafetyText } from '../safety-diagnostics.js';
import { type ContainmentVerdict } from './live-containment.js';

const execFile = promisify(execFileCb);

interface Surface {
  root: string;
  label: string;
  exclude: readonly string[];
  excludeDirectoryBasenames?: readonly string[];
  manifest: readonly Entry[];
}
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
 *   `src/conductor/dist-versions`
 *                — generated versioned distribution snapshots. Scoped to this
 *                  exact subtree so same-named source directories elsewhere
 *                  remain fingerprinted.
 *   `node_modules` — dependency and tool-cache trees at any nesting depth. The
 *                    exact directory basename is excluded; lookalikes remain
 *                    fingerprinted, and `.gitignore` is deliberately not used.
 * None of these is harness SOURCE, so everything the guard exists to protect
 * stays fingerprinted. After a mismatch, tracked Git modifications/deletions
 * (`M`/`D`) on this surface are treated as operator edits and do not halt;
 * untracked paths and indeterminate/failed Git classification still halt
 * fail-closed. Git cannot identify the writer, so an escaped process rewriting
 * already-tracked content is indistinguishable from an operator edit and is
 * the accepted residual gap in this guard.
 */
export const LIVE_CHECKOUT_VOLATILE: readonly string[] = [
  '.git', '.daemon', '.worktrees', '.pipeline', '.claude/worktrees',
  'src/conductor/dist-versions',
];
const LIVE_CHECKOUT_VOLATILE_DIRECTORY_BASENAMES: readonly string[] = ['node_modules'];

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
 *
 * `file-history` added after five halts on 2026-07-28 (build_review,
 * maintain-documentation and three `architecture_review_as_built` steps, all
 * dispatched `via claude`). Every halt window contained fresh
 * `file-history/<session-uuid>/<hash>@vN` entries written by UNRELATED
 * interactive sessions — the CLI snapshots every file it edits there, so any
 * concurrent session editing a file tripped the guard. The sandboxed build
 * writes its own snapshots under its throwaway `CLAUDE_CONFIG_DIR`, so
 * excluding this costs no leak detection: the subtree holds edited-file
 * content only, never config, hooks, or credentials. `paste-cache` is the
 * same category (per-session scratch for large pasted inputs).
 *
 * `downloads`, `settings.json.bak` and `ai-conductor.config.json` were left
 * fingerprinted: no churn was observed for them, and the latter two are
 * config-like — a self-host process rewriting harness config in the operator
 * home is exactly what this surface exists to catch.
 */
const CLAUDE_PROVIDER_STATE_VOLATILE: readonly string[] = [
  'history.jsonl',                    // append-only prompt/response log for every session on the machine
  '.last-cleanup',                    // background cleanup job's last-run timestamp
  'plugins/known_marketplaces.json',  // marketplace list cache refreshed by CLI startup/polling
  'plugins/marketplaces',             // per-marketplace catalog (marketplace.json, .gcs-sha) the
                                       // CLI re-syncs on its own schedule — same cache-churn
                                       // category as known_marketplaces.json above, not operator
                                       // config; verified 2026-07-29 as the sole diff (2 changed,
                                       // 0 added/removed) behind a false live-boundary halt
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
  'file-history',                     // per-session snapshots of every file any concurrent session edits
  'paste-cache',                      // per-session scratch for large pasted inputs
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
  'thread-writer-locks',   // one zero-byte lock per OPEN Codex thread, created and deleted by the
                           // CLI as threads come and go. Same category as mcp-oauth-locks above:
                           // no config, no hook wiring, no credential material — the file's very
                           // existence is the whole signal, and its content is always empty.
                           // Verified 2026-08-10 as the sole diff ("4 added, 0 removed, 0 changed")
                           // behind a false halt that discarded a build whose step had already
                           // succeeded. Because the locks vanish when their thread closes, the halt
                           // fired only when a concurrent session happened to hold a thread open at
                           // a dispatch boundary — intermittent, and unattributable from the reason.
  '.tmp',                  // plugin-sync staging/lock files written by the CLI's own updater
  'tmp',                   // scratch dir (e.g. `arg0`) written by the CLI at startup
  'packages/standalone',   // self-update installer bookkeeping (current release, install lock)
  'models_cache.json',     // cache of available models, refreshed periodically
  // Codex's own SQLite stores at the provider-state ROOT — `goals_1`, `logs_2`,
  // `memories_1`, `state_5` today — plus their WAL sidecars, written continuously
  // by any running session. Matched by pattern rather than enumerated because the
  // trailing digit is Codex's SCHEMA GENERATION: when Codex bumps one (`state_5`
  // -> `state_6`) or adds a store, the enumerated name stops matching, the new
  // file churns through its `-wal`/`-shm`, and every self-host build halts until
  // the list is patched. `*` matches a root-level basename only (see
  // `isExcluded`), so nothing under a subdirectory is affected and the live
  // checkout surface — which declares no patterns — is untouched.
  '*.sqlite', '*.sqlite-shm', '*.sqlite-wal', '*.sqlite-journal',
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

/**
 * True iff the root-level basename `path` matches `pattern`, where `*` stands for
 * any run of non-separator characters. Deliberately ROOT-LEVEL ONLY: a path
 * containing a separator never matches, so a pattern can never reach into a
 * subdirectory and silently blind the guard to (say)
 * `skills/evil/state_9.sqlite`.
 */
function matchesRootPattern(path: string, pattern: string): boolean {
  if (path.includes('/')) return false;
  const source = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  return new RegExp(`^${source}$`).test(path);
}

/**
 * True iff `path` (root-relative, POSIX-ish) is an excluded path, sits under one,
 * or matches a root-level `*` pattern. An exclusion entry containing `*` is a
 * pattern; every other entry keeps the exact-or-prefix semantics it always had.
 */
function isExcluded(path: string, exclude: readonly string[]): boolean {
  return exclude.some(ex => ex.includes('*')
    ? matchesRootPattern(path, ex)
    : path === ex || path.startsWith(`${ex}/`));
}

async function manifest(
  root: string,
  exclude: readonly string[],
  excludeDirectoryBasenames: readonly string[] = [],
): Promise<Entry[]> {
  // Filter DURING the walk: an excluded subtree is never descended into, so
  // `.git` is neither hashed nor a source of transient mid-run read errors.
  const walk = async (dir: string): Promise<string[]> => {
    const entries = (await readdir(dir, { withFileTypes: true }))
      .filter(entry => !(entry.isDirectory() && excludeDirectoryBasenames.includes(entry.name)))
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
    {
      root: args.liveCheckout,
      label: 'live checkout',
      exclude: LIVE_CHECKOUT_VOLATILE,
      excludeDirectoryBasenames: LIVE_CHECKOUT_VOLATILE_DIRECTORY_BASENAMES,
      manifest: await manifest(
        args.liveCheckout,
        LIVE_CHECKOUT_VOLATILE,
        LIVE_CHECKOUT_VOLATILE_DIRECTORY_BASENAMES,
      ),
    },
    { root: args.unrelatedProviderState, label: 'provider state', exclude: excluded, manifest: await manifest(args.unrelatedProviderState, excluded) },
  ] };
}

/** Most paths named in a halt reason before it collapses to a bare count. */
const MAX_REPORTED_PATHS = 8;

/**
 * The differing entries between two manifests, split by KIND. Added vs removed
 * vs changed are diagnostically different: a removal is a deletion in the
 * operator's live environment, an addition is usually unlisted churn from a
 * concurrent session, and a digest change is a rewrite.
 */
function diffManifests(before: readonly Entry[], after: readonly Entry[]): {
  added: string[]; removed: string[]; changed: string[];
} {
  const priorDigests = new Map(before.map(entry => [entry.path, entry.digest]));
  const currentDigests = new Map(after.map(entry => [entry.path, entry.digest]));
  const added: string[] = []; const removed: string[] = []; const changed: string[] = [];
  for (const [path, digest] of currentDigests) {
    if (!priorDigests.has(path)) added.push(path);
    else if (priorDigests.get(path) !== digest) changed.push(path);
  }
  for (const path of priorDigests.keys()) if (!currentDigests.has(path)) removed.push(path);
  return { added, removed, changed };
}

/**
 * Distinguishes tracked working-tree edits from unexplained live-checkout drift.
 * Git cannot identify the writer, so a sandbox escape that rewrites a tracked
 * file is indistinguishable from an operator edit and receives the same result.
 */
async function classifyLiveCheckoutDiff(
  root: string,
  paths: readonly string[],
): Promise<Map<string, 'operator-edit' | 'unexplained'>> {
  const classifications = new Map<string, 'operator-edit' | 'unexplained'>(
    paths.map(path => [path, 'unexplained']),
  );
  try {
    const { stdout } = await execFile('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--', ...paths]);
    for (const record of stdout.split('\0').filter(Boolean)) {
      if (record.length < 4 || record[2] !== ' ') continue;
      const status = record.slice(0, 2);
      const path = record.slice(3);
      if (classifications.has(path) && ['M ', ' M', 'MM', 'D ', ' D'].includes(status)) {
        classifications.set(path, 'operator-edit');
      }
    }
  } catch {
    // Fail closed: every requested path remains unexplained.
  }
  return classifications;
}

/**
 * A bounded, redacted, kind-tagged rendering of a manifest diff.
 *
 * Bounded because this string lands in `daemon.log`: a diff of a few thousand
 * entries (a cache directory the exclusion list does not cover yet) would
 * otherwise flood the log and bury the halt itself. Redacted because a provider
 * state path is operator-supplied text — paths under `~/.codex` and `~/.claude`
 * are not secret in themselves, and the credential files (`auth.json`,
 * `.credentials.json`) are already excluded via `selectedAuthPaths` so they can
 * never appear here, but a filename can still embed a token-shaped fragment and
 * `redactSafetyText` is what this codebase uses for exactly that concern.
 */
function describeDiff(diff: { added: string[]; removed: string[]; changed: string[] }): string {
  const total = diff.added.length + diff.removed.length + diff.changed.length;
  const labelled = [
    ...diff.added.map(path => `added ${path}`),
    ...diff.removed.map(path => `removed ${path}`),
    ...diff.changed.map(path => `changed ${path}`),
  ];
  const shown = labelled.slice(0, MAX_REPORTED_PATHS).map(redactSafetyText);
  const elided = total - shown.length;
  const counts = `${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed`;
  return `${counts}: ${shown.join('; ')}${elided > 0 ? `; and ${elided} more` : ''}`;
}

export async function verifyLiveBoundary(
  snapshot: LiveBoundarySnapshot,
  containmentVerdict: ContainmentVerdict = { contained: false, reason: 'containment not evaluated' },
): Promise<{
  ok: boolean;
  reason?: string;
  containedDrift?: { evidence: string; summary: string };
}> {
  let containedDrift: { evidence: string; summary: string } | undefined;
  for (const surface of snapshot.surfaces) {
    const current = await manifest(
      surface.root,
      surface.exclude,
      surface.excludeDirectoryBasenames ?? [],
    );
    if (JSON.stringify(current) !== JSON.stringify(surface.manifest)) {
      const diff = diffManifests(surface.manifest, current);
      if (surface.label === 'live checkout') {
        if (containmentVerdict.contained) {
          containedDrift = {
            evidence: containmentVerdict.evidence,
            summary: describeDiff(diff),
          };
          continue;
        }
        const paths = [...diff.added, ...diff.removed, ...diff.changed];
        const classifications = await classifyLiveCheckoutDiff(surface.root, paths);
        if (paths.every(path => classifications.get(path) === 'operator-edit')) continue;
        return {
          ok: false,
          reason: `${surface.label} changed during self-host execution — ${describeDiff(diff)}. Containment was not in force: ${containmentVerdict.reason}.`,
        };
      }
      return { ok: false, reason: `${surface.label} changed during self-host execution — ${describeDiff(diff)}.` };
    }
  }
  return containedDrift ? { ok: true, containedDrift } : { ok: true };
}
