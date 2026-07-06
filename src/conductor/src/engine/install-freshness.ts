// ── Harness install-freshness guard ─────────────────────────────────────────
//
// A harness update (git pull / merged PR) does NOT auto-relink skills — that
// only happens when `bin/install` runs. So a newly-added skill can be present in
// the harness `skills/` tree but missing from `~/.claude/skills/`, and a
// daemon-dispatched `claude -p '/<skill>'` then hits "Unknown command", returns
// empty output, and the conductor HALTs with a cryptic "no parseable result"
// (this exact gap left the `/rebase` skill unrunnable on the daemon).
//
// This guard runs `bin/install --check` (now scriptable — exits non-zero on
// drift) at daemon entry. On drift it either prompts to run `bin/install
// --update` (interactive) or fails hard (non-interactive) — never silently
// starts on a stale install. All side-effecting collaborators are injectable so
// the policy is unit-testable without touching the real install or a TTY.

import { execa } from 'execa';
import { dirname, join, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, constants } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { readRegistry, resolveRegistryPath } from './registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the harness root (the directory containing `bin/install`). Probes the
 * bundle depth (dist/ → ../../..) and the source-tree depth (src/engine/ →
 * ../../../..), mirroring resolveHarnessVersion in plugin-manifest.ts. Returns
 * null when neither resolves (e.g. an unusual install layout) — callers skip the
 * check rather than block.
 */
export async function resolveHarnessRoot(): Promise<string | null> {
  for (const rel of ['../../../', '../../../../']) {
    const root = join(__dirname, rel);
    if (await access(join(root, 'bin', 'install')).then(() => true, () => false)) {
      return root;
    }
  }
  return null;
}

// ── Installed-root resolution (#363 / adr-2026-07-06) ───────────────────────
//
// `resolveHarnessRoot` (above) answers "where does this MODULE live?" — the
// right question for self-host DETECTION, and its body is deliberately
// untouched (the PathSelfHostDetector shares it; changing its semantics would
// silently disable the whole guardrail bundle). But a worktree checkout is a
// full harness (it has bin/install), so for an engine running from a
// worktree's dist that probe resolves the WORKTREE — and incident #363 showed
// what happens when such a root authorizes writes to operator globals: every
// global bin/skill/hook path was repointed at a directory deleted at ship
// time. `resolveInstalledHarnessRoot` answers the different question "where is
// the INSTALLED main checkout?", and is used ONLY where the resolved root
// authorizes operator-global writes (relink preflight, sandbox harnessRoot).

/** Result of the installed-root resolution ladder — never a bare worktree. */
export type InstalledRootResolution =
  | { status: 'ok'; root: string }
  | { status: 'rejected'; reason: string; detail: string }
  | { status: 'unresolved' };

export interface InstalledRootOptions {
  /** Override the module-relative probe (tests). Defaults to resolveHarnessRoot. */
  probeRoot?: () => Promise<string | null>;
  /** Injected git runner: run `git <args>` in `cwd`, return trimmed stdout. */
  git?: (args: string[], cwd: string) => Promise<string>;
  /** Injected fs seam: true iff `path` exists. */
  pathExists?: (path: string) => Promise<boolean>;
  /** Registry file override for the advisory cross-check (tests). */
  registryPath?: string;
  /** Diagnostic sink (defaults to stderr). */
  log?: (message: string) => void;
}

const realGitRunner = async (args: string[], cwd: string): Promise<string> => {
  const r = await execa('git', args, { cwd });
  return r.stdout.trim();
};

const realPathExists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false,
  );

/** True iff `p` (normalized) sits under a `.worktrees/` directory. */
function isUnderWorktrees(p: string): boolean {
  return resolve(p).split(sep).includes('.worktrees');
}

/**
 * Resolve the INSTALLED harness main-checkout root — the only root allowed to
 * authorize writes to operator globals. Ladder (per the ADR):
 *   a. module-relative probe (existing `resolveHarnessRoot` semantics);
 *   b. worktree detection: probed path under `.worktrees/`, OR its
 *      `git rev-parse --git-common-dir` resolves outside the probed root;
 *   c. for a worktree, derive the main checkout from the git common dir
 *      (`<main>/.git` → `<main>`) — authoritative, no registry guessing;
 *   d. assert `bin/install` exists at the final root and hard-reject any root
 *      still under `.worktrees/` — callers fail loudly, never fall back to a
 *      worktree;
 *   e. advisory registry cross-check: warn (log only) when the resolved root
 *      is not recorded in ~/.ai-conductor/registry.json.
 * Never throws; every failure is a `rejected` result whose detail names the
 * offending path. A null probe is `unresolved` (parity with the existing
 * null-root skip semantics of `resolveHarnessRoot` callers).
 */
