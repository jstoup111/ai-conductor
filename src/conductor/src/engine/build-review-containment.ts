import { isAbsolute, relative } from 'node:path';

/** Provider-neutral process boundary used to prove a Linux review sandbox. */
export type BuildReviewContainmentProcess = (
  executable: string,
  args: readonly string[],
) => Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}>;

export interface BuildReviewContainmentPaths {
  readonly frozenSource: string;
  readonly policyMaterial: string;
  readonly originalCheckout: string;
  readonly originalInstallation: string;
  readonly engineEvidence: string;
  readonly siblingEvidence: string;
  readonly scratch: string;
  readonly sourceWriteProbe: string;
  readonly installationWriteProbe: string;
  readonly engineStateWriteProbe: string;
  readonly scratchWriteProbe: string;
  readonly siblingEvidenceProbe: string;
}

export interface BuildReviewContainmentOptions {
  readonly provider: 'claude' | 'codex';
  readonly paths: BuildReviewContainmentPaths;
  readonly runProcess: BuildReviewContainmentProcess;
}

/** A proved mount profile that an invoke adapter may wrap around a reviewer. */
export interface BuildReviewContainmentProfile {
  readonly mountArgs: readonly string[];
}

export type BuildReviewContainmentResult =
  | { readonly kind: 'ready'; readonly provider: 'claude' | 'codex'; readonly profile: BuildReviewContainmentProfile }
  | {
    readonly kind: 'unsupported';
    readonly provider: 'claude' | 'codex';
    readonly capability: 'linux-read-only-review-boundary';
    readonly recovery: 'install-bubblewrap-and-enable-nested-sandboxing';
    readonly reason: string;
  };

const REQUIRED_OBSERVATIONS = [
  'source-write-refused',
  'installation-write-refused',
  'engine-state-write-refused',
  'scratch-write-succeeded',
  'sibling-evidence-withheld',
  'nested-sandbox-available',
] as const;

const RECOGNIZED_OBSERVATIONS = new Set([
  ...REQUIRED_OBSERVATIONS,
  'source-write-succeeded',
  'installation-write-succeeded',
  'engine-state-write-succeeded',
  'scratch-write-refused',
  'sibling-evidence-readable',
  'nested-sandbox-denied',
]);

const REVIEW_CONTAINMENT_PROBE = [
  'probe_write() { if (printf x > "$1") 2>/dev/null; then printf "%s-write-succeeded\\n" "$2"; else printf "%s-write-refused\\n" "$2"; fi; }',
  'probe_write "$1" source',
  'probe_write "$2" installation',
  'probe_write "$3" engine-state',
  'probe_write "$4" scratch',
  'if test -r "$5"; then printf "sibling-evidence-readable\\n"; else printf "sibling-evidence-withheld\\n"; fi',
  'if bwrap --ro-bind / / -- true >/dev/null 2>&1; then printf "nested-sandbox-available\\n"; else printf "nested-sandbox-denied\\n"; fi',
].join('; ');

function unsupported(
  provider: 'claude' | 'codex',
  reason: string,
): Extract<BuildReviewContainmentResult, { kind: 'unsupported' }> {
  return {
    kind: 'unsupported',
    provider,
    capability: 'linux-read-only-review-boundary',
    recovery: 'install-bubblewrap-and-enable-nested-sandboxing',
    reason,
  };
}

function isWithin(parent: string, child: string): boolean {
  const childPath = relative(parent, child);
  return childPath === '' || (!childPath.startsWith('..') && childPath !== '..');
}

function hasSafePaths(paths: BuildReviewContainmentPaths): boolean {
  const values = Object.values(paths);
  if (values.some((path) => !isAbsolute(path))) return false;
  const protectedPaths = [
    paths.frozenSource,
    paths.policyMaterial,
    paths.originalCheckout,
    paths.originalInstallation,
    paths.engineEvidence,
    paths.siblingEvidence,
  ];
  if (protectedPaths.some((protectedPath) => isWithin(protectedPath, paths.scratch) || isWithin(paths.scratch, protectedPath))) {
    return false;
  }
  return isWithin(paths.frozenSource, paths.sourceWriteProbe)
    && isWithin(paths.originalInstallation, paths.installationWriteProbe)
    && isWithin(paths.engineEvidence, paths.engineStateWriteProbe)
    && isWithin(paths.scratch, paths.scratchWriteProbe)
    && isWithin(paths.siblingEvidence, paths.siblingEvidenceProbe);
}

function deriveMountArgs(paths: BuildReviewContainmentPaths): readonly string[] {
  return [
    '--ro-bind', '/', '/',
    '--dev', '/dev',
    '--proc', '/proc',
    '--unshare-pid',
    '--ro-bind', paths.frozenSource, paths.frozenSource,
    '--ro-bind', paths.policyMaterial, paths.policyMaterial,
    '--ro-bind', paths.originalCheckout, paths.originalCheckout,
    '--ro-bind', paths.originalInstallation, paths.originalInstallation,
    '--tmpfs', paths.engineEvidence,
    '--tmpfs', paths.siblingEvidence,
    '--bind', paths.scratch, paths.scratch,
  ];
}

function deriveProbeArgs(paths: BuildReviewContainmentPaths, mountArgs: readonly string[]): readonly string[] {
  return [
    ...mountArgs,
    '--', '/bin/sh', '-c', REVIEW_CONTAINMENT_PROBE, 'build-review-containment-probe',
    paths.sourceWriteProbe,
    paths.installationWriteProbe,
    paths.engineStateWriteProbe,
    paths.scratchWriteProbe,
    paths.siblingEvidenceProbe,
  ];
}

function probeFailureReason(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
    return 'bubblewrap is unavailable';
  }
  if (error instanceof Error && error.message.trim()) return `probe failed: ${error.message}`;
  return 'probe failed before bubblewrap could prove containment';
}

function interpretProbe(output: string): string | undefined {
  const observations = output.trim() === '' ? [] : output.trim().split(/\s+/);
  if (observations.some((observation) => !RECOGNIZED_OBSERVATIONS.has(observation))) {
    return 'probe produced unrecognized output';
  }
  if (new Set(observations).size !== observations.length) return 'probe produced duplicate output';
  const observed = new Set(observations);
  const missing = REQUIRED_OBSERVATIONS.find((observation) => !observed.has(observation));
  if (missing) return `probe did not prove ${missing}`;
  return undefined;
}

/**
 * The review profile is deliberately separate from BUILD's writable bind set.
 * Its complete implementation follows with the probe and mount translation.
 */
export async function prepareBuildReviewContainment(
  options: BuildReviewContainmentOptions,
): Promise<BuildReviewContainmentResult> {
  if (!hasSafePaths(options.paths)) {
    return unsupported(options.provider, 'review containment paths must be absolute and candidate scratch must not be protected');
  }
  const mountArgs = deriveMountArgs(options.paths);
  let probe: Awaited<ReturnType<BuildReviewContainmentProcess>>;
  try {
    probe = await options.runProcess('bwrap', deriveProbeArgs(options.paths, mountArgs));
  } catch (error) {
    return unsupported(options.provider, probeFailureReason(error));
  }
  if (probe.exitCode !== 0) {
    return unsupported(options.provider, `bubblewrap probe exited ${probe.exitCode}${probe.stderr.trim() ? `: ${probe.stderr.trim()}` : ''}`);
  }
  const failure = interpretProbe(probe.stdout);
  if (failure) return unsupported(options.provider, failure);
  return { kind: 'ready', provider: options.provider, profile: Object.freeze({ mountArgs }) };
}
