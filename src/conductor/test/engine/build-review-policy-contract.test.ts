// Covers: task:10
import { describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_POLICY_CONTRACT_VERSION,
  renderBuildReviewPolicyContract,
} from '../../src/engine/build-review-policy-contract.js';
import type { CapturedReviewPolicyBundle } from '../../src/engine/build-review-policy-bundle.js';

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
});
