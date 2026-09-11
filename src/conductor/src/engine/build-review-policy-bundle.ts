import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';

import type { InstalledReviewSkill } from './build-review-policy.js';

export interface CapturedReviewPolicyBundleEntry {
  readonly relativePath: string;
  readonly bytes: Buffer;
}

/** Stable, path-free selected-policy facts bound to the captured package. */
export interface CapturedReviewPolicyBundleMetadata {
  readonly version: 1;
  readonly semanticName: string;
  readonly source: InstalledReviewSkill['source'];
  readonly plugin?: {
    readonly id: string;
    readonly version?: string;
  };
  readonly declaredDependencies: readonly string[];
}

export interface CapturedReviewPolicyBundle {
  readonly policy: InstalledReviewSkill;
  readonly materialPath: string;
  readonly definitionPath: string;
  readonly manifest: readonly CapturedReviewPolicyBundleEntry[];
  readonly metadata: CapturedReviewPolicyBundleMetadata;
  readonly digest: string;
}

export interface CaptureInstalledReviewPolicyBundleOptions {
  readonly materialParent: string;
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    && path !== '..' && !isAbsolute(path));
}

function relativePackagePath(root: string, path: string): string {
  const value = relative(root, path);
  if (!value || !isWithin(root, path)) {
    throw new Error(`Policy resource is outside the selected package: ${path}`);
  }
  return value.split('\\').join('/');
}

function admittedMetadata(policy: InstalledReviewSkill): CapturedReviewPolicyBundleMetadata {
  return {
    version: 1,
    semanticName: policy.semanticName,
    source: policy.source,
    ...(policy.plugin === undefined ? {} : {
      plugin: {
        id: policy.plugin.id,
        ...(policy.plugin.version === undefined ? {} : { version: policy.plugin.version }),
      },
    }),
    declaredDependencies: [...policy.declaredDependencies],
  };
}

function effectiveBundleDigest(
  metadata: CapturedReviewPolicyBundleMetadata,
  manifest: readonly CapturedReviewPolicyBundleEntry[],
): string {
  const hash = createHash('sha256');
  const write = (value: Buffer | string) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
  };

  write('build-review-policy-bundle');
  write(JSON.stringify(metadata));
  for (const entry of manifest) {
    write(entry.relativePath);
    write(entry.bytes);
  }
  return `sha256-v1:${hash.digest('hex')}`;
}

async function collectPackageFiles(
  packageRoot: string,
  currentPath: string,
  relativeParent: string,
  ancestry: ReadonlySet<string>,
  manifest: CapturedReviewPolicyBundleEntry[],
): Promise<void> {
  const canonicalCurrentPath = await realpath(currentPath);
  if (!isWithin(packageRoot, canonicalCurrentPath)) {
    throw new Error(`Policy resource escapes the selected package: ${currentPath}`);
  }
  if (ancestry.has(canonicalCurrentPath)) {
    throw new Error(`Policy resource symlink cycle: ${currentPath}`);
  }
  const nextAncestry = new Set(ancestry).add(canonicalCurrentPath);
  const entries = await readdir(canonicalCurrentPath, { withFileTypes: true });
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  for (const entry of entries) {
    const sourcePath = join(canonicalCurrentPath, entry.name);
    const relativePath = relativeParent ? `${relativeParent}/${entry.name}` : entry.name;
    const stat = await lstat(sourcePath);

    if (stat.isDirectory()) {
      await collectPackageFiles(packageRoot, sourcePath, relativePath, nextAncestry, manifest);
      continue;
    }
    if (stat.isSymbolicLink()) {
      const targetPath = await realpath(sourcePath);
      const targetStat = await lstat(targetPath);
      if (!isWithin(packageRoot, targetPath)) {
        throw new Error(`Policy resource symlink escapes the selected package: ${relativePath}`);
      }
      if (targetStat.isDirectory()) {
        await collectPackageFiles(packageRoot, targetPath, relativePath, nextAncestry, manifest);
        continue;
      }
      if (!targetStat.isFile()) {
        throw new Error(`Policy resource is not a regular file: ${relativePath}`);
      }
      manifest.push({ relativePath, bytes: await readFile(targetPath) });
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(`Policy resource is not a regular file: ${relativePath}`);
    }
    manifest.push({ relativePath, bytes: await readFile(sourcePath) });
  }
}

/** Capture the complete selected package into runtime-owned material. */
export async function captureInstalledReviewPolicyBundle(
  policy: InstalledReviewSkill,
  options: CaptureInstalledReviewPolicyBundleOptions,
): Promise<CapturedReviewPolicyBundle> {
  await mkdir(options.materialParent, { recursive: true });
  const packageRoot = await realpath(policy.packageRoot);
  const canonicalSkillPath = await realpath(policy.canonicalSkillPath);
  const definitionRelativePath = relativePackagePath(packageRoot, canonicalSkillPath);
  const manifest: CapturedReviewPolicyBundleEntry[] = [];
  await collectPackageFiles(packageRoot, packageRoot, '', new Set(), manifest);
  manifest.sort((left, right) => (
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  ));

  const materialPath = await mkdtemp(join(options.materialParent, 'policy-bundle-'));
  for (const entry of manifest) {
    const destination = join(materialPath, entry.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, entry.bytes);
  }

  const metadata = admittedMetadata(policy);
  return {
    policy,
    materialPath,
    definitionPath: join(materialPath, definitionRelativePath),
    manifest,
    metadata,
    digest: effectiveBundleDigest(metadata, manifest),
  };
}
