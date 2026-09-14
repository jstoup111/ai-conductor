import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative } from 'node:path';

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
  /** Source read seam for fault-injected policy-loading tests. */
  readonly sourceReadFile?: (path: string) => Promise<Buffer>;
  /** Material write seam for fault-injected policy-loading tests. */
  readonly materialWriteFile?: (path: string, bytes: Buffer) => Promise<void>;
  /** Capture lifecycle seam for deterministic concurrent-source fixtures. */
  readonly captureBoundary?: (boundary: 'source-captured' | 'material-written') => Promise<void>;
}

interface CapturedSourceManifestEntry extends CapturedReviewPolicyBundleEntry {
  readonly symbolicLinkTarget?: string;
}

export const MAX_POLICY_BUNDLE_FILES = 4096;
export const MAX_POLICY_BUNDLE_BYTES = 64 * 1024 * 1024;

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

function policyResourceError(kind: string, relativePath: string): Error {
  return new Error(`Policy resource ${kind}: ${relativePath}`);
}

function resourcePathForError(relativePath: string): string {
  return relativePath || 'selected package';
}

async function canonicalResourcePath(sourcePath: string, relativePath: string): Promise<string> {
  try {
    return await realpath(sourcePath);
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ELOOP') {
      throw policyResourceError('symlink cycle', resourcePathForError(relativePath));
    }
    throw policyResourceError('is missing or unreadable', resourcePathForError(relativePath));
  }
}

function localMarkdownReferences(markdown: string): readonly string[] {
  const references: string[] = [];
  const patterns = [
    /!?\[[^\]]*]\(\s*(?:<([^>]+)>|([^\s)]+))[^)]*\)/g,
    /^\s*\[[^\]]+]:\s*(?:<([^>]+)>|(\S+))/gm,
  ];
  for (const pattern of patterns) {
    for (const match of markdown.matchAll(pattern)) {
      const reference = (match[1] ?? match[2]).trim();
      if (
        reference !== ''
        && !reference.startsWith('#')
        && !reference.startsWith('//')
        && !/^[a-z][a-z0-9+.-]*:/i.test(reference)
      ) {
        references.push(reference);
      }
    }
  }
  return references;
}

