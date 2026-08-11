import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
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

export const PROTECTED_ARTIFACT_DIRECTORIES = [
  '.docs/architecture',
  '.docs/decisions',
  '.docs/plans',
  '.docs/specs',
  '.docs/stories',
] as const;

export function isProtectedArtifactPath(path: string): boolean {
  return PROTECTED_ARTIFACT_DIRECTORIES.some((directory) => path === directory || path.startsWith(`${directory}/`));
}

export const PROTECTED_ARTIFACT_SEAL_PATH = '.pipeline/protected-artifact-seal.json';

export interface ProtectedArtifactFingerprint {
  path: string;
  fingerprint: string;
}

export interface ProtectedArtifactRebaseline {
  fromCommit: string;
  toCommit: string;
  trigger: string;
  paths: string[];
  /** Verbatim rationale for an operator-initiated scoped reseal. */
  reason?: string;
}

export interface ProtectedArtifactSeal {
  version: 2;
  baselineCommit: string;
  protectedArtifacts: ProtectedArtifactFingerprint[];
  rebaselines: ProtectedArtifactRebaseline[];
}

export interface EvaluateProtectedArtifactSealRotationInput {
  seal: ProtectedArtifactSeal;
  baselineAncestry: 'ancestor' | 'non-ancestor' | 'unresolvable';
  workspaceArtifacts: ReadonlyMap<string, Buffer>;
  headArtifacts: ReadonlyMap<string, Buffer>;
  baseTipArtifacts?: ReadonlyMap<string, Buffer>;
  authorshipByPath?: ReadonlyMap<string, 'authored' | 'not-authored' | 'indeterminate'>;
}

export interface EvaluateProtectedArtifactSealRotationInRepositoryInput {
  projectRoot: string;
  seal: ProtectedArtifactSeal;
  headCommit: string;
  baseTipRef?: string;
}

export type ProtectedArtifactSealRotationVerdict =
  | { permitted: true; paths: string[] }
  | { permitted: false; condition: 'baseline-unresolvable' }
  | { permitted: false; condition: 'same-history-ancestor' }
  | { permitted: false; condition: 'head-unresolvable' }
  | { permitted: false; condition: 'base-tip-unresolved' }
  | { permitted: false; condition: 'workspace-differs-from-head'; path: string }
  | { permitted: false; condition: 'head-differs-from-base'; path: string };

export type ProtectedArtifactSealRebaselineEvent =
  | {
      type: 'protected_artifact_rebaseline';
      trigger: string;
      fromCommit: string;
      toCommit: string;
      paths: string[];
    }
  | {
      type: 'protected_artifact_rebaseline_refused';
      condition: string;
      verdictCondition: Exclude<ProtectedArtifactSealRotationVerdict, { permitted: true }>['condition'];
      path?: string;
    };

export type ProtectedArtifactSealRebaselineObserver = (
  event: ProtectedArtifactSealRebaselineEvent,
) => void | Promise<void>;

/**
 * An in-scope amendment to the current feature's own sealed DECIDE artifact.
 * The seal remains immutable; this records the observed divergence for the
 * caller's later policy decision rather than silently refreshing that seal.
 */
export interface ProtectedArtifactSelfAmendment {
  path: string;
  sealedFingerprint: string;
  currentFingerprint: string;
}

export interface CreateProtectedArtifactSealOptions {
  projectRoot: string;
  /** Approved commit whose DECIDE artifacts must remain authoritative. */
  baselineCommit: string;
}

export interface CreateScopedProtectedArtifactSealOptions {
  projectRoot: string;
  seal: ProtectedArtifactSeal;
  toCommit: string;
  paths: string[];
}

export interface ProtectedArtifactSealFileOperations {
  writeFile(path: string, content: string): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  rm(path: string, options: { force: true }): Promise<unknown>;
}

export interface RotateProtectedArtifactSealOptions {
  projectRoot: string;
  seal: ProtectedArtifactSeal;
  toCommit: string;
  trigger: string;
  paths: string[];
  fileOperations?: ProtectedArtifactSealFileOperations;
  onRebaseline?: ProtectedArtifactSealRebaselineObserver;
}

export interface ResealProtectedArtifactSealOptions extends RotateProtectedArtifactSealOptions {
  /** Verbatim operator-supplied rationale persisted with this reseal. */
  reason?: string;
  featureDesc?: string;
  baseBranch?: string;
}

