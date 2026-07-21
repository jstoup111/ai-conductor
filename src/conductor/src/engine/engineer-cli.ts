// `conduct-ts engineer` command handler (Phase 9.3, ADR-008 conformance rework).
//
// AGENT-HOSTED EXECUTION MODEL (ADR-008):
//   The engineer subsystem is driven by the /engineer host-agent skill in a Claude
//   Code session. The bare `conduct-ts engineer` command is the FRONT DOOR: it launches
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
//   conduct-ts engineer               → {kind:'launch'}   — launch interactive `claude /engineer`
//   conduct-ts engineer projects      → {kind:'projects'} — list registry to stdout as JSON
//   conduct-ts engineer land          → {kind:'land'}     — commit pre-written artifacts to spec branch
//   conduct-ts engineer handoff       → {kind:'handoff'}  — open spec PR + ensureRunning
//   (malformed subcommand / missing flags → {kind:'guide'} — print usage)

import { execFile as execFileCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { EngineerIO, EngineerDeps } from './engineer/loop.js';
import { createRegistryReader } from './registry.js';
import { resolveEngineerDir } from './engineer-store.js';
import { resolveTargetRepo } from './engineer/target.js';
import { landSpec } from './engineer/land-spec.js';
import { loadConfig } from './config.js';
import { readMachineOwnerConfig } from './owner-gate/machine-identity.js';
import { resolveDaemonOwner } from './owner-gate/identity.js';
import { openSpecPr } from './engineer/handoff.js';
import {
  createEngineerWorktree,
  removeEngineerWorktree,
} from './engineer/worktree-authoring.js';
import { recordAuthoredKey } from './engineer/authored-ledger.js';
import { ensureRunning } from './daemon-lock.js';
// The CLI is the composition root for the github-issues intake adapter — the
// engineer loop must NOT import a concrete adapter (FR-13), but the CLI must.
import { brainLoopAlive } from './engineer/brain-liveness.js';
import { createLedger } from './engineer/intake/ledger.js';
import { createFileQueue } from './engineer/intake/queue.js';
import { createGithubIssuesAdapter, GITHUB_ISSUES_SOURCE, HANDLED_LABEL } from './engineer/intake/github-issues.js';
import { reportRouted, reportDone } from './engineer/intake/writeback.js';
import { restRemoveLabelArgs } from './pr-labels.js';
import {
  claimUnblocked,
  resolveClaimBands,
  type DependencyClaimQueue,
} from './engineer/intake/dependency-claim.js';
import type { Envelope } from './engineer/intake/port.js';
import { createBlockerResolver } from './blocker-resolver.js';
import { ghIssueLabelReader } from './backlog-priority.js';
import { createDeliveryGuardedQueue } from './engineer/intake/delivery-guard.js';
import { parseDependencyProse, createDependencyLinks, runMigration } from './engineer/issue-dep-migration.js';

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

/**
 * Production complexity-assessment seam: gates the tier through the io surface.
 * Presents the prompt and waits for the operator to provide S/M/L. An empty or
 * unparseable response → rejected (blocks authoring). NO claude subprocess.
 */
function makeProductionAssessComplexity(
  io: EngineerIO,
): NonNullable<EngineerDeps['assessComplexity']> {
  return async ({ idea, project, recommended }) => {
    io.print(`\n── DECIDE: complexity — project "${project}" — idea: ${idea}`);
    if (recommended) io.print(`Recommended tier: ${recommended}`);
    io.print('Provide the complexity tier (S, M, or L; empty = reject, blocks authoring):');
    const line = await io.prompt();
    const m = (line ?? '').trim().match(/^([SMLsml])/);
    if (!m) return { approved: false, tier: recommended ?? 'M' };
    return { approved: true, tier: m[1].toUpperCase() as 'S' | 'M' | 'L' };
  };
}

const execFileP = promisify(execFileCb);

// ── Dispatch descriptor ───────────────────────────────────────────────────────

export type EngineerDispatch =
  | { kind: 'launch'; idea?: string }
  | { kind: 'guide' }
  | { kind: 'projects' }
  | { kind: 'worktree'; project: string; idea: string }
  | { kind: 'land'; project: string; idea: string; worktree: string; sourceRef?: string }
  | { kind: 'handoff'; project: string; branch: string; worktree: string; sourceRef?: string }
  | { kind: 'poll' }
  | { kind: 'claim' }
  | { kind: 'forget'; sourceRef: string }
  | { kind: 'resolve'; sourceRef: string; prUrl: string; branch?: string }
  | { kind: 'migrate-issue-deps'; confirm: boolean }
  | { kind: 'reject'; sub: string; flag: string }
  | { kind: 'help'; topic: string };

/** Single source of truth for the known deterministic subcommands (#524). */
export const ENGINEER_SUBCOMMANDS = [
  'projects', 'worktree', 'land', 'handoff', 'poll', 'claim', 'forget', 'resolve',
  'migrate-issue-deps',
] as const;

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
/** First argv token (from index 4) starting with `--` that isn't in `allowed`
 * and isn't `--help`/`-h` (already handled earlier) — or null if none. */
function findUnknownFlag(argv: string[], allowed: string[]): string | null {
  for (let i = 4; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--') && tok !== '--help' && !allowed.includes(tok)) return tok;
  }
  return null;
}

export function detectEngineerCommand(argv: string[]): EngineerDispatch | null {
  // argv is process.argv: [node, entry, sub, ...]
  const sub = argv[2];
  if (sub !== 'engineer') return null;

  const subCmd = argv[3];

  if (!subCmd || subCmd === '') {
    // Bare `conduct-ts engineer` → launch the interactive host-agent loop.
    return { kind: 'launch' };
  }

  // #524: --help/-h MUST be checked BEFORE any subcommand's own dispatch logic —
  // mirrors the `daemon --help` guard in index.ts:378-388 (same failure class:
  // otherwise the flag is silently ignored and the subcommand actually executes).
  const KNOWN_SUBCOMMANDS = new Set<string>(ENGINEER_SUBCOMMANDS);
  if (KNOWN_SUBCOMMANDS.has(subCmd) && argv.slice(4).some((a) => a === '--help' || a === '-h')) {
    return { kind: 'help', topic: subCmd };
  }

  if (subCmd === 'projects') {
    const unk = findUnknownFlag(argv, []);
    if (unk) return { kind: 'reject', sub: 'projects', flag: unk };
    return { kind: 'projects' };
  }

  if (subCmd === 'worktree') {
    // `conduct-ts engineer worktree --project <n> --idea "<i>"` — create the per-idea
    // worktree for authoring; prints `{ slug, branch, worktreePath, reconcile }`.
    const project = parseFlag(argv, '--project');
    const idea = parseFlag(argv, '--idea');
    if (!project || !idea) {
      return { kind: 'guide' };
    }
    const unk = findUnknownFlag(argv, ['--project', '--idea']);
    if (unk) return { kind: 'reject', sub: 'worktree', flag: unk };
    return { kind: 'worktree', project, idea };
  }

  if (subCmd === 'land') {
    const project = parseFlag(argv, '--project');
    const idea = parseFlag(argv, '--idea');
    const worktree = parseFlag(argv, '--worktree');
    if (!project || !idea || !worktree) {
      // Missing required flags — treat as guide. `--worktree` is REQUIRED: landSpec
      // never falls back to the primary checkout (strict isolation, FR-7).
      return { kind: 'guide' };
    }
    // Optional intake write-back anchor — present when the idea came from an
    // intake envelope (github-issues). Absent for human-typed ideas.
    const sourceRef = parseFlag(argv, '--source-ref') ?? undefined;
    const unk = findUnknownFlag(argv, ['--project', '--idea', '--worktree', '--source-ref']);
    if (unk) return { kind: 'reject', sub: 'land', flag: unk };
    return { kind: 'land', project, idea, worktree, sourceRef };
  }

  if (subCmd === 'handoff') {
    const project = parseFlag(argv, '--project');
    const branch = parseFlag(argv, '--branch');
    const worktree = parseFlag(argv, '--worktree');
    if (!project || !branch || !worktree) {
      return { kind: 'guide' };
    }
    const sourceRef = parseFlag(argv, '--source-ref') ?? undefined;
    const unk = findUnknownFlag(argv, ['--project', '--branch', '--worktree', '--source-ref']);
    if (unk) return { kind: 'reject', sub: 'handoff', flag: unk };
    return { kind: 'handoff', project, branch, worktree, sourceRef };
  }

  if (subCmd === 'poll') {
    // `conduct-ts engineer poll` — poll intake sources and enqueue; no routing/process.
    const unk = findUnknownFlag(argv, []);
    if (unk) return { kind: 'reject', sub: 'poll', flag: unk };
    return { kind: 'poll' };
  }

  if (subCmd === 'claim') {
    // `conduct-ts engineer claim` — atomically dequeue the oldest pending idea.
    const unk = findUnknownFlag(argv, []);
    if (unk) return { kind: 'reject', sub: 'claim', flag: unk };
    return { kind: 'claim' };
  }

  if (subCmd === 'forget') {
    // `conduct-ts engineer forget <sourceRef>` — drop a ledger entry + strip the label.
    const sourceRef = argv[4];
    if (!sourceRef || sourceRef.startsWith('--')) {
      return { kind: 'guide' };
    }
    const unk = findUnknownFlag(argv, []);
    if (unk) return { kind: 'reject', sub: 'forget', flag: unk };
    return { kind: 'forget', sourceRef };
  }

  if (subCmd === 'resolve') {
    // `conduct-ts engineer resolve <sourceRef> --pr-url <url> [--branch <b>]` — mark
    // a claimed entry as delivered when write-back fails. Recovers from the stranded
    // state (claimed + no prUrl) by stamping prUrl + optional branch evidence.
    // The sourceRef is the first positional arg that doesn't start with --.
    let sourceRef: string | null = null;
    for (let i = 4; i < argv.length; i++) {
      if (!argv[i].startsWith('--')) {
        sourceRef = argv[i];
        break;
      }
      // Skip flag values (if argv[i] is a flag, skip the value too)
      if (argv[i].startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        i += 1;
      }
    }
    if (!sourceRef) {
      return { kind: 'guide' };
    }
    const prUrl = parseFlag(argv, '--pr-url');
    if (!prUrl) {
      return { kind: 'guide' };
    }
    const branch = parseFlag(argv, '--branch') ?? undefined;
    const unk = findUnknownFlag(argv, ['--pr-url', '--branch']);
    if (unk) return { kind: 'reject', sub: 'resolve', flag: unk };
    return { kind: 'resolve', sourceRef, prUrl, branch };
  }

  if (subCmd === 'migrate-issue-deps') {
    // `conduct-ts engineer migrate-issue-deps [--confirm]` — one-time prose→link
    // migration (Task 22-25). Dry-run by default (proposal only, zero writes);
    // `--confirm` applies via the GET-before-POST writer.
    const unk = findUnknownFlag(argv, ['--confirm']);
    if (unk) return { kind: 'reject', sub: 'migrate-issue-deps', flag: unk };
    const confirm = argv.includes('--confirm');
    return { kind: 'migrate-issue-deps', confirm };
  }

  // `conduct-ts engineer --idea "<text>"` — launch driving a specific idea.
  if (subCmd === '--idea') {
    const idea = parseFlag(argv, '--idea');
    if (!idea) return { kind: 'guide' };
    return { kind: 'launch', idea };
  }

  // A bare non-flag positional is free-text idea input:
  //   `conduct-ts engineer add a /healthz endpoint`
  // (Recognized subcommands are handled above, so this cannot shadow them.)
  if (!subCmd.startsWith('--')) {
    const idea = argv.slice(3).join(' ').trim();
    if (idea) return { kind: 'launch', idea };
  }

  // Unknown flag-form / empty — treat as guide.
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
   * Receives the resolved one-shot idea (CLI-supplied) for the first session, if any.
   */
  launchInteractive?: (idea?: string) => number | Promise<number>;
  /**
   * Injected pre-poll hook (for tests). When provided, the 'launch' kind calls this
   * before each fresh session (unless a CLI idea was supplied) to prime the intake
   * inbox, and prints `Intake: N issue(s) queued.` for N>0. Defaults to a real
   * github-issues sweep ONLY on the production spawn path (i.e. when launchInteractive
   * is NOT injected), so tests that stub the launcher never hit the network.
   */
  prePoll?: () => number | Promise<number>;
  /**
   * Injected brain-loop liveness check (for tests). When it returns true, the
   * production default `prePoll` is skipped entirely (the launcher defers to the
   * live brain loop — single-writer gate). Defaults to the real `brainLoopAlive()`
   * (pidfile or `cc-brain-*` tmux session). Ignored when `prePoll` is injected
   * directly.
   */
  brainLoopAlive?: () => boolean;
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
export function engineerLaunchArgs(env: NodeJS.ProcessEnv = process.env, idea?: string): string[] {
  const requested = (env.CONDUCT_ENGINEER_PERMISSION_MODE || '').trim();
  const mode = requested && requested !== 'plan' ? requested : 'default';
  // The slash command is the initial prompt; a CLI-supplied idea is appended so
  // the skill receives it directly instead of prompting in chat. With no idea the
  // prompt is exactly `/engineer` (backward-compatible).
  const trimmed = (idea ?? '').trim();
  const prompt = trimmed ? `/engineer ${trimmed}` : '/engineer';
  return ['--permission-mode', mode, prompt];
}

/**
 * Default interactive launcher: drop the operator into `claude /engineer`, inheriting
 * the terminal so the human drives the loop. Resolves with the child's exit code.
 * Rejects on spawn error (e.g. `claude` not on PATH) so the caller can fall back.
 */
function launchClaudeEngineer(cwd: string, idea?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', engineerLaunchArgs(process.env, idea), { stdio: 'inherit', cwd });
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

/** Parse owner/repo from a remote URL (SSH or HTTPS). */
function parseGhRepo(remote: string): string | null {
  if (!remote) return null;
  // Matches both git@github.com:owner/repo.git and https://github.com/owner/repo.git
  const m = remote.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return m ? m[1] : null;
}

/**
 * Per-subcommand `--help`/`-h` text (#524). Each entry states: what the subcommand
 * does, its flags (required vs optional), what durable state it mutates (or that
 * it is read-only), and where it sits in the idea→spec loop (claim → worktree →
 * land → handoff → resolve/forget; poll/migrate-issue-deps are out-of-band
 * maintenance ops).
 */
export const SUBCOMMAND_HELP = {
  projects:
    'engineer projects — list the registered projects from the project registry.\n' +
    'Flags: none.\n' +
    'Mutates: nothing (read-only).\n' +
    'Loop fit: informational only — inspect which projects the engineer can route ideas to; not a step in the claim → worktree → land → handoff → resolve/forget loop.',
  worktree:
    'engineer worktree --project <name> --idea "<idea>" — create the per-idea worktree used to author a spec.\n' +
    'Flags: --project <name> (required), --idea "<text>" (required).\n' +
    'Mutates: creates a git worktree and branch on disk for the project.\n' +
    'Loop fit: second step of the loop — claim → worktree → land → handoff → resolve/forget.',
  land:
    'engineer land --project <name> --idea "<idea>" --worktree <path> [--source-ref <ref>] — land the authored spec from the worktree onto the spec/<slug> branch and open the spec PR.\n' +
    'Flags: --project <name> (required), --idea "<text>" (required), --worktree <path> (required — strict isolation, never falls back to the primary checkout), --source-ref <ref> (optional — intake write-back anchor for github-issues-sourced ideas).\n' +
    'Mutates: commits to the worktree, pushes the spec/<slug> branch, opens a PR.\n' +
    'Loop fit: third step — claim → worktree → land → handoff → resolve/forget.',
  handoff:
    'engineer handoff --project <name> --branch <branch> --worktree <path> [--source-ref <ref>] — hand the landed spec off to the daemon/build phase.\n' +
    'Flags: --project <name> (required), --branch <branch> (required), --worktree <path> (required), --source-ref <ref> (optional — intake write-back anchor).\n' +
    'Mutates: notifies/nudges the daemon for the target project; updates ledger write-back state when --source-ref is present.\n' +
    'Loop fit: fourth step — claim → worktree → land → handoff → resolve/forget.',
  poll:
    'engineer poll — poll configured intake sources (e.g. github-issues) and enqueue new ideas into the durable inbox.\n' +
    'Flags: none.\n' +
    'Mutates: writes new envelopes to the file-backed inbox queue.\n' +
    'Loop fit: out-of-band maintenance op — primes the inbox but is not itself a step in claim → worktree → land → handoff → resolve/forget.',
  claim:
    'engineer claim — atomically dequeue the oldest pending idea from the inbox for the operator to work.\n' +
    'Flags: none.\n' +
    'Mutates: dequeues from the inbox and records a claimed entry in the ledger.\n' +
    'Loop fit: first step of the loop — claim → worktree → land → handoff → resolve/forget.',
  forget:
    'engineer forget <sourceRef> — drop a ledger entry and strip its intake label.\n' +
    'Flags: <sourceRef> positional (required, must not start with --).\n' +
    'Mutates: removes the entry from the ledger and strips the source label (e.g. on the GitHub issue).\n' +
    'Loop fit: terminal step — claim → worktree → land → handoff → resolve/forget (abandon path, alternative to resolve).',
  resolve:
    'engineer resolve <sourceRef> --pr-url <url> [--branch <branch>] — mark a claimed ledger entry as delivered when the normal write-back failed.\n' +
    'Flags: <sourceRef> positional (required), --pr-url <url> (required, must be http:// or https://), --branch <branch> (optional).\n' +
    'Mutates: stamps the ledger entry with prUrl (and branch, if given), recovering from a stranded claimed-but-undelivered state.\n' +
    'Loop fit: terminal step — claim → worktree → land → handoff → resolve/forget (recovery path, alternative to forget).',
  'migrate-issue-deps':
    'engineer migrate-issue-deps [--confirm] — one-time migration of prose-based issue dependency references to structured links.\n' +
    'Flags: --confirm (optional — without it, dry-run only: proposes changes with zero writes; with it, applies via the GET-before-POST writer).\n' +
    'Mutates: nothing by default (dry-run); with --confirm, updates issue bodies/links on the source tracker.\n' +
    'Loop fit: out-of-band maintenance op, not a step in claim → worktree → land → handoff → resolve/forget.',
} satisfies Record<(typeof ENGINEER_SUBCOMMANDS)[number], string>;

/** Print the engineer usage/guide text (front door + deterministic primitives). */
function printGuide(print: (s: string) => void): void {
  print(
    'The engineer is the agent-hosted idea→spec loop. Run `conduct-ts engineer` (no\n' +
      'subcommand) to drop into an interactive `claude /engineer` session and drive it\n' +
      'with a human in the loop. The subcommands below are the deterministic primitives\n' +
      'the /engineer skill calls in-chat:\n' +
      '\n' +
      '  conduct-ts engineer                                     — launch the interactive /engineer loop (pre-polls intake)\n' +
      '  conduct-ts engineer --idea "<text>"                     — launch driving a specific idea (skips intake poll)\n' +
      '  conduct-ts engineer projects                            — list registered projects\n' +
      '  conduct-ts engineer claim                               — dequeue the oldest pending intake idea (JSON)\n' +
      '  conduct-ts engineer worktree --project <n> --idea "<i>"                     — create the per-idea authoring worktree\n' +
      '  conduct-ts engineer land --project <n> --idea "<i>" --worktree <p> [--source-ref <ref>]    — commit spec artifacts in the worktree\n' +
      '  conduct-ts engineer handoff --project <n> --branch <b> --worktree <p> [--source-ref <ref>] — open spec PR + remove worktree + nudge daemon\n' +
      '  conduct-ts engineer resolve <ref> --pr-url <url> [--branch <b>]              — mark a claimed entry as delivered (recovery from write-back failure)\n' +
      '  conduct-ts engineer poll                                — poll github issues → enqueue new ideas\n' +
      '  conduct-ts engineer forget <owner/repo#N>               — drop an intake ledger entry + label\n' +
      '  conduct-ts engineer migrate-issue-deps [--confirm]      — one-time prose→link dependency migration ' +
      '(dry-run by default; --confirm writes)\n',
  );
}

// Construct the real gh runner used in production. Exported so other
// composition roots (e.g. the intake-loop CLI, Task 17) can reuse the exact
// same production `gh` wiring without duplicating it.
export function makeProductionGh(): NonNullable<DispatchEngineerOpts['gh']> {
  return async (args: string[], opts: { cwd: string }) => {
    const result = await execFileP('gh', args, { cwd: opts.cwd });
    return { stdout: String(result.stdout) };
  };
}

/**
 * Composition root for the github-issues intake: wires the registry reader, the
 * durable ledger + file queue, and the adapter (IntakeSource + IntakePort) over an
 * injected gh runner. The engineer loop must NOT import a concrete adapter (FR-13);
 * the CLI is the only place that may. Shared by `poll`, `claim`, the launch pre-poll,
 * and the `--source-ref` write-back on `land`/`handoff`.
 *
 * Exported (Task 17) so the production `intake-loop` CLI dispatch can reuse
 * this exact composition root instead of duplicating adapter wiring.
 */
export function buildIntake(deps: {
  engineerDir: string;
  registryPath?: string;
  gh: NonNullable<DispatchEngineerOpts['gh']>;
  printErr: (s: string) => void;
}): {
  reader: ReturnType<typeof createRegistryReader>;
  ledger: ReturnType<typeof createLedger>;
  queue: ReturnType<typeof createFileQueue>;
  adapter: ReturnType<typeof createGithubIssuesAdapter>;
} {
  const reader = createRegistryReader(deps.registryPath ? { registryPath: deps.registryPath } : {});
  const ledger = createLedger(join(deps.engineerDir, 'ledger.json'));
  const queue = createFileQueue(join(deps.engineerDir, 'inbox'));
  const adapter = createGithubIssuesAdapter({
    gh: deps.gh,
    registry: {
      list: async () =>
        (await reader.listProjects()).map((p) => ({
          name: p.remote ? parseGhRepo(p.remote) ?? p.name : p.name,
          ghRepo: p.remote ? parseGhRepo(p.remote) ?? undefined : undefined,
          path: p.path,
        })),
    },
    ledger,
    log: (m: string) => deps.printErr(m),
  });
  return { reader, ledger, queue, adapter };
}

/**
 * Pre-poll the github-issues source and enqueue new ideas into the durable inbox,
 * returning the count enqueued. This is the launch-time half of intake: the bare
 * `conduct-ts engineer` primes the inbox here so the spawned `claude /engineer`
 * session can `claim` an idea instead of starting blank. Idempotent — the ledger
 * dedups, so a re-poll enqueues nothing new. Exported for direct testing.
 */
export async function prePollIntake(deps: {
  engineerDir: string;
  registryPath?: string;
  gh: NonNullable<DispatchEngineerOpts['gh']>;
  printErr: (s: string) => void;
}): Promise<number> {
  const { queue, adapter } = buildIntake(deps);
  const envelopes = await adapter.poll();
  for (const e of envelopes) {
    await queue.enqueue(e);
  }
  return envelopes.length;
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
    // Bare `conduct-ts engineer`: drop the operator into the interactive /engineer loop.
    case 'launch': {
      const launchOne =
        opts.launchInteractive ?? ((idea?: string) => launchClaudeEngineer(process.cwd(), idea));
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

      // Intake pre-poll: prime the durable inbox before launching so the spawned
      // /engineer session can `claim` a github-issue idea. Defaults to a real sweep
      // only on the production spawn path (launchInteractive not injected) so tests
      // that stub the launcher never hit the network. A CLI-supplied idea drives a
      // specific idea and skips polling. Best-effort — a poll failure never blocks
      // the launch.
      // Single-writer gate (ADR Q2): when a background brain loop is already
      // running, it owns intake polling — the interactive launcher's pre-poll
      // defers to it rather than racing to enqueue/dedup against the same ledger.
      const brainAlive = (opts.brainLoopAlive ?? brainLoopAlive)();
      const prePoll =
        opts.prePoll ??
        (opts.launchInteractive || brainAlive
          ? undefined
          : () =>
              prePollIntake({
                engineerDir: engineerDir ?? resolveEngineerDir({}),
                registryPath,
                gh,
                printErr,
              }));

      // Outer loop: ONE fresh `claude /engineer` session per idea, so each idea
      // starts with clean context. Durable state (registry, lessons, processed
      // markers) is file-backed, so a fresh process loses nothing. The skill delivers
      // a single idea's spec then asks the operator to `/quit`; on exit we offer to
      // launch the next idea in a brand-new session. (The model cannot self-`/quit`
      // an interactive session, so the operator presses `/quit` once per idea.)
      //
      // The CLI-supplied idea is one-shot: it drives only the FIRST session; later
      // loop iterations fall back to intake/chat (pendingIdea cleared after use).
      let pendingIdea = dispatch.idea;
      let lastCode = 0;
      for (;;) {
        if (!pendingIdea && prePoll) {
          try {
            const n = await prePoll();
            if (n > 0) print(`Intake: ${n} issue(s) queued.`);
          } catch (err: unknown) {
            // Best-effort: intake must never block the interactive loop.
            printErr(
              `engineer: intake pre-poll failed (${err instanceof Error ? err.message : String(err)}) — continuing.`,
            );
          }
        }
        try {
          lastCode = await launchOne(pendingIdea);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          printErr(
            `engineer: could not launch an interactive Claude session (${msg}). ` +
              'Is the `claude` CLI installed and on your PATH?',
          );
          printGuide(print);
          return 1;
        }
        pendingIdea = undefined; // CLI idea is one-shot — next session is intake/chat driven.
        if (!(await confirmAnother())) return lastCode;
        print(''); // visual spacer before the next fresh session
      }
    }

    // ── guide ─────────────────────────────────────────────────────────────────
    case 'guide': {
      printGuide(print);
      return 0;
    }

    // ── reject ────────────────────────────────────────────────────────────────
    // Unknown flag on a zero/boolean-flag subcommand (#524 Story 3): fail fast
    // rather than silently ignoring the flag and running the subcommand anyway.
    case 'reject': {
      printErr(
        `engineer ${dispatch.sub}: unknown flag '${dispatch.flag}' — run \`engineer ${dispatch.sub} --help\` for usage.`,
      );
      return 1;
    }

    // ── help ──────────────────────────────────────────────────────────────────
    // Per-subcommand `--help`/`-h` (#524): zero side effects, single print.
    case 'help': {
      print(SUBCOMMAND_HELP[dispatch.topic as keyof typeof SUBCOMMAND_HELP] ?? '');
      return 0;
    }

    // ── projects ──────────────────────────────────────────────────────────────
    case 'projects': {
      const reader = createRegistryReader(registryPath ? { registryPath } : {});
      const projects = await reader.listProjects();
      print(JSON.stringify(projects));
      return 0;
    }

    // ── worktree ────────────────────────────────────────────────────────────────
    // `conduct-ts engineer worktree --project <n> --idea "<i>"`: create the per-idea
    // isolated worktree the skill authors + lands in. Strict-abort (FR-7): a failure
    // makes zero mutation to the primary tree and returns exit 1. Prints
    // `{ slug, branch, worktreePath, reconcile }` on success.
    case 'worktree': {
      const { project: projectName, idea } = dispatch;
      const reader = createRegistryReader(registryPath ? { registryPath } : {});
      const allProjects = await reader.listProjects();
      const record = allProjects.find((p) => p.name === projectName);
      if (!record) {
        printErr(`engineer worktree: project "${projectName}" not found in registry.`);
        return 1;
      }

      let target: Awaited<ReturnType<typeof resolveTargetRepo>>;
      try {
        target = await resolveTargetRepo(record.path, reader);
      } catch (err: unknown) {
        printErr(`engineer worktree: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }

      try {
        const wt = await createEngineerWorktree(target.canonicalPath, idea, (m) => printErr(m));
        print(JSON.stringify({ kind: 'worktree', ...wt }));
        return 0;
      } catch (err: unknown) {
        printErr(`engineer worktree: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }
    }

    // ── land ──────────────────────────────────────────────────────────────────
    case 'land': {
      const { project: projectName, idea, worktree, sourceRef } = dispatch;
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

      // Owner-gate (adr-2026-06-30-*): the daemon that later builds this spec
      // resolves ITS owner from the machine config (`spec_owner`), so stamp the
      // spec with the SAME source here. Read the machine config for `ownerConfig`
      // (D1) and thread the in-scope `gh` runner for the login fallback; landSpec
      // resolves configured spec_owner → gh login → un-owned (omits the `Owner:`
      // line). Reading from the user config never crashes the land.
      // ADR-1 naming: `ownerConfig`/`specOwner`, never a bare `owner`.
      const ownerConfig = await readMachineOwnerConfig();

      // Fail-fast identity check (Slice B Story 1): resolve the identity chain
      // BEFORE entering landSpec. If unresolved, exit immediately with actionable
      // error and do NOT proceed to landSpec (which would commit a spec with no
      // owner stamping).
      const identity = await resolveDaemonOwner(ownerConfig, gh, target.canonicalPath);
      if (!identity.resolved) {
        printErr(
          'Cannot land spec: identity unresolved. Resolve one of:\n' +
          '  1. Set spec_owner in ~/.ai-conductor/config.yml\n' +
          '  2. Authenticate via: gh auth login',
        );
        return 1;
      }

      let result: Awaited<ReturnType<typeof landSpec>>;
      try {
        result = await landSpec(
          { name: target.name, canonicalPath: target.canonicalPath },
          idea,
          worktree,
          sourceRef,
          { ownerConfig, gh },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Keep-on-failure (FR-6): the per-idea worktree is retained for inspection —
        // report WHERE it is so retention is actionable, not silent clutter.
        printErr(`engineer land: ${msg}`);
        printErr(`engineer land: worktree kept for inspection at "${worktree}".`);
        return 1;
      }

      // Intake write-back (FR-36): when this idea originated from a github issue,
      // comment "Routed to <repo>" and advance the ledger to `routed`. Advisory —
      // a gh failure never fails a successful land.
      if (sourceRef) {
        const engDir = engineerDir ?? resolveEngineerDir({});
        const { ledger, adapter } = buildIntake({ engineerDir: engDir, registryPath, gh, printErr });
        await reportRouted(
          { source: GITHUB_ISSUES_SOURCE, sourceRef, port: adapter, ledger },
          target.name,
        );
      }

      print(JSON.stringify(result));
      return 0;
    }

    // ── handoff ───────────────────────────────────────────────────────────────
    case 'handoff': {
      const { project: projectName, branch, worktree, sourceRef } = dispatch;
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
            const cwd = runnerOpts?.cwd ?? worktree;
            const r = await gh(args, { cwd });
            return { stdout: r.stdout, stderr: '' };
          },
          // gh runs in the per-idea worktree (checked out on spec/<slug>) — FR-4.
          worktreePath: worktree,
          ledgerOpts: engineerDir ? { engineerDir } : {},
          // Link the spec PR to its issue with a non-closing `Refs` (does not
          // close — the daemon's implementation PR closes it on merge).
          sourceRef,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        printErr(`engineer handoff: PR open failed: ${msg}`);
        // Handoff FAILED (e.g. no PR URL parsed): keep the worktree for inspection
        // (FR-6) — do NOT remove it. Work is preserved on the branch; report the
        // retained worktree path so retention is actionable.
        printErr(`engineer handoff: worktree kept for inspection at "${worktree}".`);

        // Task 9: Record branch evidence in the ledger if sourceRef is present.
        // This enables the operator to retry via `engineer resolve` if the write-back
        // fails. Non-fatal: if the ledger write fails, continue with exit 0.
        if (sourceRef) {
          try {
            const engDir = engineerDir ?? resolveEngineerDir({});
            const ledger = createLedger(join(engDir, 'ledger.json'));
            const entry = await ledger.get(GITHUB_ISSUES_SOURCE, sourceRef);
            if (entry) {
              await ledger.transition(GITHUB_ISSUES_SOURCE, sourceRef, entry.status, {
                branch,
                ...(entry.prUrl ? { prUrl: entry.prUrl } : {}),
              });
            }
          } catch (e: unknown) {
            printErr(
              `Failed to record branch evidence: ${e instanceof Error ? e.message : String(e)}`,
            );
            // Continue — handoff still succeeds
          }
        }

        print(
          JSON.stringify({
            kind: 'local-commit',
            branch,
            repoPath: target.canonicalPath,
            worktreePath: worktree,
          }),
        );
        return 0;
      }

      // The PR opened (or was skipped on no-remote) — the cycle succeeded, so remove
      // the per-idea worktree (FR-5). The spec/<slug> branch + commit persist; a
      // removal failure is REPORTED, never swallowed (FR-5 negative).
      try {
        await removeEngineerWorktree(target.canonicalPath, worktree);
      } catch (err: unknown) {
        printErr(
          `⚠ Spec delivered, but the per-idea worktree "${worktree}" could not be removed: ` +
            `${err instanceof Error ? err.message : String(err)}. Remove it manually.`,
        );
      }

      if (handoffResult.kind === 'pr-opened') {
        print(JSON.stringify({ kind: 'pr-opened', url: handoffResult.url }));
        // Intake write-back (FR-36): a real spec PR was opened — comment its URL,
        // apply `engineer:handled`, and advance the ledger to `done`. Advisory —
        // a gh failure never reverts a delivered PR. Only on a PR (not local-commit,
        // which has no URL to report).
        if (sourceRef) {
          const engDir = engineerDir ?? resolveEngineerDir({});
          const { ledger, adapter } = buildIntake({ engineerDir: engDir, registryPath, gh, printErr });
          await reportDone(
            { source: GITHUB_ISSUES_SOURCE, sourceRef, port: adapter, ledger },
            handoffResult.url,
            branch,
          );
        }
      } else {
        // pr-skipped — record authored key manually (openSpecPr already records on skip).
        // Task 9: Also record branch evidence in the ledger if sourceRef is present.
        if (sourceRef) {
          try {
            const engDir = engineerDir ?? resolveEngineerDir({});
            const ledger = createLedger(join(engDir, 'ledger.json'));
            const entry = await ledger.get(GITHUB_ISSUES_SOURCE, sourceRef);
            if (entry) {
              await ledger.transition(GITHUB_ISSUES_SOURCE, sourceRef, entry.status, {
                branch,
                ...(entry.prUrl ? { prUrl: entry.prUrl } : {}),
              });
            }
          } catch (e: unknown) {
            printErr(
              `Failed to record branch evidence: ${e instanceof Error ? e.message : String(e)}`,
            );
            // Continue — handoff still succeeds
          }
        }

        print(
          JSON.stringify({
            kind: 'local-commit',
            branch,
            repoPath: target.canonicalPath,
            reason: (handoffResult as { kind: 'pr-skipped'; reason: string }).reason,
          }),
        );
      }

      // Fire-and-forget ensureRunning. NEVER blocks on failure — but never silent:
      // the ADR-014 launch path hosts the daemon in a tmux session, so a tmux-less
      // host throws TmuxNotInstalledError here. Swallowing it would author the spec
      // while launching no daemon (specs pile up unbuilt with no signal). Surface
      // the reason on stderr; the handoff still succeeds.
      try {
        const launchFn = opts.ensureRunningLaunch;
        if (launchFn) {
          await Promise.resolve(launchFn(target.canonicalPath));
        } else {
          await ensureRunning(target.canonicalPath, {});
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        printErr(
          `⚠ Spec authored, but the build daemon was not started for "${target.name}": ${reason}`,
        );
      }

      return 0;
    }

    // ── poll ────────────────────────────────────────────────────────────────────
    // `conduct-ts engineer poll`: poll the github-issues source across registered
    // repos and enqueue new envelopes into the durable inbox. NO routing, NO
    // processing, NO setInterval/detached spawn — a single synchronous sweep. The
    // ledger dedups, so a double-poll enqueues nothing new.
    case 'poll': {
      const engDir = engineerDir ?? resolveEngineerDir({});
      const { queue, adapter } = buildIntake({ engineerDir: engDir, registryPath, gh, printErr });

      const envelopes = await adapter.poll();
      for (const e of envelopes) {
        await queue.enqueue(e);
      }
      print(JSON.stringify({ kind: 'poll', enqueued: envelopes.length, sourceRefs: envelopes.map((e) => e.sourceRef) }));
      return 0;
    }

    // ── claim ─────────────────────────────────────────────────────────────────
    // `conduct-ts engineer claim`: atomically dequeue the oldest pending idea so the
    // /engineer skill can route it. claim+ack removes it from the inbox (the ledger
    // is the durable record); the ledger advances to `claimed`. On an empty inbox,
    // reports {empty:true} — the skill then falls back to a CLI idea arg or chat.
    //
    // The file queue is wrapped with createDeliveryGuardedQueue (Task 8, TR-1) to detect
    // and heal stale entries (duplicate envelopes, delivered PRs) transparently.
    case 'claim': {
      const engDir = engineerDir ?? resolveEngineerDir({});
      const { ledger, queue } = buildIntake({ engineerDir: engDir, registryPath, gh, printErr });

      // Wrap the queue with the delivery guard decorator (Task 8: integration point).
      // The guard is transparent to claimUnblocked; it only filters/heals problematic
      // candidates via ledger + gh state checks.
      const guardedQueue = createDeliveryGuardedQueue(queue, ledger, {
        gh,
        logger: { info: (msg) => printErr(msg) },
      });

      // Fresh resolver per claim call — createBlockerResolver()'s memo is scoped
      // to a single walk, so reusing one across calls would leak stale verdicts
      // (see daemon-backlog.ts:210-221 for the same rule on the daemon side).
      const resolver = createBlockerResolver({ run: (args) => gh(args, { cwd: process.cwd() }) });
      // Claim-time label read — no cache: a relabel between claims must be
      // honored on the very next claim (TR-1 happy 3). A throwing reader is
      // handled inside claimUnblocked (falls back to drain order, warns once
      // via `log`) — never caught here.
      const labelReader = ghIssueLabelReader((args) => gh(args, { cwd: process.cwd() }));
      const outcome = await claimUnblocked({
        queue: guardedQueue as unknown as DependencyClaimQueue,
        resolveDependency: (sourceRef) => resolver.resolve(sourceRef ?? ''),
        resolveBands: (refs) => resolveClaimBands(labelReader, refs),
        log: (...args: unknown[]) => printErr(args.map((a) => String(a)).join(' ')),
      });

      if (outcome.kind === 'empty') {
        print(JSON.stringify({ kind: 'claim', empty: true }));
        return 0;
      }
      if (outcome.kind === 'all-blocked') {
        print(
          JSON.stringify({
            kind: 'claim',
            allBlocked: true,
            entries: outcome.entries.map(({ envelope: e, verdict }) => {
              const entryEnvelope = e as unknown as Envelope;
              return {
                text: entryEnvelope.text,
                source: entryEnvelope.source,
                sourceRef: entryEnvelope.sourceRef,
                verdict,
              };
            }),
          }),
        );
        return 0;
      }

      // claimUnblocked's ClaimableEnvelope is a structural subset of the real
      // Envelope produced by the file queue — narrow back to the concrete type
      // for ack()/ledger.transition() below.
      const envelope = outcome.envelope as unknown as Envelope;
      // Remove from the inbox now that we own it — the ledger carries lifecycle from here.
      await queue.ack(envelope);
      try {
        await ledger.transition(envelope.source, envelope.sourceRef, 'claimed');
      } catch {
        // Entry may be absent for a non-recording source — advisory transition.
      }
      print(
        JSON.stringify({
          kind: 'claim',
          text: envelope.text,
          source: envelope.source,
          sourceRef: envelope.sourceRef,
        }),
      );
      return 0;
    }

    // ── forget ──────────────────────────────────────────────────────────────────
    // `conduct-ts engineer forget <sourceRef>`: drop the ledger entry so the issue
    // is re-capturable, and strip the `engineer:handled` label so poll sees it again.
    // An absent ref is reported (found:false) and is NOT an error.
    case 'forget': {
      const { sourceRef } = dispatch;
      const engDir = engineerDir ?? resolveEngineerDir({});
      const ledger = createLedger(join(engDir, 'ledger.json'));

      const entry = await ledger.get(GITHUB_ISSUES_SOURCE, sourceRef);
      if (!entry) {
        print(JSON.stringify({ kind: 'forget', sourceRef, found: false }));
        return 0;
      }

      await ledger.forget(GITHUB_ISSUES_SOURCE, sourceRef);

      // Best-effort label strip; a gh failure must not fail `forget` (the ledger
      // entry is already gone, which is the authoritative dedup state).
      const m = sourceRef.match(/^(.+)#(\d+)$/);
      if (m) {
        try {
          await gh(restRemoveLabelArgs(m[1], m[2], HANDLED_LABEL), { cwd: process.cwd() });
        } catch (err: unknown) {
          printErr(`engineer forget: label strip failed for ${sourceRef}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      print(JSON.stringify({ kind: 'forget', sourceRef, found: true, removed: true }));
      return 0;
    }

    // ── resolve ─────────────────────────────────────────────────────────────
    // `conduct-ts engineer resolve <sourceRef> --pr-url <url> [--branch <b>]`:
    // mark a claimed entry as delivered when write-back fails (recovery from the
    // stranded state where the spec was authored/handed off but not recorded as done).
    // If entry doesn't exist: return {kind:'resolve', found:false} exit 0 (soft failure).
    // If entry exists: transition to 'done' with prUrl + optional branch override.
    // Branch is optional; if not provided, preserve existing entry.meta.branch.
    // Output: {kind:'resolve', sourceRef, priorStatus, prUrl, branch} for operator verification.
    // Exit code always 0 (resolve is advisory, never a hard failure).
    case 'resolve': {
      const { sourceRef, prUrl, branch: newBranch } = dispatch;

      // Validate --pr-url format: must be http(s)://
      if (!prUrl.match(/^https?:\/\//)) {
        printErr(`resolve: invalid --pr-url "${prUrl}" (must be http(s)://…)`);
        return 1;
      }

      const engDir = engineerDir ?? resolveEngineerDir({});
      const ledger = createLedger(join(engDir, 'ledger.json'));

      // Attempt to get the entry; if absent, return found:false (soft failure).
      const entry = await ledger.get(GITHUB_ISSUES_SOURCE, sourceRef);
      if (!entry) {
        print(JSON.stringify({ kind: 'resolve', sourceRef, found: false }));
        return 0;
      }

      // Entry exists: prepare the transition.
      // Preserve existing branch unless --branch provided.
      const priorStatus = entry.status;
      const existingBranch = entry.branch ?? '';
      const branch = newBranch !== undefined ? newBranch : existingBranch;

      // Transition the entry to 'done' with prUrl + branch evidence.
      await ledger.transition(GITHUB_ISSUES_SOURCE, sourceRef, 'done', { prUrl, branch });

      // Output: all 4 fields for operator verification.
      print(
        JSON.stringify({
          kind: 'resolve',
          sourceRef,
          priorStatus,
          prUrl,
          branch,
        }),
      );

      return 0;
    }

    // ── migrate-issue-deps ────────────────────────────────────────────────────
    // `conduct-ts engineer migrate-issue-deps [--confirm]`: one-time prose→link
    // migration over the current repo's open issues. Scans, classifies prose
    // into deterministic edges + manual-review items, prints the full proposal,
    // and only WRITES anything when `--confirm` is passed — a bare run is a
    // pure dry-run (GET-checks only, zero POSTs; see createDependencyLinks).
    case 'migrate-issue-deps': {
      const cwd = process.cwd();
      let nameWithOwner: string;
      try {
        const { stdout } = await gh(['repo', 'view', '--json', 'nameWithOwner'], { cwd });
        nameWithOwner = String((JSON.parse(stdout || '{}') as { nameWithOwner?: unknown }).nameWithOwner ?? '');
      } catch (err: unknown) {
        printErr(`engineer migrate-issue-deps: could not resolve repo (${err instanceof Error ? err.message : String(err)})`);
        return 1;
      }
      if (!nameWithOwner) {
        printErr('engineer migrate-issue-deps: could not resolve repo (no nameWithOwner)');
        return 1;
      }

      let issues: Array<{ number: number; body: string }>;
      try {
        const { stdout } = await gh(['issue', 'list', '--state', 'open', '--json', 'number,body', '--limit', '500'], {
          cwd,
        });
        issues = JSON.parse(stdout || '[]') as Array<{ number: number; body: string }>;
      } catch (err: unknown) {
        printErr(`engineer migrate-issue-deps: could not list issues (${err instanceof Error ? err.message : String(err)})`);
        return 1;
      }

      // Delegate to runMigration with formatted issues and confirmation callback
      const formattedIssues = issues.map((issue) => ({
        ref: `${nameWithOwner}#${issue.number}`,
        body: issue.body ?? '',
      }));

      const result = await runMigration({
        gh,
        issues: formattedIssues,
        confirm: async () => Promise.resolve(dispatch.confirm),
      });

      // Print the proposal (proposed edges + manual review items)
      print(`migrate-issue-deps: proposal over ${nameWithOwner} (${issues.length} open issue(s))`);
      for (const proposed of result.proposed) {
        print(`  ${proposed.issue} blocked_by ${proposed.blockedBy}  [${proposed.kind}]`);
      }
      if (result.manualReview.length > 0) {
        print(`  ${result.manualReview.length} item(s) need manual review (not auto-proposed):`);
        for (const item of result.manualReview) {
          print(`    ${item.issue} — ${item.reason}: ${item.excerpt}`);
        }
      }

      // If not confirmed, print dry-run message and return
      if (!dispatch.confirm) {
        print('Dry run — no links written. Re-run with --confirm to apply.');
        return 0;
      }

      // Print the results (created + already-present)
      const created = result.created.length;
      const alreadyPresent = result.alreadyPresent.length;
      print(`migrate-issue-deps: ${created} link(s) created, ${alreadyPresent} already present.`);
      return 0;
    }
  }
}
