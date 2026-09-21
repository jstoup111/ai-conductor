import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';

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
  /** Materialized reviewed head tree. */
  readonly frozenSource: string;
  /** Materialized reviewed baseline tree: deletions and pre-change content live only here. */
  readonly frozenBaseline: string;
  readonly policyMaterial: string;
  readonly originalCheckout: string;
  readonly originalInstallation: string;
  readonly engineEvidence: string;
  /**
   * The checkout's whole build-review evidence root: lap branch artifacts,
   * aggregates and the cache.  It is masked inside the sandbox; only policy
   * material and engine evidence are re-exposed beneath it, read-only.
   */
  readonly reviewEvidenceRoot: string;
  readonly siblingEvidence: string;
  readonly scratch: string;
  readonly sourceWriteProbe: string;
  readonly baselineWriteProbe: string;
  readonly installationWriteProbe: string;
  readonly engineStateWriteProbe: string;
  readonly scratchWriteProbe: string;
  readonly siblingEvidenceProbe: string;
  /**
   * A readable host file OUTSIDE every allowlisted root. The probe must find it
   * unreadable inside the sandbox, proving unrelated host state is withheld.
   */
  readonly hostStateProbe: string;
}

/** Host lookups the runtime-root derivation needs; injectable so tests touch no real filesystem. */
export interface BuildReviewRuntimeHost {
  readonly execPath: string;
  readonly pathEnv: string | undefined;
  readonly home: string;
  /** Resolve symlinks; throws when the path does not exist. */
  readonly realpath: (path: string) => string;
}

export interface BuildReviewContainmentOptions {
  readonly provider: 'claude' | 'codex';
  readonly paths: BuildReviewContainmentPaths;
  readonly runProcess: BuildReviewContainmentProcess;
  /** Defaults to the live process; tests inject a fixed host. */
  readonly runtimeHost?: BuildReviewRuntimeHost;
  /**
   * The command this profile will launch (a self-host prepared invocation).
   * The probe runs over the mounts composed for it; defaults to the bare provider.
   */
  readonly launch?: { readonly executable: string; readonly args: readonly string[] };
}

/** A proved mount profile that an invoke adapter may wrap around a reviewer. */
export interface BuildReviewContainmentProfile {
  /** The complete proved profile: exactly the mounts the probe ran under and the launch uses. */
  readonly mountArgs: readonly string[];
  /** Allowlisted system/provider runtime roots. Optional only for hand-built fixtures. */
  readonly runtimeMountArgs?: readonly string[];
  /** The D5 review inputs, sibling-evidence mask and private scratch. */
  readonly reviewMountArgs?: readonly string[];
  /** The candidate-private writable directory proved by the containment probe. */
  readonly scratch: string;
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
  'baseline-write-refused',
  'installation-write-refused',
  'engine-state-write-refused',
  'scratch-write-succeeded',
  'sibling-evidence-withheld',
  'nested-sandbox-available',
  'host-state-withheld',
] as const;

const RECOGNIZED_OBSERVATIONS = new Set([
  ...REQUIRED_OBSERVATIONS,
  'source-write-succeeded',
  'baseline-write-succeeded',
  'installation-write-succeeded',
  'engine-state-write-succeeded',
  'scratch-write-refused',
  'sibling-evidence-readable',
  'nested-sandbox-denied',
  'host-state-readable',
]);

const REVIEW_CONTAINMENT_PROBE = [
  'probe_write() { if (printf x > "$1") 2>/dev/null; then printf "%s-write-succeeded\\n" "$2"; else printf "%s-write-refused\\n" "$2"; fi; }',
  'probe_write "$1" source',
  'probe_write "$2" installation',
  'probe_write "$3" engine-state',
  'probe_write "$4" scratch',
  'if test -r "$5"; then printf "sibling-evidence-readable\\n"; else printf "sibling-evidence-withheld\\n"; fi',
  'if bwrap --ro-bind / / -- true >/dev/null 2>&1; then printf "nested-sandbox-available\\n"; else printf "nested-sandbox-denied\\n"; fi',
  'if test -r "$6"; then printf "host-state-readable\\n"; else printf "host-state-withheld\\n"; fi',
  'probe_write "$7" baseline',
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
  return childPath === '' || (childPath !== '..' && !childPath.startsWith(`..${sep}`) && !isAbsolute(childPath));
}

