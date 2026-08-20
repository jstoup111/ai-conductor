import { execa, type Options as ExecaOptions, type ResultPromise } from 'execa';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { copySelectedCodexLogin } from './codex-self-host-auth.js';
import type {
  AuthenticationReadiness,
  AuthenticationSource,
  CodexProbeFailure,
  InvokeOptions,
  InvokeResult,
  LLMProvider,
  SelfHostAuthContext,
  SelfHostAuthPreparation,
  TokenUsage,
} from './llm-provider.js';
import {
  epochAnchoredMonotonicClock,
  observeInterval,
  type IntervalClock,
} from './observed-interval.js';
import { summarizeProviderDiagnostic } from './provider-diagnostics.js';
import { enforceFreshSessionOptions } from './fresh-session.js';
import { withDaemonSessionMarker } from './daemon-session.js';
import { validateSpawnPermit } from '../engine/provider-runtime.js';

// These are deliberately Codex-specific rather than reusing Claude's error
// vocabulary. The CLIs report different messages for the same failure class.
export const CODEX_AUTH_FAILURE_RE =
  /not logged in|please (?:log in|run codex login)|authentication required|unauthorized|invalid api key|api error:\s*401/i;
export const CODEX_RATE_LIMIT_RE =
  /rate limit|too many requests|\b429\b|capacity exceeded/i;
// A hard usage-cap exhaustion recovers on the plan's usage window, not on a
// throttle backoff. It keeps rate-limit retry coordination (no budget burn)
// but waits on an hour-scale default and is reported as usage exhaustion.
export const CODEX_USAGE_EXHAUSTED_RE =
  /usage limit|quota exceeded|exhausted [^\n]{0,40}usage|usage [^\n]{0,40}exhausted/i;
export const CODEX_MODEL_UNAVAILABLE_RE =
  /(?:requested |selected )?model .{0,80}(?:not found|unavailable|not available|unsupported|not supported)|unknown model|model not found|do not have access to (?:the )?model/i;
export const CODEX_SESSION_EXPIRED_RE =
  /(?:session|thread|conversation) (?:not found|does not exist|expired|invalid)|no conversation found|no rollout found|thread\/resume failed|failed to resume|cannot resume/i;
export const CODEX_PERMISSION_DECISION_RE =
  /(?:permission|approval|review).{0,80}(?:denied|unavailable|rejected|cancel(?:led|ed)|timed out|timeout|unknown result|failed to (?:produce|return) (?:an? )?decision|indeterminate|no decision)/i;

interface CodexJsonEvent {
  type?: string;
  item?: { type?: string; text?: string; content?: Array<{ text?: string }> };
  usage?: Record<string, unknown>;
}

interface SelectedAuthentication {
  source: AuthenticationSource;
  apiKey?: string;
}

interface DoctorCommandResult {
  stdout?: unknown;
  stderr?: unknown;
  exitCode?: number | null;
  failed?: boolean;
  timedOut?: boolean;
  code?: unknown;
  signal?: unknown;
}

type DoctorEvidence =
  | {
    kind: 'documented';
    state: Exclude<AuthenticationReadiness['state'], 'probe-failed'>;
    unrelatedHealth?: AuthenticationReadiness['unrelatedHealth'];
    facts: CodexProbeFailure['facts'];
  }
  | {
    kind: 'legacy';
    source: AuthenticationSource;
    configured: boolean;
    authenticated: boolean;
    rejected?: boolean;
    facts: CodexProbeFailure['facts'];
  };

type ParsedDoctorEvidence =
  | { kind: 'evidence'; evidence: DoctorEvidence }
  | { kind: 'rejected'; probeFailure: CodexProbeFailure };

export interface CodexDoctorRunnerOptions {
  reject: false;
  timeout: number;
  stdout: 'pipe';
  stderr: 'pipe';
  env?: Record<string, string>;
}

/** A narrow injectable boundary for captured, non-mutating Codex readiness checks. */
export type CodexDoctorRunner = (
  command: 'codex',
  args: readonly ['doctor', '--json', '--summary'],
  options: CodexDoctorRunnerOptions,
) => Promise<DoctorCommandResult>;

const DEFAULT_CODEX_DOCTOR_TIMEOUT_MS = 10_000;

const defaultCodexDoctorRunner: CodexDoctorRunner = async (command, args, options) =>
  execa(command, args, options) as Promise<DoctorCommandResult>;

