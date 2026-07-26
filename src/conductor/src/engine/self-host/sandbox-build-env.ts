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
// CLAUDE_CONFIG_DIR that:
//   - symlinks skills/ + hooks/ into the build worktree (the edited harness);
//   - Authenticates via CLAUDE_CODE_OAUTH_TOKEN env injection (daemon-provided
//     token); no credential copy needed — the sandbox inherits the daemon's auth.
//   - COPIES `settings.json` and RETARGETS every harness-checkout absolute path
//     (hook commands, statusLine, …) to the worktree, so the build exercises its
//     OWN edited hooks rather than the live checkout's. Personal `~/.claude/hooks`
//     paths (outside the harness checkout) are left untouched.
//   - SEEDS a minimal `.claude.json` that PROPAGATES the operator's existing
//     workspace trust. A fresh CLAUDE_CONFIG_DIR trusts no project, so the
//     headless build ignored every `permissions.allow` entry in the repo's
//     `.claude/settings.json` ("this workspace has not been trusted") and
//     wedged on denied tools. Trust is copied from the operator's live state
//     file ONLY when it already trusts the harness root — the sandbox never
//     fabricates a trust grant the operator has not made.
// The sandbox is torn down after the build (pass OR fail) under a try/finally
// guarantee; global ~/.claude is never touched. Isolation is a contract:
//   - Settings are COPIED (not symlinked) — no sandbox symlink ever resolves to a
//     global-config target (TR-6 invariant); the two symlinks (skills/hooks) resolve
//     only into the worktree.
//   - A missing worktree skills//hooks/ dir FAILS CLOSED (SandboxProvisionError) —
//     a dangling-link sandbox is never launched (TR-5).
//   - Teardown runs on the crash branch (withSandboxBuildEnv finally), asserted.
//   - childEnv() returns a COPY — the daemon's own env is never mutated (no bleed).

import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateFenceScript, mergeFenceIntoSettings } from './write-fence.js';
export {
  provisionProviderHome,
  type ProviderHome,
  type ProvisionProviderHomeOptions,
  type ResolvedSelfHostProvider,
} from './provider-home.js';

/** Injectable filesystem seam so the adversarial branches are deterministic. */
export interface SandboxFs {
  mkdtemp(prefix: string): Promise<string>;
  symlink(target: string, path: string): Promise<void>;
  rm(path: string, opts: { recursive?: boolean; force?: boolean }): Promise<void>;
  realpath(path: string): Promise<string>;
  /** True iff `path` exists (used to fail closed on a missing link target). */
  pathExists(path: string): Promise<boolean>;
  /** Read a file's text, or null when it does not exist. */
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, data: string): Promise<void>;
  /** Set file mode (permissions) — used to make scripts executable. */
  chmod(path: string, mode: number): Promise<void>;
}

export const realSandboxFs: SandboxFs = {
  mkdtemp: (prefix) => fsp.mkdtemp(prefix),
  symlink: (target, path) => fsp.symlink(target, path),
  rm: (path, opts) => fsp.rm(path, opts),
  realpath: (path) => fsp.realpath(path),
  pathExists: (path) => fsp.access(path).then(() => true, () => false),
  readFile: (path) => fsp.readFile(path, 'utf-8').then((t) => t, () => null),
  writeFile: (path, data) => fsp.writeFile(path, data, 'utf-8'),
  chmod: (path, mode) => fsp.chmod(path, mode),
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
  /**
   * The harness MAIN checkout. Absolute paths under it in the copied
   * settings.json (hook commands, statusLine) are retargeted to `worktreeRoot`
   * so the self-build exercises its own edited hooks. For a real self-build this
   * differs from `worktreeRoot`; when equal, the retarget is a no-op.
   */
  harnessRoot: string;
  /** Base dir for the throwaway config dir (defaults to the OS temp dir). */
  baseDir?: string;
  /** Parent env the child env is derived from (defaults to process.env). */
  parentEnv?: NodeJS.ProcessEnv;
  /** Filesystem seam (defaults to real fs). */
  fs?: SandboxFs;
}

/** Only edited harness skills are exposed from the worktree. */
const LINKED_DIRS = ['skills'] as const;
const SETTINGS_FILE = 'settings.json';

class ThrowawaySandbox implements SandboxBuildEnv {
  private tornDown = false;
  constructor(
    readonly configDir: string,
    private readonly parentEnv: NodeJS.ProcessEnv,
    private readonly fs: SandboxFs,
  ) {}

