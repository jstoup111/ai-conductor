import type { ObservedInterval } from './observed-interval.js';

export interface TokenUsage {
  input: number;
  output: number;
  reasoningOutput?: number;
  cacheRead?: number;
  cacheCreation?: number;
  costUsd?: number;
  numTurns?: number;
  durationMs?: number;
}

export type ProviderUnavailableScope = 'run';

/** The credential mechanism selected by the Codex provider for a run. */
export type AuthenticationSource = 'api-key' | 'cached-login';

/** A closed classification for a Codex doctor probe that yielded no credential verdict. */
export type CodexProbeFailureKind = 'exec-error' | 'timeout' | 'unparseable-output';

/** A closed parser/evidence reason retained without raw doctor output. */
export type CodexProbeParserRejection =
  | 'invalid-json'
  | 'unsupported-schema'
  | 'unrecognized-envelope'
  | 'conflicting-source-evidence'
  | 'ambiguous-credential-evidence';

/**
 * Bounded, allowlisted facts about a failed Codex doctor probe. These fields
 * deliberately exclude raw output, paths, credential material, hashes, and
 * arbitrary error messages.
 */
export interface CodexProbeFailureFacts {
  processErrorCode?: 'EACCES' | 'EAGAIN' | 'ENOENT' | 'EPERM' | 'UNKNOWN';
  exitCode?: number;
  signal?: 'SIGABRT' | 'SIGALRM' | 'SIGHUP' | 'SIGINT' | 'SIGKILL' | 'SIGPIPE' | 'SIGQUIT' | 'SIGTERM' | 'UNKNOWN';
  timeoutMs?: number;
  stdoutBytes?: number;
  stderrBytes?: number;
  schemaVersion?: number;
  envelopeStatus?: 'ok' | 'warning' | 'fail' | 'unknown';
  credentialCheck?: 'absent' | 'ok' | 'fail' | 'unknown';
  parserRejection?: CodexProbeParserRejection;
}

/** Closed metadata retained when the Codex doctor probe cannot determine readiness. */
export interface CodexProbeFailure {
  kind: CodexProbeFailureKind;
  facts: CodexProbeFailureFacts;
}

/** Every state the provider may report for the selected authentication source. */
export type AuthenticationReadinessState =
  | 'ready'
  | 'missing'
  | 'unusable'
  | 'probe-failed';

/** A closed indication that non-authentication doctor checks are degraded. */
export type UnrelatedHealth = 'degraded';

/**
 * Safe metadata a provider may return for authentication recovery. Diagnostic
 * output and credential material deliberately have no representation here.
 */
interface AuthenticationReadinessBase {
  provider: 'codex';
  source: AuthenticationSource;
}

/** Supported doctor evidence affirmatively accepts the selected source. */
export interface ReadyAuthenticationReadiness extends AuthenticationReadinessBase {
  state: 'ready';
  unrelatedHealth?: UnrelatedHealth;
  remediation?: never;
  probeFailure?: never;
}

/** Supported doctor evidence affirmatively reports the selected source missing. */
export interface MissingAuthenticationReadiness extends AuthenticationReadinessBase {
  state: 'missing';
  unrelatedHealth?: never;
  remediation?: string;
  probeFailure?: never;
}

/** Supported doctor evidence affirmatively rejects the selected source. */
export interface UnusableAuthenticationReadiness extends AuthenticationReadinessBase {
  state: 'unusable';
  unrelatedHealth?: never;
  remediation?: string;
  probeFailure?: never;
}

/** The doctor probe could not produce a trustworthy credential verdict. */
export interface ProbeFailedAuthenticationReadiness extends AuthenticationReadinessBase {
  state: 'probe-failed';
  unrelatedHealth?: never;
  remediation?: never;
  probeFailure: CodexProbeFailure;
}

/** A discriminated readiness result for the selected Codex authentication source. */
export type AuthenticationReadiness =
  | ReadyAuthenticationReadiness
  | MissingAuthenticationReadiness
  | UnusableAuthenticationReadiness
  | ProbeFailedAuthenticationReadiness;

/** Opaque, child-only invocation settings prepared by a selected provider. */
export interface SelfHostInvocation {
  executable: string;
  env: NodeJS.ProcessEnv;
  args: readonly string[];
  teardown(): Promise<void>;
}

export interface SelfHostAuthPreparation {
  env?: NodeJS.ProcessEnv;
  args: readonly string[];
}

export interface SelfHostAuthContext {
  provider: 'codex';
  homeDir: string;
}

/** Declares that a provider validates lifecycle authority at its spawn boundary. */
export interface ProviderLifecycleCapability {
  synchronousSpawnPermit: true;
}

/** The synchronous authority decision made immediately before process creation. */
export type SpawnPermitDecision =
  | { permitted: true }
  | { permitted: false; reason: 'revoked' | 'superseded' };

/**
 * The provider action being authorized by a lifecycle-owned spawn permit.
 * Omitting this argument preserves the original worker-spawn contract for
 * legacy and custom providers.
 */
export type SpawnPermitPurpose = 'preparation' | 'worker-spawn';

/** A lifecycle-owned, synchronous authority check for provider process creation. */
export type SpawnPermit = (purpose?: SpawnPermitPurpose) => SpawnPermitDecision;