type CodexSubprocessFactory = (
  file: string,
  args: readonly string[],
  options: ExecaOptions,
) => ResultPromise;

/** Extract the final agent message and optional usage from Codex JSONL output. */
export function parseCodexJsonl(stdout: string): { output: string; tokenUsage?: TokenUsage } {
  let output: string | undefined;
  let tokenUsage: TokenUsage | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as CodexJsonEvent;
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        const text = event.item.text ?? event.item.content?.map((part) => part.text ?? '').join('');
        if (text) output = text;
      }
      if (event.type === 'turn.completed' && event.usage) {
        const input = event.usage.input_tokens;
        const outputTokens = event.usage.output_tokens;
        if (typeof input === 'number' && Number.isFinite(input)
          && typeof outputTokens === 'number' && Number.isFinite(outputTokens)) {
          tokenUsage ??= { input: 0, output: 0, numTurns: 0 };
          const cached = event.usage.cached_input_tokens;
          // Codex's `input_tokens` INCLUDES `cached_input_tokens` (OpenAI
          // semantics), while Claude's `input_tokens` excludes its cache
          // fields (Anthropic semantics). TokenUsage.input is fresh-only, so
          // subtract the cached share here; `cacheRead` keeps the cached
          // volume. Without this a cache-heavy agentic run reports its
          // ~100k context times every internal tool-call round trip as
          // "input" — a 1.5M figure for a ~117k-fresh remediate dispatch.
          const cachedShare =
            typeof cached === 'number' && Number.isFinite(cached) ? Math.min(cached, input) : 0;
          tokenUsage.input += input - cachedShare;
          tokenUsage.output += outputTokens;
          tokenUsage.numTurns = (tokenUsage.numTurns ?? 0) + 1;
          if (typeof cached === 'number' && Number.isFinite(cached)) {
            tokenUsage.cacheRead = (tokenUsage.cacheRead ?? 0) + cached;
          }
          const cacheCreation = event.usage.cache_write_input_tokens;
          if (typeof cacheCreation === 'number' && Number.isFinite(cacheCreation)) {
            tokenUsage.cacheCreation = (tokenUsage.cacheCreation ?? 0) + cacheCreation;
          }
          const reasoningOutput = event.usage.reasoning_output_tokens;
          if (typeof reasoningOutput === 'number' && Number.isFinite(reasoningOutput)) {
            tokenUsage.reasoningOutput = (tokenUsage.reasoningOutput ?? 0) + reasoningOutput;
          }
        }
      }
    } catch {
      // A non-JSON diagnostic can appear alongside JSONL. Keep parsing and use
      // the full stdout as a fallback below so diagnostics are never lost.
    }
  }

  return { output: output ?? stdout, tokenUsage };
}

function parseWaitSeconds(output: string, fallbackSeconds = 300): number {
  const match = output.match(/(?:retry|try again)\s*(?:after|in)?\s*(\d+)\s*(?:seconds?|secs?|s)\b/i);
  return match ? Number(match[1]) : fallbackSeconds;
}

export class CodexProvider implements LLMProvider {
  readonly supportsSessionResume = false;
  readonly lifecycleCapability = { synchronousSpawnPermit: true } as const;

  private readonly authentication: SelectedAuthentication;
  private readonly executable: string;
  private readonly cachedLoginSource: string;

  constructor(
    private readonly runDoctor: CodexDoctorRunner = defaultCodexDoctorRunner,
    executable = process.env.CODEX_EXECUTABLE ?? 'codex',
    private readonly intervalClock: IntervalClock = epochAnchoredMonotonicClock,
    private readonly subprocessFactory: CodexSubprocessFactory = execa,
    private readonly doctorTimeoutMs = DEFAULT_CODEX_DOCTOR_TIMEOUT_MS,
  ) {
    this.authentication = this.selectAuthentication();
    this.executable = executable;
    this.cachedLoginSource = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');
  }

  async resolveSelfHostExecutable(): Promise<string> {
    return this.executable;
  }

  async prepareSelfHostAuth(context: SelfHostAuthContext): Promise<SelfHostAuthPreparation> {
    if (!this.authentication.apiKey) {
      await copySelectedCodexLogin({ source: this.cachedLoginSource, homeDir: context.homeDir });
    }
    return {
      ...(this.authentication.apiKey ? { env: { CODEX_API_KEY: this.authentication.apiKey } } : {}),
      args: [],
    };
  }

