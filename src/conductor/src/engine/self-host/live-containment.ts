import { type Dirent, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LIVE_CHECKOUT_VOLATILE } from './live-boundary.js';

/** Result of determining whether a self-host build has filesystem containment. */
export type ContainmentVerdict =
  | { readonly contained: true; readonly evidence: string }
  | { readonly contained: false; readonly reason: string };

const MAX_NODE_MODULES_DISCOVERY_DEPTH = 8;

function discoverNodeModules(liveCheckout: string): readonly string[] {
  const discovered: string[] = [];
  const prunedRoots = new Set(
    LIVE_CHECKOUT_VOLATILE
      .filter((path) => path.startsWith('.'))
      .map((path) => path.split('/')[0]),
  );
  const pending: Array<{ readonly path: string; readonly depth: number }> = [{ path: liveCheckout, depth: 0 }];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;

    let entries: Dirent<string>[];
    try {
      entries = readdirSync(current.path, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) continue;
      const path = join(current.path, entry.name);
      if (entry.name === 'node_modules') {
        discovered.push(path);
        continue;
      }
      if (current.depth < MAX_NODE_MODULES_DISCOVERY_DEPTH && !prunedRoots.has(entry.name)) {
        pending.push({ path, depth: current.depth + 1 });
      }
    }
  }

  return discovered.sort((left, right) => left.localeCompare(right));
}

/**
 * Produces bwrap arguments that make the checkout read-only except for the
 * guard's volatile surface and installed dependency trees.
 */
export function deriveBindSet(liveCheckout: string, _worktreeRoot: string): readonly string[] {
  const writablePaths = [
    ...LIVE_CHECKOUT_VOLATILE
      .map((path) => join(liveCheckout, path))
      .filter((path) => existsSync(path)),
    ...discoverNodeModules(liveCheckout),
  ];

  return [
    '--dev-bind', '/', '/',
    '--ro-bind', liveCheckout, liveCheckout,
    ...writablePaths.flatMap((path) => ['--bind', path, path]),
  ];
}