function hasSafePaths(paths: BuildReviewContainmentPaths): boolean {
  const values = Object.values(paths);
  if (values.some((path) => !isAbsolute(path))) return false;
  const protectedPaths = [
    paths.frozenSource,
    paths.frozenBaseline,
    paths.policyMaterial,
    paths.originalCheckout,
    paths.originalInstallation,
    paths.engineEvidence,
    paths.siblingEvidence,
  ];
  if (protectedPaths.some((protectedPath) => isWithin(protectedPath, paths.scratch) || isWithin(paths.scratch, protectedPath))) {
    return false;
  }
  // A sentinel inside an allowlisted root could never be withheld.
  if ([...protectedPaths, paths.scratch].some((bound) => isWithin(bound, paths.hostStateProbe))) return false;
  if (isWithin(paths.frozenSource, paths.frozenBaseline) || isWithin(paths.frozenBaseline, paths.frozenSource)) return false;
  return isWithin(paths.frozenSource, paths.sourceWriteProbe)
    && isWithin(paths.frozenBaseline, paths.baselineWriteProbe)
    && isWithin(paths.originalInstallation, paths.installationWriteProbe)
    && isWithin(paths.engineEvidence, paths.engineStateWriteProbe)
    && isWithin(paths.scratch, paths.scratchWriteProbe)
    && (isWithin(paths.siblingEvidence, paths.siblingEvidenceProbe) || isWithin(paths.reviewEvidenceRoot, paths.siblingEvidenceProbe));
}

/**
 * System runtime a provider process needs to execute at all. Everything is
 * `--ro-bind-try` so a host lacking one entry (no /lib64, no /etc/pki) still
 * prepares. `/etc` is enumerated, never bound whole: it holds host service
 * configuration the reviewer has no business reading.
 */
const SYSTEM_RUNTIME_ROOTS = [
  '/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64',
  '/etc/ld.so.cache', '/etc/ld.so.conf', '/etc/ld.so.conf.d', '/etc/alternatives',
  '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/host.conf', '/etc/gai.conf',
  '/etc/passwd', '/etc/group', '/etc/localtime',
  '/etc/ssl', '/etc/ca-certificates', '/etc/ca-certificates.conf', '/etc/pki', '/etc/crypto-policies',
  // /etc/resolv.conf is commonly a symlink into this systemd-resolved directory.
  '/run/systemd/resolve',
] as const;

/**
 * A bound review root that would carry the operator home into the sandbox. An
 * installed policy package comes from provider/plugin metadata, so it is held
 * to the stricter executable rule (never HOME's direct child, e.g. ~/.claude).
 */
function broadBoundRoot(paths: BuildReviewContainmentPaths, home: string): string | undefined {
  if (isTooBroad(paths.originalInstallation, home)) return paths.originalInstallation;
  return [paths.frozenSource, paths.frozenBaseline, paths.policyMaterial, paths.originalCheckout, paths.engineEvidence, paths.scratch]
    .find((root) => root === sep || isWithin(root, home));
}

const liveRuntimeHost = (): BuildReviewRuntimeHost => ({
  execPath: process.execPath,
  pathEnv: process.env.PATH,
  home: homedir(),
  realpath: (path) => realpathSync(path),
});

function coveredBySystemRoot(path: string): boolean {
  return SYSTEM_RUNTIME_ROOTS.some((root) => isWithin(root, path));
}

/** A root is too broad when it is the filesystem root, contains HOME, is HOME, or sits directly under HOME. */
function isTooBroad(root: string, home: string): boolean {
  if (root === sep || isWithin(root, home)) return true;
  return isWithin(home, root) && dirname(root) === home;
}

/**
 * The narrowest install root that still lets one resolved executable run:
 * a package under `node_modules` binds its package root; an executable in a
 * `bin/` directory binds that install prefix (node under nvm/asdf, a codex
 * standalone release); anything else binds just the file.
 */
