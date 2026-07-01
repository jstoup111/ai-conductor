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
 */
export async function writeIntakeMarker(
  repoPath: string,
  slug: string,
  sourceRef: string | undefined | null,
  ownerIdentity: string | undefined | null,
  guard: AuthoringGuard = new AuthoringGuard(repoPath),
): Promise<string | null> {
  const hasSourceRef = parseSourceRef(sourceRef) !== null;
  const owner = ownerIdentity == null ? '' : ownerIdentity.trim();
  const hasOwner = owner !== '';

  // Nothing to record → leave non-intake, un-owned specs byte-for-byte unchanged.
  if (!hasSourceRef && !hasOwner) return null;

  const intakeDir = join(repoPath, '.docs', 'intake');
  const markerFile = join(intakeDir, `${slug}.md`);

  guard.assertWriteAllowed(intakeDir);
  guard.assertWriteAllowed(markerFile);

  const lines = [`# Intake origin: ${slug}`, ''];
  if (hasSourceRef) lines.push(`Source-Ref: ${sourceRef}`);
  if (hasOwner) lines.push(`Owner: ${owner}`);
  const body = `${lines.join('\n')}\n`;

  await mkdir(intakeDir, { recursive: true });
  await writeFile(markerFile, body, 'utf8');
  return markerFile;
}
