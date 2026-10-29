import { access, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { writeSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { ConductorEventEmitter } from './conductor-event-emitter.js';
import { clearMarker } from './daemon-rekick.js';
import { EventPersister, startOperatorEventSpine } from './event-persister.js';
import { computeFeatureOwnership, worktreeFeatureOwnershipSource } from './feature-ownership.js';
import {
  ARTIFACT_KINDS,
  MANIFEST_KIND_LOCATIONS,
  featureManifestPath,
  parseFeatureManifest,
  renderFeatureManifest,
  type ArtifactKind,
  type DocsPath,
} from './feature-manifest.js';
import { commitEngineChange } from './guarded-engine-commit.js';
import { HALT_CLASS_MARKER, HALT_MARKER, PROTECTED_ARTIFACT_HALT_CLASS } from './halt-marker.js';
import {
  PROTECTED_ARTIFACT_SEAL_PATH,
  rotateProtectedArtifactSeal,
  type ProtectedArtifactSeal,
} from './protected-artifact-seal.js';
import { makeGitRunner, originDefaultBranch } from './rebase.js';

export interface RegisterArtifactDispatch {
  readonly slug: string;
  readonly artifactKind: ArtifactKind;
  readonly path: string;
  readonly reason: string;
  readonly clearHalt: boolean;
}

export type RegistrationValidation =
  | { readonly kind: 'refusal'; readonly condition: string }
  | { readonly kind: 'rendered'; readonly manifest: string };

export interface RegistrationValidationDependencies {
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  access?: (path: string) => Promise<void>;
}

export interface RegisterArtifactCommandDependencies extends RegistrationValidationDependencies {
  cwd?: string;
  isInteractive?: boolean;
  err?: (line: string) => void;
  events?: ConductorEventEmitter;
}

async function clearProtectedArtifactHalt(worktree: string): Promise<void> {
  try {
    await access(join(worktree, HALT_MARKER));
  } catch {
    return;
  }

  const haltClass = await readFile(join(worktree, HALT_CLASS_MARKER), 'utf8').catch(() => undefined);
  if (haltClass?.trim() !== PROTECTED_ARTIFACT_HALT_CLASS) return;
  await clearMarker(worktree).catch(() => undefined);
}

async function rotateSealAndRecordRegistration(
  command: RegisterArtifactDispatch,
  worktree: string,
): Promise<void> {
  const seal = JSON.parse(
    await readFile(join(worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8'),
  ) as ProtectedArtifactSeal;
  const baseBranch = await originDefaultBranch(makeGitRunner(worktree)) ?? 'main';
  const ownership = await computeFeatureOwnership(
    worktreeFeatureOwnershipSource(worktree),
    command.slug,
    baseBranch,
  );
  if (ownership.kind !== 'legacy' && ownership.kind !== 'manifest') {
    throw new Error(`registered manifest ownership is ${ownership.kind}`);
  }

  const paths: string[] = [featureManifestPath(command.slug)];
  if (ownership.kind === 'manifest' && ownership.protectedPaths.includes(command.path as DocsPath)) {
    paths.push(command.path);
  }
  await rotateProtectedArtifactSeal({
    projectRoot: worktree,
    seal,
    toCommit: (await execa('git', ['rev-parse', '--verify', 'HEAD'], { cwd: worktree })).stdout.trim(),
    trigger: 'operator-register',
    paths,
    ownership,
  });

  const events = new ConductorEventEmitter();
  const persister = new EventPersister(join(worktree, '.pipeline', 'events.jsonl'), events);
  persister.start();
  try {
    await events.emitOrThrow({
      type: 'feature_artifacts_registered',
      slug: command.slug,
      added: [{ kind: command.artifactKind, path: command.path }],
    });
  } finally {
    persister.stop();
  }

  if (command.clearHalt) await clearProtectedArtifactHalt(worktree);
}

async function isRegistrationCommit(
  worktree: string,
  currentHead: string,
  originalHead: string,
  pathspec: readonly string[],
  registrationMarker: string,
): Promise<boolean> {
  const parent = await execa('git', ['rev-parse', `${currentHead}^`], { cwd: worktree });
  if (parent.stdout.trim() !== originalHead) return false;

  const changed = await execa('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', currentHead], { cwd: worktree });
  if (changed.stdout.trim().split('\n').filter(Boolean).sort().join('\0') !== [...pathspec].sort().join('\0')) return false;

  const message = await execa('git', ['show', '-s', '--format=%B', currentHead], { cwd: worktree });
  return message.stdout.split('\n').includes(registrationMarker);
}

async function restoreFailedRegistration(
  worktree: string,
  originalHead: string,
  originalManifest: string,
  manifestPath: string,
  pathspec: readonly string[],
  registrationMarker: string,
): Promise<void> {
  let restorationError: unknown;
  try {
    const currentHead = await execa('git', ['rev-parse', '--verify', 'HEAD'], { cwd: worktree });
    if (currentHead.stdout.trim() !== originalHead) {
      if (!await isRegistrationCommit(worktree, currentHead.stdout.trim(), originalHead, pathspec, registrationMarker)) {
        throw new Error('could not safely roll back an unexpected HEAD change');
      }
      await execa('git', ['update-ref', 'HEAD', originalHead, currentHead.stdout.trim()], { cwd: worktree });
      await execa('git', ['restore', '--staged', `--source=${originalHead}`, '--', ...pathspec], { cwd: worktree });
    }
  } catch (error) {
    restorationError = error;
  }

  await writeFile(manifestPath, originalManifest, 'utf8');
  if (restorationError !== undefined) throw restorationError;
}

function refusal(condition: string): RegistrationValidation {
  return { kind: 'refusal', condition };
}

function legacyLocationKind(path: string): ArtifactKind | undefined {
  return ARTIFACT_KINDS.find((kind) => {
    const location = MANIFEST_KIND_LOCATIONS[kind];
    if (!path.startsWith(location.directory)) return false;
    return location.filePattern.test(path.slice(location.directory.length));
  });
}

function isRegistrablePath(path: string, slug: string): boolean {
  if (!path.startsWith('.docs/') || path.split('/').includes('..')) return false;
  if (path === featureManifestPath(slug)) return false;
  return ![
    '.docs/shipped/',
    '.docs/halted/',
    '.docs/plan-review/',
    '.docs/release-waivers/',
  ].some((excluded) => path.startsWith(excluded));
}

/** Detect only the fully bound, operator-only registration grammar. */
export function detectRegisterArtifactCommand(argv: string[]): RegisterArtifactDispatch | null {
  if (argv[2] !== 'register-artifact') return null;
  const args = argv.slice(3);
  const read = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const slug = read('--slug');
  const artifactKind = read('--kind');
  const path = read('--path');
  const reason = read('--reason');
  const clearHalt = args.includes('--clear-halt');
  const expected = [
    '--slug', slug,
    '--kind', artifactKind,
    '--path', path,
    '--reason', reason,
    ...(clearHalt ? ['--clear-halt'] : []),
  ];
  if (
    args.length !== expected.length
    || expected.some((value, index) => args[index] !== value)
    || !slug
    || !artifactKind
    || !path
    || !reason
    || !/^[a-z0-9][a-z0-9-]*$/.test(slug)
    || !ARTIFACT_KINDS.includes(artifactKind as ArtifactKind)
  ) return null;
  return { slug, artifactKind: artifactKind as ArtifactKind, path, reason, clearHalt };
}

/**
 * Validate one operator-requested manifest addition without writing it. Later
 * registration tasks own the resulting commit, seal rotation, and event.
 */
export async function validateRegistration(
  command: RegisterArtifactDispatch,
  options: { readonly worktree: string } & RegistrationValidationDependencies,
): Promise<RegistrationValidation> {
  if (!command.reason.trim()) return refusal('missing rationale');
  if (!isRegistrablePath(command.path, command.slug)) {
    return refusal(`artifact path '${command.path}' is not registrable`);
  }

  const ensureAccessible = options.access ?? access;
  try {
    await ensureAccessible(join(options.worktree, command.path));
  } catch {
    return refusal(`artifact path '${command.path}' does not exist`);
  }

  const manifestPath = featureManifestPath(command.slug);
  const readManifest = options.readFile ?? readFile;
  let rawManifest: string;
  try {
    rawManifest = await readManifest(join(options.worktree, manifestPath), 'utf8');
  } catch {
    return refusal(`manifest is absent for '${command.slug}'`);
  }

  const parsed = parseFeatureManifest(rawManifest, manifestPath, command.slug);
  if (parsed.kind === 'malformed') return refusal(parsed.reason);

  if (parsed.manifest.artifacts.some((entry) => entry.kind === command.artifactKind && entry.path === command.path)) {
    return refusal(`duplicate artifact entry ${command.artifactKind} ${command.path}`);
  }

  const expectedKind = legacyLocationKind(command.path);
  if (expectedKind !== undefined && expectedKind !== command.artifactKind) {
    return refusal(`kind mismatch: ${command.path} is ${expectedKind}, not ${command.artifactKind}`);
  }

  if (command.artifactKind === 'plan' && parsed.manifest.artifacts.some((entry) => entry.kind === 'plan')) {
    return refusal('second plan entry');
  }

  return {
    kind: 'rendered',
    manifest: renderFeatureManifest({
      ...parsed.manifest,
      artifacts: [
        ...parsed.manifest.artifacts,
        { kind: command.artifactKind, path: command.path as DocsPath },
      ],
    }),
  };
}

/** Validate, persist, and commit an operator registration request. */
export async function dispatchRegisterArtifactCommand(
  command: RegisterArtifactDispatch,
  deps: RegisterArtifactCommandDependencies = {},
): Promise<number> {
  const cwd = deps.cwd ?? process.cwd();
  const err = deps.err ?? ((line: string) => writeSync(process.stderr.fd, `${line}\n`));
  const worktree = join(cwd, '.worktrees', command.slug);
  const ensureAccessible = deps.access ?? access;
  const events = deps.events ?? new ConductorEventEmitter();
  let persister: EventPersister | undefined;
  const refuse = async (condition: string): Promise<void> => {
    await events.emitOrThrow({
      type: 'feature_artifact_registration_refused',
      slug: command.slug,
      condition,
    });
    err(`register-artifact: ${condition}.`);
  };

  try {
    await ensureAccessible(worktree);
  } catch {
    if (deps.events) {
      await refuse(`unknown feature worktree '${command.slug}'`);
    } else {
      const rootSpine = startOperatorEventSpine(cwd);
      try {
        await rootSpine.events.emitOrThrow({
          type: 'feature_artifact_registration_refused',
          slug: command.slug,
          condition: `unknown feature worktree '${command.slug}'`,
        });
      } finally {
        rootSpine.stop();
      }
      err(`register-artifact: unknown feature worktree '${command.slug}'.`);
    }
    return 1;
  }

  try {
    if (!deps.events) {
      persister = new EventPersister(join(worktree, '.pipeline', 'events.jsonl'), events);
      persister.start();
    }
    const isInteractive = deps.isInteractive ?? process.stdin.isTTY === true;
    if (!isInteractive) {
      await refuse('requires an interactive terminal');
      return 1;
    }

    const result = await validateRegistration(command, {
      worktree,
      readFile: deps.readFile,
      access: ensureAccessible,
    });
    if (result.kind === 'refusal') {
      await refuse(result.condition);
      return 1;
    }

    const manifestPath = join(worktree, featureManifestPath(command.slug));
    const pathspec = [command.path, featureManifestPath(command.slug)];
    const registrationMarker = `Registration-Id: ${randomUUID()}`;
    const readManifest = deps.readFile ?? readFile;
    let originalManifest: string;
    let originalHead: string | undefined;
    try {
      originalManifest = await readManifest(manifestPath, 'utf8');
      originalHead = (await execa('git', ['rev-parse', '--verify', 'HEAD'], { cwd: worktree })).stdout.trim();
      await writeFile(manifestPath, result.manifest, 'utf8');
    } catch (error) {
      err(`register-artifact: could not write manifest: ${error instanceof Error ? error.message : String(error)}.`);
      return 1;
    }
    try {
      const commit = await commitEngineChange({
        worktree,
        slug: command.slug,
        pathspec,
        message: `register artifact: ${command.slug}\n\n${registrationMarker}`,
      });
      if (commit.kind === 'written') {
        try {
          await rotateSealAndRecordRegistration(command, worktree);
          return 0;
        } catch (error) {
          err(`register-artifact: could not finalize registration: ${error instanceof Error ? error.message : String(error)}.`);
          return 1;
        }
      }

      await restoreFailedRegistration(worktree, originalHead, originalManifest, manifestPath, pathspec, registrationMarker);
      err(`register-artifact: could not commit registration: ${commit.kind === 'noop' ? 'no changes staged' : commit.reason}.`);
      return 1;
    } catch (error) {
      try {
        if (originalHead !== undefined) {
          await restoreFailedRegistration(worktree, originalHead, originalManifest, manifestPath, pathspec, registrationMarker);
        }
      } catch {
        // Preserve the original commit error; a restoration failure cannot make
        // this command appear successful.
      }
      err(`register-artifact: could not commit registration: ${error instanceof Error ? error.message : String(error)}.`);
      return 1;
    }
  } finally {
    persister?.stop();
  }
}
