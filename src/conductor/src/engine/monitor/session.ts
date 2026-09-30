import {
  launchInteractiveSession,
  type InteractiveLaunchOutcome,
  type InteractiveLaunchRequest,
} from '../../execution/interactive-launch.js';
import type { ProjectHalt } from './halt-inventory.js';

export interface GuidedSessionRequest {
  readonly provider: string;
  readonly cwd: string;
  readonly halt: ProjectHalt;
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

function openingPrompt(request: GuidedSessionRequest): string {
  const { halt } = request;
  return [
    'Resolve this halted daemon feature with the existing daemon-triage procedure.',
    `Invoke ${triageInvocation(request.provider)} for feature ${halt.slug}.`,
    `Project: ${halt.project}`,
    `Feature: ${halt.slug}`,
    `Reason: ${halt.reason}`,
    `Classification: ${halt.haltClass}`,
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
