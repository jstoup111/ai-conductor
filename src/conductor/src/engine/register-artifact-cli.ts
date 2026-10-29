import { access, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { writeSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
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
  err?: (line: string) => void;
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

  try {
    await ensureAccessible(worktree);
  } catch {
    err(`register-artifact: unknown feature worktree '${command.slug}'.`);
    return 1;
  }

  const result = await validateRegistration(command, {
    worktree,
    readFile: deps.readFile,
    access: ensureAccessible,
  });
  if (result.kind === 'refusal') {
    err(`register-artifact: ${result.condition}.`);
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
    if (commit.kind === 'written') return 0;

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
}
