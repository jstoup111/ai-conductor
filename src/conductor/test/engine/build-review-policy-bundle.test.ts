// Covers: task:7
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  captureInstalledReviewPolicyBundle,
} from '../../src/engine/build-review-policy-bundle.js';
import type { InstalledReviewSkill } from '../../src/engine/build-review-policy.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(process.env.TMPDIR!, prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function installedSkill(packageRoot: string, overrides: Partial<InstalledReviewSkill> = {}): InstalledReviewSkill {
  return {
    semanticName: 'review-policy',
    source: 'project',
    installationOrigin: packageRoot,
    canonicalSkillPath: join(packageRoot, 'SKILL.md'),
    packageRoot,
    declaredDependencies: ['criteria/checks.md'],
    availability: 'available',
    ...overrides,
  };
}

async function policyPackage(parent: string): Promise<string> {
  const root = join(parent, 'policy');
  await mkdir(join(root, 'criteria'), { recursive: true });
  await writeFile(join(root, 'SKILL.md'), '# Policy\nRead criteria/checks.md\n', 'utf8');
  await writeFile(join(root, 'criteria', 'checks.md'), 'Check every changed boundary.\n', 'utf8');
  // Deliberately unreferenced: complete-package capture must retain it too.
  await writeFile(join(root, 'criteria', 'unreferenced.bin'), Buffer.from([0, 255, 10]));
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('engine/build-review-policy-bundle', () => {
  it('captures the complete standalone package with its relative tree and raw bytes', async () => {
    const sourceParent = await temporaryDirectory('build-review-policy-source-');
    const materialParent = await temporaryDirectory('build-review-policy-material-');
    const packageRoot = await policyPackage(sourceParent);

    const bundle = await captureInstalledReviewPolicyBundle(
      installedSkill(packageRoot),
      { materialParent },
    );

    expect(bundle.manifest.map((entry) => entry.relativePath)).toEqual([
      'SKILL.md',
      'criteria/checks.md',
      'criteria/unreferenced.bin',
    ]);
    expect(await readFile(join(bundle.materialPath, 'SKILL.md'), 'utf8'))
      .toBe('# Policy\nRead criteria/checks.md\n');
    expect(await readFile(join(bundle.materialPath, 'criteria', 'checks.md'), 'utf8'))
      .toBe('Check every changed boundary.\n');
    expect(await readFile(join(bundle.materialPath, 'criteria', 'unreferenced.bin')))
      .toEqual(Buffer.from([0, 255, 10]));
    expect(bundle.definitionPath).toBe(join(bundle.materialPath, 'SKILL.md'));
    expect(bundle.manifest.find((entry) => entry.relativePath === 'criteria/unreferenced.bin')?.bytes)
      .toEqual(Buffer.from([0, 255, 10]));
  });

  it('materializes safe in-package symlink targets at their admitted relative locations', async () => {
    const sourceParent = await temporaryDirectory('build-review-policy-link-source-');
    const materialParent = await temporaryDirectory('build-review-policy-link-material-');
    const packageRoot = await policyPackage(sourceParent);
    await symlink('checks.md', join(packageRoot, 'criteria', 'linked-checks.md'));

    const bundle = await captureInstalledReviewPolicyBundle(
      installedSkill(packageRoot),
      { materialParent },
    );

    expect(await readFile(join(bundle.materialPath, 'criteria', 'linked-checks.md'), 'utf8'))
      .toBe('Check every changed boundary.\n');
    expect(bundle.manifest.find((entry) => entry.relativePath === 'criteria/linked-checks.md')?.bytes)
      .toEqual(Buffer.from('Check every changed boundary.\n'));
  });

  it('uses the selected plugin root as the complete package boundary', async () => {
    const sourceParent = await temporaryDirectory('build-review-plugin-source-');
    const materialParent = await temporaryDirectory('build-review-plugin-material-');
    const pluginRoot = join(sourceParent, 'plugin');
    await mkdir(join(pluginRoot, 'skills', 'review', 'criteria'), { recursive: true });
    await writeFile(join(pluginRoot, 'plugin.json'), '{"name":"checks"}\n', 'utf8');
    await writeFile(join(pluginRoot, 'skills', 'review', 'SKILL.md'), '# Plugin policy\n', 'utf8');
    await writeFile(join(pluginRoot, 'skills', 'review', 'criteria', 'scope.md'), 'Plugin criteria\n', 'utf8');

    const bundle = await captureInstalledReviewPolicyBundle(installedSkill(pluginRoot, {
      source: 'plugin',
      plugin: { id: 'checks', version: '2.0.0' },
      canonicalSkillPath: join(pluginRoot, 'skills', 'review', 'SKILL.md'),
    }), { materialParent });

    expect(bundle.manifest.map((entry) => entry.relativePath)).toEqual([
      'plugin.json',
      'skills/review/SKILL.md',
      'skills/review/criteria/scope.md',
    ]);
    expect(bundle.definitionPath).toBe(join(bundle.materialPath, 'skills', 'review', 'SKILL.md'));
  });

  it('binds a versioned digest to all captured bytes and admitted metadata, never its material parent', async () => {
    const sourceParent = await temporaryDirectory('build-review-policy-digest-source-');
    const firstMaterialParent = await temporaryDirectory('build-review-policy-digest-first-');
    const secondMaterialParent = await temporaryDirectory('build-review-policy-digest-second-');
    const packageRoot = await policyPackage(sourceParent);
    const policy = installedSkill(packageRoot, { plugin: { id: 'checks', version: '2.0.0' } });

    const first = await captureInstalledReviewPolicyBundle(policy, { materialParent: firstMaterialParent });
    const second = await captureInstalledReviewPolicyBundle(policy, { materialParent: secondMaterialParent });
    await writeFile(join(packageRoot, 'criteria', 'unreferenced.bin'), Buffer.from([1, 2, 3]));
    const changed = await captureInstalledReviewPolicyBundle(policy, { materialParent: secondMaterialParent });
    const metadataChanged = await captureInstalledReviewPolicyBundle(
      installedSkill(packageRoot, {
        plugin: { id: 'checks', version: '2.0.1' },
      }),
      { materialParent: secondMaterialParent },
    );

    expect(first.digest).toMatch(/^sha256-v1:[a-f0-9]{64}$/);
    expect(first.digest).toBe(second.digest);
    expect(first.digest).not.toBe(changed.digest);
    expect(changed.digest).not.toBe(metadataChanged.digest);
  });
});
