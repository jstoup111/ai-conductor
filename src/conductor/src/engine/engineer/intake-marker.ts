// engineer/intake-marker.ts — write the committed intake-origin marker.
//
// `.docs/intake/<slug>.md` carries a single machine-readable `Source-Ref:` line
// so the originating GitHub issue reference travels WITH the spec onto the merged
// default branch — where the daemon (which never sees the intake ledger) reads it
// to put `Closes owner/repo#N` on the implementation PR.
//
// Shared by both authoring paths: landSpec (live/interactive `engineer land`)
// and runAuthoring (autonomous). No-op for hand-authored specs (no sourceRef),
// so non-intake specs are byte-for-byte unchanged.

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AuthoringGuard } from './authoring-guard.js';
import { parseSourceRef } from './issue-ref.js';

/**
 * Write `.docs/intake/<slug>.md` with `Source-Ref: <sourceRef>`.
 *
 * No-op (returns null) when `sourceRef` is absent or not a valid `owner/repo#N`
 * — the marker is never written for non-intake or malformed origins. The path is
 * guarded to stay inside `repoPath`. Returns the absolute marker path on write.
 */
export async function writeIntakeMarker(
  repoPath: string,
  slug: string,
  sourceRef: string | undefined | null,
  guard: AuthoringGuard = new AuthoringGuard(repoPath),
): Promise<string | null> {
  if (!parseSourceRef(sourceRef)) return null;

  const intakeDir = join(repoPath, '.docs', 'intake');
  const markerFile = join(intakeDir, `${slug}.md`);

  guard.assertWriteAllowed(intakeDir);
  guard.assertWriteAllowed(markerFile);

  await mkdir(intakeDir, { recursive: true });
  await writeFile(markerFile, `# Intake origin: ${slug}\n\nSource-Ref: ${sourceRef}\n`, 'utf8');
  return markerFile;
}
