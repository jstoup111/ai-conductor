import type { ComplexityTier, StepDefinition, StepName } from '../types/index.js';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const DECIDE_GRANT_PATH = '.pipeline/decide-grant.json';

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
  try {
    const value: unknown = JSON.parse(
      await readFile(join(projectRoot, DECIDE_GRANT_PATH), 'utf-8'),
    );
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
  const grant = await readOperatorGrant(projectRoot);
  if (grant?.step !== target) return null;
  try {
    await unlink(join(projectRoot, DECIDE_GRANT_PATH));
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
