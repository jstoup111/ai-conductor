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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';

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

async function defaultPrompt(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
