// Routing outcome discriminated union (ADR-007, FR-3).
//
// Four exhaustive variants:
//   confirmed  — engineer matched an existing project; caller proceeds with it.
//   redirected — engineer chose a different project than the one suggested.
//   create     — no existing project matches; caller should scaffold a new one.
//   declined   — engineer rejected the request entirely; NO project field (type-
//                enforced) so consumers cannot accidentally write to a project.
//
// The `assertNever` export gives consumers a compile-time exhaustiveness guard
// for switch statements over RoutingOutcome.
//
// routeIdea (Task 17, FR-3) — inference-only routing:
//   Reads the registry, asks an injected RoutingProvider to rank candidates,
//   and returns a RoutingResult with ranked candidates + a create suggestion
//   flag when confidence is low. The human confirm/redirect/decline gate (Task
//   18) is NOT here — this is pure inference, no decision is committed.
//
// handleGateResponse (Task 18, FR-3) — confirm/redirect/decline gate:
//   Pure function. Given a RoutingResult, an operator text response, and the
//   full registered project list, returns a GateOutcome without any real I/O.
//   Covers: confirm ('y'/'yes'), redirect to registered name, redirect to
//   unknown name (reprompt), decline/empty (declined), and near-tie
//   (needs-choice). onAuthor is an optional spy/callback; it is NEVER called
//   on declined — verified structurally here and by tests.
//
// createOnNoFit (Task 19, FR-4) — create-on-no-fit → 9.2 create + retarget:
//   When routing yields no fit and the user confirms "create new project",
//   invokes an injected CreateFn (scaffold + register a new project), then
//   re-resolves the TargetRepo from the newly created registry record so
//   subsequent authoring targets the new repo's canonical path.
//
//   Decision signal: empty/whitespace name → declined (no-op, no side effects).
//   All I/O (create fn, registry reader) is injected so tests use fakes and
//   assert call counts / non-invocation. No real git, no subprocess, no network.

import type { ProjectRecord, RegistryReader } from '../registry.js';
import type { TargetRepo } from './target.js';

export type RoutingOutcome =
  | { kind: 'confirmed'; project: ProjectRecord }
  | { kind: 'redirected'; project: ProjectRecord }
  | { kind: 'create'; name: string }
  | { kind: 'declined' };

// ---------------------------------------------------------------------------
// GateOutcome — returned by handleGateResponse (Task 18, FR-3).
//
// Five variants:
//   confirmed    — operator confirmed the proposed project.
//   redirected   — operator named a different (registered) project.
//   reprompt     — operator named an unregistered project; gate cannot
//                  proceed — no project field, no path fabricated.
//   declined     — operator declined or gave an empty response;
//                  no project field — consumers cannot write to a project.
//   needs-choice — two or more candidates are near-tied; gate refuses to
//                  auto-pick; lists tied candidates for explicit selection.
// ---------------------------------------------------------------------------
export type GateOutcome =
  | { kind: 'confirmed'; project: ProjectRecord }
  | { kind: 'redirected'; project: ProjectRecord }
  | { kind: 'reprompt'; unknownName: string }
  | { kind: 'declined' }
  | { kind: 'needs-choice'; candidates: RoutingCandidate[] };

// Exhaustiveness helper. Place in the `default` branch of a switch over
// RoutingOutcome. TypeScript will error at compile time if any variant is
// unhandled; at runtime an unknown value throws so tests can catch it too.
export function assertNever(x: never): never {
  throw new Error(`Unhandled RoutingOutcome variant: ${JSON.stringify(x)}`);
}

