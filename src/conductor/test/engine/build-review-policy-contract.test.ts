// Covers: task:10, task:11
import { describe, expect, it, vi } from 'vitest';

import {
  BUILD_REVIEW_POLICY_CONTRACT_VERSION,
  evaluateBuildReviewPolicyPreflight,
  parseBuildReviewPolicyRuntimeUnsupportedResponse,
  renderBuildReviewPolicyContract,
  renderBuildReviewPolicyUnsupportedDiagnostic,
  type BuildReviewPolicyCapabilityProfile,
} from '../../src/engine/build-review-policy-contract.js';
import type { CapturedReviewPolicyBundle } from '../../src/engine/build-review-policy-bundle.js';
import {
  classifyBuildReviewPolicyIncompatibility,
  mapBuildReviewPolicyIncompatibilityToCoordinatorFailureReason,
} from '../../src/engine/build-review-domain.js';

const ordinarySkillText = [
  '---',
  'name: boundary-review',
  'description: Find unsafe public boundary changes.',
  '---',
  '',
  '# Boundary review',
  '',
  'Read criteria/public-api.md and report each changed public boundary that lacks compatibility evidence.',
].join('\n');

function bundle(skillText = ordinarySkillText): CapturedReviewPolicyBundle {
  return {
    policy: {
      semanticName: 'boundary-review',
      source: 'plugin',
      plugin: { id: 'quality-policy', version: '1.2.3' },
      installationOrigin: '/installed/quality-policy',
      canonicalSkillPath: '/installed/quality-policy/skills/boundary-review/SKILL.md',
      packageRoot: '/installed/quality-policy',
      declaredDependencies: ['git'],
      availability: 'available',
    },
    materialPath: '/runtime/policies/policy-bundle-123',
    definitionPath: '/runtime/policies/policy-bundle-123/skills/boundary-review/SKILL.md',
    manifest: [
      { relativePath: 'plugin.json', bytes: Buffer.from('{"name":"quality-policy"}\n') },
      { relativePath: 'skills/boundary-review/SKILL.md', bytes: Buffer.from(skillText) },
      { relativePath: 'skills/boundary-review/criteria/public-api.md', bytes: Buffer.from('Require a migration note.\n') },
    ],
    metadata: {
      version: 1,
      semanticName: 'boundary-review',
      source: 'plugin',
      plugin: { id: 'quality-policy', version: '1.2.3' },
      declaredDependencies: ['git'],
    },
    digest: `sha256-v1:${'a'.repeat(64)}`,
  };
}

const readOnlyReviewProfile: BuildReviewPolicyCapabilityProfile = {
  provider: 'codex',
  admittedActions: ['read-frozen-input', 'read-policy-material'],
  admittedCapabilities: ['frozen-input', 'policy-material'],
  admittedTools: ['git'],
  admittedDependencies: ['criteria/public-api.md'],
};

