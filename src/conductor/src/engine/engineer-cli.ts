// `conduct engineer` command handler (Phase 9.3, ADR-008 conformance rework).
//
// AGENT-HOSTED EXECUTION MODEL (ADR-008):
//   The engineer subsystem is driven by the /engineer host-agent skill in a Claude
//   Code session. The bare `conduct engineer` command is the FRONT DOOR: it launches
//   an INTERACTIVE `claude /engineer` session (stdio inherited, operator present),
//   dropping the operator into the human-in-the-loop idea→spec loop. This is NOT the
//   forbidden `claude -p` substrate — that was a headless subprocess doing autonomous
//   routing/authoring (ADR-008 removes it). Launching an interactive, operator-driven
//   session is the entrypoint, not automation; routing/authoring still happen in-chat.
//
//   The remaining subcommands are DETERMINISTIC CLI PRIMITIVES the host-agent skill
//   calls from in-chat reasoning — no Node readline REPL, no spawned subprocess for
//   routing/authoring.
//
// Subcommands:
//   conduct engineer               → {kind:'launch'}   — launch interactive `claude /engineer`
//   conduct engineer projects      → {kind:'projects'} — list registry to stdout as JSON
//   conduct engineer land          → {kind:'land'}     — commit pre-written artifacts to spec branch
//   conduct engineer handoff       → {kind:'handoff'}  — open spec PR + ensureRunning
//   (malformed subcommand / missing flags → {kind:'guide'} — print usage)

import { execFile as execFileCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { EngineerIO, EngineerDeps } from './engineer/loop.js';
import { createRegistryReader } from './registry.js';
import { resolveTargetRepo } from './engineer/target.js';
import { landSpec } from './engineer/land-spec.js';
import { openSpecPr } from './engineer/handoff.js';
import { recordAuthoredKey } from './engineer/authored-ledger.js';
import { ensureRunning } from './daemon-lock.js';

/**
 * Production DECIDE seam: gates each authoring step through the io surface.
 * Presents the prompt and waits for the operator to provide the approved artifact.
 * An empty response → rejected (blocks authoring). NO claude subprocess spawned.
 */
function makeProductionDecide(io: EngineerIO): NonNullable<EngineerDeps['decide']> {
  return async ({ step, idea, project, prompt }) => {
    io.print(`\n── DECIDE: ${step} — project "${project}" — idea: ${idea}`);
    io.print(prompt);
    io.print(
      `Provide the approved ${step} artifact as your next response (empty = reject, blocks authoring):`,
    );
    const line = await io.prompt();
    const artifact = line ?? '';
    if (artifact.trim() === '') return { approved: false, artifact: '' };
    return { approved: true, artifact };
  };
}

const execFileP = promisify(execFileCb);

// ── Dispatch descriptor ───────────────────────────────────────────────────────

export type EngineerDispatch =
  | { kind: 'launch' }
  | { kind: 'guide' }
  | { kind: 'projects' }
  | { kind: 'land'; project: string; idea: string }
  | { kind: 'handoff'; project: string; branch: string };

// ── Subcommand detection ──────────────────────────────────────────────────────

/**
 * Parse process.argv into an EngineerDispatch descriptor, or return null if
 * argv[2] is not 'engineer'.
 *
 * Subcommand grammar (argv[3]):
 *   absent / undefined   → {kind:'launch'}   (drop into interactive `claude /engineer`)
 *   'projects'           → {kind:'projects'}
 *   'land'               → {kind:'land', project, idea}  (--project <n> --idea <i>)
 *   'handoff'            → {kind:'handoff', project, branch}  (--project <n> --branch <b>)
 *   malformed / missing-flags → {kind:'guide'}  (print usage)
 */
export function detectEngineerCommand(argv: string[]): EngineerDispatch | null {
  // argv is process.argv: [node, entry, sub, ...]
  const sub = argv[2];
  if (sub !== 'engineer') return null;

  const subCmd = argv[3];

  if (!subCmd || subCmd === '') {
    // Bare `conduct engineer` → launch the interactive host-agent loop.
    return { kind: 'launch' };
  }

  if (subCmd === 'projects') {
    return { kind: 'projects' };
  }

  if (subCmd === 'land') {
    const project = parseFlag(argv, '--project');
    const idea = parseFlag(argv, '--idea');
    if (!project || !idea) {
      // Missing required flags — treat as guide.
      return { kind: 'guide' };
    }
    return { kind: 'land', project, idea };
  }

  if (subCmd === 'handoff') {
    const project = parseFlag(argv, '--project');
    const branch = parseFlag(argv, '--branch');
    if (!project || !branch) {
      return { kind: 'guide' };
    }
    return { kind: 'handoff', project, branch };
  }

  // Unknown subcommand — treat as guide.
  return { kind: 'guide' };
}

/** Parse the value of a named flag (e.g. --project foo) from an argv array. */
function parseFlag(argv: string[], flag: string): string | null {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx >= argv.length - 1) return null;
  const val = argv[idx + 1];
  if (!val || val.startsWith('--')) return null;
  return val;
}

