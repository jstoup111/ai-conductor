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

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AuthoringGuard } from './authoring-guard.js';
import { parseWorkRef } from './source-ref.js';

/**
 * Write `.docs/intake/<slug>.md` with `Source-Ref: <sourceRef>` and, when an
 * `ownerIdentity` is supplied, an `Owner: <id>` line (FR-4 write side).
 *
 * FIELD-NAME COORDINATION (ADR-2 condition — adr-2026-06-30-owner-provenance-recording):
 * the owner is recorded on THIS marker rather than a competing artifact, so the
 * `Owner:` field name is shared with phase-9.3b (github-intake-writeback), which
 * also reads/writes this marker. The daemon's provenance reader
 * (`owner-gate/provenance.ts`) parses exactly `Owner:` — keep the two in lockstep.
 *
 * The owner is OMITTED entirely (never a blank `Owner:` line) when
 * `ownerIdentity` is null/absent/whitespace — a blank stamp is the "un-owned"
 * case (FR-12), not a false owner.
 *
 * No-op (returns null) only when there is NEITHER a valid `owner/repo#N`
 * sourceRef NOR an owner — so an owner is stamped even on a hand-authored,
 * non-intake spec (the marker then carries `Owner:` without `Source-Ref:`). The
 * path is guarded to stay inside `repoPath`. Returns the absolute marker path on
 * write.
 *
 * MERGE LOGIC (Slice B, Task 13):
 * When stamping an owner on the conduct path, pre-existing Source-Ref lines are
 * preserved: if the marker file exists and contains `Source-Ref:`, that line is
 * carried forward into the stamped marker. This handles the case where a spec was
 * routed from /engineer (intake origin tracked), then continued on the plain
 * /conduct path where the conduct owner stamping re-writes the marker to add Owner:.
 */
export async function writeIntakeMarker(
  repoPath: string,
  slug: string,
  sourceRef: string | undefined | null,
  ownerIdentity: string | undefined | null,
  guard: AuthoringGuard = new AuthoringGuard(repoPath),
): Promise<string | null> {
  const hasSourceRef = parseWorkRef(sourceRef) !== null;
  const owner = ownerIdentity == null ? '' : ownerIdentity.trim();
  const hasOwner = owner !== '';

  // Nothing to record → leave non-intake, un-owned specs byte-for-byte unchanged.
  if (!hasSourceRef && !hasOwner) return null;

  const intakeDir = join(repoPath, '.docs', 'intake');
  const markerFile = join(intakeDir, `${slug}.md`);

  guard.assertWriteAllowed(intakeDir);
  guard.assertWriteAllowed(markerFile);

  const lines = [`# Intake origin: ${slug}`, ''];

  // Preserve existing Source-Ref if present in an existing marker file.
  // This handles the conduct-path stamping case where a pre-existing marker
  // carries an intake origin that must survive when re-writing to add Owner:.
  let existingSourceRef: string | null = null;
  try {
    const existing = await readFile(markerFile, 'utf-8');
    const sourceRefMatch = existing.match(/^Source-Ref: (.+)$/m);
    if (sourceRefMatch) {
      existingSourceRef = sourceRefMatch[1];
    }
  } catch {
    // File doesn't exist yet, continue normally
  }

  // Use provided sourceRef if valid, otherwise use existing
  const finalSourceRef = hasSourceRef ? sourceRef : existingSourceRef;
  if (finalSourceRef) {
    lines.push(`Source-Ref: ${finalSourceRef}`);
  }

  if (hasOwner) lines.push(`Owner: ${owner}`);
  const body = `${lines.join('\n')}\n`;

  await mkdir(intakeDir, { recursive: true });
  await writeFile(markerFile, body, 'utf8');
  return markerFile;
}
