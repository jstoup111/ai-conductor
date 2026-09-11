import type {
  InstalledReviewSkill,
  InstalledReviewSkillAvailability,
  ReviewPolicyDeclaration,
  ReviewPolicyResolution,
} from './build-review-policy.js';

export type {
  InstalledReviewSkill,
  ReviewPolicyDeclaration,
  ReviewPolicyResolution,
} from './build-review-policy.js';

interface ParsedReviewPolicyReference {
  readonly semanticName: string;
  readonly pluginId?: string;
}

function parseReviewPolicyReference(skill: string): ParsedReviewPolicyReference {
  const separator = skill.indexOf(':');
  if (separator === -1) return { semanticName: skill };

  return {
    pluginId: skill.slice(0, separator),
    semanticName: skill.slice(separator + 1),
  };
}

function compareOrigin(
  left: InstalledReviewSkill,
  right: InstalledReviewSkill,
): number {
  return left.installationOrigin.localeCompare(right.installationOrigin);
}

type UnavailableReviewSkillAvailability = Exclude<InstalledReviewSkillAvailability, 'available'>;

function isUnavailable(
  policy: InstalledReviewSkill,
): policy is InstalledReviewSkill & { readonly availability: UnavailableReviewSkillAvailability } {
  return policy.availability !== 'available';
}

/**
 * Select exactly one locally installed policy without interpreting its
 * contents. Host adapters own discovery; this boundary owns semantic
 * qualification, origin deduplication, and refusal to guess between copies.
 */
export function resolveInstalledReviewPolicy(
  declaration: ReviewPolicyDeclaration,
  catalog: readonly InstalledReviewSkill[],
): ReviewPolicyResolution {
  const reference = parseReviewPolicyReference(declaration.skill);
  const matching = catalog.filter((policy) => (
    policy.semanticName === reference.semanticName
    && (declaration.source === undefined || policy.source === declaration.source)
    && (reference.pluginId === undefined || policy.plugin?.id === reference.pluginId)
  ));

  if (matching.length === 0) {
    return {
      kind: 'failure',
      failure: {
        code: 'absent',
        skill: declaration.skill,
        ...(declaration.source === undefined ? {} : { source: declaration.source }),
      },
    };
  }

  // The catalog may expose a symlink under multiple paths. Origin is the
  // canonical installation identity, so first-seen metadata is preserved and
  // package bytes never participate in selection.
  const byOrigin = new Map<string, InstalledReviewSkill>();
  for (const policy of matching) {
    byOrigin.set(policy.installationOrigin, byOrigin.get(policy.installationOrigin) ?? policy);
  }
  const deduplicated = [...byOrigin.values()].sort(compareOrigin);
  const available = deduplicated.filter((policy) => policy.availability === 'available');

  if (available.length === 0) {
    const failure = deduplicated.find(isUnavailable)!;
    return {
      kind: 'failure',
      failure: {
        code: failure.availability,
        skill: declaration.skill,
        ...(declaration.source === undefined ? {} : { source: declaration.source }),
      },
    };
  }

  if (available.length === 1) {
    return { kind: 'resolved', policy: available[0]! };
  }

  return {
    kind: 'failure',
    failure: {
      code: 'ambiguous',
      skill: declaration.skill,
      origins: available.map((policy) => policy.installationOrigin),
    },
  };
}
