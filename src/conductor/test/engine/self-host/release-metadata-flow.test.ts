// Covers: task:11
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolveReleaseMetadataFlow } from '../../../src/engine/self-host/release-metadata-flow.js';

const renamedReleaseDisposition = {
  'release-disposition': { skill: '.agents/skills/renamed-release-metadata/SKILL.md' },
};

describe('resolveReleaseMetadataFlow', () => {
  it('activates for a self-build with the gate enabled and the declared release-disposition step', () => {
    expect(resolveReleaseMetadataFlow({
      isSelfBuild: true,
      releaseArtifactGateEnabled: true,
      steps: renamedReleaseDisposition,
    })).toBe('active');
  });

  it('is inactive outside a self-build even when release-disposition is declared', () => {
    expect(resolveReleaseMetadataFlow({
      isSelfBuild: false,
      releaseArtifactGateEnabled: true,
      steps: renamedReleaseDisposition,
    })).toBe('inactive');
  });

  it.each([undefined, renamedReleaseDisposition])(
    'is inactive for a self-build when the release-artifact gate is disabled (%s)',
    (steps) => {
      expect(resolveReleaseMetadataFlow({
        isSelfBuild: true,
        releaseArtifactGateEnabled: false,
        steps,
      })).toBe('inactive');
    },
  );

  it('reports a missing release-disposition step without embedding a skills-directory path', async () => {
    expect(resolveReleaseMetadataFlow({
      isSelfBuild: true,
      releaseArtifactGateEnabled: true,
      steps: {},
    })).toBe('step-missing');

    const source = await readFile(
      fileURLToPath(new URL('../../../src/engine/self-host/release-metadata-flow.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toContain('.agents/skills/');
  });
});
