import type { TestDeclarationSpan } from './build-review-test-declarations.js';

export interface BuildReviewScopeCandidateIdentityReference {
  readonly source: { readonly fileName: string; readonly side: 'base' | 'head' };
  readonly region?: TestDeclarationSpan;
}

/** Source side, path, and declaration/diagnostic span define one scope candidate. */
export function buildReviewScopeCandidateIdentityKey(reference: BuildReviewScopeCandidateIdentityReference): string {
  const { source, region } = reference;
  return `${source.side}\u0000${source.fileName}\u0000${region?.start ?? 0}\u0000${region?.end ?? -1}`;
}
