// self-host/sandbox-build-env.ts — isolate a harness self-build from global config.
//
// SAFETY CORE (adr-2026-06-30-sandbox-build-isolation / TR-5, TR-6). Claude Code
// loads skills/hooks from CLAUDE_CONFIG_DIR (default ~/.claude), which the
// operator's ~20 concurrent sessions read live. A harness self-build edits skills
// in its worktree; if it ran against global ~/.claude it would either (a) verify
// against the OLD code it is replacing (verification gap) or (b), if we repointed
// the globals, expose live sessions to broken intermediate states.
//
// Fix: for a self-build only, run the build step with a THROWAWAY
// CLAUDE_CONFIG_DIR whose skills/ + hooks/ symlink into the build worktree. The
// build exercises its own edited harness; global ~/.claude is never touched. The
// sandbox is torn down after the build (pass OR fail) under a try/finally
// guarantee. Isolation is a contract, not a convention:
//   - No sandbox link ever resolves to a global-config target (TR-6 invariant).
//   - Teardown runs on the crash branch (withSandboxBuildEnv finally), asserted.
//   - Provisioning failure removes the partial sandbox and never launches (TR-5).
//   - childEnv() returns a COPY — the daemon's own env is never mutated (no bleed).

import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Injectable filesystem seam so the adversarial branches are deterministic. */
export interface SandboxFs {
  mkdtemp(prefix: string): Promise<string>;
  symlink(target: string, path: string): Promise<void>;
  rm(path: string, opts: { recursive?: boolean; force?: boolean }): Promise<void>;
  realpath(path: string): Promise<string>;
}

export const realSandboxFs: SandboxFs = {
  mkdtemp: (prefix) => fsp.mkdtemp(prefix),
  symlink: (target, path) => fsp.symlink(target, path),
  rm: (path, opts) => fsp.rm(path, opts),
  realpath: (path) => fsp.realpath(path),
};

/** Thrown when the sandbox cannot be provisioned; names the failed path. */
export class SandboxProvisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxProvisionError';
  }
}

/** A provisioned throwaway config dir + its lifecycle. */
export interface SandboxBuildEnv {
  /** Absolute path to the throwaway CLAUDE_CONFIG_DIR. */
  readonly configDir: string;
  /**
   * The env to launch the child build with — a COPY of the parent env with
   * CLAUDE_CONFIG_DIR pointed at the sandbox. Never mutates the parent env, so
   * the daemon's own environment is unaffected (no ambient-env bleed).
   */
  childEnv(): NodeJS.ProcessEnv;
  /** Remove the throwaway dir. Idempotent — safe to call more than once. */
  teardown(): Promise<void>;
}

export interface ProvisionOptions {
  /** Build worktree root whose skills/ + hooks/ the sandbox links to. */
  worktreeRoot: string;
  /** Base dir for the throwaway config dir (defaults to the OS temp dir). */
  baseDir?: string;
  /** Parent env the child env is derived from (defaults to process.env). */
  parentEnv?: NodeJS.ProcessEnv;
  /** Filesystem seam (defaults to real fs). */
  fs?: SandboxFs;
}

/** The two links a sandbox exposes into the worktree. */
const LINKED_DIRS = ['skills', 'hooks'] as const;

class ThrowawaySandbox implements SandboxBuildEnv {
  private tornDown = false;
  constructor(
    readonly configDir: string,
    private readonly parentEnv: NodeJS.ProcessEnv,
    private readonly fs: SandboxFs,
  ) {}

  childEnv(): NodeJS.ProcessEnv {
    // Copy — never mutate the parent env (no bleed back into the daemon).
    return { ...this.parentEnv, CLAUDE_CONFIG_DIR: this.configDir };
  }

  async teardown(): Promise<void> {
    if (this.tornDown) return;
    this.tornDown = true;
    // force: true → ENOENT is not an error, so double teardown is a no-op.
    await this.fs.rm(this.configDir, { recursive: true, force: true });
  }
}

/**
 * Provision a throwaway CLAUDE_CONFIG_DIR whose skills/ + hooks/ link into the
 * build worktree. On ANY provisioning failure, removes the partial sandbox and
 * throws SandboxProvisionError — the caller must not launch a build against a
 * partially-built sandbox.
 */
export async function provisionSandboxBuildEnv(opts: ProvisionOptions): Promise<SandboxBuildEnv> {
  const fs = opts.fs ?? realSandboxFs;
  const base = opts.baseDir ?? tmpdir();
  const parentEnv = opts.parentEnv ?? process.env;

  let configDir: string | null = null;
  try {
    configDir = await fs.mkdtemp(join(base, 'harness-selfbuild-'));
    for (const name of LINKED_DIRS) {
      await fs.symlink(join(opts.worktreeRoot, name), join(configDir, name));
    }
  } catch (err) {
    // Remove any partial sandbox so a half-built dir is never launched (TR-5).
    if (configDir) {
      await fs.rm(configDir, { recursive: true, force: true }).catch(() => {});
    }
    const e = err as NodeJS.ErrnoException;
    const failedPath = e.path ? ` (failed at ${e.path})` : '';
    throw new SandboxProvisionError(
      `Failed to provision the harness self-build sandbox${failedPath}: ${e.message}. ` +
        'The build was NOT launched.',
    );
  }
  return new ThrowawaySandbox(configDir, parentEnv, fs);
}

/**
 * Run `fn` with a provisioned sandbox, guaranteeing teardown on BOTH the success
 * and error/crash branches (try/finally). This is the contract that makes "no
 * orphaned sandbox after a mid-build crash" (TR-5) structural, not incidental.
 */
export async function withSandboxBuildEnv<T>(
  opts: ProvisionOptions,
  fn: (sandbox: SandboxBuildEnv) => Promise<T>,
): Promise<T> {
  const sandbox = await provisionSandboxBuildEnv(opts);
  try {
    return await fn(sandbox);
  } finally {
    await sandbox.teardown();
  }
}

/**
 * Resolve the sandbox's linked-dir targets (skills/hooks) — used to assert the
 * no-global-target invariant (TR-6). Returns the sandbox-side link paths, which
 * callers realpath to confirm they resolve into the worktree and never under
 * global config.
 */
export async function sandboxLinkTargets(
  sandbox: SandboxBuildEnv,
): Promise<Record<(typeof LINKED_DIRS)[number], string>> {
  return {
    skills: join(sandbox.configDir, 'skills'),
    hooks: join(sandbox.configDir, 'hooks'),
  };
}
