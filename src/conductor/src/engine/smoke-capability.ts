/** The complete set of capabilities a smoke test may require. */
export const SMOKE_CAPABILITIES = [
  'hermetic',
  'toolchain',
  'credentialed:claude',
  'credentialed:codex',
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

/** The live-provider descriptors that own credentialed smoke capabilities. */
const LIVE_SMOKE_PROVIDER_DESCRIPTORS = [
  { capability: 'credentialed:claude', credentialEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN' },
  { capability: 'credentialed:codex', credentialEnvVar: 'CODEX_API_KEY' },
] as const;

/** The executable required by each smoke file that needs the toolchain capability. */
const SMOKE_TOOLCHAIN_COMMANDS: Readonly<Record<string, string>> = {
  'test/backlog-priority.smoke.test.ts': 'gh',
  'test/engine/daemon-tmux.smoke.test.ts': 'tmux',
  'test/execution/codex-provider.smoke.test.ts': 'codex',
  'test/smoke/publish-interrupted.smoke.test.ts': 'bin/setup',
};

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
function resolveAdvisorySmokeCapabilities(
  { hasCommand, environment }: SmokeCapabilityAvailabilityDependencies,
): Record<SmokeCapability, AdvisorySmokeCapabilityResolution> {
  const credentialedCapabilities = Object.fromEntries(
    LIVE_SMOKE_PROVIDER_DESCRIPTORS.map(({ capability, credentialEnvVar }) => [
      capability,
      forceSkipsCapability(environment, capability)
        ? { outcome: 'skipped', unmet: 'operator override' }
        : environment[credentialEnvVar]
        ? { outcome: 'ran' }
        : { outcome: 'skipped', unmet: credentialEnvVar },
    ]),
  ) as Record<
    (typeof LIVE_SMOKE_PROVIDER_DESCRIPTORS)[number]['capability'],
    AdvisorySmokeCapabilityResolution
  >;

  return {
    hermetic: forceSkipsCapability(environment, 'hermetic')
      ? { outcome: 'skipped', unmet: 'operator override' }
      : { outcome: 'ran' },
    toolchain: forceSkipsCapability(environment, 'toolchain')
      ? { outcome: 'skipped', unmet: 'operator override' }
      : hasCommand('toolchain')
      ? { outcome: 'ran' }
      : { outcome: 'skipped', unmet: 'toolchain' },
    ...credentialedCapabilities,
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
  if (capability === 'toolchain') {
    if (forceSkipsCapability(dependencies.environment, capability)) {
      return { outcome: 'skipped', unmet: 'operator override' };
    }
    const command = SMOKE_TOOLCHAIN_COMMANDS[file];
    if (command !== undefined && !dependencies.hasCommand(command)) {
      return { outcome: 'skipped', unmet: command };
    }
    if (command !== undefined) return { outcome: 'ran' };
  }
  return resolveAdvisorySmokeCapabilities(dependencies)[capability];
}

/** Resolves one smoke file's fail-closed gate outcome, including file overrides. */
export function resolveGateSmokeFile(
  file: string,
  capability: SmokeCapability,
  dependencies: SmokeCapabilityAvailabilityDependencies,
): GateSmokeCapabilityResolution {
  if (forceSkipsFile(dependencies.environment, file)) {
    return { outcome: 'failed', unmet: 'operator override' };
  }
  if (capability === 'toolchain') {
    if (forceSkipsCapability(dependencies.environment, capability)) {
      return { outcome: 'failed', unmet: 'operator override' };
    }
    const command = SMOKE_TOOLCHAIN_COMMANDS[file];
    if (command !== undefined && !dependencies.hasCommand(command)) {
      return { outcome: 'failed', unmet: command };
    }
    if (command !== undefined) return { outcome: 'ran' };
  }
  return resolveGateSmokeCapabilities(dependencies)[capability];
}

/** Resolves each smoke capability's fail-closed outcome for a release gate. */
function resolveGateSmokeCapabilities(
  { hasCommand, environment }: SmokeCapabilityAvailabilityDependencies,
): Record<SmokeCapability, GateSmokeCapabilityResolution> {
  const credentialedCapabilities = Object.fromEntries(
    LIVE_SMOKE_PROVIDER_DESCRIPTORS.map(({ capability, credentialEnvVar }) => [
      capability,
      forceSkipsCapability(environment, capability)
        ? { outcome: 'failed', unmet: 'operator override' }
        : environment[credentialEnvVar]
        ? { outcome: 'ran' }
        : { outcome: 'failed', unmet: credentialEnvVar },
    ]),
  ) as Record<
    (typeof LIVE_SMOKE_PROVIDER_DESCRIPTORS)[number]['capability'],
    GateSmokeCapabilityResolution
  >;

  return {
    hermetic: forceSkipsCapability(environment, 'hermetic')
      ? { outcome: 'failed', unmet: 'operator override' }
      : { outcome: 'ran' },
    toolchain: forceSkipsCapability(environment, 'toolchain')
      ? { outcome: 'failed', unmet: 'operator override' }
      : hasCommand('toolchain')
      ? { outcome: 'ran' }
      : { outcome: 'failed', unmet: 'toolchain' },
    ...credentialedCapabilities,
  };
}

/** Rejects a gate-mode smoke run that never executed a credentialed test file. */
export function assertGateCredentialedExecution(
  executedCapabilities: readonly SmokeCapability[],
): void {
  if (!executedCapabilities.some((capability) => capability.startsWith('credentialed:'))) {
    throw new Error('Gate-mode smoke run executed no credentialed test files');
  }
}

/** Rejects a smoke run that did not discover any test files. */
export function assertSmokeDiscovery(discovered: { readonly length: number }): void {
  if (discovered.length === 0) {
    throw new Error('Smoke discovery found no test files');
  }
}
