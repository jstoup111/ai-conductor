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
//   - COPIES the operator's `.credentials.json` so the headless `claude -p` build
//     can authenticate — a fresh CLAUDE_CONFIG_DIR has no auth, and the daemon
//     cannot re-auth interactively (auth is subscription creds, not an env key);
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
//   - Credentials/settings are COPIED, never symlinked — no sandbox symlink ever
//     resolves to a global-config target (TR-6 invariant); the two symlinks
//     (skills/hooks) resolve only into the worktree.
//   - A missing worktree skills//hooks/ dir FAILS CLOSED (SandboxProvisionError) —
//     a dangling-link sandbox is never launched (TR-5).
//   - Teardown runs on the crash branch (withSandboxBuildEnv finally), asserted.
//   - childEnv() returns a COPY — the daemon's own env is never mutated (no bleed).

import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { generateFenceScript, mergeFenceIntoSettings } from './write-fence.js';

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
  /** Copy `src` → `dest`; callers guard with `pathExists` first. */
  copyFile(src: string, dest: string): Promise<void>;
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
  copyFile: (src, dest) => fsp.copyFile(src, dest),
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
  /**
   * The operator's live config dir — the source of `.credentials.json` +
   * `settings.json`. Defaults to `$CLAUDE_CONFIG_DIR` or `~/.claude`.
   */
  globalConfigDir?: string;
  /** Base dir for the throwaway config dir (defaults to the OS temp dir). */
  baseDir?: string;
  /** Parent env the child env is derived from (defaults to process.env). */
  parentEnv?: NodeJS.ProcessEnv;
  /** Filesystem seam (defaults to real fs). */
  fs?: SandboxFs;
  /**
   * The operator's live Claude state file — the SOURCE of workspace-trust
   * propagation. Defaults to `$CLAUDE_CONFIG_DIR/.claude.json` when the parent
   * env sets CLAUDE_CONFIG_DIR, else `~/.claude.json` (with the default
   * `~/.claude` config dir, Claude Code keeps state BESIDE the dir, not in it).
   */
  globalStateFile?: string;
}

