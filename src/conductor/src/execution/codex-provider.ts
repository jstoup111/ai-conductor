import { execa } from 'execa';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { copySelectedCodexLogin } from './codex-self-host-auth.js';
import type {
  AuthenticationReadiness,
  AuthenticationSource,
  InvokeOptions,
  InvokeResult,
  LLMProvider,
  SelfHostAuthContext,
  SelfHostAuthPreparation,
  TokenUsage,
} from './llm-provider.js';
import { summarizeProviderDiagnostic } from './provider-diagnostics.js';

// These are deliberately Codex-specific rather than reusing Claude's error
// vocabulary. The CLIs report different messages for the same failure class.
export const CODEX_AUTH_FAILURE_RE =
  /not logged in|please (?:log in|run codex login)|authentication required|unauthorized|invalid api key|api error:\s*401/i;
export const CODEX_RATE_LIMIT_RE =
  /rate limit|too many requests|\b429\b|usage limit|quota exceeded|capacity exceeded/i;
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
}

type DoctorEvidence =
  | {
    kind: 'documented';
    state: AuthenticationReadiness['state'];
    unrelatedHealth?: AuthenticationReadiness['unrelatedHealth'];
  }
  | {
    kind: 'legacy';
    source: AuthenticationSource;
    configured: boolean;
    authenticated: boolean;
    rejected?: boolean;
  };

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

const CODEX_DOCTOR_TIMEOUT_MS = 10_000;

const defaultCodexDoctorRunner: CodexDoctorRunner = async (command, args, options) =>
  execa(command, args, options) as Promise<DoctorCommandResult>;

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
        if (typeof input === 'number' && typeof outputTokens === 'number') {
          tokenUsage = { input, output: outputTokens };
          const cached = event.usage.cached_input_tokens;
          if (typeof cached === 'number') tokenUsage.cacheRead = cached;
        }
      }
    } catch {
      // A non-JSON diagnostic can appear alongside JSONL. Keep parsing and use
      // the full stdout as a fallback below so diagnostics are never lost.
    }
  }

  return { output: output ?? stdout, tokenUsage };
}

function parseWaitSeconds(output: string): number {
  const match = output.match(/(?:retry|try again)\s*(?:after|in)?\s*(\d+)\s*(?:seconds?|secs?|s)\b/i);
  return match ? Number(match[1]) : 300;
}

export class CodexProvider implements LLMProvider {
  private readonly authentication: SelectedAuthentication;
  private readonly executable: string;
  private readonly cachedLoginSource: string;