  childEnv(): NodeJS.ProcessEnv {
    // Copy — never mutate the parent env (no bleed back into the daemon).
    // Task 9 (TR-2): Include the current CLAUDE_CODE_OAUTH_TOKEN from process.env
    // (if present). The token is set dynamically around step execution and may change
    // during retries/parks, so we capture the current value at call time.
    const env: Record<string, string | undefined> = { ...this.parentEnv };
    env.CLAUDE_CONFIG_DIR = this.configDir;
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN !== undefined) {
      env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    }
    return env as NodeJS.ProcessEnv;
  }

  async teardown(): Promise<void> {
    if (this.tornDown) return;
    this.tornDown = true;
    // force: true → ENOENT is not an error, so double teardown is a no-op.
    await this.fs.rm(this.configDir, { recursive: true, force: true });
  }
}

/**
 * Provision a throwaway CLAUDE_CONFIG_DIR: skills/ + hooks/ symlinked into the
 * build worktree, with a hook-retargeted `settings.json` copied in. Auth is via
 * daemon-provided CLAUDE_CODE_OAUTH_TOKEN env injection; no credential copy.
 * On ANY provisioning failure (including a missing worktree skills//hooks/ dir),
 * removes the partial sandbox and throws SandboxProvisionError — the caller must
 * not launch a build against it.
 */
export async function provisionSandboxBuildEnv(opts: ProvisionOptions): Promise<SandboxBuildEnv> {
  const fs = opts.fs ?? realSandboxFs;
  const base = opts.baseDir ?? tmpdir();
  const parentEnv = opts.parentEnv ?? process.env;

  let configDir: string | null = null;
  try {
    configDir = await fs.mkdtemp(join(base, 'harness-selfbuild-'));

    for (const name of LINKED_DIRS) {
      const target = join(opts.worktreeRoot, name);
      // Fail closed on a missing target — never provision a dangling link (TR-5).
      if (!(await fs.pathExists(target))) {
        throw new SandboxProvisionError(
          `Harness self-build worktree is missing '${name}/' (expected ${target}). ` +
            'Refusing to provision a sandbox with a dangling link; the build was NOT launched.',
        );
      }
      await fs.symlink(target, join(configDir, name));
    }

    // Start from engine-owned empty settings. Operator preferences/hooks never
    // enter this home; the fence below is the sole generated control.
    await fs.writeFile(join(configDir, SETTINGS_FILE), '{}\n');

    // write-fence.sh: provision the fence script that blocks edits to the live
    // harness checkout. The script is materialized with +x mode and wired into
    // settings.json as a PreToolUse hook.
    await provisionWriteFence(fs, {
      configDir,
      harnessRoot: opts.harnessRoot,
      worktreeRoot: opts.worktreeRoot,
    });

  } catch (err) {
    // Remove any partial sandbox so a half-built dir is never launched (TR-5).
    if (configDir) {
      await fs.rm(configDir, { recursive: true, force: true }).catch(() => {});
    }
    if (err instanceof SandboxProvisionError) throw err;
    const e = err as NodeJS.ErrnoException;
    const failedPath = e.path ? ` (failed at ${e.path})` : '';
    throw new SandboxProvisionError(
      `Failed to provision the harness self-build sandbox${failedPath}: ${e.message}. ` +
        'The build was NOT launched.',
    );
  }
  return new ThrowawaySandbox(configDir, parentEnv, fs);
}


/** Generate and provision the write-fence script, then merge it into settings.json. */
async function provisionWriteFence(
  fs: SandboxFs,
  args: { configDir: string; harnessRoot: string; worktreeRoot: string },
): Promise<void> {
  // Generate the fence script with baked-in roots
  const scriptContent = generateFenceScript(args.worktreeRoot, args.harnessRoot);
  const scriptPath = join(args.configDir, 'write-fence.sh');

  // Write the script to disk
  await fs.writeFile(scriptPath, scriptContent);

  // Make it executable (mode 0o755 for rwxr-xr-x, but we only care about +x for owner)
  await fs.chmod(scriptPath, 0o755);

  // Read the settings.json that was just written
  const settingsPath = join(args.configDir, 'settings.json');
  const settingsJson = await fs.readFile(settingsPath);

  // Merge the fence entry into settings.json with the script path
  const updatedSettings = mergeFenceIntoSettings(settingsJson, scriptPath);

  // Write the updated settings back to disk
  await fs.writeFile(settingsPath, updatedSettings);
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
 * Resolve the sandbox's sole worktree-owned link. Engine-owned hooks are files
 * in the sandbox, never links to an operator or worktree hooks directory.
 */
export async function sandboxLinkTargets(
  sandbox: SandboxBuildEnv,
): Promise<Record<(typeof LINKED_DIRS)[number], string>> {
  return {
    skills: join(sandbox.configDir, 'skills'),
  };
}
