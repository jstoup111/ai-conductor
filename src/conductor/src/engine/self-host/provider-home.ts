// Provider-neutral isolated home lifecycle for self-host candidates. This owns
// only the throwaway destination, child environment, worktree assets, and
// bounded cleanup. Credential selection remains an optional provider concern.

import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import { redactSafetyText } from '../safety-diagnostics.js';
import { OPERATOR_ONLY_SKILLS } from '../worktree-prepare.js';
import { acquireScratchHome, releaseScratchHome } from './provider-scratch.js';

export type SelfHostProviderId = 'claude' | 'codex';

export interface ProviderHomeFs {
  mkdtemp(prefix: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  symlink(target: string, path: string): Promise<void>;
  /** Recursively copy a worktree asset into the throwaway home; never a live link. */
  cp(source: string, destination: string): Promise<void>;
  rm(path: string, opts: { recursive?: boolean; force?: boolean }): Promise<void>;
  pathExists(path: string): Promise<boolean>;
}

export const realProviderHomeFs: ProviderHomeFs = {
  mkdtemp: (prefix) => fsp.mkdtemp(prefix),
  mkdir: async (path) => { await fsp.mkdir(path, { recursive: true }); },
  symlink: (target, path) => fsp.symlink(target, path),
  cp: (source, destination) => fsp.cp(source, destination, { recursive: true }),
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
  readonly id: SelfHostProviderId;
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
}

type ScratchLeaseIdentity = {
  readonly repository: string;
  readonly featureSlug: string;
  readonly runId: string;
  readonly attempt: number;
};

/** Explicit baseDir is test injection; default provisioning always owns a complete lease. */
export type ProvisionProviderHomeOptions = ProvisionProviderHomeBaseOptions & (
  | (ScratchLeaseIdentity & { readonly baseDir?: undefined })
  | { readonly baseDir: string; readonly repository?: string; readonly featureSlug?: string; readonly runId?: string; readonly attempt?: number }
);

export class ProviderHomeProvisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderHomeProvisionError';
  }
}

const HOME_VARIABLE: Record<SelfHostProviderId, 'CLAUDE_CONFIG_DIR' | 'CODEX_HOME'> = {
  claude: 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
};
const DEFAULT_WORKTREE_ASSETS = ['skills'] as const;

class ThrowawayProviderHome implements ProviderHome {
  private tornDown = false;

  constructor(
    readonly provider: SelfHostProviderId,
    readonly homeDir: string,
    private readonly parentEnv: NodeJS.ProcessEnv,
    private readonly additions: NodeJS.ProcessEnv,
    private readonly args: readonly string[],
    private readonly fs: ProviderHomeFs,
    private readonly releaseScratch?: () => Promise<void>,
  ) {}

  childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...this.parentEnv };
    // Never inherit a live provider home or Claude's ambient credential token.
    delete env.CLAUDE_CONFIG_DIR;
    delete env.CODEX_HOME;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    env[HOME_VARIABLE[this.provider]] = this.homeDir;
    return { ...env, ...this.additions };
  }

  childArgs(): readonly string[] {
    return this.args;
  }

  async teardown(): Promise<void> {
    if (this.tornDown) return;
    this.tornDown = true;
    await this.fs.rm(this.homeDir, { recursive: true, force: true });
    if (this.releaseScratch) await this.releaseScratch();
  }
}

/**
 * Create one candidate-specific home. No live provider directory is read or
 * linked here; provider-owned auth can write only to the supplied destination.
 */
export async function provisionProviderHome(
  options: ProvisionProviderHomeOptions,
): Promise<ProviderHome> {
  const fs = options.fs ?? realProviderHomeFs;
  const usesScratch = options.baseDir === undefined;
  const baseDir = options.baseDir ?? await acquireScratchHome({
    worktreeRoot: options.worktreeRoot,
    repository: options.repository,
    featureSlug: options.featureSlug,
    runId: options.runId,
    attempt: options.attempt,
    provider: options.provider.id,
  });
  const parentEnv = options.parentEnv ?? process.env;
  const assets = options.worktreeAssets ?? DEFAULT_WORKTREE_ASSETS;
  let homeDir: string | undefined;

  try {
    await fs.mkdir(baseDir);
    homeDir = await fs.mkdtemp(join(baseDir, `self-host-${options.provider.id}-`));
    const context: ProviderHomeContext = { provider: options.provider.id, homeDir };

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
      // the throwaway home's isolation. A one-time copy of the (small,
      // markdown-only) skills asset keeps discovery in sync with whatever is
      // currently checked out without exposing the worktree path itself.
      await fs.cp(target, join(homeDir, asset));

      // Operator-only skills exist to debug a run from the outside; a
      // dispatched step that loads one reads its own in-flight state as
      // evidence of failure. Claude gets this via a `skillOverrides` entry in
      // the worktree settings, but Codex discovers skills by listing this
      // directory and honors no such override. Pruning the throwaway COPY
      // (never the worktree) is therefore both provider-neutral and stronger
      // than an override: neither provider has an artifact to load at all.
      if (asset === 'skills') {
        for (const skill of OPERATOR_ONLY_SKILLS) {
          await fs.rm(join(homeDir, asset, skill), { recursive: true, force: true });
        }
      }
    }
    if (options.provider.id === 'codex') {
      await fs.mkdir(join(homeDir, '.agents'));
      // Link into the already-copied throwaway skills, not the worktree, so
      // this view can't become a second write-through path into the worktree.
      await fs.symlink(join(homeDir, 'skills'), join(homeDir, '.agents', 'skills'));
    }

    const auth = await options.provider.prepareSelfHostAuth?.(context);
    const controls = await options.installEngineControls?.(context);
    return new ThrowawayProviderHome(
      options.provider.id,
      homeDir,
      parentEnv,
      { ...auth?.env, ...controls?.env },
      [...(auth?.args ?? []), ...(controls?.args ?? [])],
      fs,
      usesScratch
        ? () => releaseScratchHome({
          worktreeRoot: options.worktreeRoot,
          runId: options.runId!,
          attempt: options.attempt!,
          provider: options.provider.id,
        }).then(() => {})
        : undefined,
    );
  } catch (error) {
    if (usesScratch) {
        await releaseScratchHome({
          worktreeRoot: options.worktreeRoot,
          runId: options.runId!,
          attempt: options.attempt!,
          provider: options.provider.id,
        });
    } else if (homeDir) {
        await fs.rm(homeDir, { recursive: true, force: true }).catch(() => {});
    }
    if (error instanceof ProviderHomeProvisionError) throw error;
    const reason = redactSafetyText(error instanceof Error ? error.message : String(error));
    throw new ProviderHomeProvisionError(
      `Failed to provision isolated ${options.provider.id} self-host home: ${reason}`,
    );
  }
}
