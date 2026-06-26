// Routing outcome discriminated union (ADR-007, FR-3).
//
// Four exhaustive variants:
//   confirmed  — brain matched an existing project; caller proceeds with it.
//   redirected — brain chose a different project than the one suggested.
//   create     — no existing project matches; caller should scaffold a new one.
//   declined   — brain rejected the request entirely; NO project field (type-
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

import type { ProjectRecord, RegistryReader } from '../registry.js';

export type RoutingOutcome =
  | { kind: 'confirmed'; project: ProjectRecord }
  | { kind: 'redirected'; project: ProjectRecord }
  | { kind: 'create'; name: string }
  | { kind: 'declined' };

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
