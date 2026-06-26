// Brain mode loop — START sequence (Phase 9.3, Task 33) +
// Per-idea loop body (Phase 9.3, Task 34).
//
// Implements the full runBrainMode:
//   1. Load the project registry and open the brain store.
//   2. Print the project count.
//   3. Enter the read-line loop: blank → re-prompt; exit/EOF → clean return.
//   4. Non-blank, non-exit lines: route → confirmation gate → authorSpec → PR.
//
// Public contract:
//   runBrainMode(deps: BrainDeps): Promise<BrainSessionSummary>
//
// Design invariants:
//   - Absent registry → [] → "0 known projects", no crash. (FR-1 negative)
//   - Malformed registry → THROW with /registry/i in the message. (FR-1 negative)
//   - Absent/empty store → flywheel is a no-op; loop still runs. (FR-1 negative)
//   - exit line or EOF → exitCode: 0, ideasProcessed: 0 (when no idea processed).
//   - Blank line → re-prompt, ideasProcessed NOT incremented.
//   - Per-idea failure is isolated: one idea's error does NOT kill the session.
//   - Brain NEVER triggers a build (buildsRun stays 0 forever).
//   - Brain NEVER auto-merges: the only gh operation is opening spec PRs.

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { LLMProvider } from '../../execution/llm-provider.js';
import { createRegistryReader } from '../registry.js';
import { createBrainStoreReader } from '../brain-store.js';
import { routeIdea, createOnNoFit } from './routing.js';
import { resolveTargetRepo } from './target.js';
import { createJsonlLessonStore, selectLessons } from './lesson-store.js';
import { buildAuthoringPrompt, authorSpec } from './authoring.js';
import { openSpecPr } from './handoff.js';
import { runCreate } from '../registry-cli.js';

const execFile = promisify(execFileCb);

// ── Public types ──────────────────────────────────────────────────────────────

/** IO surface injected into runBrainMode. */
export interface BrainIO {
  /** Return the next input line, or null at EOF. */
  prompt(): Promise<string | null>;
  /** Write a line to the output sink. */
  print(s: string): void;
}

/**
 * gh runner injected into runBrainMode (PR machinery, task 34).
 */
export type GhRunner = (
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string }>;

/**
 * Deps for runBrainMode. All fields are injectable for testability.
 *
 * `registryPath` and `brainDir` override the env-var defaults when provided
 * (AI_CONDUCTOR_REGISTRY / AI_CONDUCTOR_BRAIN_DIR). Absent → env → default
 * path derivation inside the respective reader factories.
 */
export interface BrainDeps {
  /** LLM provider for routing/authoring. */
  provider: LLMProvider;
  /** Scripted or real I/O. */
  io: BrainIO;
  /** GitHub runner for PR operations. */
  gh?: GhRunner;
  /** Direct registry file path override (takes priority over env). */
  registryPath?: string;
  /** Direct brain directory path override (takes priority over env). */
  brainDir?: string;
}

/**
 * Summary returned by runBrainMode.
 *
 * ideasProcessed: number of non-blank, non-exit lines that successfully
 *   completed the full route→author→PR cycle.
 * exitCode: 0 on clean exit; absent also means 0.
 * authored: entries recorded per-idea after PR open or PR-skip.
 */
