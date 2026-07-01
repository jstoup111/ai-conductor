// engineer/track-marker.ts — write the committed work-track marker.
//
// `.docs/track/<slug>.md` carries a `Track: product|technical` line so the work
// classification travels WITH the spec onto the merged default branch, where the
// daemon reads it (parseTrack) to decide whether to expect a PRD and whether to
// run `prd-audit` at SHIP.
//
// In the interactive flow the `/explore` skill writes this marker directly; this
// helper is for the autonomous `runAuthoring` path (and any caller that already
// knows the track). No-op for an invalid track value.

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AuthoringGuard } from './authoring-guard.js';
import type { Track } from '../../types/index.js';

/**
 * Write `.docs/track/<slug>.md` with `Track: <track>`.
 *
 * No-op (returns null) when `track` is not `product`/`technical`. The path is
 * guarded to stay inside `repoPath`. Returns the absolute marker path on write.
 */
export async function writeTrackMarker(
  repoPath: string,
  slug: string,
  track: Track | undefined,
  guard: AuthoringGuard = new AuthoringGuard(repoPath),
): Promise<string | null> {
  if (track !== 'product' && track !== 'technical') return null;

  const trackDir = join(repoPath, '.docs', 'track');
  const markerFile = join(trackDir, `${slug}.md`);

  guard.assertWriteAllowed(trackDir);
  guard.assertWriteAllowed(markerFile);

  await mkdir(trackDir, { recursive: true });
  await writeFile(markerFile, `# Track: ${slug}\n\nTrack: ${track}\n`, 'utf8');
  return markerFile;
}