function installRootFor(real: string, home: string): string {
  const parts = real.split(sep);
  const modules = parts.lastIndexOf('node_modules');
  if (modules !== -1 && modules + 1 < parts.length - 1) {
    const scoped = parts[modules + 1]!.startsWith('@') && modules + 2 < parts.length - 1;
    const root = parts.slice(0, modules + (scoped ? 3 : 2)).join(sep);
    if (!isTooBroad(root, home)) return root;
  }
  if (basename(dirname(real)) === 'bin') {
    const prefix = dirname(dirname(real));
    if (!isTooBroad(prefix, home)) return prefix;
  }
  return real;
}

/**
 * Read-only roots for one executable, given by name (resolved on PATH) or by
 * absolute path. Returns the invoked path itself (so a PATH symlink still
 * resolves inside the sandbox) plus the install root behind it. An
 * unresolvable absolute path is returned as-is for `--ro-bind-try`.
 */
export function deriveExecutableRuntimeRoots(
  executable: string,
  host: BuildReviewRuntimeHost = liveRuntimeHost(),
): readonly string[] {
  const candidates = isAbsolute(executable)
    ? [executable]
    : executable.includes(sep)
      ? []
      : (host.pathEnv ?? '').split(delimiter).filter((entry) => isAbsolute(entry)).map((entry) => join(entry, executable));
  for (const candidate of candidates) {
    let real: string;
    try { real = host.realpath(candidate); } catch { continue; }
    return [...new Set([candidate, installRootFor(real, host.home)])].filter((root) => !coveredBySystemRoot(root));
  }
  return isAbsolute(executable) && !coveredBySystemRoot(executable) ? [executable] : [];
}

/**
 * Write the readable host sentinel the probe must find withheld. It sits
 * beside — never inside — the private scratch, so no allowlisted root covers
 * it; the scratch lease's parent directory is removed with the run.
 */
export async function writeReviewHostStateSentinel(scratch: string): Promise<string> {
  const sentinel = `${scratch.replace(/[\\/]+$/, '')}.host-state-probe`;
  await writeFile(sentinel, 'host state that review containment must withhold\n', 'utf8');
  return sentinel;
}

/**
 * The complete frozen review input of one materialized lap: both commit views
 * and a disposable write sentinel inside each.  Every production containment
 * call derives its source paths here so no member sees a head-only boundary.
 */
export function buildReviewFrozenInputPaths(
  view: { readonly baselinePath: string; readonly headPath: string },
): Pick<BuildReviewContainmentPaths, 'frozenSource' | 'frozenBaseline' | 'sourceWriteProbe' | 'baselineWriteProbe'> {
  return {
    frozenSource: view.headPath,
    frozenBaseline: view.baselinePath,
    sourceWriteProbe: join(view.headPath, '.build-review-write-probe'),
    baselineWriteProbe: join(view.baselinePath, '.build-review-write-probe'),
  };
}

export interface BuildReviewFrozenInputScope {
  readonly contentDigest: string;
  readonly mergeBase: string;
  readonly headSha: string;
  readonly changes: readonly ({ readonly kind: string; readonly path: string; readonly oldPath?: string })[];
  readonly view?: { readonly baselinePath: string; readonly headPath: string };
}

/** Engine-authored description of the same immutable change every lap member inspects. */
export function renderBuildReviewFrozenInputScope(scope: BuildReviewFrozenInputScope): string {
  return [
    `Frozen build-review input ${scope.contentDigest}.`,
    ...(scope.view === undefined ? [] : [
      `Reviewed baseline ${scope.mergeBase} (read-only): ${scope.view.baselinePath}`,
      `Reviewed head ${scope.headSha} (read-only): ${scope.view.headPath}`,
      'Compare the two trees to inspect the change; a deleted path exists only under the baseline.',
    ]),
    'Changed path inventory (git name-status, baseline..head):',
    ...(scope.changes.length === 0 ? ['(none)'] : scope.changes.map((change) =>
      change.oldPath === undefined ? `${change.kind} ${change.path}` : `${change.kind} ${change.oldPath} -> ${change.path}`)),
  ].join('\n');
}