export interface BrainSessionSummary {
  ideasProcessed: number;
  exitCode?: number;
  authored?: Array<{ project: string }>;
  /** Number of builds run — always 0 (brain does not trigger build pipelines). */
  buildsRun?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CONFIRM_WORDS = new Set(['y', 'yes']);
const DECLINE_WORDS = new Set(['n', 'no']);

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Run the brain mode REPL.
 *
 * START SEQUENCE:
 *   1. Load registry; count projects; print count.
 *   2. Open brain store (absent → no-op).
 *   3. Enter loop:
 *      - null/EOF    → break, return summary.
 *      - "exit"      → break, return summary.
 *      - blank line  → re-prompt (continue).
 *      - real idea   → route → gate → authorSpec → PR/handoff.
 *
 * Malformed registry: readRegistry() inside createRegistryReader throws
 * with a message containing "registry" — this propagates as a fast error.
 */
export async function runBrainMode(deps: BrainDeps): Promise<BrainSessionSummary> {
  const { io } = deps;

  // ── 1. Load registry ──────────────────────────────────────────────────────
  const registryReader = createRegistryReader(
    deps.registryPath ? { registryPath: deps.registryPath } : {},
  );

  const projects = await registryReader.listProjects();
  const projectCount = projects.length;

  // ── 2. Open brain store (absent/empty → no-op) ────────────────────────────
  const storeReader = createBrainStoreReader(
    deps.brainDir ? { brainDir: deps.brainDir } : {},
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
      const result = await deps.provider.invoke({ prompt } as any);
      const raw = (result as any).output ?? '';
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
  const summary: BrainSessionSummary = {
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
      await processIdea(trimmed, deps, registryReader, routingProvider, lessonStore, io, summary);
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
  deps: BrainDeps,
  registryReader: ReturnType<typeof createRegistryReader>,
  routingProvider: { invoke(prompt: string): Promise<string> },
  lessonStore: ReturnType<typeof createJsonlLessonStore>,
  io: BrainIO,
  summary: BrainSessionSummary,
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
        // uncommitted (no HEAD). We need an initial commit so authorSpec's
        // dirty-guard and branch creation work correctly.
        const projectName = basename(path);
        await createOnNoFit(
          projectName,
          async () => {
            const code = await runCreate(path);
            if (code !== 0) throw new Error(`conduct create failed for path "${path}"`);
            // Give the new repo a git identity and initial commit.
            await execFile('git', ['config', 'user.email', 'brain@conductor.local'], { cwd: path });
            await execFile('git', ['config', 'user.name', 'Brain'], { cwd: path });
            await execFile('git', ['add', 'CLAUDE.md', '.gitignore'], { cwd: path });
            await execFile(
              'git',
              ['commit', '-m', 'chore: brain scaffold initial commit'],
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

  // 4c. Build authoring provider that writes artifact files AND invokes the LLM.
  // authorSpec will: checkout spec branch, invoke this provider, then
  // git add .docs/specs .docs/stories .docs/plans + commit.
  // We write files here so the git add step finds content in all three dirs.
  const authoringProvider = {
    invoke: async (opts: { cwd: string; idea: string; branch: string }): Promise<void> => {
      // Build the prompt (embeds digest so the lesson marker is in the prompt).
      const { prompt } = buildAuthoringPrompt(idea, target.name, digest);

      // Invoke the LLM (acceptance test stub identifies authoring by presence of cwd).
      const result = await deps.provider.invoke({ cwd: opts.cwd, prompt } as any);
      const content = (result as any).output ?? '';

      // Materialize spec artifacts under .docs/ in the target repo.
      // authorSpec will `git add .docs/specs .docs/stories .docs/plans`, so all
      // three dirs need ≥1 file. Scenario 4.4 asserts every committed path starts
      // with `.docs/` — all files are under .docs/ here.
      const slug = idea
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);

      const specsDir = join(opts.cwd, '.docs', 'specs');
      const storiesDir = join(opts.cwd, '.docs', 'stories');
      const plansDir = join(opts.cwd, '.docs', 'plans');

      await mkdir(specsDir, { recursive: true });
      await mkdir(storiesDir, { recursive: true });
      await mkdir(plansDir, { recursive: true });

      await writeFile(
        join(specsDir, `${slug}.md`),
        `# ${idea}\n\n${content}`,
        'utf-8',
      );
      await writeFile(
        join(storiesDir, `${slug}.md`),
        `# Stories: ${idea}\n\n_Generated by brain._\n`,
        'utf-8',
      );
      await writeFile(
        join(plansDir, `${slug}.md`),
        `# Plan: ${idea}\n\n_Generated by brain._\n`,
        'utf-8',
      );
    },
  };

  // 4d. Author the spec (creates branch, writes + commits artifacts).
  const { branch } = await authorSpec(target, idea, digest, authoringProvider);

  // 4e. PR / handoff, gated on remote presence.
  if (target.remote) {
    // Target has a remote — open a spec PR.
    const handoffResult = await openSpecPr(target, branch, {
      runner: async (args, runnerOpts) => {
        const ghCwd = runnerOpts?.cwd ?? target.canonicalPath;
        const r = await deps.gh!(args, { cwd: ghCwd });
        return { stdout: r.stdout, stderr: '' };
      },
      ledgerOpts: deps.brainDir ? { brainDir: deps.brainDir } : {},
    });
    if (handoffResult.kind === 'pr-opened') {
      io.print(`Spec PR opened: ${handoffResult.url}`);
    } else {
      // pr-skipped (no remote detected at runtime by gh).
      io.print(`PR skipped: ${handoffResult.reason}`);
    }
  } else {
    // No remote — spec is committed on the branch; work is preserved locally.
    io.print(`No remote configured — PR could not be opened. Spec committed on branch "${branch}".`);
  }

  // 4f. Record the authored entry and increment counter.
  // This happens on BOTH the PR-opened and no-remote paths (work was done).
  summary.authored!.push({ project: target.name });
  summary.ideasProcessed += 1;
}