  async readiness(spawnPermit?: InvokeOptions['spawnPermit']): Promise<AuthenticationReadiness> {
    this.assertSpawnPermitted(spawnPermit, 'preparation');
    const authentication = this.authentication;
    try {
      const result = await this.runDoctor(
        'codex',
        ['doctor', '--json', '--summary'],
        {
          reject: false,
          timeout: this.doctorTimeoutMs,
          stdout: 'pipe',
          stderr: 'pipe',
          env: authentication.apiKey
            ? { CODEX_API_KEY: authentication.apiKey }
            : undefined,
        },
      );
      if (this.isProvenDoctorExecutionFailure(result)) {
        return this.executionProbeFailedReadiness(authentication.source, result);
      }
      return this.classifyReadiness(result, authentication);
    } catch (error) {
      return this.executionProbeFailedReadiness(authentication.source, error);
    }
  }

  async invoke(options: InvokeOptions): Promise<InvokeResult> {
    // Boundary enforcement: session reuse was removed by design — a fresh
    // session per invocation. Codex `exec` is one-shot and never receives the
    // session id, but the invariant is enforced uniformly at every adapter
    // entry so no future arg-building change can resurrect reuse.
    options = enforceFreshSessionOptions(options, 'codex');
    const readiness = await this.readiness(options.spawnPermit);
    this.logReadinessDiagnostic(readiness, options.diagnosticLog);
    if (readiness.state === 'missing' || readiness.state === 'unusable') {
      return this.readinessFailure(readiness);
    }

    const authentication = this.authentication;
    const args = [...this.selfHostArgs(options), ...this.buildArgs(options, true, true)];
    const prompt = this.composePrompt(options);

    const { value: result, interval } = await observeInterval(this.intervalClock, async () => {
      const subprocess = this.spawnCodex(options.selfHost?.executable ?? this.executable, args, {
        reject: false,
        input: prompt,
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: options.cwd,
        env: this.invocationEnv(options, authentication),
      }, options);
      return subprocess;
    });

    this.logDiagnostics(result, options.diagnosticLog);

    const completion = this.classifyCompletion(result, true, authentication, true, readiness);
    return { ...completion, observedIntervals: [interval] };
  }

  /**
   * Wire optional spawn and activity observations on the LIVE subprocess
   * before awaiting, so observers receive the spawn event and streamed
   * activity. These best-effort callbacks have no timeout, kill, retry, or
   * lifecycle authority and never affect provider dispatch.
   */
  private wireActivityWatchdog(
    subprocess: { kill: () => void; stdout?: NodeJS.ReadableStream | null; stderr?: NodeJS.ReadableStream | null },
    options: Pick<InvokeOptions, 'onActivity' | 'onSpawn'>,
  ): void {
    try {
      options.onSpawn?.();
      subprocess.stdout?.on('data', () => options.onActivity?.());
      subprocess.stderr?.on('data', () => options.onActivity?.());
    } catch {
      // Watchdog wiring is best-effort; never affects provider dispatch.
    }
  }

  private spawnCodex(
    executable: string,
    args: readonly string[],
    options: ExecaOptions,
    watchdogOptions: Pick<InvokeOptions, 'onActivity' | 'onSpawn' | 'spawnPermit'>,
  ): ResultPromise {
    this.assertSpawnPermitted(watchdogOptions.spawnPermit);
    const subprocess = this.subprocessFactory(executable, args, options);
    this.wireActivityWatchdog(subprocess, watchdogOptions);
    return subprocess;
  }

  private assertSpawnPermitted(
    spawnPermit: InvokeOptions['spawnPermit'],
    purpose?: 'preparation',
  ): void {
    const permit = purpose === undefined
      ? validateSpawnPermit(spawnPermit)
      : validateSpawnPermit(spawnPermit, purpose);
    if (!permit.permitted) {
      throw new Error(`Codex process spawn denied: ${permit.reason}`);
    }
  }

