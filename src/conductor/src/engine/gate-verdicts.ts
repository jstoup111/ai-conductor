import { join } from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import type { StepName } from '../types/index.js';
import {
  checkStepCompletion,
  GATE_ONLY_PREDICATES,
  type CompletionContext,
  type CompletionResult,
} from './artifacts.js';

/**
 * Objective completion check for a gate. Prefers the richer kickback-target
 * predicates (plan/stories) when present, else delegates to the conductor's
 * standard per-step completion check (build/manual_test/retro/finish/glob).
 * This is the single source the verdict layer recomputes from disk.
 */
export async function checkGateCompletion(
  dir: string,
  step: StepName,
  ctx: CompletionContext = {},
): Promise<CompletionResult> {
  const gatePredicate = GATE_ONLY_PREDICATES[step];
  if (gatePredicate) return gatePredicate(dir, ctx);
  return checkStepCompletion(dir, step, ctx);
}

/**
 * A durable, per-feature gate verdict. Written to `.pipeline/gates/<step>.json`
 * inside a feature's worktree. The gate-driven loop's selector reads these to
 * pick the next unsatisfied gate; a downstream step writes an upstream verdict
 * with `satisfied: false` + `kickback` provenance to re-open that gate.
 *
 * The loop OWNS objective verdicts: it recomputes them from on-disk evidence via
 * computeAndWriteVerdict() after each step rather than trusting an agent's
 * self-report. The only agent-authored writes are kickback invalidations, which
 * must carry evidence (enforced at the write boundary — see Phase 3).
 */
export interface GateVerdict {
  satisfied: boolean;
  /** Why — for an unsatisfied verdict, what's missing. */
  reason?: string;
  /** Epoch ms when this verdict was computed/written. */
  checkedAt: number;
  /** Set only on a kickback invalidation: which step re-opened this gate, and why. */
  kickback?: {
    from: StepName;
    evidence: string;
  };
}

export const GATES_DIR = '.pipeline/gates';

function verdictPath(dir: string, step: StepName): string {
  return join(dir, GATES_DIR, `${step}.json`);
}

/**
 * Recompute a gate's objective verdict from on-disk evidence and persist it.
 * Wraps the existing per-step completion predicates (build/manual_test/retro/
 * finish) and the new plan/stories predicates — a single uniform path.
 */
export async function computeAndWriteVerdict(
  dir: string,
  step: StepName,
  ctx: CompletionContext = {},
): Promise<GateVerdict> {
  const result = await checkGateCompletion(dir, step, ctx);
  const verdict: GateVerdict = {
    satisfied: result.done,
    reason: result.reason,
    checkedAt: Date.now(),
  };
  await writeVerdict(dir, step, verdict);
  return verdict;
}

/** Persist a verdict (objective or kickback) to `.pipeline/gates/<step>.json`. */
export async function writeVerdict(
  dir: string,
  step: StepName,
  verdict: GateVerdict,
): Promise<void> {
  await mkdir(join(dir, GATES_DIR), { recursive: true });
  await writeFile(
    verdictPath(dir, step),
    JSON.stringify(verdict, null, 2) + '\n',
    'utf-8',
  );
}

/**
 * Prefix every skip-origin verdict `reason` carries, so a reader (and the
 * dashboard) can tell "this gate was deliberately not run" apart from "this
 * gate ran and its evidence passed".
 */
export const SKIP_VERDICT_PREFIX = 'skipped: ';

/**
 * Record a verdict-bearing gate that was resolved by a SKIP rather than by a
 * run (tier skip, track skip, config disable, `when:` false, upstream skip, or
 * the daemon's in-loop `retro` skip).
 *
 * Why this exists: `advanceTail` is the only place a run-step's objective
 * verdict is computed, and it is reached exclusively on the success tail. Every
 * skip path resolves the step and `continue`s, so the gate used to end the run
 * with NO verdict on disk at all — and `gateSatisfied` (selector.ts) then falls
 * back to the step-state flag, i.e. exactly the self-report the verdict layer
 * exists to distrust. `retro` is the step this bit hardest: it is `loopGate`,
 * it is skipped for tier S and on every daemon run, and it therefore shipped
 * "done" with no `.pipeline/gates/retro.json` anywhere in the audit record.
 *
 * The verdict is `satisfied: true` because that is what the selector already
 * does with a skipped gate (`isSkipped` short-circuits ahead of
 * `gateSatisfied`) — this writes the fact down instead of changing it. The
 * `reason` names the skip cause so a skip is never mistaken for passing
 * evidence.
 */
export async function recordSkipVerdict(
  dir: string,
  step: StepName,
  cause: string,
): Promise<GateVerdict> {
  const verdict: GateVerdict = {
    satisfied: true,
    reason: `${SKIP_VERDICT_PREFIX}${cause}`,
    checkedAt: Date.now(),
  };
  await writeVerdict(dir, step, verdict);
  return verdict;
}

/** True when a persisted verdict records a skip rather than evaluated evidence. */
export function isSkipVerdict(verdict: GateVerdict | null | undefined): boolean {
  return verdict?.reason?.startsWith(SKIP_VERDICT_PREFIX) === true;
}

/** Read one gate's verdict, or null if absent/unreadable/malformed. */
export async function readVerdict(
  dir: string,
  step: StepName,
): Promise<GateVerdict | null> {
  try {
    const parsed = JSON.parse(await readFile(verdictPath(dir, step), 'utf-8'));
    if (!parsed || typeof parsed.satisfied !== 'boolean') return null;
    return parsed as GateVerdict;
  } catch {
    return null;
  }
}

/** Read every persisted gate verdict, keyed by step name. */
export async function readAllVerdicts(
  dir: string,
): Promise<Partial<Record<StepName, GateVerdict>>> {
  const out: Partial<Record<StepName, GateVerdict>> = {};
  let entries: string[];
  try {
    entries = await readdir(join(dir, GATES_DIR));
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const step = entry.slice(0, -'.json'.length) as StepName;
    const v = await readVerdict(dir, step);
    if (v) out[step] = v;
  }
  return out;
}