// ── Optional IO/deps injection (for tests) ────────────────────────────────────

/**
 * Injectable IO/deps for dispatchEngineer.
 * Production callers omit this and the defaults are used (stdout/stderr).
 * Tests inject print/printErr/gh/ensureRunningLaunch to avoid real I/O.
 */
export interface DispatchEngineerOpts {
  /** Override the registry path (for tests). */
  registryPath?: string;
  /** Override the engineer dir (for tests). */
  engineerDir?: string;
  /** Print to stdout (default: process.stdout.write). */
  print?: (s: string) => void;
  /** Print to stderr (default: process.stderr.write). */
  printErr?: (s: string) => void;
  /** Injected gh runner (for tests). */
  gh?: (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;
  /** Injected ensureRunning launch spy (for tests). */
  ensureRunningLaunch?: (repoPath: string) => void | Promise<void>;
  /**
   * Injected interactive launcher (for tests). When provided, the 'launch' kind
   * calls this instead of spawning a real `claude` process and returns its exit code.
   */
  launchInteractive?: () => number | Promise<number>;
  /**
   * Whether we are already inside a Claude Code session (default: reads CLAUDECODE).
   * When true, the 'launch' kind prints an in-session note instead of spawning a
   * nested interactive `claude` (which would recurse).
   */
  insideClaudeSession?: boolean;
  /**
   * Between-ideas continuation prompt (for tests). Returns true to launch another
   * fresh engineer session, false to stop the outer loop. Default: a TTY y/n prompt
   * that returns false when stdin is not a TTY (so non-interactive runs don't loop).
   */
  confirmAnother?: () => boolean | Promise<boolean>;
}

/**
 * Build the argv for the interactive engineer launch. Exported for testing.
 *
 * The engineer MUST author DECIDE artifacts, create the `spec/<slug>` branch, and run
 * the `land`/`handoff` git/gh primitives — so it must NOT start in `plan` mode (read-only).
 * Many users set `"defaultMode": "plan"` globally; the explicit `--permission-mode` flag
 * overrides that so the launched session can do its work. Defaults to `default` (normal
 * permission prompts — safe), overridable via `CONDUCT_ENGINEER_PERMISSION_MODE` for a
 * lower-friction mode (`acceptEdits`, `bypassPermissions`, …). `plan` is rejected (it would
 * defeat the loop) and coerced back to `default`.
 */
export function engineerLaunchArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const requested = (env.CONDUCT_ENGINEER_PERMISSION_MODE || '').trim();
  const mode = requested && requested !== 'plan' ? requested : 'default';
  return ['--permission-mode', mode, '/engineer'];
}

/**
 * Default interactive launcher: drop the operator into `claude /engineer`, inheriting
 * the terminal so the human drives the loop. Resolves with the child's exit code.
 * Rejects on spawn error (e.g. `claude` not on PATH) so the caller can fall back.
 */
