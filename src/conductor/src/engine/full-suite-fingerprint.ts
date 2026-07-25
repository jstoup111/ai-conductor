import { createHash, type Hash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import { isCodeOrTestPath } from './rebase.js';

export interface FullSuiteFingerprintOptions {
  projectRoot: string;
}

export interface FullSuiteFingerprint {
  digest: string;
  headSha: string;
}

function nulSeparatedPaths(stdout: string): string[] {
  return stdout.split('\0').filter((path) => path.length > 0);
}

async function gitOutput(projectRoot: string, args: string[]): Promise<string> {
  const result = await execa('git', args, { cwd: projectRoot });
  return result.stdout;
}

function comparePaths(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function updateField(hash: Hash, name: string, value: string | Buffer): void {
  const bytes = typeof value === 'string' ? Buffer.from(value) : value;
  hash.update(name);
  hash.update('\0');
  hash.update(String(bytes.length));
  hash.update('\0');
  hash.update(bytes);
  hash.update('\0');
}

async function streamedFileDigest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

async function updatePathIdentity(
  hash: Hash,
  projectRoot: string,
  relativePath: string,
): Promise<void> {
  updateField(hash, 'path', relativePath);
  const absolutePath = join(projectRoot, relativePath);

  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      updateField(hash, 'state', 'deleted');
      return;
    }
    throw error;
  }

  updateField(hash, 'state', 'present');
  if (stats.isSymbolicLink()) {
    updateField(hash, 'mode', '120000');
    updateField(hash, 'content', await readlink(absolutePath));
    return;
  }

  updateField(hash, 'mode', stats.mode & 0o111 ? '100755' : '100644');
  updateField(hash, 'content', await streamedFileDigest(absolutePath));
}

export async function fingerprintFullSuiteInputs(
  options: FullSuiteFingerprintOptions,
): Promise<FullSuiteFingerprint> {
  const { projectRoot } = options;
  const [headSha, trackedOutput, untrackedOutput] = await Promise.all([
    gitOutput(projectRoot, ['rev-parse', 'HEAD']),
    gitOutput(projectRoot, ['ls-files', '-z']),
    gitOutput(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);

  const paths = [
    ...new Set([
      ...nulSeparatedPaths(trackedOutput),
      ...nulSeparatedPaths(untrackedOutput),
    ]),
  ]
    .filter(isCodeOrTestPath)
    .sort(comparePaths);

  const hash = createHash('sha256');
  updateField(hash, 'schema', 'full-suite-working-tree-v1');
  for (const path of paths) {
    await updatePathIdentity(hash, projectRoot, path);
  }

  return {
    digest: hash.digest('hex'),
    headSha: headSha.trim(),
  };
}
