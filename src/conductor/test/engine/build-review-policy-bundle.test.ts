// Covers: task:7, task:8, task:9
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
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

async function expectRejectedWithoutMaterial(
  operation: Promise<unknown>,
  materialParent: string,
  message: RegExp,
): Promise<void> {
  await expect(operation).rejects.toThrow(message);
  expect(await readdir(materialParent)).toEqual([]);
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
      declaredDependencies: ['skills/review/criteria/scope.md'],
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

  it('refuses a missing declared resource before it creates eligible material', async () => {
    const sourceParent = await temporaryDirectory('build-review-policy-missing-source-');
    const materialParent = await temporaryDirectory('build-review-policy-missing-material-');
    const packageRoot = await policyPackage(sourceParent);

    await expectRejectedWithoutMaterial(
      captureInstalledReviewPolicyBundle(installedSkill(packageRoot, {
        declaredDependencies: ['criteria/missing.md'],
      }), { materialParent }),
      materialParent,
      /criteria\/missing\.md/,
    );
  });

  it('refuses an unreadable declared resource through the source I/O boundary', async () => {
    const sourceParent = await temporaryDirectory('build-review-policy-unreadable-source-');
    const materialParent = await temporaryDirectory('build-review-policy-unreadable-material-');
    const packageRoot = await policyPackage(sourceParent);

    await expectRejectedWithoutMaterial(
      captureInstalledReviewPolicyBundle(installedSkill(packageRoot), {
        materialParent,
        sourceReadFile: async (path) => {
          if (path.endsWith('criteria/checks.md')) {
            throw new Error('fixture permission denied');
          }
          return readFile(path);
        },
      }),
      materialParent,
      /criteria\/checks\.md/,
    );
  });

  it('refuses a broken local Markdown resource reference before it creates eligible material', async () => {
    const sourceParent = await temporaryDirectory('build-review-policy-reference-source-');
    const materialParent = await temporaryDirectory('build-review-policy-reference-material-');
    const packageRoot = await policyPackage(sourceParent);
    await writeFile(join(packageRoot, 'SKILL.md'), '# Policy\n[Missing criteria](criteria/missing.md)\n', 'utf8');

    await expectRejectedWithoutMaterial(
      captureInstalledReviewPolicyBundle(installedSkill(packageRoot), { materialParent }),
      materialParent,
      /criteria\/missing\.md/,
    );
  });

  it('refuses an escaping symlink and a symlink cycle by their resource names', async () => {
    const sourceParent = await temporaryDirectory('build-review-policy-link-fault-source-');
    const materialParent = await temporaryDirectory('build-review-policy-link-fault-material-');
    const packageRoot = await policyPackage(sourceParent);
    await writeFile(join(sourceParent, 'outside.md'), 'outside package', 'utf8');
    await symlink('../../outside.md', join(packageRoot, 'criteria', 'escape.md'));

    await expectRejectedWithoutMaterial(
      captureInstalledReviewPolicyBundle(installedSkill(packageRoot), { materialParent }),
      materialParent,
      /escape\.md/,
    );

    await rm(join(packageRoot, 'criteria', 'escape.md'));
    await symlink('cycle-b.md', join(packageRoot, 'criteria', 'cycle-a.md'));
    await symlink('cycle-a.md', join(packageRoot, 'criteria', 'cycle-b.md'));

    await expectRejectedWithoutMaterial(
      captureInstalledReviewPolicyBundle(installedSkill(packageRoot), { materialParent }),
      materialParent,
      /cycle-[ab]\.md/,
    );
  });

  it('refuses special files before materializing a partial package', async () => {
    // Keep the Unix-domain socket below its platform pathname limit.
    const sourceParent = await temporaryDirectory('p-');
    const materialParent = await temporaryDirectory('m-');
    const packageRoot = await policyPackage(sourceParent);
    const socketPath = join(packageRoot, 'criteria', 'policy.sock');
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    try {
      await expectRejectedWithoutMaterial(
        captureInstalledReviewPolicyBundle(installedSkill(packageRoot), { materialParent }),
        materialParent,
        /policy\.sock/,
      );
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('accepts inclusive package file and byte limits', async () => {
    const sourceParent = await temporaryDirectory('build-review-policy-limit-source-');
    const materialParent = await temporaryDirectory('build-review-policy-limit-material-');
    const packageRoot = join(sourceParent, 'policy');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, 'SKILL.md'), Buffer.alloc(64 * 1024 * 1024));
    for (let index = 1; index < 4096; index += 1) {
      await writeFile(join(packageRoot, `resource-${index}.md`), '');
    }

    const bundle = await captureInstalledReviewPolicyBundle(installedSkill(packageRoot, {
      declaredDependencies: [],
    }), { materialParent });

    expect(bundle.manifest).toHaveLength(4096);
    expect(bundle.manifest.reduce((total, entry) => total + entry.bytes.length, 0)).toBe(64 * 1024 * 1024);
  });

  it('refuses a package exceeding either complete-package limit without materializing it', async () => {
    const sourceParent = await temporaryDirectory('build-review-policy-over-limit-source-');
    const materialParent = await temporaryDirectory('build-review-policy-over-limit-material-');
    const packageRoot = join(sourceParent, 'policy');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, 'SKILL.md'), 'policy');
    for (let index = 1; index <= 4096; index += 1) {
      await writeFile(join(packageRoot, `resource-${index}.md`), '');
    }

    await expectRejectedWithoutMaterial(
      captureInstalledReviewPolicyBundle(installedSkill(packageRoot, { declaredDependencies: [] }), { materialParent }),
      materialParent,
      /4096 files/,
    );

    await rm(packageRoot, { recursive: true });
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, 'SKILL.md'), Buffer.alloc((64 * 1024 * 1024) + 1));

    await expectRejectedWithoutMaterial(
      captureInstalledReviewPolicyBundle(installedSkill(packageRoot, { declaredDependencies: [] }), { materialParent }),
      materialParent,
      /64 MiB/,
    );
  });

  it.each([
    ['changed definition bytes', async (packageRoot: string) => {
      await writeFile(join(packageRoot, 'SKILL.md'), '# Changed policy\n', 'utf8');
    }],
    ['changed resource bytes', async (packageRoot: string) => {
      await writeFile(join(packageRoot, 'criteria', 'checks.md'), 'Changed criteria\n', 'utf8');
    }],
    ['an added member', async (packageRoot: string) => {
      await writeFile(join(packageRoot, 'criteria', 'added.md'), 'Added after capture\n', 'utf8');
    }],
    ['a removed member', async (packageRoot: string) => {
      await rm(join(packageRoot, 'criteria', 'unreferenced.bin'));
    }],
    ['a changed link target', async (packageRoot: string) => {
      const linkPath = join(packageRoot, 'criteria', 'linked-checks.md');
      await rm(linkPath);
      await symlink('same-checks.md', linkPath);
    }],
  ])('rejects %s between source capture and final consistency check', async (_name, changeSource) => {
    const sourceParent = await temporaryDirectory('build-review-policy-changing-source-');
    const materialParent = await temporaryDirectory('build-review-policy-changing-material-');
    const packageRoot = await policyPackage(sourceParent);
    await writeFile(join(packageRoot, 'criteria', 'same-checks.md'), 'Check every changed boundary.\n', 'utf8');
    await symlink('checks.md', join(packageRoot, 'criteria', 'linked-checks.md'));

    await expectRejectedWithoutMaterial(
      captureInstalledReviewPolicyBundle(installedSkill(packageRoot), {
        materialParent,
        captureBoundary: async (boundary) => {
          if (boundary === 'source-captured') await changeSource(packageRoot);
        },
      }),
      materialParent,
      /changed during capture/,
    );
  });

  it('removes only failed candidate material after a write failure and fresh-captures a later attempt', async () => {
    const sourceParent = await temporaryDirectory('build-review-policy-write-failure-source-');
    const materialParent = await temporaryDirectory('build-review-policy-write-failure-material-');
    const packageRoot = await policyPackage(sourceParent);
    const unrelatedMaterial = join(materialParent, 'unrelated-candidate');
    await mkdir(unrelatedMaterial);
    await writeFile(join(unrelatedMaterial, 'keep.txt'), 'preserve', 'utf8');

    await expect(
      captureInstalledReviewPolicyBundle(installedSkill(packageRoot), {
        materialParent,
        materialWriteFile: async (path, bytes) => {
          if (path.endsWith('criteria/checks.md')) throw new Error('fixture write failure');
          await writeFile(path, bytes);
        },
      }),
    ).rejects.toThrow(/criteria\/checks\.md/);
    expect(await readdir(materialParent)).toEqual(['unrelated-candidate']);

    await writeFile(join(packageRoot, 'criteria', 'checks.md'), 'Fresh capture after failure\n', 'utf8');
    const bundle = await captureInstalledReviewPolicyBundle(installedSkill(packageRoot), { materialParent });

    expect(await readFile(join(bundle.materialPath, 'criteria', 'checks.md'), 'utf8'))
      .toBe('Fresh capture after failure\n');
    expect(await readFile(join(unrelatedMaterial, 'keep.txt'), 'utf8')).toBe('preserve');
  });
});