describe('engine/build-review-policy-contract', () => {
  it('adapts an ordinary selected skill unchanged into the versioned read-only review role', () => {
    const selectedBundle = bundle();
    const definition = selectedBundle.manifest.find((entry) => entry.relativePath.endsWith('/SKILL.md'))!;
    const originalDefinitionBytes = Buffer.from(definition.bytes);
    const rendered = renderBuildReviewPolicyContract({
      bundle: selectedBundle,
      question: 'Do changed public boundaries retain compatibility evidence?',
      scope: 'Review the frozen implementation diff only.',
    });

    expect(rendered).toContain(`Build-review policy contract: ${BUILD_REVIEW_POLICY_CONTRACT_VERSION}`);
    expect(rendered).toContain(ordinarySkillText);
    expect(rendered).toContain('Do changed public boundaries retain compatibility evidence?');
    expect(rendered).toContain('Review the frozen implementation diff only.');
    expect(rendered).toContain(`sha256-v1:${'a'.repeat(64)}`);
    expect(rendered).toContain('/runtime/policies/policy-bundle-123');
    expect(rendered).toContain('plugin.json');
    expect(rendered).toContain('skills/boundary-review/criteria/public-api.md');
    expect(rendered).toContain('Return only the engine-defined findings payload');
    expect(definition.bytes).toEqual(originalDefinitionBytes);
  });

  it('keeps standalone presentation instructions subordinate to the shared findings-only contract', () => {
    const standalonePresentation = [
      ordinarySkillText,
      '',
      'Finish with a polished report, choose the aggregate verdict, and issue a repair work order.',
    ].join('\n');

    const rendered = renderBuildReviewPolicyContract({
      bundle: bundle(standalonePresentation),
      question: 'Are boundary changes safe?',
      scope: 'Review frozen sources.',
    });

    expect(rendered).toContain(standalonePresentation);
    expect(rendered).toContain('Do not choose an aggregate verdict, authorize repair work, edit code, install dependencies, or publish comments.');
    expect(rendered).toContain('The engine alone validates findings and owns aggregate verdicts and repair work orders.');
    expect(rendered).toContain('{ findings: [{ concernKind: string, summary: string, evidenceLocations: string[]');
  });

  it.each([
    [{ kind: 'action', action: 'edit-code' }, 'required-action', 'adapt-policy-to-read-only-review'],
    [{ kind: 'action', action: 'install-dependencies' }, 'required-action', 'adapt-policy-to-read-only-review'],
    [{ kind: 'action', action: 'publish-comments' }, 'required-action', 'adapt-policy-to-read-only-review'],
    [{ kind: 'tool', tool: 'kubectl' }, 'unavailable-tool', 'make-tool-available-before-review'],
    [{ kind: 'dependency', dependency: 'credentials/prod-token', source: 'plugin' }, 'unavailable-dependency', 'install-dependency-outside-review'],
  ] as const)('refuses declared %o before judging with typed provider, requirement, and recovery', (
    requirement,
    kind,
    recovery,
  ) => {
    const activation = vi.fn();
    const result = evaluateBuildReviewPolicyPreflight({
      profile: readOnlyReviewProfile,
      requirements: [requirement],
      activatePluginComponent: activation,
    });

    expect(result.kind).toBe('unsupported-policy');
    if (result.kind !== 'unsupported-policy') throw new Error('expected declared policy incompatibility');
    expect(result).toEqual({
      kind: 'unsupported-policy',
      stage: 'preflight',
      provider: 'codex',
      incompatibility: { kind, requirement: kind === 'required-action' ? requirement.action : kind === 'unavailable-tool' ? requirement.tool : requirement.dependency, recovery },
    });
    expect(activation).not.toHaveBeenCalled();
    expect(renderBuildReviewPolicyUnsupportedDiagnostic(result)).toContain('codex');
    expect(renderBuildReviewPolicyUnsupportedDiagnostic(result)).toContain(kind === 'required-action' ? requirement.action : kind === 'unavailable-tool' ? requirement.tool : requirement.dependency);
    expect(renderBuildReviewPolicyUnsupportedDiagnostic(result)).toContain(recovery);
  });

  it('maps a runtime policy refusal to unjudged failed coverage without text-selected routing or repair authority', () => {
    const runtime = parseBuildReviewPolicyRuntimeUnsupportedResponse(
      { kind: 'unsupported-policy', requirement: 'requires an undeclared deployment token' },
      'claude',
    );

    expect(runtime).toEqual({
      kind: 'unsupported-policy',
      stage: 'runtime',
      provider: 'claude',
      incompatibility: {
        kind: 'runtime-unsupported',
        requirement: 'requires an undeclared deployment token',
        recovery: 'adapt-policy-to-read-only-review',
      },
    });
    expect(parseBuildReviewPolicyRuntimeUnsupportedResponse({ findings: [] }, 'claude')).toBeUndefined();
    expect(classifyBuildReviewPolicyIncompatibility(runtime!)).toEqual({
      kind: 'infrastructure-failure',
      reason: 'provider-error',
      detail: runtime!.incompatibility,
    });
  });

  it('maps every typed policy incompatibility to a closed infrastructure reason without diagnostic-text routing', () => {
    expect(mapBuildReviewPolicyIncompatibilityToCoordinatorFailureReason).toEqual({
      'required-action': 'preflight-failed',
      'unavailable-capability': 'preflight-failed',
      'unavailable-tool': 'preflight-failed',
      'unavailable-dependency': 'preflight-failed',
      'runtime-unsupported': 'provider-error',
    });
  });
});