function referencedPackagePath(sourceRelativePath: string, reference: string): string {
  const target = reference.replace(/\\/g, '/').split(/[?#]/, 1)[0];
  if (!target || target.startsWith('/') || isAbsolute(target)) {
    throw policyResourceError('escapes the selected package', reference);
  }
  const normalized = posix.normalize(posix.join(posix.dirname(sourceRelativePath), target));
  if (normalized === '..' || normalized.startsWith('../')) {
    throw policyResourceError('escapes the selected package', reference);
  }
  return normalized;
}

function validateRequiredResources(
  policy: InstalledReviewSkill,
  manifest: readonly CapturedReviewPolicyBundleEntry[],
): void {
  const availablePaths = new Set(manifest.map((entry) => entry.relativePath));
  const requireResource = (reference: string, sourceRelativePath = 'SKILL.md') => {
    const resourcePath = referencedPackagePath(sourceRelativePath, reference);
    if (!availablePaths.has(resourcePath)) {
      throw policyResourceError('is missing or unreadable', reference);
    }
  };

  for (const dependency of policy.declaredDependencies) {
    requireResource(dependency);
  }
  for (const entry of manifest) {
    if (!entry.relativePath.toLowerCase().endsWith('.md')) continue;
    for (const reference of localMarkdownReferences(entry.bytes.toString('utf8'))) {
      requireResource(reference, entry.relativePath);
    }
  }
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
  manifest: CapturedSourceManifestEntry[],
  sourceReadFile: (path: string) => Promise<Buffer>,
): Promise<void> {
  const canonicalCurrentPath = await canonicalResourcePath(currentPath, relativeParent);
  if (!isWithin(packageRoot, canonicalCurrentPath)) {
    throw policyResourceError('escapes the selected package', resourcePathForError(relativeParent));
  }
  if (ancestry.has(canonicalCurrentPath)) {
    throw policyResourceError('symlink cycle', resourcePathForError(relativeParent));
  }
  const nextAncestry = new Set(ancestry).add(canonicalCurrentPath);
  let entries;
  try {
    entries = await readdir(canonicalCurrentPath, { withFileTypes: true });
  } catch {
    throw policyResourceError('is missing or unreadable', resourcePathForError(relativeParent));
  }
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  for (const entry of entries) {
    const sourcePath = join(canonicalCurrentPath, entry.name);
    const relativePath = relativeParent ? `${relativeParent}/${entry.name}` : entry.name;
    let stat;
    try {
      stat = await lstat(sourcePath);
    } catch {
      throw policyResourceError('is missing or unreadable', relativePath);
    }

    if (stat.isDirectory()) {
      await collectPackageFiles(packageRoot, sourcePath, relativePath, nextAncestry, manifest, sourceReadFile);
      continue;
    }
    if (stat.isSymbolicLink()) {
      const targetPath = await canonicalResourcePath(sourcePath, relativePath);
      let targetStat;
      try {
        targetStat = await lstat(targetPath);
      } catch {
        throw policyResourceError('is missing or unreadable', relativePath);
      }
      if (!isWithin(packageRoot, targetPath)) {
        throw policyResourceError('symlink escapes the selected package', relativePath);
      }
      if (targetStat.isDirectory()) {
        await collectPackageFiles(packageRoot, targetPath, relativePath, nextAncestry, manifest, sourceReadFile);
        continue;
      }
      if (!targetStat.isFile()) {
        throw policyResourceError('is not a regular file', relativePath);
      }
      try {
        manifest.push({
          relativePath,
          bytes: await sourceReadFile(targetPath),
          symbolicLinkTarget: await readlink(sourcePath, 'utf8'),
        });
      } catch {
        throw policyResourceError('is missing or unreadable', relativePath);
      }
      continue;
    }
    if (!stat.isFile()) {
      throw policyResourceError('is not a regular file', relativePath);
    }
    try {
      manifest.push({ relativePath, bytes: await sourceReadFile(sourcePath) });
    } catch {
      throw policyResourceError('is missing or unreadable', relativePath);
    }
  }
}

async function captureSourceManifest(
  packageRoot: string,
  sourceReadFile: (path: string) => Promise<Buffer>,
): Promise<readonly CapturedSourceManifestEntry[]> {
  const manifest: CapturedSourceManifestEntry[] = [];
  await collectPackageFiles(packageRoot, packageRoot, '', new Set(), manifest, sourceReadFile);
  manifest.sort((left, right) => (
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  ));
  return manifest;
}

function sameSourceManifest(
  captured: readonly CapturedSourceManifestEntry[],
  current: readonly CapturedSourceManifestEntry[],
): boolean {
  return captured.length === current.length && captured.every((entry, index) => {
    const comparison = current[index];
    return entry.relativePath === comparison.relativePath
      && entry.bytes.equals(comparison.bytes)
      && entry.symbolicLinkTarget === comparison.symbolicLinkTarget;
  });
}

function validateBundleLimits(manifest: readonly CapturedReviewPolicyBundleEntry[]): void {
  if (manifest.length > MAX_POLICY_BUNDLE_FILES) {
    throw new Error(`Policy package exceeds ${MAX_POLICY_BUNDLE_FILES} files`);
  }
  const totalBytes = manifest.reduce((total, entry) => total + entry.bytes.length, 0);
  if (totalBytes > MAX_POLICY_BUNDLE_BYTES) {
    throw new Error('Policy package exceeds 64 MiB');
  }
}

/** Capture the complete selected package into runtime-owned material. */
export async function captureInstalledReviewPolicyBundle(
  policy: InstalledReviewSkill,
  options: CaptureInstalledReviewPolicyBundleOptions,
): Promise<CapturedReviewPolicyBundle> {
  await mkdir(options.materialParent, { recursive: true });
  const packageRoot = await canonicalResourcePath(policy.packageRoot, 'selected package');
  const canonicalSkillPath = await canonicalResourcePath(policy.canonicalSkillPath, 'SKILL.md');
  const definitionRelativePath = relativePackagePath(packageRoot, canonicalSkillPath);
  const sourceReadFile = options.sourceReadFile ?? readFile;
  const capturedSourceManifest = await captureSourceManifest(packageRoot, sourceReadFile);
  const manifest: readonly CapturedReviewPolicyBundleEntry[] = capturedSourceManifest.map((entry) => ({
    relativePath: entry.relativePath,
    bytes: entry.bytes,
  }));
  validateBundleLimits(manifest);
  validateRequiredResources(policy, manifest);
  await options.captureBoundary?.('source-captured');

  let materialPath: string | undefined;
  try {
    materialPath = await mkdtemp(join(options.materialParent, 'policy-bundle-'));
    const materialWriteFile = options.materialWriteFile ?? writeFile;
    for (const entry of manifest) {
      const destination = join(materialPath, entry.relativePath);
      await mkdir(dirname(destination), { recursive: true });
      try {
        await materialWriteFile(destination, entry.bytes);
      } catch {
        throw policyResourceError('could not be materialized', entry.relativePath);
      }
    }
    await options.captureBoundary?.('material-written');

    const finalSourceManifest = await captureSourceManifest(packageRoot, sourceReadFile);
    if (!sameSourceManifest(capturedSourceManifest, finalSourceManifest)) {
      throw new Error('Policy package changed during capture');
    }
  } catch (error) {
    if (materialPath !== undefined) await rm(materialPath, { recursive: true, force: true });
    throw error;
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