export interface VerifyProtectedArtifactSealOptions {
  projectRoot: string;
  /** Required only while validating a first BUILD entry before it may persist a seal. */
  baselineCommit?: string;
  /**
   * The current feature's own slug. Scopes durable reporting of its
   * self-amendments in `inspectSeal` — absent means no self-amendments are
   * tolerated (fully protected, prior behavior).
   */
  featureDesc?: string;
  /**
   * The feature's base branch NAME (no `origin/` prefix), e.g. `main`. Enables
   * the base-inheritance tolerance in `inspectSeal`: drift that is byte-identical
   * to the base branch tip arrived through the front door (a merged PR the feature
   * rebased onto), not from an in-worktree mutation. Absent means no tolerance
   * (fully protected, prior behavior).
   */
  baseBranch?: string;
  onRebaseline?: ProtectedArtifactSealRebaselineObserver;
}

export type ProtectedArtifactSealVerdict =
  | { ok: true; seal: ProtectedArtifactSeal; selfAmendments: ProtectedArtifactSelfAmendment[] }
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
  const root = resolve(projectRoot);
  if (target.includes('$') || target.includes('*') || target.includes('?') || target.includes('{')) {
    const wildcard = target.search(/[?*{]/);
    if (wildcard >= 0) {
      const staticTarget = target.slice(0, wildcard).replace(/[\\/]+$/, '');
      const staticResolved = resolve(root, staticTarget);
      if (staticTarget.length > 0 && isContainedBy(root, staticResolved)
        && isProtectedArtifactPath(relative(root, staticResolved).replaceAll('\\', '/'))) {
        return { ok: false, reason: 'protected-glob-target' };
      }
    }
    return { ok: false, reason: 'dynamic-target' };
  }
  if (target.split(/[\\/]/).includes('..')) {
    return { ok: false, reason: 'traversal-target' };
  }
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
  if (isProtectedArtifactPath(canonicalTarget)) {
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

function fingerprint(content: string | Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function optionalBuffersEqual(left: Buffer | undefined, right: Buffer | undefined): boolean {
  return left === undefined ? right === undefined : right !== undefined && left.equals(right);
}

/**
 * Decides whether a rewritten history may rotate an immutable artifact seal.
 * A rotation is safe only when every workspace divergence is independently
 * vouched for by both the rewritten HEAD and the current base tip.
 */
export function evaluateProtectedArtifactSealRotation({
  seal,
  baselineAncestry,
  workspaceArtifacts,
  headArtifacts,
  baseTipArtifacts,
  authorshipByPath,
}: EvaluateProtectedArtifactSealRotationInput): ProtectedArtifactSealRotationVerdict {
  if (baselineAncestry === 'unresolvable') {
    return { permitted: false, condition: 'baseline-unresolvable' };
  }
  if (baselineAncestry === 'ancestor') {
    return { permitted: false, condition: 'same-history-ancestor' };
  }
  if (!baseTipArtifacts) {
    return { permitted: false, condition: 'base-tip-unresolved' };
  }

  const sealed = new Map(seal.protectedArtifacts.map(({ path, fingerprint }) => [path, fingerprint]));
  const paths = [...new Set([
    ...sealed.keys(),
    ...workspaceArtifacts.keys(),
    ...headArtifacts.keys(),
    ...baseTipArtifacts.keys(),
    ...[...(authorshipByPath ?? new Map()).entries()]
      .filter(([, authorship]) => authorship === 'authored')
      .map(([path]) => path),
  ])]
    .filter((path) => {
      const workspace = workspaceArtifacts.get(path);
      const sealedFingerprint = sealed.get(path);
      const sealedDiffersFromWorkspace = workspace === undefined
        ? sealedFingerprint !== undefined
        : sealedFingerprint === undefined || sealedFingerprint !== fingerprint(workspace);
      return authorshipByPath?.get(path) === 'authored'
        || sealedDiffersFromWorkspace
        || !optionalBuffersEqual(workspace, headArtifacts.get(path))
        || !optionalBuffersEqual(headArtifacts.get(path), baseTipArtifacts.get(path));
    })
    .sort(comparePaths);

  const rotationPaths: string[] = [];
  for (const path of paths) {
    if (authorshipByPath?.get(path) === 'authored') {
      return { permitted: false, condition: 'head-differs-from-base', path };
    }
    const workspace = workspaceArtifacts.get(path);
    const head = headArtifacts.get(path);
    if (workspace === undefined ? head !== undefined : head === undefined || !workspace.equals(head)) {
      return { permitted: false, condition: 'workspace-differs-from-head', path };
    }
    const base = baseTipArtifacts.get(path);
    if (head === undefined ? base !== undefined : base === undefined || !head.equals(base)) {
      if (authorshipByPath?.get(path) === 'not-authored') continue;
      return { permitted: false, condition: 'head-differs-from-base', path };
    }
    rotationPaths.push(path);
  }

  return { permitted: true, paths: rotationPaths };
}

function parseSeal(serialized: string): ProtectedArtifactSeal {
  try {
    const value = JSON.parse(serialized) as Record<string, unknown>;
    const validArtifacts =
      Array.isArray(value.protectedArtifacts) &&
      value.protectedArtifacts.every(
        (artifact) =>
          typeof artifact?.path === 'string' && typeof artifact?.fingerprint === 'string',
      );
    const validRebaselines =
      value.version === 2 &&
      Array.isArray(value.rebaselines) &&
      value.rebaselines.every(
        (entry) =>
          typeof entry?.fromCommit === 'string' &&
          typeof entry?.toCommit === 'string' &&
          typeof entry?.trigger === 'string' &&
          Array.isArray(entry?.paths) &&
          entry.paths.every((path: unknown) => typeof path === 'string') &&
          (entry.reason === undefined || typeof entry.reason === 'string'),
      );
    if (
      (value.version !== 1 && !validRebaselines) ||
      typeof value.baselineCommit !== 'string' ||
      !validArtifacts
    ) {
      throw new Error();
    }
    return {
      version: 2,
      baselineCommit: value.baselineCommit,
      protectedArtifacts: value.protectedArtifacts as ProtectedArtifactFingerprint[],
      rebaselines: value.version === 1 ? [] : value.rebaselines as ProtectedArtifactRebaseline[],
    };
  } catch {
    throw new Error('Protected artifact seal is invalid');
  }
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

async function protectedArtifactsAtCommit(
  projectRoot: string,
  commit: string,
): Promise<Map<string, Buffer>> {
  const paths = await committedProtectedPaths(projectRoot, commit);
  return new Map(await Promise.all(paths.map(async (path) => [
    path,
    Buffer.from(await contentAtCommit(projectRoot, commit, path)),
  ] as const)));
}

async function workspaceProtectedArtifacts(
  projectRoot: string,
): Promise<{ artifacts: Map<string, Buffer>; unresolvedPath?: string }> {
  const discovered = await Promise.all(PROTECTED_ARTIFACT_DIRECTORIES.map(async (directory) => {
    const paths = await workspaceProtectedPaths(projectRoot, directory).catch(() => undefined);
    return paths === undefined ? { paths: [], unresolvedPath: directory } : { paths };
  }));
  const unresolvedDirectory = discovered.find(({ unresolvedPath }) => unresolvedPath);
  if (unresolvedDirectory?.unresolvedPath) {
    return { artifacts: new Map(), unresolvedPath: unresolvedDirectory.unresolvedPath };
  }
  const paths = discovered.flatMap(({ paths }) => paths);
  const artifacts = await Promise.all(paths.map(async (path) => {
    const content = await readContainedProtectedArtifact(projectRoot, path).catch(() => undefined);
    return content === undefined ? undefined : [path, Buffer.from(content)] as const;
  }));
  const unresolvedIndex = artifacts.findIndex((artifact) => artifact === undefined);
  return {
    artifacts: new Map(artifacts.filter((artifact) => artifact !== undefined)),
    ...(unresolvedIndex === -1 ? {} : { unresolvedPath: paths[unresolvedIndex] }),
  };
}

export async function evaluateProtectedArtifactSealRotationInRepository({
  projectRoot,
  seal,
  headCommit,
  baseTipRef,
}: EvaluateProtectedArtifactSealRotationInRepositoryInput): Promise<ProtectedArtifactSealRotationVerdict> {
  const ancestry = await execa(
    'git',
    ['merge-base', '--is-ancestor', seal.baselineCommit, headCommit],
    { cwd: projectRoot, reject: false },
  ).catch(() => undefined);
  const baselineAncestry =
    ancestry?.exitCode === 0 ? 'ancestor'
      : ancestry?.exitCode === 1 ? 'non-ancestor'
        : 'unresolvable';
  if (baselineAncestry === 'unresolvable') {
    return { permitted: false, condition: 'baseline-unresolvable' };
  }
  if (!baseTipRef) {
    return { permitted: false, condition: 'base-tip-unresolved' };
  }

  const workspace = await workspaceProtectedArtifacts(projectRoot);
  if (workspace.unresolvedPath) {
    return {
      permitted: false,
      condition: 'workspace-differs-from-head',
      path: workspace.unresolvedPath,
    };
  }
  const headArtifacts = await protectedArtifactsAtCommit(projectRoot, headCommit).catch(() => undefined);
  if (!headArtifacts) {
    return { permitted: false, condition: 'head-unresolvable' };
  }
  const baseTipArtifacts = await protectedArtifactsAtCommit(projectRoot, baseTipRef).catch(() => undefined);
  if (!baseTipArtifacts) {
    return { permitted: false, condition: 'base-tip-unresolved' };
  }
  const authorshipByPath = new Map(await Promise.all(
    [...new Set([...headArtifacts.keys(), ...baseTipArtifacts.keys()])]
      .filter((path) => (
        optionalBuffersEqual(workspace.artifacts.get(path), headArtifacts.get(path))
        && !optionalBuffersEqual(headArtifacts.get(path), baseTipArtifacts.get(path))
      ))
      .map(async (path) => {
        const inheritance = await branchUntouchedInheritance(projectRoot, baseTipRef, path);
        return [
          path,
          inheritance === 'inherited' ? 'not-authored'
            : inheritance === 'not-inherited' ? 'authored'
              : 'indeterminate',
        ] as const;
      }),
  ));
  return evaluateProtectedArtifactSealRotation({
    seal,
    baselineAncestry,
    workspaceArtifacts: workspace.artifacts,
    headArtifacts,
    baseTipArtifacts,
    authorshipByPath,
  });
}

async function createSeal(options: CreateProtectedArtifactSealOptions): Promise<ProtectedArtifactSeal> {
  const paths = await committedProtectedPaths(options.projectRoot, options.baselineCommit);
  const protectedArtifacts = await Promise.all(
    paths.map(async (path) => ({
      path,
      fingerprint: fingerprint(await contentAtCommit(options.projectRoot, options.baselineCommit, path)),
    })),
  );
  return { version: 2, baselineCommit: options.baselineCommit, protectedArtifacts, rebaselines: [] };
}

async function createScopedProtectedArtifactSeal({
  projectRoot,
  seal,
  toCommit,
  paths,
}: CreateScopedProtectedArtifactSealOptions): Promise<ProtectedArtifactSeal> {
  if (paths.length === 0) {
    throw new Error('Scoped protected artifact reseal requires at least one path');
  }
  const sealedPaths = new Set(seal.protectedArtifacts.map((artifact) => artifact.path));
  for (const path of paths) {
    if (!isProtectedArtifactPath(path)) {
      throw new Error(`Protected artifact reseal target is not protected: ${path}`);
    }
    if (!sealedPaths.has(path)) {
      throw new Error(`Protected artifact reseal target is not sealed: ${path}`);
    }
  }
  const target = await execa('git', ['rev-parse', '--verify', '--quiet', `${toCommit}^{commit}`], {
    cwd: projectRoot,
    reject: false,
  }).catch(() => undefined);
  if (!target || target.exitCode !== 0) {
    throw new Error(`Protected artifact reseal target commit is unresolvable: ${toCommit}`);
  }
  for (const path of paths) {
    if (await readContainedProtectedArtifact(projectRoot, path) === undefined) {
      throw new Error(`Protected artifact reseal target is deleted: ${path}`);
    }
    const dirty = await execa('git', ['diff', '--quiet', 'HEAD', '--', path], {
      cwd: projectRoot,
      reject: false,
    }).catch(() => undefined);
    if (!dirty || dirty.exitCode !== 0) {
      throw new Error(
        `Protected artifact reseal target has uncommitted changes: ${path}\nCommit the protected artifact before resealing.`,
      );
    }
  }
  const scopedPaths = new Set(paths);
  const protectedArtifacts = await Promise.all(seal.protectedArtifacts.map(async (artifact) => {
    if (!scopedPaths.has(artifact.path)) return artifact;
    return {
      ...artifact,
      fingerprint: fingerprint(await contentAtCommit(projectRoot, toCommit, artifact.path)),
    };
  }));
  return { ...seal, protectedArtifacts };
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
 * for backlog metadata lookups in #1024). Used ONLY to scope the durable
 * self-amendment reporting below — it never affects whether a path is
 * discovered/protected in the first place.
 */
export function namesOwnFeature(path: string, featureDesc: string): boolean {
  const pathStem = basename(path, '.md');
  return pathStem === featureDesc || undatedStem(pathStem) === undatedStem(featureDesc);
}

/**
 * Resolves the ref naming the tip of the feature's base branch, preferring the
 * remote-tracking `origin/<base>` (what `resolveBaseCore` in `rebase.ts` picks as
 * the rebase target when an origin exists) and degrading to the local `<base>`.
 * Returns `undefined` when neither ref exists — the caller then applies no
 * tolerance and the seal stays fully protected.
 *
 * Deliberately does NOT call `resolveBaseCore`: that helper performs a network
 * `git fetch`, and this runs before EVERY BUILD/SHIP step. Read-only ref
 * resolution is all this predicate needs — it only ever asks whether content
 * already present locally is explained by the base branch.
 */
async function resolveBaseTipRef(
  projectRoot: string,
  baseBranch: string,
): Promise<string | undefined> {
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    const verified = await execa('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: projectRoot,
      reject: false,
    });
    if (verified.exitCode === 0) return ref;
  }
  return undefined;
}

/**
 * True when `path`'s CURRENT on-disk content is byte-identical to that path as
 * committed at `baseRef`. This is the "arrived through the front door" test: a
 * protected artifact owned by SOME OTHER feature legitimately changes under a
 * feature's feet when that feature rebases onto a base branch which has since
 * merged the owner's PR. In that case the workspace copy is exactly the base
 * tip's copy, and the base branch — an independent source of truth the build
 * agent cannot write to — already vouches for the content.
 *
 * Any other content (an in-worktree edit, a partially applied change, a revert)
 * fails this test and still halts, so real tamper detection is unweakened.
 */
async function matchesBaseTip(
  projectRoot: string,
  baseRef: string,
  path: string,
): Promise<boolean> {
  const committed = await execa('git', ['show', `${baseRef}:${path}`], {
    cwd: projectRoot,
    stripFinalNewline: false,
    reject: false,
  });
  if (committed.exitCode !== 0) return false;
  const workspace = await readContainedProtectedArtifact(projectRoot, path);
  return workspace !== undefined && workspace === committed.stdout;
}

/**
 * True when this feature has not changed `path` since it diverged from the
 * base branch, and its workspace still exactly reflects its own HEAD. This
 * permits a feature that remains behind a newer base-tip artifact without
 * accepting an in-worktree mutation or a change authored on the feature.
 */
async function branchUntouchedInheritance(
  projectRoot: string,
  baseRef: string,
  path: string,
): Promise<'inherited' | 'not-inherited' | 'no-merge-base' | 'diff-probe-failed'> {
  const changed = await execa('git', ['diff', '--name-only', `${baseRef}...HEAD`, '--', path], {
    cwd: projectRoot,
    reject: false,
  }).catch(() => undefined);
  if (!changed || changed.exitCode !== 0) {
    const mergeBase = await execa('git', ['merge-base', baseRef, 'HEAD'], {
      cwd: projectRoot,
      reject: false,
    }).catch(() => undefined);
    return mergeBase?.exitCode === 1 ? 'no-merge-base' : 'diff-probe-failed';
  }
  if (changed.stdout.length !== 0) return 'not-inherited';

  const head = await execa('git', ['show', `HEAD:${path}`], {
    cwd: projectRoot,
    stripFinalNewline: false,
    reject: false,
  }).catch(() => undefined);
  if (!head || head.exitCode !== 0) return 'not-inherited';

  const workspace = await readContainedProtectedArtifact(projectRoot, path);
  return workspace !== undefined && workspace === head.stdout ? 'inherited' : 'not-inherited';
}

async function inspectSeal(
  projectRoot: string,
  seal: ProtectedArtifactSeal,
  featureDesc?: string,
  baseBranch?: string,
  excludedPaths?: ReadonlySet<string>,
): Promise<ProtectedArtifactSealVerdict> {
  const selfAmendments: ProtectedArtifactSelfAmendment[] = [];
  // Resolved at most once per verification, and only lazily — a fully clean
  // workspace never shells out to git here at all.
  let baseTipRef: string | undefined | null = null;
  const baseRef = async (): Promise<string | undefined> => {
    if (baseTipRef === null) baseTipRef = baseBranch ? await resolveBaseTipRef(projectRoot, baseBranch) : undefined;
    return baseTipRef;
  };
  const missingBaseRef = async (): Promise<string | undefined> => {
    if (!baseBranch) return 'no base branch was supplied';
    return (await baseRef()) === undefined
      ? `neither origin/${baseBranch} nor ${baseBranch} resolves`
      : undefined;
  };
  const undeterminableProvenance = (path: string, missingRef: string): ProtectedArtifactSealVerdict => ({
    ok: false,
    reason: `Protected artifact provenance undeterminable: ${path}\nMissing base ref: ${missingRef}.\nProvide the base ref, then rebase onto it.`,
  });
  const noMergeBase = (path: string, baseBranch: string): ProtectedArtifactSealVerdict => ({
    ok: false,
    reason: `Protected artifact provenance undeterminable: ${path}\nNo merge-base exists between HEAD and ${baseBranch}.\nRebase onto ${baseBranch} to establish shared history.`,
  });
  const failedInheritanceProbe = (path: string): ProtectedArtifactSealVerdict => ({
    ok: false,
    reason: `Protected artifact provenance undeterminable: ${path}\nInheritance probe failed: git diff.\nVerify Git access and retry.`,
  });
  const inheritedFromBase = async (path: string): Promise<
    'inherited' | 'not-inherited' | 'no-merge-base' | 'diff-probe-failed'
  > => {
    const ref = await baseRef();
    if (ref === undefined) return 'diff-probe-failed';
    if (await matchesBaseTip(projectRoot, ref, path)) return 'inherited';
    return branchUntouchedInheritance(projectRoot, ref, path);
  };

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
    if (excludedPaths?.has(path)) continue;
    if (!expected.has(path)) {
      // Same base-inheritance tolerance as the change branch below: an entirely
      // NEW protected artifact appears under a feature's feet when it rebases
      // onto a base branch that merged another feature's DECIDE artifacts after
      // this seal's baseline was taken. Tolerated only when the workspace copy
      // is byte-identical to the base tip's committed copy.
      const inheritance = await inheritedFromBase(path);
      if (inheritance === 'inherited') continue;
      const missingRef = await missingBaseRef();
      if (missingRef) return undeterminableProvenance(path, missingRef);
      if (inheritance === 'no-merge-base') return noMergeBase(path, baseBranch!);
      if (inheritance === 'diff-probe-failed') return failedInheritanceProbe(path);
      return { ok: false, reason: `Protected artifact added: ${path}` };
    }
    const content = await readContainedProtectedArtifact(projectRoot, path);
    if (content === undefined) {
      return { ok: false, reason: `Indeterminate protected artifact target: ${path}` };
    }
    const sealedFingerprint = expected.get(path);
    const currentFingerprint = fingerprint(content);
    if (currentFingerprint !== sealedFingerprint) {
      // #1047 / ADR: verify inherited base content before treating drift as a
      // self-amendment. The base branch is an independent authority, so content
      // it already contains is neither a local amendment nor a seal violation.
      const inheritance = await inheritedFromBase(path);
      if (inheritance === 'inherited') continue;
      if (featureDesc && namesOwnFeature(path, featureDesc)) {
        selfAmendments.push({ path, sealedFingerprint: sealedFingerprint!, currentFingerprint });
      } else {
        const missingRef = await missingBaseRef();
        if (missingRef) return undeterminableProvenance(path, missingRef);
        if (inheritance === 'no-merge-base') return noMergeBase(path, baseBranch!);
        if (inheritance === 'diff-probe-failed') return failedInheritanceProbe(path);
        // BASE-INHERITANCE TOLERANCE (#976). The mismatch is not this feature's
        // own amendment, and was not inherited from the base branch. The seal
        // therefore remains authoritative and the mutation must halt.
        return { ok: false, reason: `Protected artifact changed: ${path}` };
      }
    }
  }

  for (const path of expected.keys()) {
    if (excludedPaths?.has(path)) continue;
    if (!actualPaths.includes(path)) {
      return { ok: false, reason: `Protected artifact deleted: ${path}` };
    }
  }
  return { ok: true, seal, selfAmendments };
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
  if (existing) return verifyExistingProtectedArtifactSeal(options, existing);
  if (!options.baselineCommit) {
    return { ok: false, reason: 'Protected artifact seal is missing' };
  }
  return inspectSeal(
    options.projectRoot,
    await createSeal({ projectRoot: options.projectRoot, baselineCommit: options.baselineCommit }),
    options.featureDesc,
    options.baseBranch,
  );
}

type ProtectedArtifactSealRotationContext =
  | { resolved: false; condition: 'head-unresolvable' | 'base-tip-unresolved' }
  | { resolved: true; headCommit: string; baseTipRef: string };

async function resolveProtectedArtifactSealRotationContext(
  projectRoot: string,
  baseBranch: string,
): Promise<ProtectedArtifactSealRotationContext> {
  const head = await execa(
    'git',
    ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
    { cwd: projectRoot, reject: false },
  ).catch(() => undefined);
  if (!head || head.exitCode !== 0 || head.stdout.length === 0) {
    return { resolved: false, condition: 'head-unresolvable' };
  }
  const baseTipRef = await resolveBaseTipRef(projectRoot, baseBranch);
  return baseTipRef
    ? { resolved: true, headCommit: head.stdout, baseTipRef }
    : { resolved: false, condition: 'base-tip-unresolved' };
}

function rotationRefusalVerdict(
  rotation: Exclude<ProtectedArtifactSealRotationVerdict, { permitted: true }>,
  inspection: ProtectedArtifactSealVerdict,
  seal: ProtectedArtifactSeal,
  headCommit: string,
): ProtectedArtifactSealVerdict {
  if (rotationRefusalPreservesInspection(rotation, inspection)) return inspection;
  if (rotation.condition === 'baseline-unresolvable') {
    return {
      ok: false,
      reason: `Protected artifact seal baseline is unresolvable: ${seal.baselineCommit}`,
    };
  }
  if (rotation.condition === 'head-unresolvable') {
    return { ok: false, reason: `Protected artifact seal HEAD is unresolvable: ${headCommit}` };
  }
  if (!('path' in rotation)) return inspection;
  if (rotation.condition === 'workspace-differs-from-head') {
    return {
      ok: false,
      reason: `Uncommitted protected artifact changed: ${rotation.path}\nRestore from HEAD.`,
    };
  }
  return {
    ok: false,
    reason: `Protected artifact changed: ${rotation.path}\nFeature-authored committed change: revert to the committed DECIDE content and route any actual amendment to DECIDE.`,
  };
}

function rotationRefusalPreservesInspection(
  rotation: Exclude<ProtectedArtifactSealRotationVerdict, { permitted: true }>,
  inspection: ProtectedArtifactSealVerdict,
): boolean {
  return rotation.condition === 'same-history-ancestor'
    || rotation.condition === 'base-tip-unresolved'
    || (
      rotation.condition === 'workspace-differs-from-head'
      && !inspection.ok
      && inspection.reason.startsWith('Indeterminate protected artifact target')
    );
}

async function reportRotationRefusal(
  observer: ProtectedArtifactSealRebaselineObserver | undefined,
  rotation: Exclude<ProtectedArtifactSealRotationVerdict, { permitted: true }>,
): Promise<void> {
  if (rotation.condition !== 'same-history-ancestor') {
    await emitRotationRefusal(observer, rotation);
  }
}

interface ApplyPermittedProtectedArtifactSealRotationInput {
  options: VerifyProtectedArtifactSealOptions;
  seal: ProtectedArtifactSeal;
  headCommit: string;
  paths: string[];
}

async function applyPermittedProtectedArtifactSealRotation(
  {
    options,
    seal,
    headCommit,
    paths,
  }: ApplyPermittedProtectedArtifactSealRotationInput,
): Promise<ProtectedArtifactSealVerdict> {
  const rotated = await rotateProtectedArtifactSeal({
    projectRoot: options.projectRoot,
    seal,
    toCommit: headCommit,
    trigger: 'defensive-history-rewrite',
    paths,
    onRebaseline: options.onRebaseline,
  });
  return { ok: true, seal: rotated, selfAmendments: [] };
}

async function verifyExistingProtectedArtifactSeal(
  options: VerifyProtectedArtifactSealOptions,
  seal: ProtectedArtifactSeal,
): Promise<ProtectedArtifactSealVerdict> {
  const inspection = await inspectSeal(
    options.projectRoot,
    seal,
    options.featureDesc,
    options.baseBranch,
  );
  if (!options.baseBranch) return inspection;

  const context = await resolveProtectedArtifactSealRotationContext(
    options.projectRoot,
    options.baseBranch,
  );
  if (!context.resolved) {
    await emitRotationRefusal(options.onRebaseline, { permitted: false, condition: context.condition });
    return context.condition === 'head-unresolvable'
      ? { ok: false, reason: 'Protected artifact seal HEAD is unresolvable' }
      : inspection;
  }

  const rotation = await evaluateProtectedArtifactSealRotationInRepository({
    projectRoot: options.projectRoot,
    seal,
    headCommit: context.headCommit,
    baseTipRef: context.baseTipRef,
  });
  if (!rotation.permitted) {
    await reportRotationRefusal(options.onRebaseline, rotation);
    return rotationRefusalVerdict(rotation, inspection, seal, context.headCommit);
  }
  return applyPermittedProtectedArtifactSealRotation({
    options,
    seal,
    headCommit: context.headCommit,
    paths: rotation.paths,
  });
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

export async function rotateProtectedArtifactSeal({
  projectRoot,
  seal,
  toCommit,
  trigger,
  paths,
  fileOperations = { writeFile, rename, rm },
  onRebaseline,
}: RotateProtectedArtifactSealOptions): Promise<ProtectedArtifactSeal> {
  const recomputed = await createSeal({ projectRoot, baselineCommit: toCommit });
  return persistProtectedArtifactSealRotation({
    projectRoot,
    seal,
    recomputed,
    trigger,
    paths,
    fileOperations,
    onRebaseline,
  });
}

export async function resealProtectedArtifactSeal({
  projectRoot,
  seal,
  toCommit,
  trigger,
  paths,
  fileOperations = { writeFile, rename, rm },
  onRebaseline,
  reason,
  featureDesc,
  baseBranch,
}: ResealProtectedArtifactSealOptions): Promise<ProtectedArtifactSeal> {
  const classification = await inspectSeal(projectRoot, seal, featureDesc, baseBranch, new Set(paths));
  if (!classification.ok) throw new Error(classification.reason);
  const recomputed = await createScopedProtectedArtifactSeal({ projectRoot, seal, toCommit, paths });
  return persistProtectedArtifactSealRotation({
    projectRoot,
    seal,
    recomputed: { ...recomputed, baselineCommit: toCommit },
    trigger,
    paths,
    reason,
    fileOperations,
    onRebaseline,
  });
}

interface PersistProtectedArtifactSealRotationOptions {
  projectRoot: string;
  seal: ProtectedArtifactSeal;
  recomputed: ProtectedArtifactSeal;
  trigger: string;
  paths: string[];
  reason?: string;
  fileOperations: ProtectedArtifactSealFileOperations;
  onRebaseline?: ProtectedArtifactSealRebaselineObserver;
}

async function persistProtectedArtifactSealRotation({
  projectRoot,
  seal,
  recomputed,
  trigger,
  paths,
  reason,
  fileOperations,
  onRebaseline,
}: PersistProtectedArtifactSealRotationOptions): Promise<ProtectedArtifactSeal> {
  const rotated: ProtectedArtifactSeal = {
    ...recomputed,
    rebaselines: [
      ...seal.rebaselines,
      {
        fromCommit: seal.baselineCommit,
        toCommit: recomputed.baselineCommit,
        trigger,
        paths,
        ...(reason === undefined ? {} : { reason }),
      },
    ],
  };
  const sealPath = join(projectRoot, PROTECTED_ARTIFACT_SEAL_PATH);
  const temporaryPath = join(dirname(sealPath), `.${basename(sealPath)}.${randomUUID()}.tmp`);

  await mkdir(dirname(sealPath), { recursive: true });
  let operationFailed = false;
  try {
    await fileOperations.writeFile(temporaryPath, `${JSON.stringify(rotated, null, 2)}\n`);
    await fileOperations.rename(temporaryPath, sealPath);
    await notifyRebaselineObserver(onRebaseline, {
      type: 'protected_artifact_rebaseline',
      trigger,
      fromCommit: seal.baselineCommit,
      toCommit: recomputed.baselineCommit,
      paths,
    });
    return rotated;
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    await fileOperations.rm(temporaryPath, { force: true }).catch((error: unknown) => {
      if (!operationFailed) throw error;
    });
  }
}

async function emitRotationRefusal(
  observer: ProtectedArtifactSealRebaselineObserver | undefined,
  verdict: Exclude<ProtectedArtifactSealRotationVerdict, { permitted: true }>,
): Promise<void> {
  const featureAuthored =
    verdict.condition === 'workspace-differs-from-head' || verdict.condition === 'head-differs-from-base';
  await notifyRebaselineObserver(observer, {
    type: 'protected_artifact_rebaseline_refused',
    condition: featureAuthored ? `feature-authored:${verdict.condition}` : verdict.condition,
    verdictCondition: verdict.condition,
    ...('path' in verdict ? { path: verdict.path } : {}),
  });
}

async function notifyRebaselineObserver(
  observer: ProtectedArtifactSealRebaselineObserver | undefined,
  event: ProtectedArtifactSealRebaselineEvent,
): Promise<void> {
  try {
    await observer?.(event);
  } catch {
    // Telemetry is best-effort and must never alter rotation or refusal policy.
  }
}
