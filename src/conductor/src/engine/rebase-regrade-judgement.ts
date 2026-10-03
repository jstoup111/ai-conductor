/**
 * Post-rebase regrade judgement (ADR-2026-07-20 amendment).
 *
 * When a completed replay CHANGED the feature's own contribution (conflict
 * resolution altered the feature diff), whether the document-bound judged
 * gates — prd_audit and architecture_review_as_built — need a new grade is a
 * judgement call, not a path test. Machinery owns the bookkeeping: it computes
 * the bounded own-diff delta, dispatches one auxiliary judgement through an
 * injected provider boundary, validates the closed result schema, and fails
 * closed (reopen every candidate) on any invalid or unavailable judgement.
 * The verdict travels on the event spine as `rebase_regrade_judged`.
 */
import type { StepName } from '../types/index.js';
import type { GitRunner } from './rebase.js';
import type { ReplayIdentity } from './rebase-replay.js';

/** The only gates this judgement may reopen. coverage_binding never reads code. */
export const REBASE_REGRADE_GATES = ['prd_audit', 'architecture_review_as_built'] as const;
export type RebaseRegradeGate = (typeof REBASE_REGRADE_GATES)[number];

/** The shipped skill carrying the judgement policy and result contract. */
export const REBASE_REGRADE_SKILL = 'rebase-regrade';

/** Upper bound on the own-diff delta handed to the judge. */
export const REBASE_REGRADE_MAX_DELTA_BYTES = 48_000;

export interface RebaseRegradeInput {
  /** Gates that would otherwise be preserved and that the judge may reopen. */
  candidates: RebaseRegradeGate[];
  /** Files whose feature-owned patch differs between pre- and post-rebase. */
  changedFiles: string[];
  /** Pre/post feature patches for those files, bounded. */
  delta: string;
  truncated: boolean;
}

/** Provider boundary: dispatches the judgement prompt, returns raw output. */
export type RebaseRegradeJudge = (prompt: string) => Promise<{ success: boolean; output?: string }>;

export interface RebaseRegradeDecision {
  outcome: 'regrade' | 'preserve' | 'fail-closed';
  candidates: RebaseRegradeGate[];
  reopen: RebaseRegradeGate[];
  rationale?: string;
  reason?: string;
  /** Files whose feature-owned patch changed; empty when never computed. */
  changedFiles: string[];
}

function splitPatch(patch: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    const header = /^diff --git a\/(\S+) b\/(\S+)/.exec(chunk);
    if (!header) continue;
    files.set(header[2]!, chunk);
  }
  return files;
}

/** Position-independent patch body: drops blob ids and hunk line numbers. */
function normalizePatch(chunk: string | undefined): string {
  if (chunk === undefined) return '';
  return chunk
    .split('\n')
    .filter((line) => !line.startsWith('index '))
    .map((line) => (line.startsWith('@@') ? line.replace(/^@@[^@]*@@/, '@@') : line))
    .join('\n');
}

/**
 * Compute the feature's own-contribution delta: the feature patch before the
 * rebase (merge-base → pre-rebase head) against the feature patch after it
 * (target → completed head), restricted to files whose patch content differs.
 */
export async function computeOwnContributionDelta(
  git: GitRunner,
  identity: ReplayIdentity,
  candidates: RebaseRegradeGate[],
  maxBytes = REBASE_REGRADE_MAX_DELTA_BYTES,
): Promise<RebaseRegradeInput> {
  const before = await git(['diff', '--no-color', '--no-ext-diff', identity.mergeBase, identity.preRebaseHead]);
  const after = await git(['diff', '--no-color', '--no-ext-diff', identity.target, identity.completedHead]);
  if (before.exitCode !== 0 || after.exitCode !== 0) {
    throw new Error('feature own-diff could not be computed');
  }
  const pre = splitPatch(before.stdout);
  const post = splitPatch(after.stdout);
  const changedFiles = [...new Set([...pre.keys(), ...post.keys()])]
    .filter((file) => normalizePatch(pre.get(file)) !== normalizePatch(post.get(file)))
    .sort();
  let delta = '';
  for (const file of changedFiles) {
    delta += `=== ${file} — feature patch BEFORE rebase ===\n${pre.get(file) ?? '(absent)\n'}` +
      `=== ${file} — feature patch AFTER rebase ===\n${post.get(file) ?? '(absent)\n'}`;
  }
  const truncated = Buffer.byteLength(delta) > maxBytes;
  if (truncated) delta = Buffer.from(delta).subarray(0, maxBytes).toString('utf8');
  return { candidates, changedFiles, delta, truncated };
}