function roBindTry(paths: readonly string[]): string[] {
  return [...new Set(paths)].flatMap((path) => ['--ro-bind-try', path, path]);
}

/**
 * The allowlisted runtime half of the profile. There is deliberately NO
 * whole-root bind: the sandbox root is an empty tmpfs, so the operator's HOME,
 * other projects, host config directories, plugin/MCP state and credential
 * files are absent unless a root below names them (adr-2026-09-10 D5).
 */
function deriveRuntimeMountArgs(provider: 'claude' | 'codex', host: BuildReviewRuntimeHost): readonly string[] {
  return [
    ...roBindTry([...SYSTEM_RUNTIME_ROOTS]),
    '--dev', '/dev',
    '--proc', '/proc',
    '--tmpfs', '/tmp',
    '--unshare-pid',
    ...roBindTry([
      ...deriveExecutableRuntimeRoots(host.execPath, host),
      ...deriveExecutableRuntimeRoots(provider, host),
    ]),
  ];
}

function deriveReviewMountArgs(paths: BuildReviewContainmentPaths): readonly string[] {
  return [
    '--ro-bind', paths.frozenSource, paths.frozenSource,
    '--ro-bind', paths.frozenBaseline, paths.frozenBaseline,
    '--ro-bind', paths.originalCheckout, paths.originalCheckout,
    // The checkout bind above would expose every sibling branch artifact,
    // aggregate and cache entry under the evidence root.  Mask the root, then
    // re-expose only what this reviewer may read; bubblewrap applies these in
    // order, so the binds below land inside the empty mask.
    '--tmpfs', paths.reviewEvidenceRoot,
    '--ro-bind', paths.policyMaterial, paths.policyMaterial,
    '--ro-bind', paths.originalInstallation, paths.originalInstallation,
    // Engine evidence is an existing engine-owned directory. Bind it read-only
    // so the mandatory probe proves it cannot be changed by a reviewer.
    '--ro-bind', paths.engineEvidence, paths.engineEvidence,
    '--tmpfs', paths.siblingEvidence,
    '--bind', paths.scratch, paths.scratch,
  ];
}

/**
 * Evidence paths of one production review launch, all derived from the feature
 * checkout.  The read sentinel sits directly in the evidence root, beside the
 * lap directories, so the probe proves real sibling artifacts are withheld.
 */
export function buildReviewEvidencePaths(projectDir: string): Pick<BuildReviewContainmentPaths, 'reviewEvidenceRoot' | 'engineEvidence' | 'siblingEvidence' | 'engineStateWriteProbe' | 'siblingEvidenceProbe'> {
  const reviewEvidenceRoot = join(projectDir, '.pipeline', 'build-review');
  const engineEvidence = join(reviewEvidenceRoot, 'engine-evidence');
  return {
    reviewEvidenceRoot, engineEvidence,
    siblingEvidence: join(reviewEvidenceRoot, 'sibling-evidence'),
    engineStateWriteProbe: join(engineEvidence, '.build-review-write-probe'),
    siblingEvidenceProbe: join(reviewEvidenceRoot, '.sibling-evidence-probe'),
  };
}

/** Creates the evidence directories and the readable host sentinel the probe must find withheld. */
export async function prepareBuildReviewEvidencePaths(projectDir: string): Promise<ReturnType<typeof buildReviewEvidencePaths>> {
  const paths = buildReviewEvidencePaths(projectDir);
  await Promise.all([mkdir(paths.engineEvidence, { recursive: true }), mkdir(paths.siblingEvidence, { recursive: true })]);
  await writeFile(paths.siblingEvidenceProbe, 'sibling review evidence that containment must withhold\n', 'utf8');
  return paths;
}

const BWRAP_BIND_FLAGS = new Set(['--bind', '--bind-try', '--ro-bind', '--ro-bind-try', '--dev-bind', '--dev-bind-try']);

export interface BuildReviewLaunchCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

