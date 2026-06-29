// Engineer mode loop — START sequence (Phase 9.3, Task 33) +
// Per-idea loop body (Phase 9.3, Task 34).
//
// NOTE: runEngineerMode is the scripted/test orchestration harness driven by the
// /engineer host-agent skill in a Claude Code session. The production entry is the
// /engineer host-agent skill driving the deterministic CLI primitives below
// (dispatchEngineer subcommands: projects, land, handoff, guide).
// There is NO Node readline REPL and NO spawned routing subprocess in this module.
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
// FR-13/FR-1: depend on the intake PORT/source interfaces, never a concrete adapter.
import type { Envelope, IntakePort } from './intake/port.js';
import type { IntakeSource } from './intake/source.js';
import type { IntakeQueue } from './intake/queue.js';
import type { Ledger } from './intake/ledger.js';
import { reportRouted, reportDone } from './intake/writeback.js';
import type { RoutingProvider } from './routing.js';
import { createRegistryReader } from '../registry.js';
import { createEngineerStoreReader } from '../engineer-store.js';
import { routeIdea, createOnNoFit } from './routing.js';
import { resolveTargetRepo } from './target.js';
import { createJsonlLessonStore, selectLessons } from './lesson-store.js';
import { buildAuthoringPrompt, runAuthoring } from './authoring.js';
import type { DecideResult, DecideStep, AssessComplexityResult } from './authoring.js';
import type { ComplexityTier } from '../../types/index.js';
import { runHandoff } from './handoff-step.js';
import { runCreate } from '../registry-cli.js';

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
  /**
   * In-chat routing seam (ADR-008 FR-3/4/5): the host agent's reasoning over the
   * registry. invoke(prompt) returns the host agent's raw JSON routing response.
   * No subprocess is spawned — this is the host agent answering in-chat.
   */
  route: RoutingProvider;
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
   * Host-agent human-gated DECIDE seam. Called once per markdown step in
   * canonical order (brainstorm → stories → conflict_check →
   * architecture_diagram → architecture_review → plan).
   * Absent → processIdea throws (fail-closed — no authoring without a seam).
   */
  decide?: (ctx: {
    step: DecideStep;
    idea: string;
    project: string;
    prompt: string;
  }) => Promise<DecideResult>;
  /**
   * Host-agent complexity-assessment seam. Called once, after brainstorm and
   * before stories — its tier gates which later DECIDE steps run (Small skips
   * conflict-check + architecture) and is persisted to `.docs/complexity/`.
   * Absent → processIdea throws (fail-closed — same contract as `decide`).
   */
  assessComplexity?: (ctx: {
    recommended: ComplexityTier | null;
    idea: string;
    project: string;
    prompt: string;
  }) => Promise<AssessComplexityResult>;
  /**
   * Async intake sources polled ONCE at launch (FR-31). Adapter-agnostic: the
   * CLI constructs the concrete adapter (e.g. github-issues) and injects it here,
   * so the loop never imports a concrete adapter (FR-13).
   */
  sources?: IntakeSource[];
  /** Durable inbox buffering polled envelopes (FR-29/30). */
  queue?: IntakeQueue;
  /**
   * Write-back sink for routed/done progress (FR-36). Typically the SAME instance
   * as one of `sources` (the github adapter is both IntakeSource and IntakePort).
   */
  intakePort?: IntakePort;
  /** Intake ledger for lifecycle transitions (FR-33); record-on-enqueue + routed/done. */
  ledger?: Ledger;
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

  // ── 4. Build normalising routing wrapper (reuse across ideas) ───────────────
  // deps.route is the host agent's in-chat RoutingProvider seam (ADR-008 FR-3/4/5).
  // No subprocess is spawned. We normalise any wrapped { candidates: [...] } response
  // to a bare array JSON string so routeIdea always receives the expected shape.
  const routingProvider = {
    invoke: async (prompt: string): Promise<string> => {
      const raw = await deps.route.invoke(prompt);
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

  // ── 5.5 Intake: poll-on-launch → enqueue → process the oldest (FR-31) ───────
  // Polls every injected source once, buffers what they surface (adapters dedup
  // via the ledger), then claims and processes EXACTLY ONE envelope (the oldest).
  // An empty inbox after polling falls through to the interactive chat loop below
  // — no error, no idle hang. Processing failure releases the claim for re-delivery.
  if (deps.sources?.length && deps.queue) {
    const queue = deps.queue;
    for (const source of deps.sources) {
      let envs: Envelope[] = [];
      try {
        envs = await source.poll();
      } catch (err: unknown) {
        io.print(`Intake poll failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      for (const e of envs) {
        try {
          // record() is idempotent — guarantees a ledger entry for later routed/done
          // transitions even when a source did not itself record (record is a no-op
          // when the entry already exists, so the github adapter's own record is safe).
          if (deps.ledger) await deps.ledger.record({ source: e.source, sourceRef: e.sourceRef });
          await queue.enqueue(e);
        } catch {
          // A single malformed envelope must not abort the whole intake phase.
        }
      }
    }

    const claimed = await queue.claim();
    if (claimed) {
      try {
        await processIdea(
          claimed.text,
          deps,
          registryReader,
          routingProvider,
          lessonStore,
          io,
          summary,
          deps.ensureRunningLaunch,
          { envelope: claimed, port: deps.intakePort, ledger: deps.ledger },
        );
        await queue.ack(claimed);
      } catch (err: unknown) {
        io.print(`Error processing intake idea: ${err instanceof Error ? err.message : String(err)}`);
        try {
          await queue.release(claimed);
        } catch {
          // release best-effort — a stuck claim stays reclaimable by staleness.
        }
      }
    }
  }

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
  intake?: { envelope: Envelope; port?: IntakePort; ledger?: Ledger },
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

  // Intake write-back: report routed (FR-36) + advance the ledger via the shared
  // helper (one implementation, also used by `engineer land --source-ref`).
  // Best-effort at this call site — write-back must never abort spec authoring.
  if (intake) {
    await reportRouted(
      {
        source: intake.envelope.source,
        sourceRef: intake.envelope.sourceRef,
        port: intake.port,
        ledger: intake.ledger,
      },
      target.name,
    );
  }

  // 4b. Select lessons (flywheel).
  const digest = await selectLessons(idea, target.name, lessonStore);

  // 4c. Build the authoring prompt (embeds digest so lessons are visible to the DECIDE seam).
  const { prompt: authoringPrompt } = buildAuthoringPrompt(idea, target.name, digest);

  // 4d. Author the full DECIDE phase via the gated runAuthoring seam (C2: no
  //     subprocess, no stub). The markdown DECIDE seam (`decide`) is required —
  //     absent → fail-closed. The complexity seam (`assessComplexity`) is
  //     optional: when wired it drives tier-conditional conflict-check +
  //     architecture; when absent, runAuthoring defaults to Small (the legacy
  //     brainstorm→stories→plan flow).
  if (!deps.decide) {
    throw new Error(
      'engineer: no DECIDE seam wired — cannot author (agent-hosted decide required)',
    );
  }
  const decideFn = deps.decide;
  const assessComplexityFn = deps.assessComplexity;
  const decide = (step: DecideStep) =>
    decideFn({ step, idea, project: target.name, prompt: authoringPrompt });
  const assessComplexity = assessComplexityFn
    ? (recommended: ComplexityTier | null) =>
        assessComplexityFn({ recommended, idea, project: target.name, prompt: authoringPrompt })
    : undefined;
  const sourceRef = intake?.envelope.sourceRef;
  const { branch } = await runAuthoring(target, idea, { decide, assessComplexity, sourceRef });

  // 4e-4g. Post-authoring handoff (extracted — retro A-2): PR-open-vs-local-commit,
  //        ensure-running fire-and-forget, and the authored entry. runHandoff owns
  //        the gh-present guard (A-3 — no `gh!`) and the ENSURE-NOT-MANAGE boundary.
  const entry = await runHandoff(target, branch, {
    gh: deps.gh,
    engineerDir: deps.engineerDir,
    launchFn,
    print: (s) => io.print(s),
    sourceRef,
  });
  summary.authored!.push({ project: entry.project });

  // Intake write-back: report done (FR-36) + final ledger transition once the spec
  // PR is open (entry.prUrl present), via the shared helper (also used by
  // `engineer handoff --source-ref`). Best-effort — the spec PR is the real
  // artifact, so a failed comment/transition never reverts a delivered handoff.
  if (intake && entry.prUrl) {
    await reportDone(
      {
        source: intake.envelope.source,
        sourceRef: intake.envelope.sourceRef,
        port: intake.port,
        ledger: intake.ledger,
      },
      entry.prUrl,
      branch,
    );
  }

  summary.ideasProcessed += 1;
}
