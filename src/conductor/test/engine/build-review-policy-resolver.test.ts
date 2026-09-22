// Covers: task:3
import { describe, expect, it } from 'vitest';

import {
  resolveInstalledReviewPolicy,
  type InstalledReviewSkill,
  type ReviewPolicyDeclaration,
} from '../../src/engine/build-review-policy-resolver.js';

function installedSkill(overrides: Partial<InstalledReviewSkill> = {}): InstalledReviewSkill {
  return {
    semanticName: 'review-policy',
    source: 'project',
    installationOrigin: '/candidate/project/skills/review-policy',
    canonicalSkillPath: '/candidate/project/skills/review-policy/SKILL.md',
    packageRoot: '/candidate/project/skills/review-policy',
    declaredDependencies: [],
    availability: 'available',
    ...overrides,
  };
}

function declaration(overrides: Partial<ReviewPolicyDeclaration> = {}): ReviewPolicyDeclaration {
  return {
    skill: 'review-policy',
    ...overrides,
  };
}

describe('engine/build-review-policy-resolver', () => {
  it('selects project, global, and plugin-qualified installed policies by canonical identity', () => {
    const project = installedSkill();
    const global = installedSkill({
      source: 'global',
      installationOrigin: '/candidate/global/skills/review-policy',
      canonicalSkillPath: '/candidate/global/skills/review-policy/SKILL.md',
      packageRoot: '/candidate/global/skills/review-policy',
    });
    const plugin = installedSkill({
      semanticName: 'review',
      source: 'plugin',
      plugin: { id: 'kotlin-review', version: '2.4.0' },
      installationOrigin: '/candidate/plugins/kotlin-review',
      canonicalSkillPath: '/candidate/plugins/kotlin-review/skills/review/SKILL.md',
      packageRoot: '/candidate/plugins/kotlin-review',
    });

    expect(resolveInstalledReviewPolicy(declaration({ source: 'project' }), [project, global]))
      .toEqual({ kind: 'resolved', policy: project });
    expect(resolveInstalledReviewPolicy(declaration({ source: 'global' }), [project, global]))
      .toEqual({ kind: 'resolved', policy: global });
    expect(resolveInstalledReviewPolicy(declaration({ skill: 'kotlin-review:review' }), [plugin]))
      .toEqual({ kind: 'resolved', policy: plugin });
  });

  it('lets one enabled global installation supply the policy with no local copy and leaves another project\'s selection unchanged', () => {
    const global = installedSkill({
      source: 'global',
      installationOrigin: '/candidate/global/skills/review-policy',
      canonicalSkillPath: '/candidate/global/skills/review-policy/SKILL.md',
      packageRoot: '/candidate/global/skills/review-policy',
    });
    const otherProjectLocal = installedSkill({
      installationOrigin: '/other-project/skills/review-policy',
      canonicalSkillPath: '/other-project/skills/review-policy/SKILL.md',
      packageRoot: '/other-project/skills/review-policy',
    });
    const otherProjectCatalog = [otherProjectLocal, global] as const;
    const otherProjectBefore = resolveInstalledReviewPolicy(declaration({ source: 'project' }), otherProjectCatalog);

    expect(resolveInstalledReviewPolicy(declaration(), [global])).toEqual({ kind: 'resolved', policy: global });

    expect(otherProjectBefore).toEqual({ kind: 'resolved', policy: otherProjectLocal });
    expect(resolveInstalledReviewPolicy(declaration({ source: 'project' }), otherProjectCatalog)).toEqual(otherProjectBefore);
    expect(otherProjectCatalog).toEqual([otherProjectLocal, global]);
  });

  it('collapses aliases of one canonical installation without rewriting original descriptors', () => {
    const canonical = installedSkill();
    const alias = installedSkill({
      canonicalSkillPath: '/candidate/aliases/review-policy/SKILL.md',
      packageRoot: '/candidate/aliases/review-policy',
    });
    const originals = [canonical, alias] as const;

    expect(resolveInstalledReviewPolicy(declaration(), originals)).toEqual({
      kind: 'resolved',
      policy: canonical,
    });
    expect(originals).toEqual([canonical, alias]);
  });

  it('refuses byte-equal policies at distinct installation origins instead of deduplicating their content', () => {
    const project = installedSkill();
    const globalCopy = installedSkill({
      source: 'global',
      installationOrigin: '/candidate/global/skills/review-policy',
      canonicalSkillPath: '/candidate/global/skills/review-policy/SKILL.md',
      packageRoot: '/candidate/global/skills/review-policy',
    });

    expect(resolveInstalledReviewPolicy(declaration(), [project, globalCopy])).toEqual({
      kind: 'failure',
      failure: {
        code: 'ambiguous',
        skill: 'review-policy',
        origins: [
          '/candidate/global/skills/review-policy',
          '/candidate/project/skills/review-policy',
        ],
      },
    });
  });

  it.each([
    ['absent', [], 'absent'],
    ['unreadable', [installedSkill({ availability: 'unreadable' })], 'unreadable'],
    ['disabled', [installedSkill({ availability: 'disabled' })], 'disabled'],
    ['marketplace-only', [installedSkill({ availability: 'marketplace-only' })], 'marketplace-only'],
    ['incomplete', [installedSkill({ availability: 'incomplete' })], 'incomplete'],
  ] as const)('names a %s selected installation failure without substituting another copy', (
    _caseName,
    catalog,
    code,
  ) => {
    const selectedSource = 'global';
    const selectedCatalog = catalog.map((policy) => installedSkill({
      ...policy,
      source: selectedSource,
      installationOrigin: '/candidate/global/skills/review-policy',
      canonicalSkillPath: '/candidate/global/skills/review-policy/SKILL.md',
      packageRoot: '/candidate/global/skills/review-policy',
    }));

    const offered = [installedSkill(), ...selectedCatalog];
    const offeredBefore = structuredClone(offered);

    expect(resolveInstalledReviewPolicy(declaration({ source: selectedSource }), offered)).toEqual({
      kind: 'failure',
      failure: {
        code,
        skill: 'review-policy',
        source: selectedSource,
      },
    });
    // Reporting is the whole effect: the unavailable descriptor is never
    // flipped to available (no enablement or download), and the available
    // alternative copy is left offered but unselected.
    expect(offered).toEqual(offeredBefore);
  });
});
