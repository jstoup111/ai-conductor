import type { ComplexityTier, StepDefinition, StepName } from '../types/index.js';
import { readFile, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Operator-only grant store, in the MAIN checkout's daemon-owned directory.
 *
 * The grant used to live at `<worktree>/.pipeline/decide-grant.json` — inside the
 * very directory the build agent writes all build long (task-status, evidence,
 * verdicts). That put the authorization token within reach of the subject it
 * authorizes, so "operator-only" held by convention, not by construction: on
 * 2026-08-09 an agent hand-wrote two grant files, never touched the CLI, and the
 * daemon honored both and dispatched `plan`.
 *
 * `.daemon/` is daemon-owned, sits outside every worktree, and is already excluded
 * from the self-host live boundary. A build agent operating inside its worktree has
 * no business there, and a `.pipeline/decide-grant.json` it writes now authorizes
 * nothing at all.
 */
const DAEMON_GRANT_DIR = join('.daemon', 'grants');

/**
 * The one DECIDE target no grant may ever unlock, even a well-formed
 * operator-written one (operator rule, 2026-08-09): the daemon must never re-plan.
 * A grant approves ONE authoring pass, but the daemon then runs the step itself —
 * rewriting an approved DECIDE artifact with no human at the gate, which is the
 * same class of failure the re-entry was meant to repair.
 */
const UNGRANTABLE_STEP: StepName = 'plan';

/**
 * Resolve the operator grant path for a run rooted at `projectRoot`.
 *
 * A daemon feature runs in `<root>/.worktrees/<slug>`, so the main checkout and the
 * slug are both recoverable from that path; the grant is read from
 * `<root>/.daemon/grants/<slug>.json`. A run whose root is not a `.worktrees/<slug>`
 * path (interactive `/conduct` in the main checkout) has no daemon grant store —
 * and needs none, since interactive DECIDE entry never consults a grant.
 */
export function resolveGrantPath(projectRoot: string): string | null {
  const slug = basename(projectRoot);
  const worktreesDir = dirname(projectRoot);
  if (basename(worktreesDir) !== '.worktrees') return null;
  return join(dirname(worktreesDir), DAEMON_GRANT_DIR, `${slug}.json`);
}

export interface OperatorGrant {
  version?: number;
  step: StepName;
  reason?: string;
  grantedAt?: string;
  grantedBy: string;
  [key: string]: unknown;
}

/** Read a durable operator grant. Malformed or unavailable grants authorize nothing. */
export async function readOperatorGrant(projectRoot: string): Promise<OperatorGrant | null> {
  const grantPath = resolveGrantPath(projectRoot);
  if (grantPath === null) return null;
  try {
    const value: unknown = JSON.parse(await readFile(grantPath, 'utf-8'));
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof (value as { step?: unknown }).step !== 'string' ||
      typeof (value as { grantedBy?: unknown }).grantedBy !== 'string'
    ) {
      return null;
    }
    return value as OperatorGrant;
  } catch {
    return null;
  }
}

/**
 * Consume an exact, previously-read grant before provider work begins.
 * A failed deletion fails closed, leaving the caller to re-evaluate with no grant.
 */
export async function consumeOperatorGrant(
  projectRoot: string,
  target: StepName,
): Promise<OperatorGrant | null> {
  const grantPath = resolveGrantPath(projectRoot);
  if (grantPath === null) return null;
  const grant = await readOperatorGrant(projectRoot);
  if (grant?.step !== target) return null;
  // Defense in depth: `plan` is refused before consumption is ever reached, so a
  // plan grant must never be spent — it stays on disk as operator-visible evidence.
  if (target === UNGRANTABLE_STEP) return null;
  try {
    await unlink(grantPath);
    return grant;
  } catch {
    return null;
  }
}

export interface DecideEntryHalt {
  reason: string;
  target: StepName;
  sourceGate: StepName | 'forward-walk' | 'resume-clamp';
  evidence?: string;
}

export type DecideEntryDisposition =
  | { kind: 'enter'; grantedBy: string }
  | { kind: 'fast-forward'; as: 'done' | 'skipped' }
  | { kind: 'halt'; halt: DecideEntryHalt };

/**
 * Render the operator-facing body for a refused autonomous DECIDE entry.
 * Callers own the durable marker and must write this as `needs-human`.
 */
export function renderDecideEntryHalt(halt: DecideEntryHalt): string {
  return [
    'DECIDE entry refused — autonomous run may not enter DECIDE without operator direction.',
    '',
    `Source gate:       ${halt.sourceGate}`,
    `Requested target:  ${halt.target}`,
    `Evidence:          ${halt.evidence ?? 'none provided'}`,
    `Why refused:       ${halt.reason}`,
    'Operator choices:  direct a return to a named step | correct the routing target | reject the kickback',
  ].join('\n');
}

/**
 * Decide whether a daemon may enter a DECIDE-phase target.
 *
 * This is deliberately a pure policy: callers own reading contracts, checking
 * evidence, recording state, and consuming grants.
 */
export function decideEntryDisposition(input: {
  target: StepName;
  steps: StepDefinition[];
  daemon: boolean;
  tier: ComplexityTier | undefined;
  hasContract: boolean;
  satisfied: boolean | 'unknown';
  grant: OperatorGrant | null;
  sourceGate: StepName | 'forward-walk' | 'resume-clamp';
  evidence?: string;
}): DecideEntryDisposition {
  if (!input.daemon) return { kind: 'enter', grantedBy: 'interactive' };

  const targetStep = input.steps.find((step) => step.name === input.target);
  if (!targetStep?.phase) {
    return halt(input, `DECIDE target '${input.target}' could not be resolved from the configured steps.`);
  }

  if (targetStep.phase !== 'DECIDE') {
    return { kind: 'enter', grantedBy: 'non-decide-target' };
  }

  if (input.tier !== undefined && targetStep.skippableForTiers.includes(input.tier)) {
    return { kind: 'fast-forward', as: 'skipped' };
  }

  if (!input.hasContract) return { kind: 'fast-forward', as: 'skipped' };
  if (input.satisfied === true) return { kind: 'fast-forward', as: 'done' };

  // `plan` is ungrantable, full stop — checked BEFORE the grant so no grant of any
  // provenance can reach it. Deliberately placed AFTER the tier-skippable /
  // no-contract / satisfied fast-forwards: those never RUN the step, they only
  // record it, so halting them would wedge ordinary S-tier and already-satisfied
  // flows.
  if (input.target === UNGRANTABLE_STEP) {
    return halt(
      input,
      `Autonomous entry to '${UNGRANTABLE_STEP}' is never permitted — the daemon may not ` +
        're-plan, and no operator grant authorizes this target. Drive the plan ' +
        'revision interactively, then resume the feature.',
    );
  }

  if (
    input.grant?.step === input.target
  ) {
    return { kind: 'enter', grantedBy: input.grant.grantedBy };
  }

  return halt(
    input,
    `Autonomous entry to DECIDE target '${input.target}' requires an in-scope grant from '${input.sourceGate}'.`,
  );
}

function halt(
  input: Pick<
    Parameters<typeof decideEntryDisposition>[0],
    'target' | 'sourceGate' | 'evidence'
  >,
  reason: string,
): DecideEntryDisposition {
  return {
    kind: 'halt',
    halt: {
      reason,
      target: input.target,
      sourceGate: input.sourceGate,
      ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
    },
  };
}