  /**
   * Codex's `exec` mode is one-shot rather than a REPL. Keep the interface
   * usable for conductor's collaborative calls by streaming that one-shot run.
   */
  async invokeInteractive(options: InvokeOptions): Promise<InvokeResult> {
    // Boundary enforcement: fresh session per invocation (see invoke()).
    options = enforceFreshSessionOptions(options, 'codex');
    // A real interactive session leaves authorization to the operator. Auto
    // streaming still uses this method, but is explicitly marked noninteractive
    // by the runner and must prove readiness for every dispatch.
    const readiness = options.interactive
      ? undefined
      : await this.readiness(options.spawnPermit);
    if (readiness) this.logReadinessDiagnostic(readiness, options.diagnosticLog);
    if (readiness?.state === 'missing' || readiness?.state === 'unusable') {
      return this.readinessFailure(readiness);
    }

    const authentication = this.authentication;
    const { value: result, interval } = await observeInterval(this.intervalClock, async () => {
      const subprocess = this.spawnCodex(options.selfHost?.executable ?? this.executable, [...this.selfHostArgs(options), ...this.buildArgs(options, false, !options.interactive)], {
        reject: false,
        input: this.composePrompt(options),
        stdin: 'pipe',
        stdout: options.diagnosticLog ? 'pipe' : options.interactive ? ['pipe', 'inherit'] : 'pipe',
        stderr: options.diagnosticLog ? 'pipe' : options.interactive ? ['pipe', 'inherit'] : 'pipe',
        cwd: options.cwd,
        env: this.invocationEnv(options, authentication),
      }, options);
      return subprocess;
    });

    this.logDiagnostics(result, options.diagnosticLog);

    return {
      ...this.classifyCompletion(result, false, authentication, !options.interactive, readiness),
      observedIntervals: [interval],
    };
  }

  private logDiagnostics(
    result: { stdout?: unknown; stderr?: unknown },
    diagnosticLog: InvokeOptions['diagnosticLog'],
  ): void {
    if (!diagnosticLog) return;
    for (const output of [result.stdout, result.stderr]) {
      // `exec --json` stdout is a JSONL machine stream. Summarize it for the
      // operator-facing daemon log; unrecognized output passes through verbatim.
      if (typeof output === 'string' && output.length > 0) {
        diagnosticLog(summarizeProviderDiagnostic('codex', output));
      }
    }
  }

  private logReadinessDiagnostic(
    readiness: AuthenticationReadiness,
    diagnosticLog: InvokeOptions['diagnosticLog'],
  ): void {
    if (!diagnosticLog || readiness.state !== 'probe-failed') return;

    const { facts, kind } = readiness.probeFailure;
    const renderedFacts = [
      facts.processErrorCode && `processErrorCode=${facts.processErrorCode}`,
      facts.exitCode !== undefined && `exitCode=${facts.exitCode}`,
      facts.signal && `signal=${facts.signal}`,
      facts.timeoutMs !== undefined && `timeoutMs=${facts.timeoutMs}`,
      facts.stdoutBytes !== undefined && `stdoutBytes=${facts.stdoutBytes}`,
      facts.stderrBytes !== undefined && `stderrBytes=${facts.stderrBytes}`,
      facts.schemaVersion !== undefined && `schemaVersion=${facts.schemaVersion}`,
      facts.envelopeStatus && `envelopeStatus=${facts.envelopeStatus}`,
      facts.credentialCheck && `credentialCheck=${facts.credentialCheck}`,
      facts.parserRejection && `parserRejection=${facts.parserRejection}`,
    ].filter((fact): fact is string => typeof fact === 'string');
    diagnosticLog(
      `Codex readiness probe failed: ${kind}${renderedFacts.length > 0 ? ` (${renderedFacts.join(', ')})` : ''}.`,
    );
  }

