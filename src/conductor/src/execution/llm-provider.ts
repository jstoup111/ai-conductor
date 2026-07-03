export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheCreation?: number;
}

export interface InvokeResult {
  success: boolean;
  output: string;
  exitCode: number;
  rateLimited?: boolean;
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
}

export interface LLMProvider {
  invoke(options: InvokeOptions): Promise<InvokeResult>;
  invokeInteractive(options: InvokeOptions): Promise<void>;
}
