import { execa } from 'execa';
import type { InvokeOptions, InvokeResult, LLMProvider, TokenUsage } from './llm-provider.js';

// These are deliberately Codex-specific rather than reusing Claude's error
// vocabulary. The CLIs report different messages for the same failure class.
export const CODEX_AUTH_FAILURE_RE =
  /not logged in|please (?:log in|run codex login)|authentication required|unauthorized|invalid api key|api error:\s*401/i;
export const CODEX_RATE_LIMIT_RE =
  /rate limit|too many requests|\b429\b|usage limit|quota exceeded|capacity exceeded/i;
export const CODEX_MODEL_UNAVAILABLE_RE =
  /(?:requested |selected )?model .{0,80}(?:not found|unavailable|not available|unsupported|not supported)|unknown model|model not found|do not have access to (?:the )?model/i;
export const CODEX_SESSION_EXPIRED_RE =
  /(?:session|thread|conversation) (?:not found|does not exist|expired|invalid)|no conversation found|failed to resume|cannot resume/i;

interface CodexJsonEvent {
  type?: string;
  item?: { type?: string; text?: string; content?: Array<{ text?: string }> };
  usage?: Record<string, unknown>;
}

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
  async invoke(options: InvokeOptions): Promise<InvokeResult> {
    const args = this.buildArgs(options, true);
    const prompt = this.composePrompt(options);

    const result = await execa('codex', args, {
      reject: false,
      input: prompt,
      stdout: ['pipe', 'inherit'],
      stderr: ['pipe', 'inherit'],
      cwd: options.cwd,
    });

    const stdout = (result.stdout ?? '') as string;
    const stderr = (result.stderr ?? '') as string;
    const exitCode = (result.exitCode ?? 1) as number;
    const parsed = parseCodexJsonl(stdout);
    const output = stderr ? `${parsed.output}\n${stderr}`.trim() : parsed.output;

    if (exitCode === 127 || /ENOENT|command not found|codex:\s*not found|spawn codex/i.test(stderr)) {
      return {
        success: false,
        output: "LLM provider 'codex' not found. Install it or check your PATH.",
        exitCode,
      };
    }

    // Rate limits take precedence over auth: some service responses include
    // both quota and sign-in wording, but retry coordination must win.
    const rateLimited = exitCode !== 0 && CODEX_RATE_LIMIT_RE.test(output);
    const modelUnavailable = exitCode !== 0 && CODEX_MODEL_UNAVAILABLE_RE.test(output);
    const authFailure = exitCode !== 0 && !rateLimited && !modelUnavailable && CODEX_AUTH_FAILURE_RE.test(output);
    const sessionExpired = CODEX_SESSION_EXPIRED_RE.test(output);

    return {
      success: exitCode === 0,
      output,
      exitCode,
      rateLimited: rateLimited || undefined,
      waitSeconds: rateLimited ? parseWaitSeconds(output) : undefined,
      modelUnavailable: modelUnavailable || undefined,
      authFailure: authFailure || undefined,
      sessionExpired: sessionExpired || undefined,
      tokenUsage: parsed.tokenUsage,
    };
  }

  /**
   * Codex's `exec` mode is one-shot rather than a REPL. Keep the interface
   * usable for conductor's collaborative calls by streaming that one-shot run.
   */
  async invokeInteractive(options: InvokeOptions): Promise<void> {
    await execa('codex', this.buildArgs(options, false), {
      reject: false,
      input: this.composePrompt(options),
      stdio: ['pipe', 'inherit', 'inherit'],
      cwd: options.cwd,
    });
  }

  private buildArgs(options: InvokeOptions, json: boolean): string[] {
    const args = options.resume
      ? ['exec', 'resume', options.sessionId]
      : ['exec'];

    if (options.model) args.push('--model', options.model);
    if (options.effort) args.push('--config', `model_reasoning_effort="${options.effort}"`);
    if (options.dangerouslySkipPermissions) args.push('--dangerously-bypass-approvals-and-sandbox');
    // `resume` does not expose --cd, but execa's cwd still sets the working root.
    if (!options.resume && options.cwd) args.push('--cd', options.cwd);
    if (json) args.push('--json');
    // An explicit '-' makes stdin prompt delivery unambiguous and avoids argv
    // length limits for large build-review prompts.
    args.push('-');
    return args;
  }

  private composePrompt(options: InvokeOptions): string {
    if (!options.systemPrompt) return options.prompt;
    return `${options.systemPrompt}\n\n${options.prompt}`;
  }
}
