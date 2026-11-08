import { requireProviderCapability, type BuiltInProviderId } from '../../execution/provider-catalog.js';

export type BoundaryChoice = 'continue' | 'switch' | 'handoff';

/**
 * Validate a launcher boundary choice without probing providers.  The caller owns
 * prompts and spawning; this pure boundary keeps a rejected switch from changing
 * either the branch or the Composer record.
 */
export function resolveBoundaryProvider(input: {
  choice: BoundaryChoice;
  activeProvider: BuiltInProviderId;
  switchTo?: BuiltInProviderId;
  hasRemote: boolean;
}): { action: 'resume'; provider: BuiltInProviderId } | { action: 'handoff' } {
  if (input.choice === 'handoff') {
    if (!input.hasRemote) throw new Error('compose handoff: this Composer run exists only locally and cannot be handed off.');
    return { action: 'handoff' };
  }
  const provider = input.choice === 'switch' ? input.switchTo : input.activeProvider;
  if (!provider) throw new Error('compose boundary: choose a provider with interactiveLaunch capability.');
  requireProviderCapability(provider, 'interactiveLaunch');
  return { action: 'resume', provider };
}