  private classifyCompletion(
    result: {
      stdout?: unknown;
      stderr?: unknown;
      exitCode?: number | null;
      code?: string;
    },
    jsonOutput: boolean,
    authenticationSelection: SelectedAuthentication,
    automaticReview = true,
    readyReadiness?: Extract<AuthenticationReadiness, { state: 'ready' | 'probe-failed' }>,
  ): InvokeResult {
    const { source } = authenticationSelection;
    const stdout = (result.stdout ?? '') as string;
    const stderr = (result.stderr ?? '') as string;
    const exitCode = (result.exitCode ?? 1) as number;
    const parsed = jsonOutput
      ? parseCodexJsonl(stdout)
      : { output: stdout, tokenUsage: undefined };
    const rawOutput =
      stderr ? `${parsed.output}\n${stderr}`.trim() : parsed.output;
    const output = this.sanitizeOutput(
      rawOutput,
      authenticationSelection.apiKey,
    );

    // Missing-binary classification is anchored to structural process signals.
    // Never infer provider-wide unavailability from arbitrary stderr prose.
    if (result.code === 'ENOENT' || exitCode === 127) {
      const reason =
        "LLM provider 'codex' not found. Install it or check your PATH.";
      return {
        success: false,
        output: reason,
        exitCode,
        providerUnavailable: true,
        providerUnavailableScope: 'run',
        providerUnavailableReason: reason,
        // A missing executable takes precedence as the completion result, but
        // must not overwrite an earlier inconclusive readiness probe.
        authentication: readyReadiness ?? this.authenticationResult(source, 'ready'),
      };
    }

    // Rate limits take precedence over auth: some service responses include
    // both quota and sign-in wording, but retry coordination must win.
    const usageExhausted = exitCode !== 0 && CODEX_USAGE_EXHAUSTED_RE.test(rawOutput);
    const rateLimited = usageExhausted || (exitCode !== 0 && CODEX_RATE_LIMIT_RE.test(rawOutput));
    const modelUnavailable = exitCode !== 0 && CODEX_MODEL_UNAVAILABLE_RE.test(rawOutput);
    const authFailure = exitCode !== 0 && !rateLimited && !modelUnavailable && CODEX_AUTH_FAILURE_RE.test(rawOutput);
    const sessionExpired = CODEX_SESSION_EXPIRED_RE.test(rawOutput);
    // Automatic runs cannot wait for an operator to decide a permission
    // request. Once every established recovery class has been excluded, treat
    // the remaining Codex-specific permission-decision result as an unavailable
    // automatic-review decision and fail closed. A generic empty exit or
    // process timeout is not sufficient evidence of a permission denial.
    const permissionDenied =
      exitCode !== 0 &&
      automaticReview &&
      !rateLimited &&
      !modelUnavailable &&
      !authFailure &&
      !sessionExpired &&
      CODEX_PERMISSION_DECISION_RE.test(rawOutput);
    const authentication = authFailure
      ? this.authenticationResult(source, 'unusable')
      : readyReadiness ?? this.authenticationResult(source, 'ready');

    return {
      success: exitCode === 0,
      output: authFailure
        ? `Codex authentication failed using the selected ${source} source.`
        : permissionDenied
          ? 'Codex automatic permission review was denied or unavailable. Verify the review policy or permissions, then retry.'
        : output,
      exitCode,
      rateLimited: rateLimited || undefined,
      usageExhausted: usageExhausted || undefined,
      waitSeconds: usageExhausted
        ? parseWaitSeconds(rawOutput, 3600)
        : rateLimited
          ? parseWaitSeconds(rawOutput)
          : undefined,
      modelUnavailable: modelUnavailable || undefined,
      authFailure: authFailure || undefined,
      permissionDenied: permissionDenied || undefined,
      sessionExpired: sessionExpired || undefined,
      tokenUsage: parsed.tokenUsage,
      authentication,
    };
  }

  private readinessFailure(readiness: AuthenticationReadiness): InvokeResult {
    return {
      success: false,
      output: readiness.remediation ?? 'Codex authentication is not ready.',
      exitCode: 1,
      authFailure: true,
      authentication: readiness,
    };
  }

  private selectAuthentication(): SelectedAuthentication {
    const apiKey = process.env.CODEX_API_KEY;
    return apiKey
      ? { source: 'api-key', apiKey }
      : { source: 'cached-login' };
  }

  private authenticationResult(
    source: AuthenticationSource,
    state: Exclude<AuthenticationReadiness['state'], 'probe-failed'> | undefined,
  ): AuthenticationReadiness | undefined {
    if (!state) return undefined;
    return {
      provider: 'codex',
      source,
      state,
    };
  }