export interface InvokeResult {
  success: boolean;
  output: string;
  exitCode: number;
  /** Engine-observed provider subprocess intervals, separate from provider-reported usage. */
  observedIntervals?: readonly ObservedInterval[];
  rateLimited?: boolean;
  waitSeconds?: number;
  /**
   * Task 18: Parsed absolute deadline (milliseconds since epoch) from rate-limit message.
   * When set, represents a timezone-aware reset time extracted from the message
   * (e.g., "resets 3:20pm (America/New_York)"). Used by the episode coordinator
   * for deadline-first scheduling: if deadline is present, it overrides waitSeconds
   * for the episode timer. Undefined if timezone is unknown, unparseable, or not
   * present in the message. Clamped to cap (≈3600s); past/negative → default (60s).
   */
  deadline?: number;
  sessionExpired?: boolean;
  tokenUsage?: TokenUsage;
  /**
   * Set when the provider detects that the requested model is unavailable
   * (e.g. not entitled, deprecated, or rejected by the CLI/API). Consumed by
   * the ModelAvailability cache to drive fallback-ladder decisions — marking
   * the model unavailable so subsequent invocations fall back to the next
   * model in the ladder instead of retrying the same one.
   */
  modelUnavailable?: boolean;
  /**
   * Set when the provider detects that the invocation failed due to
   * authentication issues (e.g. "Not logged in", "Invalid API key").
   * Indicates the daemon's OAuth token may be stale or missing.
   */
  authFailure?: boolean;
  /**
   * Set when Codex's automatic permission review was denied or could not
   * complete. This is distinct from authentication, rate, model, and session
   * recovery signals so unattended work fails closed with an operator action.
   */
  permissionDenied?: boolean;
  /**
   * Explicitly identifies deterministic provider-wide unavailability.
   * Consumers must also require providerUnavailableScope === 'run'; output
   * text alone never authorizes provider fallback or run-wide caching.
   */
  providerUnavailable?: boolean;
  providerUnavailableScope?: ProviderUnavailableScope;
  providerUnavailableReason?: string;
  /** Set when a provider reports that the exact dispatched slash command is unknown. */
  commandUnresolved?: boolean;
  /** The slash-command name reported as unresolved, without its leading slash. */
  commandUnresolvedName?: string;
  /** Set by the execution layer when a cached unavailable provider is skipped. */
  providerInvocationSkipped?: boolean;
  /** Provider-owned, safe authentication source/readiness metadata. */
  authentication?: AuthenticationReadiness;
  /** Sanitized diagnostic-only safety notices; never an authorization input. */
  safetyDiagnostics?: readonly string[];
}

export interface InvokeOptions {
  prompt: string;
  systemPrompt?: string;
  sessionId: string;
  resume: boolean;
  interactive?: boolean;
  dangerouslySkipPermissions?: boolean;
  stepCooldown?: number;
  sessionName?: string;
  /**
   * Claude model to use for this invocation (e.g. "haiku", "sonnet", "opus", or
   * a full model ID). When omitted, the Claude CLI picks its own default.
   */
  model?: string;
  /**
   * Claude reasoning effort level for this invocation. Passed via
   * CLAUDE_CODE_EFFORT_LEVEL env var (which takes precedence over settings.json
   * and skill frontmatter, and cascades to subagent invocations spawned within
   * the session). Values: low | medium | high | xhigh | max.
   */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /**
   * Working directory for the spawned `claude` process. CRITICAL for the daemon:
   * each feature runs in its own git worktree, so the agent's file writes and
   * commits must land in that worktree — not the daemon's main checkout. When
   * omitted, the subprocess inherits the parent process cwd.
   */
  cwd?: string;
  /**
   * Optional feature-scoped sink for subprocess diagnostics. Daemon feature
   * runs supply their persisted logger; ordinary CLI runs leave this unset and
   * continue inheriting stdio directly.
   */
  diagnosticLog?: (message: string) => void;
  /** Set only for the resolved self-host provider candidate. */
  selfHost?: SelfHostInvocation;
  /**
   * Fired on every observed stdout/stderr activity boundary from the spawned
   * provider subprocess (each streamed JSON event line). Used to drive the
   * `.pipeline/step-heartbeat` liveness signal (see `step-heartbeat.ts`) so a
   * genuinely-working step is never mistaken for a silent hang. Best-effort:
   * a throwing handler must never affect provider dispatch.
   */
  onActivity?: () => void;
  /**
   * Optional, best-effort notification fired synchronously once the provider
   * subprocess has spawned. It is observation only: it grants no timeout,
   * kill, retry, or lifecycle authority. The callback must not affect provider
   * dispatch; lifecycle authority remains with `spawnPermit` before spawn.
   */
  onSpawn?: () => void;
  /**
   * Lifecycle-owned authority that adapters must validate synchronously
   * immediately before creating a provider process.
   */
  spawnPermit?: SpawnPermit;
}

export interface LLMProvider {
  /**
   * Whether this adapter can resume a caller-supplied session ID. Providers
   * that cannot resume must declare `false`; an absent legacy/custom-provider
   * declaration is also treated as `false` (only `=== true` authorizes resume).
   */
  supportsSessionResume?: boolean;
  /**
   * Declares that this adapter honors `InvokeOptions.spawnPermit` synchronously
   * at its subprocess creation boundary.
   */
  lifecycleCapability?: ProviderLifecycleCapability;
  invoke(options: InvokeOptions): Promise<InvokeResult>;
  /** Optional so legacy and custom providers need not implement auth recovery. */
  readiness?(): Promise<AuthenticationReadiness>;
  /** Optional provider-owned selected-auth handoff for an isolated self-host home. */
  prepareSelfHostAuth?(context: SelfHostAuthContext): Promise<SelfHostAuthPreparation>;
  /** Resolve the provider executable before a child home overrides provider state. */
  resolveSelfHostExecutable?(): Promise<string>;
  /**
   * Built-in providers return classified completion after their streamed
   * process exits. Legacy custom providers may keep returning void; absence of
   * a result carries no provider-fallback authority.
   */
  invokeInteractive(options: InvokeOptions): Promise<InvokeResult | void>;
}