// ---------------------------------------------------------------------------
// RoutingProvider — minimal interface for LLM ranking calls.
//
// Intentionally narrower than LLMProvider (which carries session/resume state
// irrelevant to one-shot ranking). Consumers inject a stub in tests; the real
// implementation wraps ClaudeProvider.invoke or any HTTP call.
//
// invoke(prompt) → the raw text response from the LLM.
// ---------------------------------------------------------------------------
export interface RoutingProvider {
  invoke(prompt: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// RoutingCandidate — a single ranked project returned by routeIdea.
// ---------------------------------------------------------------------------
export interface RoutingCandidate {
  /** The full registry record for this project. */
  project: ProjectRecord;
  /** Confidence score 0–1 (1 = perfect match). */
  score: number;
  /** Human-readable rationale from the provider. */
  rationale: string;
}

// ---------------------------------------------------------------------------
// RoutingResult — the full output of routeIdea.
//
// candidates: all candidates the provider returned that matched a registry
//   record, sorted by score descending.
// createSuggested: true when the best candidate is below confidenceThreshold
//   OR when no candidates were returned. Caller should offer "create new
//   project" as an option.
// ---------------------------------------------------------------------------
export interface RoutingResult {
  candidates: RoutingCandidate[];
  createSuggested: boolean;
}

// ---------------------------------------------------------------------------
// routeIdea options.
// ---------------------------------------------------------------------------
export interface RouteIdeaOpts {
  /**
   * Minimum score required for the best candidate to suppress the create
   * suggestion. Default: 0.5. Set higher to require stronger matches.
   */
  confidenceThreshold?: number;
}

// Default confidence threshold — below this, a new-project suggestion surfaces.
const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Provider response shape (what we ask the LLM to return as JSON).
// ---------------------------------------------------------------------------
interface RawCandidate {
  name: string;
  score: number;
  rationale: string;
}

/**
 * Parse the provider's raw text response into an array of RawCandidate.
 * Returns [] on any parse failure — callers treat that as "no candidates".
 */
function parseProviderResponse(raw: string): RawCandidate[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RawCandidate =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).name === 'string' &&
        typeof (item as Record<string, unknown>).score === 'number' &&
        typeof (item as Record<string, unknown>).rationale === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Build the ranking prompt sent to the provider. Lists all project names +
 * their paths so the LLM can reason about them without additional context.
 */
function buildRankingPrompt(idea: string, projects: ProjectRecord[]): string {
  const projectList = projects
    .map((p) => `- name: "${p.name}", path: "${p.path}"`)
    .join('\n');

  // `idea` is user-supplied / untrusted input. It is embedded verbatim into the
  // LLM prompt here. The defense against malformed or prompt-injected LLM
  // responses is `parseProviderResponse`, which validates the response shape
  // and yields empty candidates (→ createSuggested=true) on any parse failure.
  // Project paths come from the registry (operator-controlled), not from users.
  return (
    `You are a project router. Given a feature idea and a list of existing projects, ` +
    `rank each project by how well it fits the idea.\n\n` +
    `Feature idea: "${idea}"\n\n` +
    `Projects:\n${projectList}\n\n` +
    `Return a JSON array (no markdown fences) where each element is:\n` +
    `{ "name": "<project name>", "score": <0.0–1.0>, "rationale": "<1-2 sentence reason>" }\n\n` +
    `Sort by score descending. Return [] if no project fits at all.`
  );
}

/**
 * routeIdea — inference-only routing (Task 17, FR-3).
 *
 * Reads all registry projects, asks `provider` to rank them against `idea`,
 * filters provider hallucinations (names not in registry), and returns a
 * RoutingResult with:
 *   - candidates: ranked by score descending, with ProjectRecord + rationale.
 *   - createSuggested: true when the best score is below the threshold OR
 *     when no candidates survive filtering.
 *
 * This is INFERENCE only. No routing decision is committed. The human gate
 * (confirm / redirect / decline) is Task 18.
 *
 * @param idea            The feature or project idea to route.
 * @param registryReader  Reads project records (injectable for tests).
 * @param provider        LLM stub or real implementation (injectable for tests).
 * @param opts            Optional overrides (e.g. confidenceThreshold).
 */
export async function routeIdea(
  idea: string,
  registryReader: RegistryReader,
  provider: RoutingProvider,
  opts: RouteIdeaOpts = {},
): Promise<RoutingResult> {
  const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  // 1. Load registry projects.
  const projects = await registryReader.listProjects();

  // Short-circuit: empty registry → always suggest create (no LLM call needed).
  if (projects.length === 0) {
    return { candidates: [], createSuggested: true };
  }

  // 2. Ask provider to rank candidates.
  const prompt = buildRankingPrompt(idea, projects);
  const rawResponse = await provider.invoke(prompt);

  // 3. Parse + validate provider response.
  const rawCandidates = parseProviderResponse(rawResponse);

  // 4. Filter to only real registry projects (prevent hallucinations), then
  //    join with full ProjectRecord.
  const projectByName = new Map<string, ProjectRecord>(projects.map((p) => [p.name, p]));

  const candidates: RoutingCandidate[] = rawCandidates
    .filter((rc) => projectByName.has(rc.name))
    .map((rc) => ({
      project: projectByName.get(rc.name)!,
      score: rc.score,
      rationale: rc.rationale,
    }))
    // Sort descending by score (provider may not have sorted reliably).
    .sort((a, b) => b.score - a.score);

  // 5. Determine whether to suggest creating a new project.
  //    createSuggested=true when:
  //      - no candidates survived filtering, OR
  //      - the best candidate's score is below the confidence threshold.
  const bestScore = candidates.length > 0 ? candidates[0].score : -1;
  const createSuggested = bestScore < threshold;

  return { candidates, createSuggested };
}

// ---------------------------------------------------------------------------
// handleGateResponse (Task 18, FR-3) — confirm/redirect/decline gate.
//
// Pure function — no real repo I/O, no disk reads/writes, no git/gh calls.
// Maps a RoutingResult + operator text response → GateOutcome.
//
// Decision tree:
//   1. decline/empty response           → 'declined' (onAuthor NEVER called)
//   2. near-tie top candidates          → 'needs-choice' (refuses to auto-pick)
//   3. confirm ('y'/'yes')              → 'confirmed' with top candidate project
//   4. operator names registered proj   → 'redirected' with that project record
//   5. operator names unknown proj      → 'reprompt' (no fabricated project)
//
// Near-tie definition: the top-two candidates' scores differ by less than
// TIE_DELTA (0.05). This prevents silent auto-selection when the router is
// uncertain.
//
// @param result          The RoutingResult from routeIdea.
// @param response        The operator's raw text response (trimmed internally).
// @param registered      Full list of registered projects (for redirect lookup).
// @param onAuthor        Optional callback; injected as a spy in tests to
//                        assert zero calls on declined paths.
// ---------------------------------------------------------------------------

/** Maximum score delta between the top two candidates to be considered a tie. */
const TIE_DELTA = 0.05;

/** Words that the operator can type to confirm the proposed routing. */
const CONFIRM_WORDS = new Set(['y', 'yes']);

/** Words that the operator can type to decline. */
const DECLINE_WORDS = new Set(['n', 'no']);

export function handleGateResponse(
  result: RoutingResult,
  response: string,
  registered: ProjectRecord[],
  onAuthor?: () => void,
): GateOutcome {
  const trimmed = response.trim().toLowerCase();

  // ── 1. Decline / empty ─────────────────────────────────────────────────────
  // Empty, whitespace-only, or explicit 'n'/'no' → declined immediately.
  // onAuthor is deliberately NOT called here — callers can spy on this.
  if (trimmed === '' || DECLINE_WORDS.has(trimmed)) {
    return { kind: 'declined' };
  }

  // ── 2. Near-tie check (runs BEFORE confirm processing) ────────────────────
  // If the top two candidates are within TIE_DELTA, surface 'needs-choice'
  // even when the operator typed 'y'. Forcing an explicit selection prevents
  // silent auto-routing when the engineer is undecided.
  if (result.candidates.length >= 2) {
    const [first, second] = result.candidates;
    if (first.score - second.score < TIE_DELTA) {
      return { kind: 'needs-choice', candidates: result.candidates };
    }
  }

  // ── 3. Confirm ─────────────────────────────────────────────────────────────
  if (CONFIRM_WORDS.has(trimmed)) {
    // Must have at least one candidate to confirm.
    if (result.candidates.length === 0) {
      // No candidates → cannot confirm; treat as declined.
      return { kind: 'declined' };
    }
    const top = result.candidates[0];
    onAuthor?.();
    return { kind: 'confirmed', project: top.project };
  }

  // ── 4. Redirect lookup ─────────────────────────────────────────────────────
  // Operator typed something other than y/yes/n/no — treat it as a project
  // name. Look it up in the registered list (case-sensitive, exact match).
  const registeredByName = new Map<string, ProjectRecord>(registered.map((p) => [p.name, p]));
  const target = registeredByName.get(response.trim()); // original casing for exact match

  if (target !== undefined) {
    onAuthor?.();
    return { kind: 'redirected', project: target };
  }

  // ── 5. Unknown project name → reprompt ────────────────────────────────────
  // The operator named a project that does not exist in the registry.
  // Return 'reprompt' carrying the unrecognised name for the UI to surface.
  // No project path is invented or fabricated.
  return { kind: 'reprompt', unknownName: response.trim() };
}

// ---------------------------------------------------------------------------
// createOnNoFit (Task 19, FR-4) — create-and-retarget.
//
// When the routing gate yields no fit and the operator confirms a new project
// name, this function:
//   1. Guards against decline: an empty or whitespace-only name is treated as a
//      decline (no-op). Returns { kind: 'declined' } immediately — createFn is
//      NEVER called.
//   2. Calls createFn(name) to scaffold + register the new project. Any error
//      from createFn is propagated directly — no swallowing, no orphan state.
//   3. Re-resolves the new project from the registry reader (by listing all
//      projects and finding the exact name match). If the record is absent after
//      create (wrong registry path, silent write failure) an explicit error is
//      thrown rather than returning a fabricated or undefined target.
//   4. Returns { kind: 'created', target: TargetRepo } with the canonical path
//      from the registry record — NOT constructed from the name string.
//
// IMPORTANT: The registry reader is queried ONLY after a successful createFn
// call. If createFn throws, the reader is never touched (no orphan lookup).
// ---------------------------------------------------------------------------

/**
 * Injected create function (corresponds to the 9.2 `conduct create` path).
 * Accepts the project name and resolves when scaffold + registry write succeed.
 * Any failure must reject — the caller (createOnNoFit) propagates it.
 */
export type CreateFn = (name: string) => Promise<void>;

/**
 * Discriminated return type for createOnNoFit.
 *   created  — scaffold succeeded; target carries the new project's canonical path.
 *   declined — name was empty/whitespace; nothing was created; no authoring.
 */
export type CreateOnNoFitResult =
  | { kind: 'created'; target: TargetRepo }
  | { kind: 'declined' };

/**
 * createOnNoFit — FR-4 implementation.
 *
 * @param name           The project name supplied by the operator. Empty /
 *                       whitespace signals a decline — nothing is created.
 * @param createFn       Injected scaffold+register function (no real subprocess
 *                       in tests).
 * @param registryReader Injected reader used to re-resolve the new record after
 *                       create. Must reflect the post-create registry state.
 * @returns              CreateOnNoFitResult — { kind: 'created', target } on
 *                       success, { kind: 'declined' } when name is blank.
 * @throws               When createFn rejects (propagated verbatim), or when
 *                       the newly created project cannot be found in the
 *                       registry after a successful createFn call, or when the
 *                       registry is corrupt/unreadable after the create.
 */
export async function createOnNoFit(
  name: string,
  createFn: CreateFn,
  registryReader: RegistryReader,
): Promise<CreateOnNoFitResult> {
  // ── 1. Decline guard ───────────────────────────────────────────────────────
  // Empty or whitespace-only name → treat as a user declining the create offer.
  // createFn is NEVER invoked; the reader is NEVER touched; no side effects.
  if (name.trim() === '') {
    return { kind: 'declined' };
  }

  // ── 2. Scaffold + register via injected createFn ───────────────────────────
  // Any error propagates directly — no swallowing, no retry. The reader is only
  // queried AFTER a successful create so there are no orphan registry lookups.
  await createFn(name);

  // ── 3. Re-resolve from the registry ───────────────────────────────────────
  // List all projects from the (now-updated) registry and find the new record
  // by name. This may throw if the registry is corrupt/unreadable after create
  // (error propagates directly — stops all further authoring).
  const projects = await registryReader.listProjects();
  const record = projects.find((p) => p.name === name);

  if (record === undefined) {
    throw new Error(
      `createOnNoFit: project "${name}" not found in registry after create. ` +
        'The registry write may have targeted the wrong path or failed silently.',
    );
  }

  // ── 4. Build and return the TargetRepo from the canonical registry record ──
  // canonicalPath comes from the record — never constructed from the name string.
  const target: TargetRepo = {
    name: record.name,
    canonicalPath: record.path,
    ...(record.remote !== undefined ? { remote: record.remote } : {}),
  };

  return { kind: 'created', target };
}
