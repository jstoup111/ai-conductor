import { execa } from 'execa';
import { mkdir, copyFile, writeFile, readFile, access, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { BacklogItem } from './daemon.js';
import type { LLMProvider } from '../execution/llm-provider.js';
import type {
  FeatureRunnerDeps,
  FeatureWorktree,
  WorktreeOutcome,
} from './daemon-runner.js';
import { runInfraPreflight } from './infra-preflight.js';

export interface RealDepsConfig {
  /** The main checkout the daemon runs from. */
  projectRoot: string;
  /** Directory under which per-feature worktrees are created. */
  worktreeBase: string;
  /** Branch the worktrees fork from (e.g. 'main'). */
  baseBranch: string;
  /** Run the gate loop in a worktree to DONE/HALT (assembled by the CLI). */
  runConductorInWorktree: (worktree: FeatureWorktree, item: BacklogItem) => Promise<void>;
  /** LLM provider used for the Phase 9.1 `done`-feature retro narrative. */
  provider: LLMProvider;
  log?: (msg: string) => void;
}

const PROCESSED_SUBDIR = '.daemon/processed';
const WARNED_SUBDIR = '.daemon/warned';

/** Concrete (git/fs) implementation of the feature-runner primitives. */
export function makeFeatureRunnerDeps(cfg: RealDepsConfig): FeatureRunnerDeps {
  const processedDir = join(cfg.projectRoot, PROCESSED_SUBDIR);

  return {
    log: cfg.log,
    // The real daemon path always emits to the engineer store on completion
    // (Phase 9.1). Manual `/conduct` runs don't go through makeFeatureRunnerDeps.
    daemon: true,
    provider: cfg.provider,
    // Project key for the engineer store = the main checkout's basename (NOT the
    // worktree path, which is always `<projectRoot>/.worktrees/<slug>`).
    project: basename(cfg.projectRoot),

    createWorktree: async (slug) => {
      const branch = `feat/daemon-${slug}`;
      const path = join(cfg.worktreeBase, slug);
      const root = cfg.projectRoot;
      // Idempotent so re-running the daemon after a kept (halted/errored)
      // worktree resumes instead of aborting on "branch/worktree already
      // exists". Three cases:
      //   1. worktree already registered for this path → reuse it (resume).
      //   2. branch exists but its worktree was removed → attach a worktree.
      //   3. neither exists → fresh branch + worktree off the base branch.
      if (await isRegisteredWorktree(root, path)) {
        cfg.log?.(`reusing worktree ${path} (resume)`);
      } else if (await branchExists(root, branch)) {
        cfg.log?.(`attaching worktree to existing branch ${branch}`);
        await execa('git', ['worktree', 'add', path, branch], { cwd: root });
      } else {
        await execa('git', ['worktree', 'add', '-b', branch, path, cfg.baseBranch], {
          cwd: root,
        });
      }
      return { path, branch };
    },

    // Materialize the human-authored specs INTO the worktree (the gotcha: they
    // may be uncommitted in the main checkout and thus invisible in a fresh
    // worktree). Copy + commit so the loop's gates see committed inputs.
    materializeSpecs: async (wt, item) => {
      await mkdir(join(wt.path, '.docs/stories'), { recursive: true });
      await mkdir(join(wt.path, '.docs/plans'), { recursive: true });
      await copyFile(item.storiesPath, join(wt.path, '.docs/stories', basename(item.storiesPath)));
      await copyFile(item.planPath, join(wt.path, '.docs/plans', basename(item.planPath)));
      await execa('git', ['add', '.docs'], { cwd: wt.path });
      await execa('git', ['commit', '-m', `daemon: materialize specs for ${item.slug}`], {
        cwd: wt.path,
      }).catch(() => {
        /* nothing to commit (already tracked) — fine */
      });
    },

    // Opt-in infra bring-up: runs the project's `bin/daemon-preflight` in the
    // worktree if present (no-op otherwise). Keeps the daemon stack-agnostic
    // while letting each project supply its own shared/namespaced infra setup.
    preflight: (wt) => runInfraPreflight(wt.path, cfg.log),

    runConductor: (wt, item) => cfg.runConductorInWorktree(wt, item),

    readOutcome: (wt) => readWorktreeOutcome(wt.path),

    teardownWorktree: async (wt, keep) => {
      if (keep) return; // halt/error → leave it for the human
      await execa('git', ['worktree', 'remove', '--force', wt.path], {
        cwd: cfg.projectRoot,
      }).catch(() => {
        /* best-effort cleanup */
      });
    },

    markProcessed: async (slug) => {
      await mkdir(processedDir, { recursive: true });
      await writeFile(join(processedDir, slug), 'shipped\n', 'utf-8');
    },
  };
}

/** True if `path` is already a registered git worktree of `projectRoot`. */
async function isRegisteredWorktree(projectRoot: string, path: string): Promise<boolean> {
  try {
    const { stdout } = await execa('git', ['worktree', 'list', '--porcelain'], {
      cwd: projectRoot,
    });
    // Lines look like `worktree <abs-path>`. Match the exact path or its
    // `.worktrees/<slug>` suffix (git may report a realpath-resolved form).
    const suffix = path.slice(path.indexOf(join('.worktrees', basename(path))));
    return stdout
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .some((l) => {
        const wt = l.slice('worktree '.length);
        return wt === path || wt.endsWith(suffix);
      });
  } catch {
    return false;
  }
}

/** True if a local branch named `branch` exists in `projectRoot`. */
async function branchExists(projectRoot: string, branch: string): Promise<boolean> {
  try {
    await execa('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
      cwd: projectRoot,
    });
    return true;
  } catch {
    return false;
  }
}

