// Provider-neutral isolated home lifecycle for self-host candidates. This owns
// only the throwaway destination, child environment, worktree assets, and
// bounded cleanup. Credential selection remains an optional provider concern.

import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import { scrubTmuxEnvironment } from '../../execution/child-environment.js';
import {
  BUILT_IN_PROVIDERS,
  requireProviderCapability,
  type BuiltInProviderId,
  type ProviderWith,
} from '../../execution/provider-catalog.js';
import { isProviderSetupUnavailableError } from '../provider-setup-failure.js';
import { redactSafetyText } from '../safety-diagnostics.js';
import { OPERATOR_ONLY_SKILLS } from '../worktree-prepare.js';
import { resolveSkillName } from '../skill-names.js';
import { acquireScratchHome, releaseScratchHome } from './provider-scratch.js';
import { collectKnownSecrets } from './transcript-sanitize.js';
import { emitTranscriptHarvest, harvestThenRemove, harvestTranscripts, transcriptCapture, transcriptCaptureLeaseStep, type TranscriptCaptureSource, type TranscriptHarvestResult } from './transcript-harvest.js';
import type { ConductorEventEmitter } from '../../ui/events.js';

export type SelfHostProvider = ProviderWith<'selfHost'>;
export type SelfHostProviderId = Extract<BuiltInProviderId, SelfHostProvider['id']>;

export interface ProviderHomeFs {
  mkdtemp(prefix: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  symlink(target: string, path: string): Promise<void>;
  /**
   * Recursively copy a worktree asset into the throwaway home; never a live link.
   * Symlinks inside the asset (a skill's shared `templates/` files) are copied as
   * the files they point at, or the copy would carry links back into the worktree.
   */
  cp(source: string, destination: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  rm(path: string, opts: { recursive?: boolean; force?: boolean }): Promise<void>;
  pathExists(path: string): Promise<boolean>;
}

export const realProviderHomeFs: ProviderHomeFs = {
  mkdtemp: (prefix) => fsp.mkdtemp(prefix),
  mkdir: async (path) => { await fsp.mkdir(path, { recursive: true }); },
  symlink: (target, path) => fsp.symlink(target, path),
  cp: (source, destination) => fsp.cp(source, destination, { recursive: true, dereference: true }),
  readdir: (path) => fsp.readdir(path),
  rm: (path, opts) => fsp.rm(path, opts),
  pathExists: (path) => fsp.access(path).then(() => true, () => false),
};

export interface ProviderHomeEnvironment {
  /** Additional child-only environment values. */
  env?: NodeJS.ProcessEnv;
  /** Provider-owned bounded invocation arguments; never credential material. */
  args?: readonly string[];
}

export interface ProviderHomeContext {
  readonly provider: SelfHostProviderId;
  readonly homeDir: string;
}

/** Provider-owned: the engine never selects, reads, or logs credentials. */
export type PrepareSelfHostAuth = (
  context: ProviderHomeContext,
) => Promise<ProviderHomeEnvironment | void>;

export interface ResolvedSelfHostProvider {
  readonly id: BuiltInProviderId;
  readonly prepareSelfHostAuth?: PrepareSelfHostAuth;
}

export interface ProviderHome {
  readonly provider: SelfHostProviderId;
  readonly homeDir: string;
  childEnv(): NodeJS.ProcessEnv;
  childArgs(): readonly string[];
  teardown(): Promise<void>;
}

interface ProvisionProviderHomeBaseOptions {
  /** The actual candidate selected for this attempt, not a preferred provider. */
  provider: ResolvedSelfHostProvider;
  worktreeRoot: string;
  parentEnv?: NodeJS.ProcessEnv;
  fs?: ProviderHomeFs;
  /** Engine-owned controls (for example a write fence) applied only in this home. */
  installEngineControls?: (context: ProviderHomeContext) => Promise<ProviderHomeEnvironment | void>;
  /** Worktree-owned assets exposed inside the isolated home. */
  worktreeAssets?: readonly string[];
  /** Existing event spine; provider-home retirement is observational only. */
  events?: ConductorEventEmitter;
}

export type ProviderHomeCaptureIdentity = TranscriptCaptureSource;

type ScratchLeaseIdentity = {
  readonly repository: string;
  readonly featureSlug: string;
  readonly captureIdentity: ProviderHomeCaptureIdentity;
};

/** Explicit baseDir is test injection; default provisioning always owns a complete lease. */
export type ProvisionProviderHomeOptions = ProvisionProviderHomeBaseOptions & (
  | (ScratchLeaseIdentity & { readonly baseDir?: undefined })
  | { readonly baseDir: string; readonly repository?: string; readonly featureSlug?: string; readonly captureIdentity?: ProviderHomeCaptureIdentity }
);

export class ProviderHomeProvisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderHomeProvisionError';
  }
}

