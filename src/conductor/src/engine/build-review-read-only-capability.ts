import { mkdir } from 'node:fs/promises';

/** Process boundary for the provider-owned read-only review capability probe. */
export type ReadOnlyReviewCapabilityProcess = (
  executable: string,
  args: readonly string[],
) => Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}>;

export type ReadOnlyReviewCapability =
  | { readonly provider: string; readonly platform: string; readonly status: 'available' }
  | { readonly provider: string; readonly platform: string; readonly status: 'unavailable'; readonly reason: string };

export interface ProbeReadOnlyReviewCapabilityOptions {
  readonly provider: string;
  readonly platform: string;
  readonly runProcess: ReadOnlyReviewCapabilityProcess;
  /** A pipeline-excluded directory used only by the Codex probe write. */
  readonly scratchDir: string;
}

const CODEX_PROBE_OBSERVATIONS = new Set([
  'sandbox-started',
  'probe-write-refused',
  'probe-write-succeeded',
  'probe-parent-missing',
]);

const CODEX_READ_ONLY_PROBE = [
  'printf "sandbox-started\\n"',
  'if [ ! -d "$2" ]; then printf "probe-parent-missing\\n"; elif printf x > "$1" 2>/dev/null; then printf "probe-write-succeeded\\n"; else printf "probe-write-refused\\n"; fi',
].join('; ');

const CLAUDE_READ_ONLY_FLAGS = [
  '--restricted',
  '--tools',
  '--allowedTools',
  '--strict-mcp-config',
] as const;

function unavailable(
  options: ProbeReadOnlyReviewCapabilityOptions,
  reason: string,
): ReadOnlyReviewCapability {
  return { provider: options.provider, platform: options.platform, status: 'unavailable', reason };
}

function processFailureReason(error: unknown, executable: string): string {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
    return `${executable} sandbox helper is unavailable`;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return `${executable} sandbox helper could not start`;
}

function exitedReason(provider: string, exitCode: number, stderr: string): string {
  return `${provider} ${provider === 'codex' ? 'sandbox' : 'help'} exited ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ''}`;
}

async function probeCodex(options: ProbeReadOnlyReviewCapabilityOptions): Promise<ReadOnlyReviewCapability> {
  // A refused write only proves the sandbox when the probe's parent exists;
  // otherwise an ordinary missing-path failure would read as a denial (D5.5).
  try {
    await mkdir(options.scratchDir, { recursive: true });
  } catch (error) {
    return unavailable(options, `probe directory could not be created: ${error instanceof Error ? error.message : String(error)}`);
  }
  let result: Awaited<ReturnType<ReadOnlyReviewCapabilityProcess>>;
  try {
    result = await options.runProcess('codex', [
      'sandbox', '-P', ':read-only', '--', '/bin/sh', '-c', CODEX_READ_ONLY_PROBE,
      'read-only-review-probe', `${options.scratchDir}/write-probe`, options.scratchDir,
    ]);
  } catch (error) {
    return unavailable(options, processFailureReason(error, 'codex'));
  }
  if (result.exitCode !== 0) return unavailable(options, exitedReason('codex', result.exitCode, result.stderr));

  const observations = result.stdout.trim() === '' ? [] : result.stdout.trim().split(/\s+/);
  if (
    observations.length !== 2
    || new Set(observations).size !== observations.length
    || observations.some((observation) => !CODEX_PROBE_OBSERVATIONS.has(observation))
  ) {
    return unavailable(options, 'probe produced unrecognized output');
  }
  const observed = new Set(observations);
  if (!observed.has('sandbox-started')) return unavailable(options, 'probe did not prove the sandbox started');
  if (observed.has('probe-parent-missing')) return unavailable(options, 'probe directory does not exist');
  if (observed.has('probe-write-succeeded')) return unavailable(options, 'probe write was not refused');
  if (!observed.has('probe-write-refused')) return unavailable(options, 'probe produced unrecognized output');
  return { provider: options.provider, platform: options.platform, status: 'available' };
}

async function probeClaude(options: ProbeReadOnlyReviewCapabilityOptions): Promise<ReadOnlyReviewCapability> {
  let result: Awaited<ReturnType<ReadOnlyReviewCapabilityProcess>>;
  try {
    result = await options.runProcess('claude', ['--help']);
  } catch (error) {
    return unavailable(options, processFailureReason(error, 'claude'));
  }
  if (result.exitCode !== 0) return unavailable(options, exitedReason('claude', result.exitCode, result.stderr));

  const missing = CLAUDE_READ_ONLY_FLAGS.find((flag) => !result.stdout.includes(flag));
  return missing === undefined
    ? { provider: options.provider, platform: options.platform, status: 'available' }
    : unavailable(options, `Claude help does not list ${missing}`);
}

/**
 * Establishes availability using the selected provider's own read-only mechanism.
 * This probe never sends a model prompt or invokes a provider adapter.
 */
export async function probeReadOnlyReviewCapability(
  options: ProbeReadOnlyReviewCapabilityOptions,
): Promise<ReadOnlyReviewCapability> {
  if (options.provider === 'codex') return probeCodex(options);
  if (options.provider === 'claude') return probeClaude(options);
  return unavailable(options, 'provider has no read-only review mode');
}