/** Has this slug already been shipped by the daemon? (for discoverBacklog). */
export async function isProcessed(projectRoot: string, slug: string): Promise<boolean> {
  try {
    await access(join(projectRoot, PROCESSED_SUBDIR, slug));
    return true;
  } catch {
    return false;
  }
}

/**
 * Has this slug's "merged spec cannot build" skip already been surfaced once?
 * Mirrors `isProcessed` but for the `.daemon/warned/` markers — lets
 * `discoverBacklog` log a persistently-unbuildable merged spec exactly once
 * instead of on every poll tick.
 */
export async function hasWarned(projectRoot: string, slug: string): Promise<boolean> {
  try {
    await access(join(projectRoot, WARNED_SUBDIR, slug));
    return true;
  } catch {
    return false;
  }
}

/** Record that this slug's skip has been surfaced, suppressing repeat skip logs. */
export async function markWarned(projectRoot: string, slug: string): Promise<void> {
  const warnedDir = join(projectRoot, WARNED_SUBDIR);
  await mkdir(warnedDir, { recursive: true });
  await writeFile(join(warnedDir, slug), 'warned\n', 'utf-8');
}

/**
 * True while a halted feature's worktree HALT marker is still present — the
 * park-gate the daemon checks before re-dispatching (see daemon.ts `isHalted`).
 * A human clears `.pipeline/HALT` to make the feature re-eligible. Takes the
 * worktree base so it stays in lockstep with `createWorktree`'s path convention
 * (`<worktreeBase>/<slug>`), not a re-derived `.worktrees`.
 */
export async function isHalted(worktreeBase: string, slug: string): Promise<boolean> {
  return exists(join(worktreeBase, slug, '.pipeline/HALT'));
}

/** Read the loop outcome from a worktree's `.pipeline` markers. */
export async function readWorktreeOutcome(worktreePath: string): Promise<WorktreeOutcome> {
  const done = await exists(join(worktreePath, '.pipeline/DONE'));
  const haltPath = join(worktreePath, '.pipeline/HALT');
  const halted = await exists(haltPath);

  let reason: string | undefined;
  if (halted) {
    reason = (await readFile(haltPath, 'utf-8').catch(() => '')).trim() || undefined;
  }

  let prUrl: string | undefined;
  try {
    const state = JSON.parse(
      await readFile(join(worktreePath, '.pipeline/conduct-state.json'), 'utf-8'),
    ) as { pr_url?: string };
    prUrl = state.pr_url;
  } catch {
    /* no state / no pr_url */
  }

  return { done, halted, reason, prUrl };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
