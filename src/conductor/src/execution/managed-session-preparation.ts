import type { ManagedSessionContext } from './managed-session-context.js';
import { ProviderSetupUnavailableError } from '../engine/provider-setup-failure.js';

/** The minimum evidence a provider policy must supply before it may write telemetry. */
export type ObservationDestinationProbeResult =
  | { readonly producerWrite: 'allowed'; readonly protectedWrites: 'refused' }
  | { readonly producerWrite: 'refused' | 'unproven'; readonly protectedWrites: 'refused' | 'unproven' };

export interface ObservationDestinationProbeInput {
  readonly provider: string;
  readonly producerRoot: string;
  /** Representative protected roots; these are never made writable by preparation. */
  readonly protectedPaths: readonly string[];
}

export type ObservationDestinationProbe = (
  input: ObservationDestinationProbeInput,
) => Promise<ObservationDestinationProbeResult>;

export interface PrepareManagedSessionObservationDestinationInput {
  readonly provider: string;
  readonly context: ManagedSessionContext;
  readonly readOnlyReview: boolean;
  readonly probe: ObservationDestinationProbe;
}

/**
 * Admit the one producer root only when the selected native review policy
 * proves both halves of the contract.  This does not alter native profiles;
 * the supplied probe is the provider-specific policy seam.
 */
export async function prepareManagedSessionObservationDestination(
  input: PrepareManagedSessionObservationDestinationInput,
): Promise<{ readonly producerRoot: string }> {
  if (!input.readOnlyReview) return { producerRoot: input.context.producerRoot };
  const result = await input.probe({
    provider: input.provider,
    producerRoot: input.context.producerRoot,
    protectedPaths: protectedPaths(input.context),
  });
  if (result.producerWrite !== 'allowed' || result.protectedWrites !== 'refused') {
    throw unavailable(input.provider, 'the selected read-only policy cannot prove narrow observation access');
  }
  return { producerRoot: input.context.producerRoot };
}

function protectedPaths(context: ManagedSessionContext): readonly string[] {
  return [
    `${context.worktreeRoot}/source`,
    `${context.worktreeRoot}/.pipeline/sealed`,
    `${context.worktreeRoot}/.pipeline/unrelated`,
    `${context.projectRoot}/.codex`,
  ];
}

function unavailable(provider: string, reason: string): ProviderSetupUnavailableError {
  return new ProviderSetupUnavailableError({
    provider,
    capability: 'managed-observation-destination',
    reason,
    recoveryAction: 'Configure a provider review policy that proves the per-dispatch observation destination is writable while protected paths remain refused.',
  });
}
