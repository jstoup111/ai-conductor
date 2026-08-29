// canonical-launcher.ts — resolve the harness launcher used by internal spawns.
//
// A long-lived daemon can outlive a relink of ~/.local/bin. Internal processes
// must therefore prefer the executable beside the engine bundle that launched
// them, rather than relying on whichever `ai-conductor` happens to be on PATH.

import { accessSync, constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));

export interface CanonicalLauncherOptions {
  /** Environment override, primarily injectable for deterministic tests. */
  env?: NodeJS.ProcessEnv;
  /** Module directory to probe, primarily injectable for deterministic tests. */
  moduleDir?: string;
  /** Executability probe, primarily injectable for deterministic tests. */
  isExecutable?: (path: string) => boolean;
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the command that harness-owned background processes should invoke.
 *
 * The depth ladder intentionally matches resolveHarnessRoot in
 * install-freshness.ts: published bundles live three levels below the harness
 * root, while source-tree engine modules live four levels below it. Unusual
 * layouts degrade to the historical PATH command instead of blocking launch.
 */
export function resolveCanonicalLauncher(opts: CanonicalLauncherOptions = {}): string {
  const env = opts.env ?? process.env;
  const override = env.AI_CONDUCTOR_ENGINE_BIN;
  if (override) return override;

  const probe = opts.isExecutable ?? executable;
  const from = opts.moduleDir ?? moduleDir;
  for (const rel of ['../../../', '../../../../']) {
    const launcher = join(from, rel, 'bin', 'ai-conductor');
    if (probe(launcher)) return launcher;
  }
  return 'ai-conductor';
}

/** Quote one resolved launcher path for safe interpolation into a shell command. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