/** The two links a sandbox exposes into the worktree. */
const LINKED_DIRS = ['skills', 'hooks'] as const;
/** Config files copied (never symlinked) from the operator's global config. */
const CREDENTIALS_FILE = '.credentials.json';
const SETTINGS_FILE = 'settings.json';
/** Claude Code state file — holds per-project workspace-trust grants. */
const STATE_FILE = '.claude.json';

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
 * Provision a throwaway CLAUDE_CONFIG_DIR: skills/ + hooks/ symlinked into the
 * build worktree, with `.credentials.json` + a hook-retargeted `settings.json`
 * copied in. On ANY provisioning failure (including a missing worktree
 * skills//hooks/ dir), removes the partial sandbox and throws
 * SandboxProvisionError — the caller must not launch a build against it.
 */
export async function provisionSandboxBuildEnv(opts: ProvisionOptions): Promise<SandboxBuildEnv> {
  const fs = opts.fs ?? realSandboxFs;
  const base = opts.baseDir ?? tmpdir();
  const parentEnv = opts.parentEnv ?? process.env;
  const globalConfigDir =
    opts.globalConfigDir ?? parentEnv.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');

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

    // Auth: copy the operator's credentials so the headless build authenticates.
    // Copy (not symlink) keeps the TR-6 no-global-symlink invariant intact.
    // Copy-if-present: an env-key auth (ANTHROPIC_API_KEY) needs no creds file.
    await copyIfPresent(
      fs,
      join(globalConfigDir, CREDENTIALS_FILE),
      join(configDir, CREDENTIALS_FILE),
    );

    // settings.json: copy + retarget harness-checkout paths to the worktree, so
    // hooks declared by absolute path fire against the EDITED hooks.
    await provisionSettings(fs, {
      src: join(globalConfigDir, SETTINGS_FILE),
      dest: join(configDir, SETTINGS_FILE),
      harnessRoot: opts.harnessRoot,
      worktreeRoot: opts.worktreeRoot,
    });

    // write-fence.sh: provision the fence script that blocks edits to the live
    // harness checkout. The script is materialized with +x mode and wired into
    // settings.json as a PreToolUse hook.
    await provisionWriteFence(fs, {
      configDir,
      harnessRoot: opts.harnessRoot,
      worktreeRoot: opts.worktreeRoot,
    });

    // .claude.json: propagate the operator's EXISTING workspace trust so the
    // headless build honors the repo's `.claude/settings.json` permissions.
    // Propagate-only — when the operator has not trusted the harness root,
    // nothing is written and the build runs untrusted (fails safe, not open).
    await provisionTrustState(fs, {
      src: opts.globalStateFile ?? defaultGlobalStateFile(parentEnv),
      dest: join(configDir, STATE_FILE),
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

/** Copy `src` → `dest` only when `src` exists; a missing source is not an error. */
async function copyIfPresent(fs: SandboxFs, src: string, dest: string): Promise<void> {
  if (await fs.pathExists(src)) await fs.copyFile(src, dest);
}

/** Read the global settings.json, retarget harness-checkout paths, write the copy. */
async function provisionSettings(
  fs: SandboxFs,
  args: { src: string; dest: string; harnessRoot: string; worktreeRoot: string },
): Promise<void> {
  const raw = await fs.readFile(args.src);
  if (raw === null) return; // no global settings.json → nothing to provision
  const rewritten = await retargetHarnessPaths(fs, raw, args.harnessRoot, args.worktreeRoot);
  await fs.writeFile(args.dest, rewritten);
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

  // Merge the fence entry into settings.json
  const updatedSettings = mergeFenceIntoSettings(settingsJson);

  // Write the updated settings back to disk
  await fs.writeFile(settingsPath, updatedSettings);
}

/**
 * Replace every `<harnessRoot>/` prefix with `<worktreeRoot>/` in the settings
 * text, so absolute harness-checkout paths (hook commands, statusLine) resolve
 * into the worktree's edited copies. Both roots are realpath-canonicalized first
 * (settings paths are canonical); the trailing `/` keeps a sibling like
 * `<harnessRoot>-old/` from matching. A no-op when the roots are equal or
 * either fails to resolve.
 */
async function retargetHarnessPaths(
  fs: SandboxFs,
  settingsText: string,
  harnessRoot: string,
  worktreeRoot: string,
): Promise<string> {
  const from = await canonicalize(fs, harnessRoot);
  const to = await canonicalize(fs, worktreeRoot);
  if (from === null || to === null || from === to) return settingsText;
  return settingsText.split(`${from}/`).join(`${to}/`);
}

/** realpath a path, or null if it does not resolve (never throws). */
async function canonicalize(fs: SandboxFs, p: string): Promise<string | null> {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
}

/**
 * Where the operator's live state file lives: inside CLAUDE_CONFIG_DIR when
 * that is set, else at `~/.claude.json` (beside, not inside, `~/.claude`).
 */
function defaultGlobalStateFile(parentEnv: NodeJS.ProcessEnv): string {
  return parentEnv.CLAUDE_CONFIG_DIR
    ? join(parentEnv.CLAUDE_CONFIG_DIR, STATE_FILE)
    : join(homedir(), STATE_FILE);
}

/**
 * Seed the sandbox `.claude.json` by PROPAGATING the operator's existing
 * workspace trust. Writes a minimal state file trusting the harness root and
 * the build worktree (both as-passed and realpath-canonicalized — Claude Code
 * may key trust by either) IFF the operator's live state file already trusts
 * the harness root. Everything else — a missing state file, malformed JSON, or
 * an untrusted harness root — writes NOTHING: the sandbox never fabricates a
 * trust grant, it only re-homes one the operator already made. The seeded file
 * is a fresh write (never a symlink), preserving the TR-6 no-global-symlink
 * invariant; the operator's live state file is only ever read.
 */
async function provisionTrustState(
  fs: SandboxFs,
  args: { src: string; dest: string; harnessRoot: string; worktreeRoot: string },
): Promise<void> {
  const raw = await fs.readFile(args.src);
  if (raw === null) return; // no operator state file → nothing to propagate
  let state: unknown;
  try {
    state = JSON.parse(raw);
  } catch {
    return; // malformed operator state → propagate nothing (never guess trust)
  }
  const projects = (state as { projects?: unknown }).projects;
  if (projects === null || typeof projects !== 'object') return;
  const trustedByOperator = (p: string | null): boolean =>
    p !== null &&
    (projects as Record<string, { hasTrustDialogAccepted?: unknown }>)[p]
      ?.hasTrustDialogAccepted === true;

  const canonHarness = await canonicalize(fs, args.harnessRoot);
  if (!trustedByOperator(args.harnessRoot) && !trustedByOperator(canonHarness)) return;

  const canonWorktree = await canonicalize(fs, args.worktreeRoot);
  const seeded: Record<string, { hasTrustDialogAccepted: true }> = {};
  for (const p of [args.harnessRoot, canonHarness, args.worktreeRoot, canonWorktree]) {
    if (p !== null) seeded[p] = { hasTrustDialogAccepted: true };
  }
  const onboarded =
    (state as { hasCompletedOnboarding?: unknown }).hasCompletedOnboarding === true;
  await fs.writeFile(
    args.dest,
    `${JSON.stringify(
      { ...(onboarded ? { hasCompletedOnboarding: true } : {}), projects: seeded },
      null,
      2,
    )}\n`,
  );
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

/**
 * Re-copy `.credentials.json` from source config dir to sandbox config dir,
 * overwriting any existing sandbox credentials. Used when the operator's
 * credentials are refreshed (e.g., token expiry) and the running sandbox
 * build needs updated credentials without tearing down the sandbox.
 *
 * The copy is a regular file, never a symlink (TR-6 invariant). If the source
 * file does not exist, this is a no-op (no error thrown — the caller is
 * responsible for ensuring the source exists when needed).
 */
export async function refreshSandboxCredentials(
  sourceConfigDir: string,
  sandboxConfigDir: string,
): Promise<void> {
  const src = join(sourceConfigDir, CREDENTIALS_FILE);
  const dest = join(sandboxConfigDir, CREDENTIALS_FILE);
  await copyIfPresent(realSandboxFs, src, dest);
}
