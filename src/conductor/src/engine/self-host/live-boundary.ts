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
    return (await Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(entry =>
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
  liveCheckout: string; unrelatedProviderState: string; selectedAuthPaths?: readonly string[];
}): Promise<LiveBoundarySnapshot> {
  const excluded = args.selectedAuthPaths ?? [];
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
