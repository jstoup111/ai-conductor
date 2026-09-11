/** The installation source through which a policy may be selected. */
export type InstalledReviewSkillSource = 'project' | 'global' | 'plugin';

/** The local loading state reported by a host-neutral catalog adapter. */
export type InstalledReviewSkillAvailability =
  | 'available'
  | 'unreadable'
  | 'disabled'
  | 'marketplace-only'
  | 'incomplete';

/** A locally materialized plugin that owns an installed policy, if any. */
export interface InstalledReviewPlugin {
  readonly id: string;
  readonly version?: string;
}

/** One host-normalized installed review policy descriptor. */
export interface InstalledReviewSkill {
  readonly semanticName: string;
  readonly source: InstalledReviewSkillSource;
  readonly plugin?: InstalledReviewPlugin;
  /** Canonical origin used for alias deduplication, never package bytes. */
  readonly installationOrigin: string;
  readonly canonicalSkillPath: string;
  readonly packageRoot: string;
  readonly declaredDependencies: readonly string[];
  readonly availability: InstalledReviewSkillAvailability;
}

/** The installed semantic policy requested by one validated custom declaration. */
export interface ReviewPolicyDeclaration {
  readonly skill: string;
  readonly source?: InstalledReviewSkillSource;
}

export interface ReviewPolicyResolutionFailure {
  readonly code: 'absent' | Exclude<InstalledReviewSkillAvailability, 'available'> | 'ambiguous';
  readonly skill: string;
  readonly source?: InstalledReviewSkillSource;
  readonly origins?: readonly string[];
}

export type ReviewPolicyResolution =
  | { readonly kind: 'resolved'; readonly policy: InstalledReviewSkill }
  | { readonly kind: 'failure'; readonly failure: ReviewPolicyResolutionFailure };
