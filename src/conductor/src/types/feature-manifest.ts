export const ARTIFACT_KINDS = [
  'plan',
  'stories',
  'prd',
  'track',
  'complexity',
  'conflicts',
  'coherence',
  'coherence-waiver',
  'architecture',
  'intake',
  'applicability',
  'decision',
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