  private classifyReadiness(
    result: DoctorCommandResult,
    authentication: SelectedAuthentication,
  ): AuthenticationReadiness {
    const parsed = this.parseDoctorEvidence(result.stdout);
    if (parsed.kind === 'rejected') {
      return this.probeFailedReadiness(authentication.source, parsed.probeFailure);
    }
    const { evidence } = parsed;
    if (evidence.kind === 'legacy' && evidence.source !== authentication.source) {
      return this.probeFailedReadiness(authentication.source, {
        kind: 'unparseable-output',
        facts: { ...evidence.facts, parserRejection: 'conflicting-source-evidence' },
      });
    }

    const exitCode = result.exitCode ?? 1;
    if (evidence.kind === 'documented') {
      if (evidence.state === 'ready') {
        return {
          provider: 'codex',
          source: authentication.source,
          state: 'ready',
          ...(evidence.unrelatedHealth
            ? { unrelatedHealth: evidence.unrelatedHealth }
            : {}),
        };
      }
      return this.nonReadyReadiness(authentication.source, evidence.state);
    }

    if (
      evidence.configured === true &&
      evidence.authenticated === true &&
      evidence.rejected !== true &&
      exitCode === 0
    ) {
      return { provider: 'codex', source: authentication.source, state: 'ready' };
    }
    if (
      evidence.configured === false &&
      evidence.authenticated === false &&
      evidence.rejected !== true
    ) {
      return this.nonReadyReadiness(authentication.source, 'missing');
    }
    if (
      evidence.configured === true &&
      evidence.authenticated === false &&
      evidence.rejected === true
    ) {
      return this.nonReadyReadiness(authentication.source, 'unusable');
    }
    return this.probeFailedReadiness(authentication.source, {
      kind: 'unparseable-output',
      facts: { ...evidence.facts, parserRejection: 'ambiguous-credential-evidence' },
    });
  }

