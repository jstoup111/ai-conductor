import { access, chmod, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { validateManagedSessionProducerPath, type ManagedSessionContext } from './managed-session-context.js';
import { ProviderSetupUnavailableError } from '../engine/provider-setup-failure.js';
import { GH_OBSERVER_EXECUTABLE_NAME, renderGhObserverAsset } from './gh-observer-assets.js';
import { GH_OBSERVER_REAL_EXECUTABLE_ENV } from './gh-observer.js';

/** Coverage is intentionally bounded: an empty event set is never remote-write proof. */
export interface ManagedGhObservationCoverage {
  readonly boundary: 'managed-path-resolved-gh';
  readonly completeness: 'unknown';
}

export interface PreparedManagedGhObservation {
  readonly wrapperDirectory: string;
  readonly realExecutable: string;
  readonly coverage: ManagedGhObservationCoverage;
}

export interface PrepareManagedGhObservationInput {
  readonly context: ManagedSessionContext;
  /** The inherited environment is read before the wrapper can change PATH. */
  readonly environment?: NodeJS.ProcessEnv;
  /** Injectable resolver keeps ordinary tests off the host executable boundary. */
  readonly resolveExecutable?: (program: string, environment: NodeJS.ProcessEnv) => Promise<string | undefined>;
  /** Injectable only for fixture assets; production uses this module's packaged sibling. */
  readonly observerModuleUrl?: string;
}

const preparedGhObservations = new WeakMap<ManagedSessionContext, PreparedManagedGhObservation>();
/**
 * The wrapper observes only PATH-resolved `gh`; all executor results retain
 * this verdict so an absent event is never interpreted as absence of a write.
 */
export const UNKNOWN_MANAGED_GH_OBSERVATION_COVERAGE: ManagedGhObservationCoverage = {
  boundary: 'managed-path-resolved-gh', completeness: 'unknown',
};

/**
 * Provision one private `gh` PATH entry for an already-owned managed child.
 * This never changes process.env: operator commands and unrelated engine
 * subprocesses retain their original resolution.
 */
export async function prepareManagedGhObservation(
  input: PrepareManagedGhObservationInput,
): Promise<PreparedManagedGhObservation> {
  const environment = input.environment ?? process.env;
  if (!validManagedContext(input.context)) {
    throw ghUnavailable(input.context.provider, 'the managed-session context is invalid');
  }
  const realExecutable = await (input.resolveExecutable ?? resolveExecutable)(GH_OBSERVER_EXECUTABLE_NAME, environment);
  if (!realExecutable || !isAbsolute(realExecutable)) {
    throw ghUnavailable(input.context.provider, 'the underlying gh executable could not be resolved before PATH observation setup');
  }
  const wrapper = await validateManagedSessionProducerPath(input.context, '.gh-observer');
  if (!wrapper.ok) {
    throw ghUnavailable(input.context.provider, 'the per-dispatch observation destination is outside its provisioned producer root');
  }
  const wrapperDirectory = wrapper.path;
  try {
    await mkdir(wrapperDirectory, { recursive: true });
    await writeFile(
      join(wrapperDirectory, GH_OBSERVER_EXECUTABLE_NAME),
      // tsup preserves this executable entry under dist/execution even when
      // this module itself is folded into a dist-root chunk.
      renderGhObserverAsset(input.observerModuleUrl ?? new URL('./execution/gh-observer.js', import.meta.url).href),
      { mode: 0o755 },
    );
    await chmod(join(wrapperDirectory, GH_OBSERVER_EXECUTABLE_NAME), 0o755);
  } catch {
    throw ghUnavailable(input.context.provider, 'the managed gh observer wrapper could not be provisioned');
  }
  const prepared = { wrapperDirectory, realExecutable, coverage: UNKNOWN_MANAGED_GH_OBSERVATION_COVERAGE };
  preparedGhObservations.set(input.context, prepared);
  return prepared;
}

/** Apply only a previously prepared managed-child overlay; no ambient mutation. */
export function composePreparedManagedSessionEnvironment(
  context: ManagedSessionContext | undefined,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (!context) return environment;
  const prepared = preparedGhObservations.get(context);
  if (!prepared) return environment;
  const inheritedPath = environment.PATH ?? process.env.PATH;
  return {
    ...environment,
    PATH: inheritedPath ? `${prepared.wrapperDirectory}${delimiter}${inheritedPath}` : prepared.wrapperDirectory,
    [GH_OBSERVER_REAL_EXECUTABLE_ENV]: prepared.realExecutable,
  };
}

async function resolveExecutable(program: string, environment: NodeJS.ProcessEnv): Promise<string | undefined> {
  for (const directory of (environment.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, program);
    try {
      await access(candidate, 1);
      if (!(await stat(candidate)).isFile()) continue;
      const resolved = await realpath(candidate);
      if (isAbsolute(resolved)) return resolved;
    } catch {
      // Continue searching the inherited PATH. A missing segment is not proof
      // that a later operator-supplied segment lacks gh.
    }
  }
  return undefined;
}

function validManagedContext(context: ManagedSessionContext): boolean {
  return isAbsolute(context.projectRoot)
    && isAbsolute(context.worktreeRoot)
    && isAbsolute(context.producerRoot)
    && context.dispatchId.trim().length > 0
    && context.provider.trim().length > 0;
}

function ghUnavailable(provider: string, reason: string): ProviderSetupUnavailableError {
  return new ProviderSetupUnavailableError({
    provider: provider || 'unknown',
    capability: 'managed-gh-observation',
    reason,
    recoveryAction: 'Install an executable gh on the managed provider PATH and ensure the per-dispatch observation destination is writable, then retry.',
  });
}

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
    context.worktreeRoot,
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
