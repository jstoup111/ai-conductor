import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { execa } from 'execa';
import { resolveDocsAllowlist } from './phase-marker.js';

/**
 * The stem with a leading `YYYY-MM-DD-` date prefix removed. Duplicated here
 * (rather than imported from `daemon-backlog.ts`'s `undatedStem`) to avoid
 * adding a new cross-module dependency for one regex; keep both in sync if
 * the date-prefix convention ever changes.
 */
function undatedStem(stem: string): string {
  return stem.replace(/^\d{4}-\d{2}-\d{2}-(?=.)/, '');
}

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

export interface VerifyProtectedArtifactSealOptions {
  projectRoot: string;
  /** Required only while validating a first BUILD entry before it may persist a seal. */
  baselineCommit?: string;
  /**
   * The current feature's own slug. Scopes the temporary self-amendment
   * loosening in `inspectSeal` — absent means no loosening (fully protected,
   * prior behavior). See that function's inline comment for the rationale.
   */
  featureDesc?: string;
}

export type ProtectedArtifactSealVerdict =
  | { ok: true; seal: ProtectedArtifactSeal }
  | { ok: false; reason: string };

export interface ActiveStepArtifactExceptionInput {
  phase: string;
  step: string;
  target: unknown;
}

export interface MutationTargetClassificationInput extends ActiveStepArtifactExceptionInput {
  projectRoot: string;
}

export type MutationTargetClassification =
  | { kind: 'unprotected'; target: string }
  | { kind: 'allowed'; target: string }
  | { kind: 'protected'; target: string }
  | { kind: 'indeterminate'; reason: string };

function isContainedBy(root: string, target: string): boolean {
  const relation = relative(root, target);
  return relation === '' || (!relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && relation !== '..' && !isAbsolute(relation));
}

function canonicalWorkspaceTarget(projectRoot: string, target: unknown):
  | { ok: true; target: string }
  | { ok: false; reason: string } {
  if (typeof target !== 'string' || target.length === 0 || target.includes('\0')) {
    return { ok: false, reason: 'missing-or-malformed-target' };
  }
  if (target.includes('$') || target.includes('*') || target.includes('?') || target.includes('{')) {
    return { ok: false, reason: 'dynamic-target' };
  }
  if (target.split(/[\\/]/).includes('..')) {
    return { ok: false, reason: 'traversal-target' };
  }
  const root = resolve(projectRoot);
  const resolved = resolve(root, target);
  if (!isContainedBy(root, resolved)) return { ok: false, reason: 'outside-workspace-target' };
  const canonical = relative(root, resolved).replaceAll('\\', '/');
  if (canonical.length === 0) return { ok: false, reason: 'workspace-root-target' };
  return { ok: true, target: canonical };
}

/**
 * Produces the provider-neutral target verdict used by the generated artifact
 * hook and the terminal seal audit. Paths are canonicalized relative to the
 * feature workspace before policy is applied, so absolute and relative hook
 * payloads have the same decision.
 */
export function classifyMutationTarget({
  projectRoot,
  target,
  phase,
  step,
}: MutationTargetClassificationInput): MutationTargetClassification {
  const canonical = canonicalWorkspaceTarget(projectRoot, target);
  if (!canonical.ok) return { kind: 'indeterminate', reason: canonical.reason };
  const canonicalTarget = canonical.target;
  if (isActiveStepArtifactException({ phase, step, target: canonicalTarget })) {
    return { kind: 'allowed', target: canonicalTarget };
  }
  if (canonicalTarget === '.docs' || canonicalTarget.startsWith('.docs/')) {
    return { kind: 'protected', target: canonicalTarget };
  }
  return { kind: 'unprotected', target: canonicalTarget };
}

async function readContainedProtectedArtifact(
  projectRoot: string,
  path: string,
): Promise<string | undefined> {
  const root = await realpath(projectRoot);
  const target = join(projectRoot, path);
  const parent = await realpath(dirname(target)).catch(() => undefined);
  if (!parent || !isContainedBy(root, parent)) return undefined;

  const before = await lstat(target).catch(() => undefined);
  if (!before || !before.isFile() || before.isSymbolicLink()) return undefined;
  const content = await readFile(target, 'utf8').catch(() => undefined);
  if (content === undefined) return undefined;

  // Re-resolve after reading: a target may be replaced between the initial
  // lstat and acceptance, so the earlier lexical check is never authoritative.
  const after = await lstat(target).catch(() => undefined);
  const accepted = await realpath(target).catch(() => undefined);
  if (
    !after || !accepted || !after.isFile() || after.isSymbolicLink()
    || before.dev !== after.dev || before.ino !== after.ino || !isContainedBy(root, accepted)
  ) {
    return undefined;
  }
  return content;
}