  constructor(
    private readonly runDoctor: CodexDoctorRunner = defaultCodexDoctorRunner,
    executable = process.env.CODEX_EXECUTABLE ?? 'codex',
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

  async readiness(): Promise<AuthenticationReadiness> {
    const authentication = this.authentication;
    try {
      const result = await this.runDoctor(
        'codex',
        ['doctor', '--json', '--summary'],
        {
          reject: false,
          timeout: CODEX_DOCTOR_TIMEOUT_MS,
          stdout: 'pipe',
          stderr: 'pipe',
          env: authentication.apiKey
            ? { CODEX_API_KEY: authentication.apiKey }
            : undefined,
        },
      );
      return this.classifyReadiness(result, authentication);
    } catch {
      return this.nonReadyReadiness(authentication.source, 'unverifiable');
    }
  }

  async invoke(options: InvokeOptions): Promise<InvokeResult> {
    const readiness = await this.readiness();
    if (readiness.state !== 'ready') return this.readinessFailure(readiness);

    const authentication = this.authentication;
    const args = [...this.buildArgs(options, true, true), ...this.selfHostArgs(options)];
    const prompt = this.composePrompt(options);

    const subprocess = execa(options.selfHost?.executable ?? this.executable, args, {
      reject: false,
      input: prompt,
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: options.cwd,
      env: this.invocationEnv(options, authentication),
    });
    this.wireActivityWatchdog(subprocess, options);
    const result = await subprocess;

    this.logDiagnostics(result, options.diagnosticLog);

    return this.classifyCompletion(result, true, authentication, true);
  }

  /**
   * Wire the heartbeat/stall-watchdog seam on the LIVE subprocess, before it
   * is awaited — attaching after resolution would miss every streamed event
   * and hand the kill handle to the watchdog too late for a stall to ever be
   * caught. Best-effort: never affects provider dispatch.
   */
  private wireActivityWatchdog(
    subprocess: { kill: () => void; stdout?: NodeJS.ReadableStream | null; stderr?: NodeJS.ReadableStream | null },
    options: Pick<InvokeOptions, 'onActivity' | 'onSpawn'>,
  ): void {
    try {
      options.onSpawn?.({ kill: () => subprocess.kill() });
      subprocess.stdout?.on('data', () => options.onActivity?.());
      subprocess.stderr?.on('data', () => options.onActivity?.());
    } catch {
      // Watchdog wiring is best-effort; never affects provider dispatch.
    }
  }

  /**
   * Codex's `exec` mode is one-shot rather than a REPL. Keep the interface
   * usable for conductor's collaborative calls by streaming that one-shot run.
   */
  async invokeInteractive(options: InvokeOptions): Promise<InvokeResult> {
    // A real interactive session leaves authorization to the operator. Auto
    // streaming still uses this method, but is explicitly marked noninteractive
    // by the runner and must prove readiness for every dispatch.
    if (!options.interactive) {
      const readiness = await this.readiness();
      if (readiness.state !== 'ready') return this.readinessFailure(readiness);
    }

    const authentication = this.authentication;
    const subprocess = execa(options.selfHost?.executable ?? this.executable, [...this.buildArgs(options, false, !options.interactive), ...this.selfHostArgs(options)], {
      reject: false,
      input: this.composePrompt(options),
      stdin: 'pipe',
      stdout: options.diagnosticLog ? 'pipe' : options.interactive ? ['pipe', 'inherit'] : 'pipe',
      stderr: options.diagnosticLog ? 'pipe' : options.interactive ? ['pipe', 'inherit'] : 'pipe',
      cwd: options.cwd,
      env: this.invocationEnv(options, authentication),
    });
    this.wireActivityWatchdog(subprocess, options);
    const result = await subprocess;

    this.logDiagnostics(result, options.diagnosticLog);

    return this.classifyCompletion(result, false, authentication, !options.interactive);
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
        authentication: this.authenticationResult(source, 'ready'),
      };
    }

    // Rate limits take precedence over auth: some service responses include
    // both quota and sign-in wording, but retry coordination must win.
    const rateLimited = exitCode !== 0 && CODEX_RATE_LIMIT_RE.test(rawOutput);
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
    const authentication = this.authenticationResult(
      source,
      authFailure ? 'unusable' : 'ready',
    );

