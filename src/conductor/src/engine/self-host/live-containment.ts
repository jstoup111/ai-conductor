import { type Dirent, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LIVE_CHECKOUT_VOLATILE } from './live-boundary.js';

/** Result of determining whether a self-host build has filesystem containment. */
export type ContainmentVerdict =
  | { readonly contained: true; readonly evidence: string }
  | { readonly contained: false; readonly reason: string };

/** Executes the isolated containment probe without coupling it to process spawning. */
export type ContainmentProbeRunner = (
  executable: string,
  args: readonly string[],
) => Promise<{ readonly stdout: string }>;

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

/** Wraps an invocation command in bubblewrap without changing its environment. */
export function wrapForContainment<TEnv>(
  command: { readonly executable: string; readonly args: readonly string[]; readonly env: TEnv },
  bindSet: readonly string[],
): { readonly executable: string; readonly args: readonly string[]; readonly env: TEnv } {
  return {
    executable: 'bwrap',
    args: [...bindSet, '--', command.executable, ...command.args],
    env: command.env,
  };
}

const CONTAINMENT_PROBE = [
  'if test -w "$1"; then printf "live-root-writable\\n"; else printf "live-root-not-writable\\n"; fi',
  'if test -w "$2"; then printf "worktree-writable\\n"; else printf "worktree-not-writable\\n"; fi',
].join('; ');

/**
 * Verifies that the live checkout is read-only while the dispatched worktree
 * remains writable under the exact bind set that will wrap the child process.
 */
export async function probeContainment(
  bindSet: readonly string[],
  liveCheckout: string,
  worktreeRoot: string,
  runner: ContainmentProbeRunner,
): Promise<ContainmentVerdict> {
  const { stdout } = await runner('bwrap', [
    ...bindSet,
    '--',
    '/bin/sh',
    '-c',
    CONTAINMENT_PROBE,
    'containment-probe',
    liveCheckout,
    worktreeRoot,
  ]);
  const observations = new Set(stdout.trim().split(/\s+/));

  if (observations.has('live-root-writable')) {
    return { contained: false, reason: `probe found ${liveCheckout} writable` };
  }
  if (observations.has('worktree-not-writable')) {
    return { contained: false, reason: `probe found ${worktreeRoot} not writable` };
  }
  if (!observations.has('live-root-not-writable')) {
    return { contained: false, reason: `probe did not prove ${liveCheckout} is not writable` };
  }
  if (!observations.has('worktree-writable')) {
    return { contained: false, reason: `probe did not prove ${worktreeRoot} is writable` };
  }

  return {
    contained: true,
    evidence: 'probe confirmed live-root-not-writable and worktree-writable',
  };
}