function bindSources(args: readonly string[]): string[] {
  const sources: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (!BWRAP_BIND_FLAGS.has(args[index]!)) continue;
    const source = args[index + 1];
    if (source !== undefined) sources.push(source);
    index += 2;
  }
  return sources;
}

/**
 * The launched command's own needs, placed BETWEEN the runtime roots and the
 * review binds so a later review bind (writable scratch, evidence mask) wins:
 *  - a provider executable gets its narrow install root, read-only;
 *  - a self-host prepared invocation that is itself a bubblewrap wrap needs
 *    every path its inner bind set names to EXIST in this outer view. Its
 *    sources are the live checkout, sibling worktrees and daemon state, so
 *    they are never re-exposed: a source outside the proved roots becomes an
 *    empty `--dir` placeholder the inner wrap can bind onto itself.
 */
function composeLaunchMounts(
  runtime: readonly string[],
  review: readonly string[],
  command: BuildReviewLaunchCommand,
  host: BuildReviewRuntimeHost,
): readonly string[] {
  const executables: string[] = [];
  const placeholders: string[] = [];
  if (basename(command.executable) === 'bwrap') {
    const end = command.args.indexOf('--');
    const inner = end === -1 ? command.args : command.args.slice(0, end);
    const provedRoots = [...SYSTEM_RUNTIME_ROOTS, '/dev', '/proc', ...bindSources(runtime), ...bindSources(review)];
    for (const source of bindSources(inner)) {
      if (!isAbsolute(source) || source === sep) continue;
      if (provedRoots.some((root) => isWithin(root, source))) continue;
      placeholders.push(source);
    }
    const innerExecutable = end === -1 ? undefined : command.args[end + 1];
    if (innerExecutable !== undefined) executables.push(...deriveExecutableRuntimeRoots(innerExecutable, host));
  } else {
    executables.push(...deriveExecutableRuntimeRoots(command.executable, host));
  }
  const known = new Set(runtime);
  return [
    ...runtime,
    ...[...new Set(placeholders)].flatMap((path) => ['--dir', path]),
    ...roBindTry(executables.filter((path) => !known.has(path) && !coveredBySystemRoot(path))),
    ...review,
  ];
}

/**
 * Mount args for one concrete launch. A probed profile launches only the
 * exact mounts its probe proved: a command that composes differently is
 * refused rather than run under an unproved profile.
 */
export function composeReviewLaunchMounts(
  profile: BuildReviewContainmentProfile,
  command: BuildReviewLaunchCommand,
  host: BuildReviewRuntimeHost = liveRuntimeHost(),
): readonly string[] {
  const proved = profile.runtimeMountArgs !== undefined && profile.reviewMountArgs !== undefined;
  const composed = composeLaunchMounts(profile.runtimeMountArgs ?? [], profile.reviewMountArgs ?? profile.mountArgs, command, host);
  if (proved && (composed.length !== profile.mountArgs.length || composed.some((arg, index) => arg !== profile.mountArgs[index]))) {
    throw new Error('review launch mounts differ from the proved containment profile; refusing to launch an unproved profile');
  }
  return composed;
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
    paths.hostStateProbe,
    paths.baselineWriteProbe,
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
  const host = options.runtimeHost ?? liveRuntimeHost();
  const broad = broadBoundRoot(options.paths, host.home);
  if (broad !== undefined) {
    return unsupported(options.provider, `review containment root ${broad} is too broad: binding it would expose the operator home or provider configuration`);
  }
  if (!hasSafePaths(options.paths)) {
    return unsupported(options.provider, 'review containment paths must be absolute, candidate scratch must not be protected, and the host-state sentinel must lie outside every bound root');
  }
  const runtimeMountArgs = deriveRuntimeMountArgs(options.provider, host);
  const reviewMountArgs = deriveReviewMountArgs(options.paths);
  const mountArgs = composeLaunchMounts(runtimeMountArgs, reviewMountArgs, options.launch ?? { executable: options.provider, args: [] }, host);
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
  return {
    kind: 'ready',
    provider: options.provider,
    profile: Object.freeze({ mountArgs, runtimeMountArgs, reviewMountArgs, scratch: options.paths.scratch }),
  };
}