export async function resolveInstalledHarnessRoot(
  opts: InstalledRootOptions = {},
): Promise<InstalledRootResolution> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const probe = opts.probeRoot ?? resolveHarnessRoot;
  const git = opts.git ?? realGitRunner;
  const pathExists = opts.pathExists ?? realPathExists;

  try {
    const probed = await probe();
    if (probed === null) return { status: 'unresolved' };
    const probedRoot = resolve(probed);

    let commonDirAbs: string;
    try {
      const raw = await git(['rev-parse', '--git-common-dir'], probedRoot);
      commonDirAbs = isAbsolute(raw) ? resolve(raw) : resolve(probedRoot, raw);
    } catch (err) {
      return {
        status: 'rejected',
        reason: 'git-failure',
        detail:
          `git rev-parse --git-common-dir failed at ${probedRoot}: ` +
          `${err instanceof Error ? err.message : String(err)}. Cannot verify the probed root ` +
          'is the installed main checkout, so it must not authorize operator-global writes.',
      };
    }

    const commonDirInsideProbed =
      commonDirAbs === probedRoot || commonDirAbs.startsWith(probedRoot + sep);
    const isWorktree = isUnderWorktrees(probedRoot) || !commonDirInsideProbed;

    // Worktree → the main checkout owns the common dir (`<main>/.git`).
    const root = isWorktree ? dirname(commonDirAbs) : probedRoot;

    if (isUnderWorktrees(root)) {
      return {
        status: 'rejected',
        reason: 'worktree-root',
        detail:
          `resolved root ${root} still sits under .worktrees/ — a build worktree must never ` +
          'authorize operator-global writes (it is deleted at ship time).',
      };
    }

    if (!(await pathExists(join(root, 'bin', 'install')))) {
      return {
        status: 'rejected',
        reason: 'missing-installer',
        detail: `derived root ${root} has no bin/install — not an installed harness checkout.`,
      };
    }

    // Advisory only: the registry cannot mark "the harness", so a mismatch is
    // a warning, never a rejection — git derivation above is authoritative.
    try {
      const registryPath = opts.registryPath ?? resolveRegistryPath();
      const records = await readRegistry(registryPath);
      if (records.length > 0 && !records.some((r) => resolve(r.path) === root)) {
        log(
          `installed-root: resolved root ${root} is not recorded in the project registry ` +
            `(${registryPath}) — proceeding anyway (registry is advisory).`,
        );
      }
    } catch {
      // Missing/unreadable registry never blocks resolution.
    }

    return { status: 'ok', root };
  } catch (err) {
    return {
      status: 'rejected',
      reason: 'resolver-error',
      detail: `installed-root resolution failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Runs `bin/install <args>` rooted at the harness; resolves to its exit code. */
export interface InstallRunner {
  (args: string[], harnessRoot: string): Promise<number>;
}

export const realInstallRunner: InstallRunner = async (args, harnessRoot) => {
  const r = await execa(join(harnessRoot, 'bin', 'install'), args, {
    cwd: harnessRoot,
    reject: false,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return typeof r.exitCode === 'number' ? r.exitCode : 1;
};

/** Thrown when the install is stale and was not (or could not be) refreshed. */
export class InstallStaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallStaleError';
  }
}

export interface EnsureFreshOptions {
  /** Override harness-root discovery (tests). */
  harnessRoot?: string | null;
  /** Override the `bin/install` runner (tests). */
  runner?: InstallRunner;
  /**
   * Whether an interactive prompt is possible. Defaults to `process.stdin.isTTY`.
   * The continuous daemon loop passes `false` so it never blocks on a prompt —
   * it fails hard on drift instead.
   */
  interactive?: boolean;
  /** Override the y/N prompt (tests). Returns true for "yes". */
  prompt?: (question: string) => Promise<boolean>;
  /** Diagnostic sink (defaults to stderr). */
  log?: (message: string) => void;
}

const DRIFT_MESSAGE =
  'Harness install is stale — one or more skills are missing or out of date in ' +
  '~/.claude/skills/. Daemon-dispatched skills (e.g. /rebase) will fail silently ' +
  'until `bin/install --update` is run.';

/**
 * Ensure the harness install is fresh before starting work. Resolves quietly
 * when the install is healthy. On drift:
 *   - interactive  → prompt to run `bin/install --update`; "yes" heals + resolves,
 *                    "no" throws InstallStaleError (caller should NOT start).
 *   - non-interactive → throws InstallStaleError (never auto-mutates global config,
 *                    never blocks on an unanswerable prompt).
 * A failed `--update` also throws. If the harness root can't be located the
 * check is skipped (resolves) rather than blocking an otherwise-working install.
 */
export async function ensureInstallFresh(opts: EnsureFreshOptions = {}): Promise<void> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const harnessRoot =
    opts.harnessRoot !== undefined ? opts.harnessRoot : await resolveHarnessRoot();
  if (!harnessRoot) {
    log('install-freshness: could not locate the harness root; skipping the staleness check.');
    return;
  }

  const runner = opts.runner ?? realInstallRunner;
  const checkCode = await runner(['--check'], harnessRoot);
  if (checkCode === 0) return; // fresh — nothing to do

  log(DRIFT_MESSAGE);

  const interactive = opts.interactive ?? Boolean(process.stdin.isTTY);
  if (!interactive) {
    throw new InstallStaleError(`${DRIFT_MESSAGE} Run \`bin/install --update\` and retry.`);
  }

  const prompt = opts.prompt ?? defaultPrompt;
  const yes = await prompt('Run `bin/install --update` now? [y/N] ');
  if (!yes) {
    throw new InstallStaleError(
      'Declined the harness install refresh — not starting on a stale install.',
    );
  }

  const updateCode = await runner(['--update'], harnessRoot);
  if (updateCode !== 0) {
    throw new InstallStaleError(
      '`bin/install --update` failed — not starting on a stale install.',
    );
  }
  // Healed — resolve and let the caller proceed.
}

