// Engineer mode loop — START sequence (Phase 9.3, Task 33) +
// Per-idea loop body (Phase 9.3, Task 34).
//
// Implements the full runEngineerMode:
//   1. Load the project registry and open the engineer store.
//   2. Print the project count.
//   3. Enter the read-line loop: blank → re-prompt; exit/EOF → clean return.
//   4. Non-blank, non-exit lines: route → confirmation gate → runAuthoring → PR.
//
// Public contract:
//   runEngineerMode(deps: EngineerDeps): Promise<EngineerSessionSummary>
//
// Design invariants:
//   - Absent registry → [] → "0 known projects", no crash. (FR-1 negative)
//   - Malformed registry → THROW with /registry/i in the message. (FR-1 negative)
//   - Absent/empty store → flywheel is a no-op; loop still runs. (FR-1 negative)
//   - exit line or EOF → exitCode: 0, ideasProcessed: 0 (when no idea processed).
//   - Blank line → re-prompt, ideasProcessed NOT incremented.
//   - Per-idea failure is isolated: one idea's error does NOT kill the session.
//   - Engineer NEVER triggers a build (buildsRun stays 0 forever).
//   - Engineer NEVER auto-merges: the only gh operation is opening spec PRs.

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { basename } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { LLMProvider } from '../../execution/llm-provider.js';
// FR-13/FR-1: depend on the intake PORT interface, never the concrete adapter.
import type { IntakePort } from './intake/port.js';
import { createRegistryReader } from '../registry.js';
import { createEngineerStoreReader } from '../engineer-store.js';
import { routeIdea, createOnNoFit } from './routing.js';
import { resolveTargetRepo } from './target.js';
import { createJsonlLessonStore, selectLessons } from './lesson-store.js';
import { buildAuthoringPrompt, runAuthoring } from './authoring.js';
import type { DecideResult } from './authoring.js';
import { openSpecPr } from './handoff.js';
import { recordAuthoredKey } from './authored-ledger.js';
import { runCreate } from '../registry-cli.js';
import { ensureRunning } from '../daemon-lock.js';

const execFile = promisify(execFileCb);

// ── Public types ──────────────────────────────────────────────────────────────

/** IO surface injected into runEngineerMode. */
export interface EngineerIO {
  /** Return the next input line, or null at EOF. */
  prompt(): Promise<string | null>;
  /** Write a line to the output sink. */
  print(s: string): void;
}

/**
 * gh runner injected into runEngineerMode (PR machinery, task 34).
 */
export type GhRunner = (
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string }>;

/**
 * Deps for runEngineerMode. All fields are injectable for testability.
 *
 * `registryPath` and `engineerDir` override the env-var defaults when provided
 * (AI_CONDUCTOR_REGISTRY / AI_CONDUCTOR_ENGINEER_DIR). Absent → env → default
 * path derivation inside the respective reader factories.
 */
export interface EngineerDeps {
  /** LLM provider for routing/authoring. */
  provider: LLMProvider;
  /** Scripted or real I/O. */
  io: EngineerIO;
  /** GitHub runner for PR operations. */
  gh?: GhRunner;
  /** Direct registry file path override (takes priority over env). */
  registryPath?: string;
  /** Direct engineer directory path override (takes priority over env). */
  engineerDir?: string;
  /**
   * Injectable launch function for ensureRunning (FR-21, Task 37).
   * Called with the target's repoPath after spec artifacts land (PR opened or
   * locally committed). Fire-and-forget — errors are swallowed.
   * When absent, defaults to ensureRunning from daemon-lock.ts with no explicit
   * launch override (real detached spawn).
   * Injecting a spy here lets tests assert "was called" without spawning processes.
   */
  ensureRunningLaunch?: (repoPath: string) => void | Promise<void>;
  /**
   * Host-agent human-gated DECIDE seam. Called once per step.
   * Absent → runAuthoring throws (fail-closed — no authoring without a seam).
   */
  decide?: (ctx: {
    step: 'brainstorm' | 'stories' | 'plan';
    idea: string;
    project: string;
    prompt: string;
  }) => Promise<DecideResult>;
}

/**
 * Summary returned by runEngineerMode.
 *
 * ideasProcessed: number of non-blank, non-exit lines that successfully
 *   completed the full route→author→PR cycle.
 * exitCode: 0 on clean exit; absent also means 0.
 * authored: entries recorded per-idea after PR open or PR-skip.
 */
