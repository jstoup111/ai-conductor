/** The complete set of capabilities a smoke test may require. */
export const SMOKE_CAPABILITIES = [
  'hermetic',
  'toolchain',
  'credentialed',
] as const;

export type SmokeCapability = (typeof SMOKE_CAPABILITIES)[number];

export type SmokeOutcomeLedgerEntry =
  | {
    file: string;
    capability: SmokeCapability;
    outcome: 'ran';
  }
  | {
    file: string;
    capability: SmokeCapability;
    outcome: 'skipped';
    unmet: string;
  }
  | {
    file: string;
    capability: SmokeCapability;
    outcome: 'failed';
    evidencePath: string;
  };

export interface SmokeCapabilityAvailabilityDependencies {
  hasCommand(command: string): boolean;
  environment: Readonly<Record<string, string | undefined>>;
}

export type AdvisorySmokeCapabilityResolution =
  | { outcome: 'ran' }
  | { outcome: 'skipped'; unmet: string };

export type GateSmokeCapabilityResolution =
  | { outcome: 'ran' }
  | { outcome: 'failed'; unmet: string };

const declarations = new Map<string, SmokeCapability>();

/** Emits one attributable outcome line for every smoke file in a run. */
export function emitSmokeOutcomeLedger(
  entries: readonly SmokeOutcomeLedgerEntry[],
  emit: (line: string) => void,
): void {
  for (const entry of entries) {
    const prefix = `smoke ledger: ${entry.file} [${entry.capability}]`;
    switch (entry.outcome) {
      case 'ran':
        emit(`${prefix} ran`);
        break;
      case 'skipped':
        emit(`${prefix} skipped (unmet: ${entry.unmet})`);
        break;
      case 'failed':
        emit(`${prefix} failed (evidence: ${entry.evidencePath})`);
        break;
    }
  }
}

function forceSkipsCapability(
  environment: SmokeCapabilityAvailabilityDependencies['environment'],
  capability: SmokeCapability,
): boolean {
  return environment.SMOKE_FORCE_SKIP?.split(',').includes(`capability:${capability}`) ?? false;
}

function forceSkipsFile(
  environment: SmokeCapabilityAvailabilityDependencies['environment'],
  file: string,
): boolean {
  return environment.SMOKE_FORCE_SKIP?.split(',').includes(`file:${file}`) ?? false;
}

/** Resolves each smoke capability's advisory outcome once for a smoke run. */
export function resolveAdvisorySmokeCapabilities(
  { hasCommand, environment }: SmokeCapabilityAvailabilityDependencies,
): Record<SmokeCapability, AdvisorySmokeCapabilityResolution> {
  return {
    hermetic: forceSkipsCapability(environment, 'hermetic')
      ? { outcome: 'skipped', unmet: 'operator override' }
      : { outcome: 'ran' },
    toolchain: forceSkipsCapability(environment, 'toolchain')
      ? { outcome: 'skipped', unmet: 'operator override' }
      : hasCommand('codex')
      ? { outcome: 'ran' }
      : { outcome: 'skipped', unmet: 'codex' },
    credentialed: forceSkipsCapability(environment, 'credentialed')
      ? { outcome: 'skipped', unmet: 'operator override' }
      : environment.CLAUDE_CODE_OAUTH_TOKEN
      ? { outcome: 'ran' }
      : { outcome: 'skipped', unmet: 'CLAUDE_CODE_OAUTH_TOKEN' },
  };
}

/** Resolves one smoke file's advisory outcome, including a file-specific override. */
export function resolveAdvisorySmokeFile(
  file: string,
  capability: SmokeCapability,
  dependencies: SmokeCapabilityAvailabilityDependencies,
): AdvisorySmokeCapabilityResolution {
  if (forceSkipsFile(dependencies.environment, file)) {
    return { outcome: 'skipped', unmet: 'operator override' };
  }
  return resolveAdvisorySmokeCapabilities(dependencies)[capability];
}

/** Resolves each smoke capability's fail-closed outcome for a release gate. */
export function resolveGateSmokeCapabilities(
  { hasCommand, environment }: SmokeCapabilityAvailabilityDependencies,
): Record<SmokeCapability, GateSmokeCapabilityResolution> {
  return {
    hermetic: forceSkipsCapability(environment, 'hermetic')
      ? { outcome: 'failed', unmet: 'operator override' }
      : { outcome: 'ran' },
    toolchain: forceSkipsCapability(environment, 'toolchain')
      ? { outcome: 'failed', unmet: 'operator override' }
      : hasCommand('codex')
      ? { outcome: 'ran' }
      : { outcome: 'failed', unmet: 'codex' },
    credentialed: forceSkipsCapability(environment, 'credentialed')
      ? { outcome: 'failed', unmet: 'operator override' }
      : environment.CLAUDE_CODE_OAUTH_TOKEN
      ? { outcome: 'ran' }
      : { outcome: 'failed', unmet: 'CLAUDE_CODE_OAUTH_TOKEN' },
  };
}

/** Rejects a gate-mode smoke run that never executed a credentialed test file. */
export function assertGateCredentialedExecution(
  executedCapabilities: readonly SmokeCapability[],
): void {
  if (!executedCapabilities.includes('credentialed')) {
    throw new Error('Gate-mode smoke run executed no credentialed test files');
  }
}

/** Rejects a smoke run that did not discover any test files. */
export function assertSmokeDiscovery(discovered: { readonly length: number }): void {
  if (discovered.length === 0) {
    throw new Error('Smoke discovery found no test files');
  }
}

/** Records the capability required by a smoke test file. */
export function declareSmokeCapability(
  file: string,
  capability: SmokeCapability,
): void {
  if (!SMOKE_CAPABILITIES.includes(capability)) {
    throw new Error(`Smoke file ${file} declares invalid capability ${capability}`);
  }
  declarations.set(file, capability);
}

/** Returns a smoke test file's declared capability. */
export function getDeclaredSmokeCapability(
  file: string,
): SmokeCapability {
  const capability = declarations.get(file);
  if (capability === undefined) {
    throw new Error(`Smoke file ${file} declares no capability`);
  }
  return capability;
}
