import { execa } from 'execa';
import type { LLMProvider, InvokeOptions, InvokeResult } from './llm-provider.js';

const RATE_LIMIT_RE = /rate limit|429|overloaded|usage limit/i;
const STALE_SESSION_RE = /No conversation found/i;

export class ClaudeProvider implements LLMProvider {
  async invoke(options: InvokeOptions): Promise<InvokeResult> {
    const args = this.buildArgs(options);

    if (options.prompt) {
      args.push('--print', '--output-format', 'text', '-p', options.prompt);
    }

    // Stream stdout/stderr to terminal while also capturing for analysis
    const result = await execa('claude', args, {
      reject: false,
      stdout: ['pipe', 'inherit'],
      stderr: ['pipe', 'inherit'],
    });

    const stdout = (result.stdout ?? '') as string;
    const stderr = (result.stderr ?? '') as string;
    const exitCode = (result.exitCode ?? 1) as number;

    // Combine stdout + stderr so the caller has full context
    const output = stderr ? `${stdout}\n${stderr}`.trim() : stdout;

    // Detect missing binary (exit 127 or ENOENT in stderr)
    if (exitCode === 127 || /ENOENT|not found/i.test(stderr)) {
      return {
        success: false,
        output: "LLM provider 'claude' not found. Install it or check your PATH.",
        exitCode,
      };
    }

    const rateLimited = RATE_LIMIT_RE.test(output);
    const sessionExpired = STALE_SESSION_RE.test(output);

    return {
      success: exitCode === 0,
      output,
      exitCode,
      rateLimited: rateLimited || undefined,
      sessionExpired: sessionExpired || undefined,
    };
  }

  async invokeInteractive(options: InvokeOptions): Promise<void> {
    const args = this.buildArgs(options);

    await execa('claude', args, {
      stdio: 'inherit',
      reject: false,
    });
  }

  private buildArgs(options: InvokeOptions): string[] {
    const args: string[] = [];

    if (options.resume) {
      args.push('--resume', options.sessionId);
    } else {
      args.push('--session-id', options.sessionId);
    }

    if (options.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    if (options.sessionName) {
      args.push('--name', options.sessionName);
    }

    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt);
    }

    return args;
  }
}