export interface EngineerSessionSummary {
  ideasProcessed: number;
  exitCode?: number;
  authored?: Array<{ project: string }>;
  /** Number of builds run — always 0 (engineer does not trigger build pipelines). */
  buildsRun?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CONFIRM_WORDS = new Set(['y', 'yes']);
const DECLINE_WORDS = new Set(['n', 'no']);

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Run the engineer mode REPL.
 *
 * START SEQUENCE:
 *   1. Load registry; count projects; print count.
 *   2. Open engineer store (absent → no-op).
 *   3. Enter loop:
 *      - null/EOF    → break, return summary.
 *      - "exit"      → break, return summary.
 *      - blank line  → re-prompt (continue).
 *      - real idea   → route → gate → runAuthoring → PR/handoff.
 *
 * Malformed registry: readRegistry() inside createRegistryReader throws
 * with a message containing "registry" — this propagates as a fast error.
 */
export async function runEngineerMode(deps: EngineerDeps): Promise<EngineerSessionSummary> {
  const { io } = deps;

  // ── 1. Load registry ──────────────────────────────────────────────────────
  const registryReader = createRegistryReader(
    deps.registryPath ? { registryPath: deps.registryPath } : {},
  );

  const projects = await registryReader.listProjects();
  const projectCount = projects.length;

  // ── 2. Open engineer store (absent/empty → no-op) ────────────────────────────
  const storeReader = createEngineerStoreReader(
    deps.engineerDir ? { engineerDir: deps.engineerDir } : {},
  );
  // Pre-open: read signals.jsonl (returns [] when absent — no crash).
  await storeReader.readSignals();

  // Build lesson store ONCE and reuse across ideas (context reuse).
  const lessonStore = createJsonlLessonStore(storeReader);

  // ── 3. Print project count ────────────────────────────────────────────────
  io.print(`${projectCount} known project${projectCount === 1 ? '' : 's'}`);

  // ── 4. Build routing provider adapter (reuse across ideas) ───────────────
  // routeIdea expects RoutingProvider: invoke(prompt: string) → string.
  // The acceptance provider returns { output: '<json>' } where json may be
  // either a bare array [{ name, score, rationale }] (the routeIdea format)
  // or a wrapped object { candidates: [...] }. We normalise here.
  const routingProvider = {
    invoke: async (prompt: string): Promise<string> => {
      // Routing is a single-shot, stateless classification — a fresh session
      // each call, never a resume. A valid UUID sessionId is REQUIRED: the real
      // ClaudeProvider emits `claude --session-id <id>`, which the CLI rejects
      // with "Invalid session ID. Must be a valid UUID." when the field is absent.
      const result = await deps.provider.invoke({
        prompt,
        sessionId: uuidv4(),
        resume: false,
      });
      const raw = result.output ?? '';
      // Normalise wrapped { candidates: [...] } → bare array JSON string.
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          Array.isArray((parsed as Record<string, unknown>).candidates)
        ) {
          return JSON.stringify((parsed as Record<string, unknown>).candidates);
        }
      } catch {
        // raw is not JSON — fall through, return as-is.
      }
      return raw;
    },
  };

  // ── 5. Read-line loop ─────────────────────────────────────────────────────
  const summary: EngineerSessionSummary = {
    ideasProcessed: 0,
    exitCode: 0,
    authored: [],
    buildsRun: 0,
  };

  for (;;) {
    const line = await io.prompt();

    // EOF
    if (line === null) {
      break;
    }

    const trimmed = line.trim();

    // Blank → re-prompt
    if (trimmed === '') {
      continue;
    }

    // Explicit exit
    if (trimmed === 'exit') {
      break;
    }

    // ── Per-idea body ─────────────────────────────────────────────────────
    // Wrapped in try/catch for per-idea failure isolation.
    // On failure: print error, continue (do NOT increment ideasProcessed).
    try {
      await processIdea(trimmed, deps, registryReader, routingProvider, lessonStore, io, summary, deps.ensureRunningLaunch);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      io.print(`Error processing idea: ${msg}`);
      // Do NOT increment ideasProcessed — failure isolation.
    }
  }

  return summary;
}

// ── processIdea: the per-idea body ───────────────────────────────────────────