export function renderRebaseRegradePrompt(input: RebaseRegradeInput): string {
  return [
    'A rebase conflict resolution changed this feature\'s own diff. Decide whether the change warrants a new grade from any candidate gate. Judge only the supplied delta; do not read files or run commands.',
    'Return exactly one JSON object: {"regrade": boolean, "gates": [candidate gate names], "rationale": string}.',
    JSON.stringify({
      candidates: input.candidates,
      changedFiles: input.changedFiles,
      truncated: input.truncated,
    }),
    input.delta,
  ].join('\n\n');
}

export type ParsedRegrade =
  | { ok: true; regrade: boolean; gates: RebaseRegradeGate[]; rationale: string }
  | { ok: false; reason: string };

/** Closed-schema validation of the judge's output. */
export function parseRebaseRegradeJudgement(output: string, candidates: readonly RebaseRegradeGate[]): ParsedRegrade {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end < start) return { ok: false, reason: 'no JSON object in judgement output' };
  let value: unknown;
  try {
    value = JSON.parse(output.slice(start, end + 1));
  } catch {
    return { ok: false, reason: 'judgement output is not valid JSON' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'judgement is not a JSON object' };
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(['regrade', 'gates', 'rationale']);
  const extra = Object.keys(record).filter((key) => !allowed.has(key));
  if (extra.length > 0) return { ok: false, reason: `unknown judgement keys: ${extra.join(', ')}` };
  if (typeof record.regrade !== 'boolean') return { ok: false, reason: 'regrade must be a boolean' };
  if (typeof record.rationale !== 'string' || record.rationale.trim() === '') {
    return { ok: false, reason: 'rationale must be a non-empty string' };
  }
  if (!Array.isArray(record.gates) || record.gates.some((gate) => typeof gate !== 'string')) {
    return { ok: false, reason: 'gates must be an array of gate names' };
  }
  const gates = [...new Set(record.gates as string[])];
  const unknown = gates.filter((gate) => !candidates.includes(gate as RebaseRegradeGate));
  if (unknown.length > 0) return { ok: false, reason: `gates outside the candidate set: ${unknown.join(', ')}` };
  if (record.regrade && gates.length === 0) return { ok: false, reason: 'regrade true requires at least one gate' };
  if (!record.regrade && gates.length > 0) return { ok: false, reason: 'regrade false must name no gates' };
  return { ok: true, regrade: record.regrade, gates: gates as RebaseRegradeGate[], rationale: record.rationale };
}

/**
 * Resolve the regrade decision. Any missing judge, thrown dispatch, failed
 * provider result, or schema violation reopens every candidate.
 */
export async function judgeRebaseRegrade(
  computeInput: () => Promise<RebaseRegradeInput>,
  candidates: RebaseRegradeGate[],
  judge: RebaseRegradeJudge | undefined,
): Promise<RebaseRegradeDecision> {
  let changedFiles: string[] = [];
  const failClosed = (reason: string): RebaseRegradeDecision =>
    ({ outcome: 'fail-closed', candidates, reopen: [...candidates], reason, changedFiles });
  if (!judge) return failClosed('no regrade judge available at this rebase seam');
  let result: { success: boolean; output?: string };
  try {
    const input = await computeInput();
    changedFiles = input.changedFiles;
    result = await judge(renderRebaseRegradePrompt(input));
  } catch (error) {
    return failClosed(`regrade judgement dispatch failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!result.success || typeof result.output !== 'string') {
    return failClosed(`regrade judgement provider failed: ${result.output ?? 'no output'}`);
  }
  const parsed = parseRebaseRegradeJudgement(result.output, candidates);
  if (!parsed.ok) return failClosed(`invalid regrade judgement: ${parsed.reason}`);
  return parsed.regrade
    ? { outcome: 'regrade', candidates, reopen: parsed.gates, rationale: parsed.rationale, changedFiles }
    : { outcome: 'preserve', candidates, reopen: [], rationale: parsed.rationale, changedFiles };
}

export function isRebaseRegradeGate(gate: StepName | string): gate is RebaseRegradeGate {
  return (REBASE_REGRADE_GATES as readonly string[]).includes(gate);
}
