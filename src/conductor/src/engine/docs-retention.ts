import { artifactMatchesFeatureIdentity } from './artifacts.js';
import { undatedStem } from './daemon-backlog.js';

export const DOCS_RETENTION_POLICY = {
  keptFamilies: [
    'stories',
    'specs',
    'decisions',
    'architecture',
    'shipped',
    'intake',
    'release-waivers',
  ],
  prunableFamilies: [
    'plans',
    'conflicts',
    'coherence',
    'coherence-waivers',
    'track',
    'complexity',
    'halted',
    'plan-review',
    'applicability',
    'retros',
  ],
  repositoryWideExclusions: [
    'audit',
    'audits',
    'baselines',
    'observation',
    '*.md',
  ],
  normalizedStemFamilies: [
    'conflicts', 'coherence', 'coherence-waivers', 'track', 'complexity',
    'halted', 'plan-review', 'applicability', 'retros',
  ],
} as const;

const PLAN_STEM_IDENTITY = { strategy: 'plan-stem' } as const;
const NORMALIZED_STEM_IDENTITY = {
  strategy: 'normalized-stem',
  stripDatePrefix: true,
} as const;

/** Return paths in prunable families that belong to a feature stem. */
export function prunableFilesForStem(paths: readonly string[], stem: string): string[] {
  const undated = undatedStem(stem);
  return paths.filter((path) => {
    const normalizedPath = path.replaceAll('\\', '/');
    const isPrunableFamily = DOCS_RETENTION_POLICY.prunableFamilies.some(
      (family) => normalizedPath.startsWith(`.docs/${family}/`),
    );
    if (!isPrunableFamily) return false;

    const family = DOCS_RETENTION_POLICY.prunableFamilies.find((candidate) => normalizedPath.startsWith(`.docs/${candidate}/`));
    if (artifactMatchesFeatureIdentity(normalizedPath, stem, PLAN_STEM_IDENTITY)) return true;
    if (undated === stem || !family || !DOCS_RETENTION_POLICY.normalizedStemFamilies.includes(family as never)) return false;
    return artifactMatchesFeatureIdentity(normalizedPath, undated, PLAN_STEM_IDENTITY)
      || artifactMatchesFeatureIdentity(normalizedPath, stem, NORMALIZED_STEM_IDENTITY);
  });
}
