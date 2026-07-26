import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';

const PROTECTED_ARTIFACT_DIRECTORIES = [
  '.docs/architecture',
  '.docs/plans',
  '.docs/specs',
  '.docs/stories',
] as const;

export const PROTECTED_ARTIFACT_SEAL_PATH = '.pipeline/protected-artifact-seal.json';

export interface ProtectedArtifactFingerprint {
  path: string;
  fingerprint: string;
}

export interface ProtectedArtifactSeal {
  version: 1;
  baselineCommit: string;
  protectedArtifacts: ProtectedArtifactFingerprint[];
}

export interface CreateProtectedArtifactSealOptions {
  projectRoot: string;
  /** Approved commit whose DECIDE artifacts must remain authoritative. */
  baselineCommit: string;
}

function comparePaths(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function fingerprint(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function parseSeal(serialized: string): ProtectedArtifactSeal {
  const value = JSON.parse(serialized) as Partial<ProtectedArtifactSeal>;
  if (
    value.version !== 1 ||
    typeof value.baselineCommit !== 'string' ||
    !Array.isArray(value.protectedArtifacts) ||
    !value.protectedArtifacts.every(
      (artifact) =>
        typeof artifact?.path === 'string' && typeof artifact?.fingerprint === 'string',
    )
  ) {
    throw new Error('Protected-artifact seal is invalid');
  }
  return value as ProtectedArtifactSeal;
}

async function readExistingSeal(path: string): Promise<ProtectedArtifactSeal | undefined> {
  try {
    return parseSeal(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function committedProtectedPaths(projectRoot: string, baselineCommit: string): Promise<string[]> {
  const result = await execa(
    'git',
    ['ls-tree', '-r', '-z', '--name-only', baselineCommit, '--', ...PROTECTED_ARTIFACT_DIRECTORIES],
    { cwd: projectRoot },
  );
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .sort(comparePaths);
}

async function contentAtCommit(
  projectRoot: string,
  baselineCommit: string,
  path: string,
): Promise<string> {
  const result = await execa('git', ['show', `${baselineCommit}:${path}`], {
    cwd: projectRoot,
    stripFinalNewline: false,
  });
  return result.stdout;
}

async function createSeal(options: CreateProtectedArtifactSealOptions): Promise<ProtectedArtifactSeal> {
  const paths = await committedProtectedPaths(options.projectRoot, options.baselineCommit);
  const protectedArtifacts = await Promise.all(
    paths.map(async (path) => ({
      path,
      fingerprint: fingerprint(await contentAtCommit(options.projectRoot, options.baselineCommit, path)),
    })),
  );
  return { version: 1, baselineCommit: options.baselineCommit, protectedArtifacts };
}

/**
 * Creates the first-BUILD immutable DECIDE-artifact baseline. Existing seals always
 * win, including when a resumed invocation supplies a newer commit, so a dirty or
 * later workspace cannot become the new authority.
 */
export async function createProtectedArtifactSeal(
  options: CreateProtectedArtifactSealOptions,
): Promise<ProtectedArtifactSeal> {
  const sealPath = join(options.projectRoot, PROTECTED_ARTIFACT_SEAL_PATH);
  const existing = await readExistingSeal(sealPath);
  if (existing) return existing;

  const seal = await createSeal(options);
  await mkdir(join(options.projectRoot, '.pipeline'), { recursive: true });
  try {
    await writeFile(sealPath, `${JSON.stringify(seal, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return seal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const concurrentSeal = await readExistingSeal(sealPath);
    if (!concurrentSeal) throw error;
    return concurrentSeal;
  }
}