  private parseDoctorEvidence(stdout: unknown): ParsedDoctorEvidence {
    if (typeof stdout !== 'string') return this.parserRejected('unrecognized-envelope');
    const stdoutBytes = Buffer.byteLength(stdout);
    try {
      const parsed: unknown = JSON.parse(stdout);
      if (!parsed || typeof parsed !== 'object') {
        return this.parserRejected('unrecognized-envelope', { stdoutBytes });
      }
      const record = parsed as Record<string, unknown>;
      if (record.schemaVersion !== 1) {
        return this.parserRejected('unsupported-schema', {
          stdoutBytes,
          ...(typeof record.schemaVersion === 'number' ? { schemaVersion: record.schemaVersion } : {}),
        });
      }

      const hasDocumentedShape = 'overallStatus' in record || 'checks' in record;
      const hasLegacyShape = 'auth' in record || 'transport' in record;
      if (hasDocumentedShape && hasLegacyShape) {
        return this.parserRejected('ambiguous-credential-evidence', this.documentedShapeFacts(record, stdoutBytes));
      }

      if (hasDocumentedShape) {
        // `codex doctor` reports three envelope statuses: ok / warning / fail.
        // Only `auth.credentials` is authoritative for readiness — the envelope
        // aggregates unrelated checks (e.g. `updates.status` warns when the
        // version probe is rate-limited with HTTP 403, which the daemon's own
        // 30s readiness polling reliably provokes). Rejecting `warning` here
        // discarded a healthy credentials check as `unverifiable`, which parked
        // and then halted every Codex build for the full auth-park timeout.
        const { overallStatus, checks } = record;
        if (
          (overallStatus !== 'ok' && overallStatus !== 'warning' && overallStatus !== 'fail') ||
          !checks ||
          typeof checks !== 'object' ||
          Array.isArray(checks)
        ) {
          return this.parserRejected('unrecognized-envelope', this.documentedShapeFacts(record, stdoutBytes));
        }
        const credentials = (checks as Record<string, unknown>)['auth.credentials'];
        if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
          return this.parserRejected('ambiguous-credential-evidence', this.documentedShapeFacts(record, stdoutBytes));
        }
        const { status, summary } = credentials as Record<string, unknown>;
        if (typeof summary !== 'string') {
          return this.parserRejected('ambiguous-credential-evidence', this.documentedShapeFacts(record, stdoutBytes));
        }
        if (status === 'ok') {
          return { kind: 'evidence', evidence: {
            kind: 'documented',
            state: 'ready',
            unrelatedHealth: overallStatus === 'ok' ? undefined : 'degraded',
            facts: this.documentedShapeFacts(record, stdoutBytes),
          } };
        }
        if (status !== 'fail') {
          return this.parserRejected('ambiguous-credential-evidence', this.documentedShapeFacts(record, stdoutBytes));
        }
        if (/(?:no codex credentials were found|codex credentials are missing)/i.test(summary)) {
          return { kind: 'evidence', evidence: {
            kind: 'documented', state: 'missing', facts: this.documentedShapeFacts(record, stdoutBytes),
          } };
        }
        if (/invalid|rejected|unauthorized|expired/i.test(summary)) {
          return { kind: 'evidence', evidence: {
            kind: 'documented', state: 'unusable', facts: this.documentedShapeFacts(record, stdoutBytes),
          } };
        }
        return this.parserRejected('ambiguous-credential-evidence', this.documentedShapeFacts(record, stdoutBytes));
      }

      const { auth, transport } = record;
      if (!auth || typeof auth !== 'object' || !transport || typeof transport !== 'object') {
        return this.parserRejected('unrecognized-envelope', {
          stdoutBytes,
          schemaVersion: 1,
          envelopeStatus: 'unknown',
          credentialCheck: 'unknown',
        });
      }
      const { selectedMode, configured, rejected } = auth as Record<string, unknown>;
      const { authenticated } = transport as Record<string, unknown>;
      if (
        (selectedMode !== 'api-key' && selectedMode !== 'cached-login') ||
        typeof configured !== 'boolean' ||
        typeof authenticated !== 'boolean' ||
        (rejected !== undefined && typeof rejected !== 'boolean')
      ) {
        return this.parserRejected('ambiguous-credential-evidence', { stdoutBytes, schemaVersion: 1 });
      }
      return { kind: 'evidence', evidence: {
        kind: 'legacy', source: selectedMode, configured, authenticated, rejected,
        facts: { stdoutBytes, schemaVersion: 1 },
      } };
    } catch {
      return this.parserRejected('invalid-json', { stdoutBytes });
    }
  }

  private parserRejected(
    parserRejection: Extract<CodexProbeFailure['facts']['parserRejection'], string>,
    facts: CodexProbeFailure['facts'] = {},
  ): ParsedDoctorEvidence {
    return {
      kind: 'rejected',
      probeFailure: { kind: 'unparseable-output', facts: { ...facts, parserRejection } },
    };
  }

  private documentedShapeFacts(record: Record<string, unknown>, stdoutBytes: number): CodexProbeFailure['facts'] {
    const overallStatus = record.overallStatus;
    const checks = record.checks;
    const credentials = checks && typeof checks === 'object' && !Array.isArray(checks)
      ? (checks as Record<string, unknown>)['auth.credentials']
      : undefined;
    const status = credentials && typeof credentials === 'object' && !Array.isArray(credentials)
      ? (credentials as Record<string, unknown>).status
      : undefined;
    return {
      stdoutBytes,
      schemaVersion: 1,
      envelopeStatus: overallStatus === 'ok' || overallStatus === 'warning' || overallStatus === 'fail'
        ? overallStatus
        : 'unknown',
      credentialCheck: credentials === undefined
        ? 'absent'
        : status === 'ok' || status === 'fail'
          ? status
          : 'unknown',
    };
  }

  private nonReadyReadiness(
    source: AuthenticationSource,
    state: 'missing' | 'unusable',
  ): AuthenticationReadiness {
    const action = source === 'api-key'
      ? 'Replace CODEX_API_KEY and restart the daemon.'
      : 'Sign in to Codex and retry.';
    const reason = state === 'missing'
      ? 'The selected Codex authentication source is not configured.'
      : state === 'unusable'
        ? 'The selected Codex authentication source was rejected.'
        : 'Codex authentication readiness could not be verified.';
    return { provider: 'codex', source, state, remediation: `${reason} ${action}` };
  }

  private executionProbeFailedReadiness(
    source: AuthenticationSource,
    error: unknown,
  ): AuthenticationReadiness {
    const facts = this.executionProbeFacts(error);
    if (typeof error === 'object' && error !== null && (error as { timedOut?: unknown }).timedOut === true) {
      return this.probeFailedReadiness(source, {
        kind: 'timeout',
        facts: { timeoutMs: this.doctorTimeoutMs, ...facts },
      });
    }

    return this.probeFailedReadiness(source, { kind: 'exec-error', facts });
  }

  private isProvenDoctorExecutionFailure(result: DoctorCommandResult): boolean {
    if (result.timedOut === true) return true;
    const facts = this.executionProbeFacts(result);
    return facts.processErrorCode !== undefined || facts.signal !== undefined;
  }

  private executionProbeFacts(error: unknown): CodexProbeFailure['facts'] {
    const facts: CodexProbeFailure['facts'] = {};
    if (typeof error !== 'object' || error === null) return facts;
    const record = error as Record<string, unknown>;
    const code = record.code;
    if (code === 'EACCES' || code === 'EAGAIN' || code === 'ENOENT' || code === 'EPERM') {
      facts.processErrorCode = code;
    } else if (code !== undefined) {
      facts.processErrorCode = 'UNKNOWN';
    }
    const exitCode = record.exitCode;
    if (typeof exitCode === 'number' && Number.isInteger(exitCode) && exitCode >= 0) {
      facts.exitCode = exitCode;
    }
    const signal = record.signal;
    if (
      signal === 'SIGABRT' || signal === 'SIGALRM' || signal === 'SIGHUP' || signal === 'SIGINT' ||
      signal === 'SIGKILL' || signal === 'SIGPIPE' || signal === 'SIGQUIT' || signal === 'SIGTERM'
    ) {
      facts.signal = signal;
    } else if (signal !== undefined) {
      facts.signal = 'UNKNOWN';
    }
    const stdoutBytes = this.outputByteLength(record.stdout);
    if (stdoutBytes !== undefined) facts.stdoutBytes = stdoutBytes;
    const stderrBytes = this.outputByteLength(record.stderr);
    if (stderrBytes !== undefined) facts.stderrBytes = stderrBytes;
    return facts;
  }

  private outputByteLength(output: unknown): number | undefined {
    if (typeof output === 'string' || Buffer.isBuffer(output)) return Buffer.byteLength(output);
    return undefined;
  }

  private probeFailedReadiness(
    source: AuthenticationSource,
    probeFailure: CodexProbeFailure = {
      kind: 'unparseable-output',
      facts: { parserRejection: 'unrecognized-envelope' },
    },
  ): AuthenticationReadiness {
    return {
      provider: 'codex',
      source,
      state: 'probe-failed',
      probeFailure,
    };
  }

  private sanitizeOutput(output: string, apiKey: string | undefined): string {
    if (!apiKey) return output;

    const fragments = [
      apiKey,
      ...Array.from(
        { length: Math.max(0, apiKey.length - 1) },
        (_, index) => apiKey.slice(0, apiKey.length - index - 1),
      ),
      ...Array.from(
        { length: Math.max(0, apiKey.length - 1) },
        (_, index) => apiKey.slice(index + 1),
      ),
    ]
      .filter((fragment) => fragment.length > 0)
      .sort((left, right) => right.length - left.length);

    return fragments.reduce(
      (sanitized, fragment) => sanitized.split(fragment).join('[redacted]'),
      output,
    );
  }

  private buildArgs(options: InvokeOptions, json: boolean, unattended: boolean): string[] {
    const args = ['exec'];

    if (options.model) args.push('--model', options.model);
    if (options.effort) args.push('--config', `model_reasoning_effort="${options.effort}"`);
    if (unattended) {
      args.push(
        '--config', 'sandbox_mode="workspace-write"',
        '--config', 'approval_policy="on-request"',
        '--config', 'approvals_reviewer="auto_review"',
        '--config', 'shell_environment_policy.ignore_default_excludes=false',
      );
    }
    if (options.cwd) args.push('--cd', options.cwd);
    if (json) args.push('--json');
    // An explicit '-' makes stdin prompt delivery unambiguous and avoids argv
    // length limits for large build-review prompts.
    args.push('-');
    return args;
  }

  private invocationEnv(options: InvokeOptions, authentication: SelectedAuthentication): NodeJS.ProcessEnv {
    const auth = authentication.apiKey ? { CODEX_API_KEY: authentication.apiKey } : undefined;
    // Every session env carries the daemon-session marker: any Codex session
    // spawned through this adapter is engine-managed, and the conduct-ts
    // entry guard refuses recursive conductor invocations from inside it
    // (see daemon-session.ts). Applied last so neither self-host env nor auth
    // can unset it.
    return withDaemonSessionMarker(
      options.selfHost ? { ...options.selfHost.env, ...auth } : auth,
    );
  }

  private selfHostArgs(options: InvokeOptions): readonly string[] {
    const args = options.selfHost?.args ?? [];
    if (args.some((arg) => arg.length > 512)) {
      throw new Error('Codex self-host arguments exceed the 512-character per-argument provider contract.');
    }
    return args;
  }

  private composePrompt(options: InvokeOptions): string {
    if (!options.systemPrompt) return options.prompt;
    return `${options.systemPrompt}\n\n${options.prompt}`;
  }
}