function launchClaudeEngineer(cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', engineerLaunchArgs(), { stdio: 'inherit', cwd });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

/**
 * Default between-ideas prompt: after one engineer session exits, ask whether to
 * launch another in a FRESH session (clean context). Empty/`y`/`yes` → continue
 * (default), anything else → stop. Non-TTY stdin → false (don't loop unattended).
 *
 * Deliberately uses a one-shot raw `process.stdin` read rather than the line-reader
 * module. This is a single launcher continuation prompt between sessions, not a REPL
 * substrate; the orphaned-primitive guard bans that module in the engineer path
 * precisely to keep the old routing/authoring REPL from creeping back — which this
 * is not.
 */
function promptAnother(): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  process.stdout.write('\nProcess another idea in a fresh session? [Y/n] ');
  return new Promise((resolve) => {
    const onData = (chunk: Buffer): void => {
      process.stdin.off('data', onData);
      process.stdin.pause();
      const a = chunk.toString().trim().toLowerCase();
      resolve(a === '' || a === 'y' || a === 'yes');
    };
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

/** Print the engineer usage/guide text (front door + deterministic primitives). */
function printGuide(print: (s: string) => void): void {
  print(
    'The engineer is the agent-hosted idea→spec loop. Run `conduct engineer` (no\n' +
      'subcommand) to drop into an interactive `claude /engineer` session and drive it\n' +
      'with a human in the loop. The subcommands below are the deterministic primitives\n' +
      'the /engineer skill calls in-chat:\n' +
      '\n' +
      '  conduct engineer                                     — launch the interactive /engineer loop\n' +
      '  conduct engineer projects                            — list registered projects\n' +
      '  conduct engineer land --project <n> --idea "<i>"    — commit pre-written spec artifacts\n' +
      '  conduct engineer handoff --project <n> --branch <b> — open spec PR + nudge daemon\n',
  );
}

// Construct the real gh runner used in production.
function makeProductionGh(): NonNullable<DispatchEngineerOpts['gh']> {
  return async (args: string[], opts: { cwd: string }) => {
    const result = await execFileP('gh', args, { cwd: opts.cwd });
    return { stdout: String(result.stdout) };
  };
}

// ── Main dispatch ─────────────────────────────────────────────────────────────

/**
 * Dispatch an engineer command.
 *
 * The bare `launch` kind spawns an INTERACTIVE `claude /engineer` session (the front
 * door — operator present, drives the loop). The `projects`/`land`/`handoff` primitives
 * are deterministic and spawn no claude: no Node readline REPL, and no `claude -p`
 * subprocess for routing or authoring (those happen in-chat in the launched session).
 */
export async function dispatchEngineer(
  dispatch: EngineerDispatch,
  opts: DispatchEngineerOpts = {},
): Promise<number> {
  const print = opts.print ?? ((s: string) => process.stdout.write(s + '\n'));
  const printErr = opts.printErr ?? ((s: string) => process.stderr.write(s + '\n'));
  const gh = opts.gh ?? makeProductionGh();
  const registryPath = opts.registryPath;
  const engineerDir = opts.engineerDir;

  switch (dispatch.kind) {
    // ── launch ──────────────────────────────────────────────────────────────────
    // Bare `conduct engineer`: drop the operator into the interactive /engineer loop.
    case 'launch': {
      const launchOne = opts.launchInteractive ?? (() => launchClaudeEngineer(process.cwd()));
      const confirmAnother = opts.confirmAnother ?? promptAnother;

      // Real-spawn path only: if we're already inside a Claude Code session, don't
      // nest a second interactive claude (it would recurse). When a launcher is
      // injected (tests), there is no real nesting, so skip this guard.
      if (!opts.launchInteractive) {
        const inside = opts.insideClaudeSession ?? Boolean(process.env.CLAUDECODE);
        if (inside) {
          print(
            "You're already inside a Claude Code session — run /engineer directly to start " +
              'the idea→spec loop (no need to launch a nested session).',
          );
          return 0;
        }
      }

      // Outer loop: ONE fresh `claude /engineer` session per idea, so each idea
      // starts with clean context. Durable state (registry, lessons, processed
      // markers) is file-backed, so a fresh process loses nothing. The skill delivers
      // a single idea's spec then asks the operator to `/quit`; on exit we offer to
      // launch the next idea in a brand-new session. (The model cannot self-`/quit`
      // an interactive session, so the operator presses `/quit` once per idea.)
      let lastCode = 0;
      for (;;) {
        try {
          lastCode = await launchOne();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          printErr(
            `engineer: could not launch an interactive Claude session (${msg}). ` +
              'Is the `claude` CLI installed and on your PATH?',
          );
          printGuide(print);
          return 1;
        }
        if (!(await confirmAnother())) return lastCode;
        print(''); // visual spacer before the next fresh session
      }
    }

    // ── guide ─────────────────────────────────────────────────────────────────
    case 'guide': {
      printGuide(print);
      return 0;
    }

    // ── projects ──────────────────────────────────────────────────────────────
    case 'projects': {
      const reader = createRegistryReader(registryPath ? { registryPath } : {});
      const projects = await reader.listProjects();
      print(JSON.stringify(projects));
      return 0;
    }

    // ── land ──────────────────────────────────────────────────────────────────
    case 'land': {
      const { project: projectName, idea } = dispatch;
      const reader = createRegistryReader(registryPath ? { registryPath } : {});
      const allProjects = await reader.listProjects();
      const record = allProjects.find((p) => p.name === projectName);
      if (!record) {
        printErr(`engineer land: project "${projectName}" not found in registry.`);
        return 1;
      }

      let target: Awaited<ReturnType<typeof resolveTargetRepo>>;
      try {
        target = await resolveTargetRepo(record.path, reader);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        printErr(`engineer land: ${msg}`);
        return 1;
      }

      let result: Awaited<ReturnType<typeof landSpec>>;
      try {
        result = await landSpec({ name: target.name, canonicalPath: target.canonicalPath }, idea);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        printErr(`engineer land: ${msg}`);
        return 1;
      }

      print(JSON.stringify(result));
      return 0;
    }

    // ── handoff ───────────────────────────────────────────────────────────────
    case 'handoff': {
      const { project: projectName, branch } = dispatch;
      const reader = createRegistryReader(registryPath ? { registryPath } : {});
      const allProjects = await reader.listProjects();
      const record = allProjects.find((p) => p.name === projectName);
      if (!record) {
        printErr(`engineer handoff: project "${projectName}" not found in registry.`);
        return 1;
      }

      let target: Awaited<ReturnType<typeof resolveTargetRepo>>;
      try {
        target = await resolveTargetRepo(record.path, reader);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        printErr(`engineer handoff: ${msg}`);
        return 1;
      }

      let handoffResult: Awaited<ReturnType<typeof openSpecPr>>;
      try {
        handoffResult = await openSpecPr(target, branch, {
          runner: async (args, runnerOpts) => {
            const cwd = runnerOpts?.cwd ?? target.canonicalPath;
            const r = await gh(args, { cwd });
            return { stdout: r.stdout, stderr: '' };
          },
          ledgerOpts: engineerDir ? { engineerDir } : {},
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        printErr(`engineer handoff: PR open failed: ${msg}`);
        // Non-fatal: fall through to local-commit result.
        print(JSON.stringify({ kind: 'local-commit', branch, repoPath: target.canonicalPath }));
        return 0;
      }

      if (handoffResult.kind === 'pr-opened') {
        print(JSON.stringify({ kind: 'pr-opened', url: handoffResult.url }));
      } else {
        // pr-skipped — record authored key manually (openSpecPr already records on skip).
        print(
          JSON.stringify({
            kind: 'local-commit',
            branch,
            repoPath: target.canonicalPath,
            reason: (handoffResult as { kind: 'pr-skipped'; reason: string }).reason,
          }),
        );
      }

      // Fire-and-forget ensureRunning. NEVER blocks on failure.
      try {
        const launchFn = opts.ensureRunningLaunch;
        if (launchFn) {
          await Promise.resolve(launchFn(target.canonicalPath));
        } else {
          await ensureRunning(target.canonicalPath, {});
        }
      } catch {
        // Swallow: ensure-running failure must never abort handoff.
      }

      return 0;
    }
  }
}
