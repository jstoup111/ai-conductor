// owner-gate/provenance.ts — read a spec's committed owner stamp.
//
// The daemon reads ONLY committed base-branch state — it never sees the live PR
// (ADR: adr-2026-06-30-owner-provenance-recording). A spec's owner therefore
// travels as a committed `Owner:` line in the per-spec intake marker
// (`.docs/intake/<slug>.md`), which the engineer `land` flow writes. This is the
// READ side (the `CommittedStampReader` seam): fetch the marker from the base
// tree via `git show <base>:.docs/intake/<slug>.md` and parse the `Owner:` line.
//
// A missing marker, a marker without an `Owner:` line, or a blank/whitespace
// value is NOT a valid owner — it is the "un-owned" case (`present: false`),
// handled downstream by the grandfather cutover (FR-8/9/12).
//
// A future `SignedProvenance` reader can replace this one without changing the
// gate, per the ADR's forward-compat seam.

import type { GitRunner } from '../rebase.js';
import { normalizeOwnerId } from './identity.js';

/**
 * The result of reading a spec's committed owner stamp. `present: true` carries
 * a normalized owner id; `present: false` is the un-owned case (no marker, no
 * `Owner:` line, or a blank value).
 */
export type OwnerStamp = { present: true; id: string } | { present: false };

/**
 * Read the committed `Owner:` stamp for `slug` from the intake marker on
 * `baseBranch` (FR-4 read side). Runs `git show <base>:.docs/intake/<slug>.md`
 * and parses the first `Owner:` line, normalized (FR-12). Returns `present:
 * false` when the marker is absent (git non-zero), has no `Owner:` line, or the
 * value is blank/whitespace.
 */
export async function readSpecOwnerStamp(
  git: GitRunner,
  baseBranch: string,
  slug: string,
): Promise<OwnerStamp> {
  const { exitCode, stdout } = await git(['show', `${baseBranch}:.docs/intake/${slug}.md`]);
  if (exitCode !== 0) return { present: false };

  for (const line of stdout.split('\n')) {
    const m = /^\s*Owner:\s*(.*)$/.exec(line);
    if (!m) continue;
    const id = normalizeOwnerId(m[1]);
    return id === null ? { present: false } : { present: true, id };
  }
  return { present: false };
}