const DEFAULT_WORKTREE_ASSETS = ['skills'] as const;

const ISOLATED_HOME_SCRUB_VARIABLES = BUILT_IN_PROVIDERS.flatMap((descriptor) => [
  descriptor.homeVariable,
  ...(descriptor.selfHostShape?.scrubVariables ?? []),
]);

class ThrowawayProviderHome implements ProviderHome {
  private tornDown = false;

  constructor(
    readonly provider: SelfHostProviderId,
    private readonly homeVariable: string,
    readonly homeDir: string,
    private readonly parentEnv: NodeJS.ProcessEnv,
    private readonly scrubVariables: readonly string[],
    private readonly additions: NodeJS.ProcessEnv,
    private readonly args: readonly string[],
    private readonly fs: ProviderHomeFs,
    private readonly transcript: ProviderHomeTranscript | undefined,
    private readonly releaseScratch?: () => Promise<void>,
  ) {}

  childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...this.parentEnv };
    for (const variable of this.scrubVariables) delete env[variable];
    // Scrub only inherited operator state. Provider-owned auth is prepared for
    // this throwaway home and must remain available to its selected child.
    Object.assign(env, this.additions);
    env[this.homeVariable] = this.homeDir;
    return scrubTmuxEnvironment(env);
  }

  childArgs(): readonly string[] {
    return this.args;
  }

  async teardown(): Promise<void> {
    if (this.tornDown) return;
    this.tornDown = true;
    if (this.transcript === undefined) {
      await this.fs.rm(this.homeDir, { recursive: true, force: true });
    } else {
      const transcript = this.transcript;
      await harvestThenRemove({
        harvest: async () => {
          const authText = await fsp.readFile(join(this.homeDir, transcript.selectedAuthPath), 'utf8')
            .catch(() => '');
          return harvestTranscripts({
            home: this.homeDir,
            globs: transcript.globs,
            destination: transcript.destination,
            knownSecrets: collectKnownSecrets(authText, []),
          });
        },
        report: async (result) => { await transcript.report(result); },
        remove: () => this.fs.rm(this.homeDir, { recursive: true, force: true }),
      });
    }
    if (this.releaseScratch) await this.releaseScratch();
  }
}

interface ProviderHomeTranscript {
  readonly selectedAuthPath: string;
  readonly globs: readonly string[];
  readonly destination: string;
  report(result: TranscriptHarvestResult): Promise<void>;
}

function providerHomeTranscript(options: ProvisionProviderHomeOptions, provider: SelfHostProvider): ProviderHomeTranscript | undefined {
  const identity = options.captureIdentity;
  if (identity === undefined) return undefined;
  const source = { ...identity, provider: provider.id };
  const capture = transcriptCapture({ worktreeRoot: options.worktreeRoot, ...source });
  return {
    selectedAuthPath: provider.selfHostShape.selectedAuthPath,
    globs: provider.selfHostShape.transcripts.globs,
    destination: capture.destination,
    report: async (result) => {
      await emitTranscriptHarvest(options.events, { ...source, path: capture.path, interrupted: false }, result);
    },
  };
}

/**
 * Create one candidate-specific home. No live provider directory is read or
 * linked here; provider-owned auth can write only to the supplied destination.
 */
