import { basename } from 'node:path';

/**
 * Resolves the one durable shipment identity shared by the record writer and
 * strict evidence verifier. `feature_desc` commonly omits the date prefix the
 * plan author puts in the filename; the persisted record is keyed by the
 * canonical plan stem, never by that shorthand.
 */
export interface ShipmentIdentity {
  requestedSlug: string;
  slug: string;
  planPath: string;
  recordPath: string;
}

export type ShipmentIdentityResolution =
  | { kind: 'resolved'; identity: ShipmentIdentity }
  | { kind: 'missing'; expected: string }
  | { kind: 'ambiguous'; expected: string; candidates: string[] };

/**
 * Resolve an exact plan stem first. When the caller holds the daemon's
 * unprefixed feature description, accept exactly one YYYY-MM-DD-prefixed plan
 * with that suffix. More than one candidate is deliberately not guessed.
 */
export function resolveShipmentIdentity(
  requestedSlug: string,
  planPaths: readonly string[],
): ShipmentIdentityResolution {
  const expected = `.docs/plans/${requestedSlug}.md`;
  if (planPaths.includes(expected)) return resolved(requestedSlug, requestedSlug);

  const escaped = requestedSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dated = new RegExp(`^\\.docs/plans/\\d{4}-\\d{2}-\\d{2}-${escaped}\\.md$`);
  const candidates = planPaths.filter((path) => dated.test(path)).sort();
  if (candidates.length === 0) return { kind: 'missing', expected };
  if (candidates.length > 1) return { kind: 'ambiguous', expected, candidates };

  const canonicalSlug = basename(candidates[0], '.md');
  return resolved(requestedSlug, canonicalSlug);
}

function resolved(requestedSlug: string, slug: string): ShipmentIdentityResolution {
  return {
    kind: 'resolved',
    identity: {
      requestedSlug,
      slug,
      planPath: `.docs/plans/${slug}.md`,
      recordPath: `.docs/shipped/${slug}.md`,
    },
  };
}
