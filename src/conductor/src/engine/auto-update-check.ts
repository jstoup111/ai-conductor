// ── Auto-update-check — conduct-ts startup wiring for `bin/update --auto` ───
//
// Re-homes the auto-check that used to run inside `bin/conduct`
// (`check_harness_update`) onto `conduct-ts` startup, now that the check logic
// itself has moved to the standalone `bin/update` script (port-self-update-flow,
// T1-T4). Story 7: `autoCheck=true` → spawn `bin/update --auto` before the
// pipeline boots; `autoCheck=false` is `bin/update`'s own silent no-op, not
// this module's concern. Negative path: a missing/erroring `bin/update` (or a
// harness root that can't be resolved) must be logged and swallowed — this
// check is advisory and must never block or crash conductor startup.

import { execa } from 'execa';
import { join } from 'node:path';
import { resolveHarnessRoot } from './install-freshness.js';

/** Runs `path` with `args`; resolves to its exit code (or rejects on spawn error). */
export interface AutoUpdateRunner {
  (path: string, args: string[]): Promise<unknown>;
}

export const realAutoUpdateRunner: AutoUpdateRunner = (path, args) =>
  execa(path, args, { stdout: 'inherit', stderr: 'inherit' });

export interface SpawnAutoUpdateCheckOptions {
  /** Override harness-root discovery (tests). Defaults to resolveHarnessRoot. */
  harnessRoot?: string | null;
  /** Override the subprocess runner (tests). Defaults to a real `execa` spawn. */
  runner?: AutoUpdateRunner;
  /** Diagnostic sink for the log-and-swallow path (defaults to stderr). */
  log?: (message: string) => void;
}

/**
 * Spawn `bin/update --auto` at conduct-ts startup, resolved relative to the
 * harness root. Never throws: a missing harness root, a missing `bin/update`,
 * a spawn failure, or a non-zero exit from `bin/update` are all logged and
 * swallowed — advisory only, must never block the pipeline from booting.
 */
export async function spawnAutoUpdateCheck(opts: SpawnAutoUpdateCheckOptions = {}): Promise<void> {
  const log = opts.log ?? ((m: string) => console.error(m));
  try {
    const harnessRoot =
      opts.harnessRoot !== undefined ? opts.harnessRoot : await resolveHarnessRoot();
    if (!harnessRoot) {
      log('auto-update-check: could not locate the harness root; skipping the auto-check.');
      return;
    }
    const runner = opts.runner ?? realAutoUpdateRunner;
    await runner(join(harnessRoot, 'bin', 'update'), ['--auto']);
  } catch (err) {
    log(
      `auto-update-check: bin/update --auto failed (advisory, ignored): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
