import {
  launchInteractiveSession,
  type InteractiveLaunchOutcome,
  type InteractiveLaunchRequest,
} from '../../execution/interactive-launch.js';
import { findBuiltInProviderDescriptor } from '../../execution/provider-catalog.js';
import { join } from 'node:path';
import type { HaltDisposition } from '../halt-marker.js';
import type { EffortLevel } from '../../types/config.js';
import type { ProjectHalt } from './halt-inventory.js';

/** Halt context at the external session boundary, before classification is trusted. */
export type GuidedSessionHalt = Omit<ProjectHalt, 'haltClass'> & {
  readonly haltClass?: unknown;
};

export interface GuidedSessionRequest {
  readonly provider: string;
  readonly model?: string;
  readonly effort?: EffortLevel;
  readonly halt: GuidedSessionHalt;
}

export type GuidedSessionLauncher = (
  request: InteractiveLaunchRequest,
) => Promise<InteractiveLaunchOutcome>;

export interface GuidedSessionOptions {
  readonly launch?: GuidedSessionLauncher;
}

function triageInvocation(provider: string): string {
  return `${findBuiltInProviderDescriptor(provider)?.invocationPrefix ?? '$'}daemon-triage`;
}

const HALT_DISPOSITIONS: Readonly<Record<HaltDisposition, true>> = {
  'needs-human': true,
  mechanical: true,
  'protected-artifact': true,
  'plan-gap': true,
  'kickback-cap': true,
  'over-scope': true,
  legacy: true,
  unclassified: true,
};

function recognizedHaltDisposition(value: unknown): HaltDisposition | undefined {
  if (typeof value !== 'string') return undefined;
  return Object.hasOwn(HALT_DISPOSITIONS, value) ? value as HaltDisposition : undefined;
}

/** The queue and session use one presentation for a missing or invalid sidecar. */
export function displayHaltClassification(haltClass: unknown): string {
  const recognized = recognizedHaltDisposition(haltClass);
  return recognized === undefined || recognized === 'unclassified' ? 'undetermined' : recognized;
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
    `Classification: ${displayHaltClassification(haltClass)}`,
    `Recovery procedure: ${recoveryProcedure(haltClass ?? 'unclassified')}`,
  ].join('\n');
}

function haltedWorktree(halt: GuidedSessionHalt): string {
  return join(halt.project, '.worktrees', halt.slug);
}

/** Opens a fresh operator-owned session with the halted feature's evidence. */
export async function openGuidedSession(
  request: GuidedSessionRequest,
  options: GuidedSessionOptions = {},
): Promise<InteractiveLaunchOutcome> {
  const launch = options.launch ?? launchInteractiveSession;
  return launch({
    provider: request.provider,
    model: request.model,
    effort: request.effort,
    cwd: haltedWorktree(request.halt),
    openingPrompt: openingPrompt(request),
  });
}