/**
 * Reports whether the current lifecycle step grants an exception for this
 * exact target. The allowlist is resolved for every decision so one step's
 * permission cannot be reused by a later step.
 */
export function isActiveStepArtifactException({
  phase,
  step,
  target,
}: ActiveStepArtifactExceptionInput): boolean {
  if ((phase !== 'BUILD' && phase !== 'SHIP') || typeof target !== 'string') return false;
  return resolveDocsAllowlist(step).some((prefix) => target.startsWith(prefix));
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

async function workspaceProtectedPaths(projectRoot: string, directory: string): Promise<string[]> {
  const root = join(projectRoot, directory);
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const paths = await Promise.all(entries.map(async (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return workspaceProtectedPaths(projectRoot, path);
      if (entry.isFile()) return [path];
      return [path];
    }));
    return paths.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * True when `path`'s filename stem (basename minus `.md`) names the SAME
 * feature as `featureDesc`, tolerating a leading `YYYY-MM-DD-` date-prefix
 * mismatch on either side (mirrors the dated-vs-undated stem ambiguity fixed
 * for backlog metadata lookups in #1024). Used ONLY to scope the temporary
 * self-amendment loosening below — it never affects whether a path is
 * discovered/protected in the first place.
 */
function namesOwnFeature(path: string, featureDesc: string): boolean {
  const pathStem = basename(path, '.md');
  return pathStem === featureDesc || undatedStem(pathStem) === undatedStem(featureDesc);
}

async function inspectSeal(
  projectRoot: string,
  seal: ProtectedArtifactSeal,
  featureDesc?: string,
): Promise<ProtectedArtifactSealVerdict> {
  const expected = new Map(seal.protectedArtifacts.map((artifact) => [artifact.path, artifact.fingerprint]));
  const discoveredPaths = (await Promise.all(
    PROTECTED_ARTIFACT_DIRECTORIES.map((directory) => workspaceProtectedPaths(projectRoot, directory)),
  )).flat().sort(comparePaths);
  const actualPaths: string[] = [];
  for (const path of discoveredPaths) {
    const classification = classifyMutationTarget({
      projectRoot,
      target: path,
      phase: 'BUILD',
      step: 'protected_artifact_seal_audit',
    });
    if (classification.kind === 'indeterminate') {
      return { ok: false, reason: `Indeterminate protected artifact target: ${path}` };
    }
    actualPaths.push(classification.target);
  }

  for (const path of actualPaths) {
    if (!expected.has(path)) {
      return { ok: false, reason: `Protected artifact added: ${path}` };
    }
    const content = await readContainedProtectedArtifact(projectRoot, path);
    if (content === undefined) {
      return { ok: false, reason: `Indeterminate protected artifact target: ${path}` };
    }
    if (fingerprint(content) !== expected.get(path)) {
      // TEMPORARY LOOSENING (operator-directed, see intake filed for the
      // durable fix): a feature legitimately amending ITS OWN DECIDE artifact
      // mid-build — e.g. updating its own architecture doc to reflect
      // in-scope work surfaced by a build_review kickback — currently halts
      // identically to a THIRD PARTY tampering with that same file. Tolerate
      // the former; still halt on the latter (any other artifact) and on any
      // addition/deletion (handled above/below, unaffected by this branch).
      if (!featureDesc || !namesOwnFeature(path, featureDesc)) {
        return { ok: false, reason: `Protected artifact changed: ${path}` };
      }
    }
  }

  for (const path of expected.keys()) {
    if (!actualPaths.includes(path)) {
      return { ok: false, reason: `Protected artifact deleted: ${path}` };
    }
  }
  return { ok: true, seal };
}

/**
 * Verifies the workspace against the original durable seal. When no durable
 * seal exists, callers may supply the committed baseline to validate a first
 * BUILD entry before they persist it; this function never writes or refreshes
 * a seal itself.
 */
export async function verifyProtectedArtifactSeal(
  options: VerifyProtectedArtifactSealOptions,
): Promise<ProtectedArtifactSealVerdict> {
  const existing = await readExistingSeal(join(options.projectRoot, PROTECTED_ARTIFACT_SEAL_PATH));
  if (existing) return inspectSeal(options.projectRoot, existing, options.featureDesc);
  if (!options.baselineCommit) {
    return { ok: false, reason: 'Protected artifact seal is missing' };
  }
  return inspectSeal(
    options.projectRoot,
    await createSeal({ projectRoot: options.projectRoot, baselineCommit: options.baselineCommit }),
    options.featureDesc,
  );
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