async function processIdea(
  idea: string,
  deps: EngineerDeps,
  registryReader: ReturnType<typeof createRegistryReader>,
  routingProvider: { invoke(prompt: string): Promise<string> },
  lessonStore: ReturnType<typeof createJsonlLessonStore>,
  io: EngineerIO,
  summary: EngineerSessionSummary,
  launchFn?: (repoPath: string) => void | Promise<void>,
): Promise<void> {
  // Step 1: Route the idea.
  const routingResult = await routeIdea(idea, registryReader, routingProvider);

  // Step 2: Confirmation gate.
  let currentTarget: string | null = routingResult.candidates[0]?.project.name ?? null;
  let confirmed = false;
  let declined = false;

  if (routingResult.createSuggested) {
    // No-fit path: offer to create a new project.
    io.print(
      `No matching project found. Would you like to create one? (create <path> to scaffold, or n to decline)`,
    );

    // Gate loop for no-fit.
    gateLoop: for (;;) {
      const gateLine = await io.prompt();
      if (gateLine === null) {
        declined = true;
        break gateLoop;
      }
      const gateTrimmed = gateLine.trim();
      const gateLower = gateTrimmed.toLowerCase();

      if (DECLINE_WORDS.has(gateLower) || gateTrimmed === '') {
        declined = true;
        break gateLoop;
      }

      if (gateLower.startsWith('create ')) {
        const path = gateTrimmed.slice('create '.length).trim();
        if (!path) {
          declined = true;
          break gateLoop;
        }
        // Ask for confirmation of create.
        io.print(`Create new project at "${path}"? (y/yes to confirm)`);
        const confirmLine = await io.prompt();
        if (confirmLine === null) {
          declined = true;
          break gateLoop;
        }
        const confirmTrimmed = confirmLine.trim().toLowerCase();
        if (!CONFIRM_WORDS.has(confirmTrimmed)) {
          declined = true;
          break gateLoop;
        }
        // Perform the create: runCreate + git initial commit.
        // runCreate does git init + CLAUDE.md + .gitignore but leaves the repo
        // uncommitted (no HEAD). We need an initial commit so runAuthoring's
        // dirty-guard and branch creation work correctly.
        const projectName = basename(path);
        await createOnNoFit(
          projectName,
          async () => {
            const code = await runCreate(path);
            if (code !== 0) throw new Error(`conduct create failed for path "${path}"`);
            // Give the new repo a git identity and initial commit.
            await execFile('git', ['config', 'user.email', 'engineer@conductor.local'], { cwd: path });
            await execFile('git', ['config', 'user.name', 'Engineer'], { cwd: path });
            await execFile('git', ['add', 'CLAUDE.md', '.gitignore'], { cwd: path });
            await execFile(
              'git',
              ['commit', '-m', 'chore: engineer scaffold initial commit'],
              { cwd: path },
            );
          },
          registryReader,
        );
        currentTarget = projectName;
        // Ask to confirm authoring on the new project.
        io.print(`Proceed with authoring spec for "${currentTarget}"? (y/yes to confirm)`);
        const authorConfirmLine = await io.prompt();
        if (authorConfirmLine === null) {
          declined = true;
          break gateLoop;
        }
        if (!CONFIRM_WORDS.has(authorConfirmLine.trim().toLowerCase())) {
          declined = true;
          break gateLoop;
        }
        confirmed = true;
        break gateLoop;
      }

      // Unrecognized input — re-prompt.
      io.print(`Type "create <path>" to scaffold a new project, or "n" to decline.`);
    }
  } else {
    // Candidates exist: propose the top candidate.
    io.print(
      `Routing suggests project "${currentTarget}" for your idea. Confirm? (y/yes, redirect <name>, n/no)`,
    );

    // Gate loop for candidate confirmation.
    gateLoop: for (;;) {
      const gateLine = await io.prompt();
      if (gateLine === null) {
        declined = true;
        break gateLoop;
      }
      const gateTrimmed = gateLine.trim();
      const gateLower = gateTrimmed.toLowerCase();

      if (DECLINE_WORDS.has(gateLower) || gateTrimmed === '') {
        declined = true;
        break gateLoop;
      }

      if (CONFIRM_WORDS.has(gateLower)) {
        confirmed = true;
        break gateLoop;
      }

      if (gateLower.startsWith('redirect ')) {
        const redirectName = gateTrimmed.slice('redirect '.length).trim();
        // Check if the redirected name is a registered project.
        const allProjects = await registryReader.listProjects();
        const found = allProjects.find((p) => p.name === redirectName);
        if (found) {
          currentTarget = redirectName;
          // Re-prompt with the new target.
          io.print(
            `Redirected to "${currentTarget}". Confirm? (y/yes, redirect <name>, n/no)`,
          );
          continue gateLoop;
        } else {
          io.print(`"${redirectName}" is not a registered project. Please try again.`);
          continue gateLoop;
        }
      }

      // Any other input: unrecognized, re-prompt.
      io.print(`Please respond with y/yes, n/no, or "redirect <project-name>".`);
    }
  }

  // Step 3: If declined, do nothing (ZERO side effects — no branch, no gh call).
  if (declined || !confirmed || currentTarget === null) {
    return;
  }

  // Step 4: Confirmed — resolve target, author spec, open PR.

  // 4a. Resolve target by name (find registry record by name, resolve by path).
  // We look up by name first because routing returns project names, not paths.
  const allProjects = await registryReader.listProjects();
  const record = allProjects.find((p) => p.name === currentTarget);
  if (!record) {
    throw new Error(`project "${currentTarget}" not found in registry after confirmation`);
  }
  const target = await resolveTargetRepo(record.path, registryReader);

  // 4b. Select lessons (flywheel).
  const digest = await selectLessons(idea, target.name, lessonStore);

  // 4c. Build the authoring prompt (embeds digest so lessons are visible to the DECIDE seam).
  const { prompt: authoringPrompt } = buildAuthoringPrompt(idea, target.name, digest);

  // 4d. Author the spec via the gated runAuthoring seam (C2: no subprocess, no stub).
  //     deps.decide is the host-agent DECIDE seam; absent → fail-closed.
  if (!deps.decide) {
    throw new Error(
      'engineer: no DECIDE seam wired — cannot author (agent-hosted decide required)',
    );
  }
  const decideFn = deps.decide;
  const decide = (step: string) =>
    decideFn({ step: step as 'brainstorm' | 'stories' | 'plan', idea, project: target.name, prompt: authoringPrompt });
  const { branch } = await runAuthoring(target, idea, { decide });

  // 4e. PR / handoff, gated on remote presence.
  if (target.remote) {
    // Target has a remote — open a spec PR.
    const handoffResult = await openSpecPr(target, branch, {
      runner: async (args, runnerOpts) => {
        const ghCwd = runnerOpts?.cwd ?? target.canonicalPath;
        const r = await deps.gh!(args, { cwd: ghCwd });
        return { stdout: r.stdout, stderr: '' };
      },
      ledgerOpts: deps.engineerDir ? { engineerDir: deps.engineerDir } : {},
    });
    if (handoffResult.kind === 'pr-opened') {
      io.print(`Spec PR opened: ${handoffResult.url}`);
    } else {
      // pr-skipped (no remote detected at runtime by gh).
      io.print(`PR skipped: ${handoffResult.reason}`);
    }
  } else {
    // No remote — spec is committed on the branch; work is preserved locally.
    // Record the authored key so FR-12 flywheel trend counts this authoring event
    // (mirrors openSpecPr's pr-skipped path which also records the ledger entry).
    await recordAuthoredKey(target.name, branch, deps.engineerDir ? { engineerDir: deps.engineerDir } : {});
    io.print(`No remote configured — PR could not be opened. Spec committed on branch "${branch}".`);
  }

  // 4f. Wire ensure-running (FR-21, Task 37): after spec artifacts land, fire-and-
  //     forget a daemon probe for the target repo. Uses the injected launchFn if
  //     present (tests spy on it); falls back to ensureRunning with the real
  //     launchDaemonDetached. Errors are swallowed — this is not on the critical
  //     path, and a failed ensure-running must never abort spec authoring.
  //
  //     CONTRACT: ensureRunning is the ENSURE-NOT-MANAGE boundary. It fires at most
  //     once per authored idea (one call per PR opened or per local commit). The
  //     engineer NEVER sends lifecycle signals to a running daemon.
  try {
    if (launchFn) {
      // Injected launch spy: used by tests to assert call count + repoPath.
      await Promise.resolve(launchFn(target.canonicalPath));
    } else {
      // Real path: ensureRunning probes the pidfile; spawns detached iff no live daemon.
      await ensureRunning(target.canonicalPath, {});
    }
  } catch {
    // Fire-and-forget: ensure-running failure must never block the engineer loop.
  }

  // 4g. Record the authored entry and increment counter.
  // This happens on BOTH the PR-opened and no-remote paths (work was done).
  summary.authored!.push({ project: target.name });
  summary.ideasProcessed += 1;
}
