// halt-marker.ts — the single source of truth for the `.pipeline/HALT` marker.
//
// A HALT parks a feature for the operator: the daemon loop treats the presence
// of `.pipeline/HALT` as a stop and never advances, opens a PR, or merges past
// it. The path was previously spelled independently in the conductor, the rebase
// step, the self-host gates, and the daemon dashboard/deps/rekick modules; a
// change to how the marker is written or where it lives had to be mirrored across
// all of them. Both the constant and the best-effort writer now live here.

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The park-for-human marker the daemon loop treats as a stop. */
export const HALT_MARKER = '.pipeline/HALT';

/** Machine-readable sidecar classifying why a HALT was raised. */
export const HALT_CLASS_MARKER = '.pipeline/HALT.class';

/** HALT class for a feature-authored protected-artifact violation. */
export const PROTECTED_ARTIFACT_HALT_CLASS = 'protected-artifact';

/**
 * Classification of a HALT: `needs-human` marks are those only an operator
 * can resolve; `mechanical` marks are those the daemon may safely re-kick.
 */
export type HaltClass =
  | 'needs-human'
  | 'mechanical'
  | typeof PROTECTED_ARTIFACT_HALT_CLASS;

/** Classification observed while reading a HALT sidecar. */
export type HaltDisposition = HaltClass | 'legacy' | 'unclassified';

/**
 * Write `.pipeline/HALT` under `projectRoot` with `body` as its contents,
 * creating `.pipeline/` if needed. Best-effort: mkdir/write failures are
 * swallowed — the HALT is a signal to park, never itself a hard failure (a
 * failed write must not crash the finish flow). The first non-empty line of
 * `body` is the reason the daemon dashboard surfaces.
 *
 * Also best-effort write `.pipeline/HALT.class` with the class string, so
 * callers (e.g. the daemon re-kick sweep) can tell a needs-human HALT apart
 * from a mechanical one without parsing `body`.
 */
export async function writeHaltMarker(
  projectRoot: string,
  body: string,
  haltClass: HaltClass,
): Promise<void> {
  const haltClassPath = join(projectRoot, HALT_CLASS_MARKER);
  const haltClassTempPath = `${haltClassPath}.tmp`;

  await mkdir(join(projectRoot, '.pipeline'), { recursive: true }).catch(() => {});
  try {
    await unlink(haltClassPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
  }

  try {
    await writeFile(join(projectRoot, HALT_MARKER), body, 'utf-8');
    await writeFile(haltClassTempPath, haltClass, 'utf-8');
    await rename(haltClassTempPath, haltClassPath);
  } catch {
    await unlink(haltClassTempPath).catch(() => {});
  }
}

/**
 * Read and classify `.pipeline/HALT.class` under `worktreePath`. Tolerant by
 * design: a missing file, an unreadable file (permissions, missing parent
 * dir, etc.), or unrecognized content all resolve to `'unclassified'` rather
 * than throwing — callers (e.g. the daemon re-kick sweep) must never crash
 * on a HALT sidecar read.
 */
export async function readHaltClass(worktreePath: string): Promise<HaltDisposition> {
  try {
    const contents = (await readFile(join(worktreePath, HALT_CLASS_MARKER), 'utf-8')).trim();
    if (
      contents === 'needs-human' ||
      contents === 'mechanical' ||
      contents === 'legacy' ||
      contents === PROTECTED_ARTIFACT_HALT_CLASS
    ) {
      return contents;
    }
    return 'unclassified';
  } catch {
    return 'unclassified';
  }
}