export async function provisionProviderHome(
  options: ProvisionProviderHomeOptions,
): Promise<ProviderHome> {
  const fs = options.fs ?? realProviderHomeFs;
  // Refuse before allocating scratch, copying assets, or letting a provider-owned
  // preparation hook reach its subprocess boundary.
  const provider = requireProviderCapability(options.provider.id, 'selfHost');
  const usesScratch = options.baseDir === undefined;
  const captureIdentity = options.captureIdentity;
  const baseDir = options.baseDir ?? await acquireScratchHome({
    worktreeRoot: options.worktreeRoot,
    repository: options.repository,
    featureSlug: options.featureSlug,
    runId: captureIdentity!.runId,
    attempt: captureIdentity!.attempt,
    step: transcriptCaptureLeaseStep(captureIdentity!),
    member: captureIdentity!.member,
    provider: provider.id,
  });
  const parentEnv = options.parentEnv ?? process.env;
  const assets = options.worktreeAssets ?? DEFAULT_WORKTREE_ASSETS;
  let homeDir: string | undefined;

  try {
    await fs.mkdir(baseDir);
    homeDir = await fs.mkdtemp(join(baseDir, `self-host-${provider.id}-`));
    const context: ProviderHomeContext = { provider: provider.id, homeDir };

    for (const asset of assets) {
      const target = join(options.worktreeRoot, asset);
      if (!(await fs.pathExists(target))) {
        throw new ProviderHomeProvisionError(
          `Self-host worktree is missing required asset '${asset}' at ${target}.`,
        );
      }
      // Copy rather than symlink: a live link lets provider-owned warmup/init
      // writes (for example Codex's skill-discovery `.system/` bookkeeping)
      // land back inside the git-tracked worktree through the link, defeating
      // the throwaway home's isolation. A one-time copy of the small skills
      // asset, including its bundled executable helpers, keeps discovery in
      // sync with whatever is currently checked out without exposing the
      // worktree path itself.
      // Operator-only skills exist to debug a run from the outside; a
      // dispatched step that loads one reads its own in-flight state as
      // evidence of failure. Claude gets this via a `skillOverrides` entry in
      // the worktree settings, but Codex discovers skills by listing this
      // directory and honors no such override. Pruning the throwaway COPY
      // (never the worktree) is therefore both provider-neutral and stronger
      // than an override: neither provider has an artifact to load at all.
      if (asset === 'skills') {
        const destination = join(homeDir, asset);
        await fs.mkdir(destination);
        for (const directory of await fs.readdir(target)) {
          // Operator-only identity is an engine contract, so it remains keyed
          // by the source directory even when the host-visible name differs.
          if (OPERATOR_ONLY_SKILLS.includes(directory)) continue;

          const source = join(target, directory);
          const hasSkillFile = await fs.pathExists(join(source, 'SKILL.md'));
          const name = hasSkillFile
            ? await resolveSkillName(options.worktreeRoot, directory)
            : directory;
          await fs.cp(source, join(destination, name));
        }
      } else {
        await fs.cp(target, join(homeDir, asset));
      }
    }
    if (provider.selfHostShape.agentsSkillsLink) {
      await fs.mkdir(join(homeDir, '.agents'));
      // Link into the already-copied throwaway skills, not the worktree, so
      // this view can't become a second write-through path into the worktree.
      await fs.symlink(join(homeDir, 'skills'), join(homeDir, '.agents', 'skills'));
    }

    const auth = await options.provider.prepareSelfHostAuth?.(context);
    const controls = await options.installEngineControls?.(context);
    return new ThrowawayProviderHome(
      provider.id,
      provider.homeVariable,
      homeDir,
      parentEnv,
      ISOLATED_HOME_SCRUB_VARIABLES,
      { ...auth?.env, ...controls?.env },
      [...(auth?.args ?? []), ...(controls?.args ?? [])],
      fs,
      providerHomeTranscript(options, provider),
      usesScratch
        ? () => releaseScratchHome({
          worktreeRoot: options.worktreeRoot,
          runId: captureIdentity!.runId,
          attempt: captureIdentity!.attempt,
          member: captureIdentity!.member,
          provider: provider.id,
        }).then(() => {})
        : undefined,
    );
  } catch (error) {
    if (usesScratch) {
        await releaseScratchHome({
          worktreeRoot: options.worktreeRoot,
          runId: captureIdentity!.runId,
          attempt: captureIdentity!.attempt,
          member: captureIdentity!.member,
          provider: provider.id,
        });
    } else if (homeDir) {
        await fs.rm(homeDir, { recursive: true, force: true }).catch(() => {});
    }
    if (
      error instanceof ProviderHomeProvisionError
      || isProviderSetupUnavailableError(error)
    ) throw error;
    const reason = redactSafetyText(error instanceof Error ? error.message : String(error));
    throw new ProviderHomeProvisionError(
      `Failed to provision isolated ${provider.id} self-host home: ${reason}`,
    );
  }
}