    return {
      success: exitCode === 0,
      output: authFailure
        ? `Codex authentication failed using the selected ${source} source.`
        : permissionDenied
          ? 'Codex automatic permission review was denied or unavailable. Verify the review policy or permissions, then retry.'
        : output,
      exitCode,
      rateLimited: rateLimited || undefined,
      waitSeconds: rateLimited ? parseWaitSeconds(rawOutput) : undefined,
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
    state: AuthenticationReadiness['state'] | undefined,
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
    const evidence = this.parseDoctorEvidence(result.stdout);
    if (!evidence || (evidence.kind === 'legacy' && evidence.source !== authentication.source)) {
      return this.nonReadyReadiness(authentication.source, 'unverifiable');
    }

    const exitCode = result.exitCode ?? 1;
    if (evidence.kind === 'documented') {
      if (evidence.state === 'ready') {
        return {
          provider: 'codex',
          source: authentication.source,
          state: 'ready',
          unrelatedHealth: evidence.unrelatedHealth,
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
      evidence.rejected !== true &&
      exitCode === 0
    ) {
      return this.nonReadyReadiness(authentication.source, 'missing');
    }
    if (
      evidence.configured === true &&
      evidence.authenticated === false &&
      evidence.rejected === true &&
      exitCode !== 0
    ) {
      return this.nonReadyReadiness(authentication.source, 'unusable');
    }
    return this.nonReadyReadiness(authentication.source, 'unverifiable');
  }

  private parseDoctorEvidence(stdout: unknown): DoctorEvidence | undefined {
    if (typeof stdout !== 'string') return undefined;
    try {
      const parsed: unknown = JSON.parse(stdout);
      if (!parsed || typeof parsed !== 'object') return undefined;
      const record = parsed as Record<string, unknown>;
      if (record.schemaVersion !== 1) return undefined;

      const hasDocumentedShape = 'overallStatus' in record || 'checks' in record;
      const hasLegacyShape = 'auth' in record || 'transport' in record;
      if (hasDocumentedShape && hasLegacyShape) return undefined;

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
          return undefined;
        }
        const credentials = (checks as Record<string, unknown>)['auth.credentials'];
        if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) return undefined;
        const { status, summary } = credentials as Record<string, unknown>;
        if (typeof summary !== 'string') return undefined;
        if (status === 'ok') {
          return {
            kind: 'documented',
            state: 'ready',
            unrelatedHealth: overallStatus === 'ok' ? undefined : 'degraded',
          };
        }
        if (status !== 'fail') return undefined;
        if (/(?:no codex credentials were found|codex credentials are missing)/i.test(summary)) {
          return { kind: 'documented', state: 'missing' };
        }
        if (/invalid|rejected|unauthorized|expired/i.test(summary)) {
          return { kind: 'documented', state: 'unusable' };
        }
        return undefined;
      }

      const { auth, transport } = record;
      if (!auth || typeof auth !== 'object' || !transport || typeof transport !== 'object') return undefined;
      const { selectedMode, configured, rejected } = auth as Record<string, unknown>;
      const { authenticated } = transport as Record<string, unknown>;
      if (
        (selectedMode !== 'api-key' && selectedMode !== 'cached-login') ||
        typeof configured !== 'boolean' ||
        typeof authenticated !== 'boolean' ||
        (rejected !== undefined && typeof rejected !== 'boolean')
      ) {
        return undefined;
      }
      return { kind: 'legacy', source: selectedMode, configured, authenticated, rejected };
    } catch {
      return undefined;
    }
  }

  private nonReadyReadiness(
    source: AuthenticationSource,
    state: Exclude<AuthenticationReadiness['state'], 'ready'>,
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
    const args = options.resume
      ? ['exec', 'resume', options.sessionId]
      : ['exec'];

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
    // `resume` does not expose --cd, but execa's cwd still sets the working root.
    if (!options.resume && options.cwd) args.push('--cd', options.cwd);
    if (json) args.push('--json');
    // An explicit '-' makes stdin prompt delivery unambiguous and avoids argv
    // length limits for large build-review prompts.
    args.push('-');
    return args;
  }

  private invocationEnv(options: InvokeOptions, authentication: SelectedAuthentication): NodeJS.ProcessEnv | undefined {
    const auth = authentication.apiKey ? { CODEX_API_KEY: authentication.apiKey } : undefined;
    return options.selfHost ? { ...options.selfHost.env, ...auth } : auth;
  }

  private selfHostArgs(options: InvokeOptions): readonly string[] {
    const args = options.selfHost?.args ?? [];
    if (args.length > 16 || args.some((arg) => arg.length > 512)) {
      throw new Error('Codex self-host arguments exceed the bounded provider contract.');
    }
    return args;
  }

  private composePrompt(options: InvokeOptions): string {
    if (!options.systemPrompt) return options.prompt;
    return `${options.systemPrompt}\n\n${options.prompt}`;
  }
}