// ── Self-build skill-relink preflight (TR-4) ────────────────────────────────
//
// A harness SELF-BUILD may merge a spec that adds or renames a skill. `git pull`
// alone does not relink `~/.claude/skills/`, so a dispatched `claude -p
// '/<skill>'` would hit "Unknown command" → empty output → a "no parseable
// result" HALT (the exact gap that left /rebase unrunnable). Before dispatching a
// self-build we proactively relink via `bin/install --update` (relink only — it
// skips deps + channel prompt, and does NOT git-pull). Scoped to self-builds:
// callers gate this behind the SelfHostDetector, so a non-harness build never
// reaches here and `ensureInstallFresh`'s normal-repo behavior is unchanged.

export interface RelinkPreflightOptions {
  /** Override harness-root discovery (tests). */
  harnessRoot?: string | null;
  /** Override the `bin/install` runner (tests). When set, the real installer-
   *  existence check is skipped (the injected runner models install behavior). */
  runner?: InstallRunner;
  /** Diagnostic sink (defaults to stderr). */
  log?: (message: string) => void;
}

/**
 * Relink harness skills before a self-build dispatches. Resolves when the relink
 * succeeds (or when there is no harness root to link against — reported, not a
 * crash). Throws `InstallStaleError` when `bin/install --update` exits non-zero
 * or the installer is missing / non-executable — the caller must NOT dispatch a
 * self-build into a known stale-symlink state.
 */
export async function relinkSkillsForSelfBuild(opts: RelinkPreflightOptions = {}): Promise<void> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const harnessRoot =
    opts.harnessRoot !== undefined ? opts.harnessRoot : await resolveHarnessRoot();
  if (!harnessRoot) {
    // Nothing to link against — report and skip rather than crash (TR-4 negative).
    log('skill-relink preflight: harness root unresolved; skipping the self-build relink.');
    return;
  }

  // Production path (no injected runner): verify the real installer up front so a
  // missing / non-executable `bin/install` surfaces a keyed error naming the
  // path, not an opaque ENOENT/EACCES spawn error from execa (TR-4 negative).
  if (!opts.runner) await assertInstallerRunnable(harnessRoot);

  const runner = opts.runner ?? realInstallRunner;
  const code = await runner(['--update'], harnessRoot);
  if (code !== 0) {
    throw new InstallStaleError(
      `Skill relink failed for the harness self-build (\`bin/install --update\` exited ${code}). ` +
        'Not dispatching into a stale-symlink state — a newly added or renamed skill would HALT ' +
        'the build on "no parseable result".',
    );
  }
}

async function assertInstallerRunnable(harnessRoot: string): Promise<void> {
  const installer = join(harnessRoot, 'bin', 'install');
  try {
    await access(installer, constants.X_OK);
  } catch {
    throw new InstallStaleError(
      `Harness installer is missing or not executable: ${installer}. ` +
        'Cannot relink skills for the self-build.',
    );
  }
}

async function defaultPrompt(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
