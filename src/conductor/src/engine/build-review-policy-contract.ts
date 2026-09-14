import { relative } from 'node:path';

import type { CapturedReviewPolicyBundle } from './build-review-policy-bundle.js';

/** The first engine-owned contract for an installed read-only review policy. */
export const BUILD_REVIEW_POLICY_CONTRACT_VERSION = 'v1' as const;

export interface RenderBuildReviewPolicyContractOptions {
  readonly bundle: CapturedReviewPolicyBundle;
  readonly question: string;
  readonly scope: string;
}

/** Actions that an installed policy may declare, independent of its prose. */
export type BuildReviewPolicyAction =
  | 'read-frozen-input'
  | 'read-policy-material'
  | 'edit-code'
  | 'install-dependencies'
  | 'publish-comments';

/** The explicit, provider-prepared capabilities of the read-only review role. */
export interface BuildReviewPolicyCapabilityProfile {
  readonly provider: 'claude' | 'codex';
  readonly admittedActions: readonly BuildReviewPolicyAction[];
  readonly admittedCapabilities: readonly string[];
  readonly admittedTools: readonly string[];
  readonly admittedDependencies: readonly string[];
}

/**
 * Catalog/manifest metadata is already structured.  This is deliberately not
 * a parser for arbitrary policy instructions: undeclared runtime needs use
 * the separate runtime-unsupported result below.
 */
export type BuildReviewPolicyDeclaredRequirement =
  | { readonly kind: 'action'; readonly action: BuildReviewPolicyAction }
  | { readonly kind: 'capability'; readonly capability: string }
  | { readonly kind: 'tool'; readonly tool: string }
  | { readonly kind: 'dependency'; readonly dependency: string; readonly source: 'host' | 'plugin' };

export type BuildReviewPolicyIncompatibilityKind =
  | 'required-action'
  | 'unavailable-capability'
  | 'unavailable-tool'
  | 'unavailable-dependency'
  | 'runtime-unsupported';

export type BuildReviewPolicyRecovery =
  | 'adapt-policy-to-read-only-review'
  | 'make-review-capability-available'
  | 'make-tool-available-before-review'
  | 'install-dependency-outside-review';

export interface BuildReviewPolicyIncompatibility {
  readonly kind: BuildReviewPolicyIncompatibilityKind;
  /** The exact declared or runtime-reported need; it never selects routing. */
  readonly requirement: string;
  /** Engine-selected recovery identity, never diagnostic prose. */
  readonly recovery: BuildReviewPolicyRecovery;
}

export interface BuildReviewPolicyUnsupportedResult {
  readonly kind: 'unsupported-policy';
  readonly stage: 'preflight' | 'runtime';
  readonly provider: BuildReviewPolicyCapabilityProfile['provider'];
  readonly incompatibility: BuildReviewPolicyIncompatibility;
}

export type BuildReviewPolicyPreflightResult =
  | { readonly kind: 'admitted' }
  | BuildReviewPolicyUnsupportedResult;

export interface EvaluateBuildReviewPolicyPreflightOptions {
  readonly profile: BuildReviewPolicyCapabilityProfile;
  readonly requirements: readonly BuildReviewPolicyDeclaredRequirement[];
  /**
   * Reserved to make the boundary's non-activation guarantee observable.
   * Preflight always refuses before this optional plugin-component seam.
   */
  readonly activatePluginComponent?: () => void;
}

const SHARED_FINDINGS_PAYLOAD = '{ findings: [{ concernKind: string, summary: string, evidenceLocations: string[], sourceRegions: [{ path: string, startLine: integer, endLine: integer }], confidence?: integer (0..100) }] }';

const RECOVERY_FOR_DECLARED_REQUIREMENT = Object.freeze({
  action: 'adapt-policy-to-read-only-review',
  capability: 'make-review-capability-available',
  tool: 'make-tool-available-before-review',
  dependency: 'install-dependency-outside-review',
} satisfies Record<BuildReviewPolicyDeclaredRequirement['kind'], BuildReviewPolicyRecovery>);

function unsupported(
  stage: BuildReviewPolicyUnsupportedResult['stage'],
  provider: BuildReviewPolicyCapabilityProfile['provider'],
  incompatibility: BuildReviewPolicyIncompatibility,
): BuildReviewPolicyUnsupportedResult {
  return { kind: 'unsupported-policy', stage, provider, incompatibility };
}

/**
 * Compare only declared, typed requirements with the candidate's admitted
 * review profile.  It never infers requirements from policy prose and never
 * enables another plugin component to make a policy fit.
 */
export function evaluateBuildReviewPolicyPreflight(
  options: EvaluateBuildReviewPolicyPreflightOptions,
): BuildReviewPolicyPreflightResult {
  for (const declared of options.requirements) {
    const unavailable = declared.kind === 'action'
      ? !options.profile.admittedActions.includes(declared.action)
      : declared.kind === 'capability'
        ? !options.profile.admittedCapabilities.includes(declared.capability)
        : declared.kind === 'tool'
          ? !options.profile.admittedTools.includes(declared.tool)
          : !options.profile.admittedDependencies.includes(declared.dependency);
    if (!unavailable) continue;

    const kind: BuildReviewPolicyIncompatibilityKind = declared.kind === 'action'
      ? 'required-action'
      : declared.kind === 'capability'
        ? 'unavailable-capability'
        : declared.kind === 'tool'
          ? 'unavailable-tool'
          : 'unavailable-dependency';
    const requirement = declared.kind === 'action'
      ? declared.action
      : declared.kind === 'capability'
        ? declared.capability
        : declared.kind === 'tool'
          ? declared.tool
          : declared.dependency;
    return unsupported('preflight', options.profile.provider, {
      kind,
      requirement,
      recovery: RECOVERY_FOR_DECLARED_REQUIREMENT[declared.kind],
    });
  }
  return { kind: 'admitted' };
}

/**
 * Runtime policy compatibility is opt-in and bounded.  In particular an
 * ordinary empty findings payload is a judged result at its own boundary, not
 * an unsupported-policy signal.
 */
export function parseBuildReviewPolicyRuntimeUnsupportedResponse(
  value: unknown,
  provider: BuildReviewPolicyCapabilityProfile['provider'],
): BuildReviewPolicyUnsupportedResult | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (source.kind !== 'unsupported-policy' || typeof source.requirement !== 'string') return undefined;
  const requirement = source.requirement.trim();
  if (!requirement || requirement.length > 512 || Object.keys(source).some((key) => key !== 'kind' && key !== 'requirement')) {
    return undefined;
  }
  return unsupported('runtime', provider, {
    kind: 'runtime-unsupported',
    requirement,
    recovery: 'adapt-policy-to-read-only-review',
  });
}

/** Render typed unsupported-policy evidence without using prose for routing. */
export function renderBuildReviewPolicyUnsupportedDiagnostic(
  result: BuildReviewPolicyUnsupportedResult,
): string {
  const { incompatibility } = result;
  return `Build-review policy is unsupported during ${result.stage} for ${result.provider}: ${incompatibility.kind} requirement "${incompatibility.requirement}". Recovery: ${incompatibility.recovery}. No judgement or repair authority was granted.`;
}

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
