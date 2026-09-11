import { relative } from 'node:path';

import type { CapturedReviewPolicyBundle } from './build-review-policy-bundle.js';

/** The first engine-owned contract for an installed read-only review policy. */
export const BUILD_REVIEW_POLICY_CONTRACT_VERSION = 'v1' as const;

export interface RenderBuildReviewPolicyContractOptions {
  readonly bundle: CapturedReviewPolicyBundle;
  readonly question: string;
  readonly scope: string;
}

const SHARED_FINDINGS_PAYLOAD = '{ findings: [{ concernKind: string, summary: string, evidenceLocations: string[], sourceRegions: [{ path: string, startLine: integer, endLine: integer }], confidence?: integer (0..100) }] }';

function selectedSkillText(bundle: CapturedReviewPolicyBundle): string {
  const definitionRelativePath = relative(bundle.materialPath, bundle.definitionPath).split('\\').join('/');
  const definition = bundle.manifest.find((entry) => entry.relativePath === definitionRelativePath);
  if (!definition) {
    throw new Error(`Captured policy definition is absent from its manifest: ${bundle.definitionPath}`);
  }
  return definition.bytes.toString('utf8');
}

/**
 * Adapts one immutable installed policy into the engine-owned, read-only
 * review role. The policy's own workflow is evidence only: the engine owns
 * the result shape and all aggregate authority.
 */
export function renderBuildReviewPolicyContract(
  options: RenderBuildReviewPolicyContractOptions,
): string {
  const { bundle, question, scope } = options;
  const materialEntries = bundle.manifest
    .map((entry) => `- ${entry.relativePath}`)
    .join('\n');

  return [
    `Build-review policy contract: ${BUILD_REVIEW_POLICY_CONTRACT_VERSION}`,
    '',
    'You are a read-only build-review policy reviewer. Produce evidence about the supplied frozen implementation input only.',
    'Do not choose an aggregate verdict, authorize repair work, edit code, install dependencies, or publish comments.',
    'The engine alone validates findings and owns aggregate verdicts and repair work orders.',
    '',
    `Declared review question: ${question}`,
    `Review scope: ${scope}`,
    `Selected policy content identity: ${bundle.digest}`,
    `Captured policy material root (read-only): ${bundle.materialPath}`,
    `Selected policy definition (read-only): ${bundle.definitionPath}`,
    'Captured support tree (all paths are available read-only beneath the material root):',
    materialEntries,
    '',
    'Return only the engine-defined findings payload; do not use another output contract or a standalone presentation format.',
    `Shared findings payload schema: ${SHARED_FINDINGS_PAYLOAD}`,
    'The engine stamps policy, provider, lap, verdict, and all aggregate metadata after validating the payload.',
    '',
    'The complete selected SKILL.md follows unchanged. Apply its criteria only within the review role above:',
    selectedSkillText(bundle),
  ].join('\n');
}
