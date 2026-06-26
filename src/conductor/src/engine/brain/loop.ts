// Brain mode loop — START sequence (Phase 9.3, Task 33).
//
// Implements ONLY the start sequence of runBrainMode:
//   1. Load the project registry and open the brain store.
//   2. Print the project count.
//   3. Enter the read-line loop: blank → re-prompt; exit/EOF → clean return.
//   4. Non-blank, non-exit lines are an extension point for task 34 (routing/
//      authoring/PR). For task 33 they are a no-op placeholder — ideasProcessed
//      is NOT incremented here; task 34 will fill this in.
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

import type { LLMProvider } from '../../execution/llm-provider.js';
import { createRegistryReader } from '../registry.js';
import { createBrainStoreReader } from '../brain-store.js';

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
 * Accepted here so the interface is stable; unused in task 33.
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
  /** LLM provider for routing/authoring (task 34). Accepted but unused in task 33. */
  provider: LLMProvider;
  /** Scripted or real I/O. */
  io: BrainIO;
  /** GitHub runner for PR operations (task 34). Accepted but unused in task 33. */
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
 *   completed the full route→author→PR cycle (task 34 populates this).
 * exitCode: 0 on clean exit; absent also means 0.
 * authored: entries recorded per-idea after PR open (task 34).
 */
export interface BrainSessionSummary {
  ideasProcessed: number;
  exitCode?: number;
  authored?: Array<{ project: string }>;
  /** Number of builds run — always 0 (brain never triggers a build). */
  buildsRun?: number;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Run the brain mode REPL.
 *
 * START SEQUENCE (task 33):
 *   1. Load registry; count projects; print count.
 *   2. Open brain store (absent → no-op).
 *   3. Enter loop:
 *      - null/EOF    → break, return summary.
 *      - "exit"      → break, return summary.
 *      - blank line  → re-prompt (continue).
 *      - real idea   → EXTENSION POINT for task 34; currently a no-op
 *                       (does NOT increment ideasProcessed).
 *
 * Malformed registry: readRegistry() inside createRegistryReader throws
 * with a message containing "registry" — this propagates as a fast error.
 */
export async function runBrainMode(deps: BrainDeps): Promise<BrainSessionSummary> {
  const { io } = deps;

  // ── 1. Load registry ──────────────────────────────────────────────────────
  // createRegistryReader honours opts.registryPath > env > default path.
  const registryReader = createRegistryReader(
    deps.registryPath ? { registryPath: deps.registryPath } : {},
  );

  // listProjects() → [] on absent file; THROWS on malformed JSON (surfaces as
  // a /registry/i error per the readRegistry() implementation in registry.ts).
  const projects = await registryReader.listProjects();
  const projectCount = projects.length;

  // ── 2. Open brain store (absent/empty → no-op) ────────────────────────────
  // createBrainStoreReader honours opts.brainDir > env > default path.
  // Reading signals here is a best-effort flywheel open — we don't crash on
  // missing/empty store; the store is available for task 34 to use per-idea.
  const _storeReader = createBrainStoreReader(
    deps.brainDir ? { brainDir: deps.brainDir } : {},
  );
  // Pre-open: read signals.jsonl (returns [] when absent — no crash).
  // Result available for task 34's lesson-select; discard here.
  await _storeReader.readSignals();

  // ── 3. Print project count ────────────────────────────────────────────────
  io.print(`${projectCount} known project${projectCount === 1 ? '' : 's'}`);

  // ── 4. Read-line loop ─────────────────────────────────────────────────────
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

    // ── EXTENSION POINT (task 34) ──────────────────────────────────────────
    // A non-blank, non-exit line is a real idea. Task 34 will slot in:
    //   routeIdea → confirmationGate → authorSpec → openPR
    // and will increment summary.ideasProcessed on success.
    //
    // For task 33, do nothing (placeholder). Do NOT increment ideasProcessed.
    // This keeps task-33 tests honest: they never depend on routing being done.
    // ── END EXTENSION POINT ───────────────────────────────────────────────
  }

  return summary;
}
