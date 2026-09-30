import {
  launchInteractiveSession,
  type InteractiveLaunchOutcome,
  type InteractiveLaunchRequest,
} from '../../execution/interactive-launch.js';
import type { HaltDisposition } from '../halt-marker.js';
import type { ProjectHalt } from './halt-inventory.js';

/** Halt context at the external session boundary, before classification is trusted. */
export type GuidedSessionHalt = Omit<ProjectHalt, 'haltClass'> & {
  readonly haltClass?: unknown;
};

export interface GuidedSessionRequest {
  readonly provider: string;
  readonly cwd: string;
  readonly halt: GuidedSessionHalt;
}

export type GuidedSessionLauncher = (
  request: InteractiveLaunchRequest,
) => Promise<InteractiveLaunchOutcome>;

export interface GuidedSessionOptions {
  readonly launch?: GuidedSessionLauncher;
}

function triageInvocation(provider: string): string {
  return provider === 'claude' ? '/daemon-triage' : '$daemon-triage';
}

function recognizedHaltDisposition(value: unknown): HaltDisposition | undefined {
  if (typeof value !== 'string') return undefined;
  switch (value) {
    case 'needs-human':
    case 'mechanical':
    case 'protected-artifact':
    case 'plan-gap':
    case 'kickback-cap':
    case 'over-scope':
    case 'legacy':
    case 'unclassified':
      return value;
  }
  return undefined;
}

/** Maps every canonical halt disposition to the one recovery presentation it owns. */
export function recoveryProcedure(haltClass: HaltDisposition): string {
  switch (haltClass) {
    case 'needs-human':
      return 'Follow the needs-human halt recovery in docs/runbooks/stalled-or-stuck-feature.md.';
    case 'mechanical':
      return 'Follow the mechanical halt recovery in docs/runbooks/stalled-or-stuck-feature.md.';
    case 'protected-artifact':
      return 'Follow the protected-artifact halt recovery in docs/runbooks/stalled-or-stuck-feature.md.';
    case 'plan-gap':
      return 'Follow the plan-gap halt recovery in docs/runbooks/stalled-or-stuck-feature.md.';
    case 'kickback-cap':
      return 'Follow the kickback-cap halt recovery in docs/runbooks/stalled-or-stuck-feature.md.';
    case 'over-scope':
      return 'Resolve every over-scope decision before clearing the halt.';
    case 'legacy':
      return 'Follow the legacy halt recovery in docs/runbooks/stalled-or-stuck-feature.md.';
    case 'unclassified':
      return 'Gather read-only evidence and determine the halt classification before recovery.';
  }
}

function openingPrompt(request: GuidedSessionRequest): string {
  const { halt } = request;
  const haltClass = recognizedHaltDisposition(halt.haltClass);
  return [
    'Resolve this halted daemon feature with the existing daemon-triage procedure.',
    `Invoke ${triageInvocation(request.provider)} for feature ${halt.slug}.`,
    `Project: ${halt.project}`,
    `Feature: ${halt.slug}`,
    `Reason: ${halt.reason}`,
    `Classification: ${haltClass === undefined || haltClass === 'unclassified' ? 'undetermined' : haltClass}`,
    `Recovery procedure: ${recoveryProcedure(haltClass ?? 'unclassified')}`,
  ].join('\n');
}

/** Opens a fresh operator-owned session with the halted feature's evidence. */
export async function openGuidedSession(
  request: GuidedSessionRequest,
  options: GuidedSessionOptions = {},
): Promise<InteractiveLaunchOutcome> {
  const launch = options.launch ?? launchInteractiveSession;
  return launch({
    provider: request.provider,
    cwd: request.cwd,
    openingPrompt: openingPrompt(request),
  });
}
