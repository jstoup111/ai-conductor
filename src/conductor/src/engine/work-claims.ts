/** A claim belongs either to a dispatched feature or to a pooled PR repair. */
export type WorkClaim =
  | { readonly kind: 'feature'; readonly slug: string }
  | { readonly kind: 'repair'; readonly prUrl: string };

/** Preserve feature slugs while reserving `repair:` for pooled repair claims. */
export function encodeClaimKey(claim: WorkClaim): string {
  return claim.kind === 'feature' ? claim.slug : `repair:${claim.prUrl}`;
}

/** Parse the one durable claim-key representation used by the daemon pool. */
export function decodeClaimKey(key: string): WorkClaim {
  return key.startsWith('repair:')
    ? { kind: 'repair', prUrl: key.slice('repair:'.length) }
    : { kind: 'feature', slug: key };
}

/** Project a mixed claim inventory onto the feature slugs its consumers own. */
export function featureSlugs(claims: Pick<WorkClaims, 'list'>): readonly string[] {
  return claims.list().flatMap((key) => {
    const claim = decodeClaimKey(key);
    return claim.kind === 'feature' ? [claim.slug] : [];
  });
}

export interface WorkClaims {
  claim(slug: string): boolean;
  release(slug: string): void;
  list(): readonly string[];
  complete(slug: string): void;
  isCompleted(slug: string): boolean;
  park(slug: string): void;
  unpark(slug: string): void;
  isParked(slug: string): boolean;
  listParked(): readonly string[];
}

export class InMemoryWorkClaims implements WorkClaims {
  private readonly activeSlugs = new Set<string>();
  private readonly completedSlugs = new Set<string>();
  private readonly parkedSlugs = new Set<string>();

  claim(slug: string): boolean {
    if (this.activeSlugs.has(slug)) return false;
    this.activeSlugs.add(slug);
    return true;
  }

  release(slug: string): void {
    this.activeSlugs.delete(slug);
  }

  list(): readonly string[] {
    return [...this.activeSlugs];
  }

  complete(slug: string): void {
    this.completedSlugs.add(slug);
  }

  isCompleted(slug: string): boolean {
    return this.completedSlugs.has(slug);
  }

  park(slug: string): void {
    this.parkedSlugs.add(slug);
  }

  unpark(slug: string): void {
    this.parkedSlugs.delete(slug);
  }

  isParked(slug: string): boolean {
    return this.parkedSlugs.has(slug);
  }

  listParked(): readonly string[] {
    return [...this.parkedSlugs];
  }
}
