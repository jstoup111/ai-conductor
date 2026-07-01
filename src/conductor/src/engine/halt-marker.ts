// halt-marker.ts — the single source of truth for the `.pipeline/HALT` marker.
//
// A HALT parks a feature for the operator: the daemon loop treats the presence
// of `.pipeline/HALT` as a stop and never advances, opens a PR, or merges past
// it. The path was previously spelled independently in the conductor, the rebase
// step, the self-host gates, and the daemon dashboard/deps/rekick modules; a
// change to how the marker is written or where it lives had to be mirrored across
// all of them. Both the constant and the best-effort writer now live here.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The park-for-human marker the daemon loop treats as a stop. */
export const HALT_MARKER = '.pipeline/HALT';

/**
 * Write `.pipeline/HALT` under `projectRoot` with `body` as its contents,
 * creating `.pipeline/` if needed. Best-effort: mkdir/write failures are
 * swallowed — the HALT is a signal to park, never itself a hard failure (a
 * failed write must not crash the finish flow). The first non-empty line of
 * `body` is the reason the daemon dashboard surfaces.
 */
export async function writeHaltMarker(projectRoot: string, body: string): Promise<void> {
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true }).catch(() => {});
  await writeFile(join(projectRoot, HALT_MARKER), body, 'utf-8').catch(() => {});
}
