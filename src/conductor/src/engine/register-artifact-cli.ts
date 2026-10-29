import { access, readFile } from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARTIFACT_KINDS,
  MANIFEST_KIND_LOCATIONS,
  featureManifestPath,
  parseFeatureManifest,
  renderFeatureManifest,
  type ArtifactKind,
  type DocsPath,
} from './feature-manifest.js';

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

/** Validate an operator registration request without mutating the worktree. */
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
  if (result.kind === 'rendered') return 0;

  err(`register-artifact: ${result.condition}.`);
  return 1;
}
