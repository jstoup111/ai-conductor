import { execa } from 'execa';
import type { LLMProvider, InvokeOptions, InvokeResult, TokenUsage } from './llm-provider.js';

const RATE_LIMIT_RE = /rate limit|429|overloaded|usage limit/i;
const STALE_SESSION_RE = /No conversation found/i;
// A session-id lock ("already in use" / "session is in use by another
// process"). Recovers the same way as a stale session — reset to a fresh
// session id and retry — so it's folded into the sessionExpired signal.
const SESSION_IN_USE_RE = /\balready in use\b|\b(session|conversation)\b[^\n]{0,60}\bin use\b/i;
// Signatures indicating authentication failure — the daemon's OAuth token is
// missing, stale, or invalid. Distinct from model unavailability (entitled
// but token expired) or rate limiting (entitled but quota hit). Drives the
// token refresh / re-login flow in the recovery handler.
//
// Includes the Claude CLI's actual login-error wording as of 2026-07:
// - "Not logged in" — no stored token
// - "Invalid API key" — malformed or revoked token
// - "Please run /login" — interactive prompt to re-authenticate
export const AUTH_FAILURE_RE = /not logged in|invalid api key|please run \/login/i;

// Signatures indicating the requested model itself is unavailable — not
// entitled, deprecated, or unrecognized by the CLI/API — as opposed to a
// transient rate limit or session issue. Drives the fallback-ladder logic in
// ModelAvailability.
//
// Includes the real Claude CLI's actual wording as of 2026-07, confirmed via
// a real-binary smoke test (claude-provider.smoke.ts): running
// `claude --model definitely-not-a-model-xyz -p ping --print` produces:
//   "There's an issue with the selected model (definitely-not-a-model-xyz).
//    It may not exist or you may not have access to it. Run --model to pick
//    a different model."
// The original API-error-shaped patterns (not_found_error/"model not
// found"/"invalid model") are kept for coverage of raw API responses that
// may surface in other invocation paths.
export const MODEL_UNAVAILABLE_RE =
  /not_found_error.{0,80}model|model not found|invalid model( name)?|issue with the selected model|may not exist or you may not have access/i;

// Signature indicating the requested model has no usage credits / balance left
// on this account. Unlike MODEL_UNAVAILABLE_RE, the CLI prints this on a
// **zero exit code** (it's a soft notice, not a hard error) — e.g.
//   "You're out of usage credits. Run /usage-credits to keep using Fable 5 or
//    /model to switch models."
// Treated as model-unavailable so ModelAvailability ladders to the next model
// with credits (a different model on the same account is unaffected), instead
// of the step silently "completing" with no artifact and halting.
export const OUT_OF_CREDITS_RE =
  /out of usage credits|out of credits|run \/usage-credits/i;

/**
 * Parse rate limit wait time from output.
 * Handles two patterns:
 * 1. Duration-based: "retry after 450 seconds", "retry in 120 seconds", "try again after 60 seconds"
 *    - Applies a minutes heuristic: if extracted value < 60, treats it as minutes and converts to seconds.
 * 2. Time-based: "resets at 23:00", "resets 11pm", "resets 3am"
 *    - Calculates wait time as the delta from "now" to the reset time
 *    - Handles next-day rollover: if the parsed time is in the past, adds 86400 seconds (one day)
 *
 * @param output The error message to parse
 * @param now Optional Date object for deterministic testing (defaults to current time)
 * @returns The parsed integer seconds value, or 0 if no pattern matches
 */
export function parseRateLimitWaitSeconds(output: string, now?: Date): number {
  // Try duration-based patterns first: "retry after N seconds", "retry in N seconds", etc.
  const durationMatch = output.match(/(?:retry|try).*(after|in)\s*([0-9]+)/i);
  if (durationMatch && durationMatch[2]) {
    const value = parseInt(durationMatch[2], 10);
    // Apply minutes heuristic: if value < 60, treat as minutes and convert to seconds
    if (value < 60) {
      return value * 60;
    }
    return value;
  }

  // Try time-based patterns: "resets at 23:00", "resets 11pm", etc.
  if (/resets?(?:\s+at)?\s+[0-9a-z]/i.test(output)) {
    const currentTime = now || new Date();

    // Try HH:MM format first (e.g., "23:00", "11:30", with optional am/pm)
    let resetTime = output.match(/(\d{1,2}):(\d{2})\s*(?:(am|pm))?/i);
    if (resetTime) {
      const resetHour = parseResetHour(parseInt(resetTime[1], 10), resetTime[3]);
      const resetMinute = parseInt(resetTime[2], 10);
      return calculateWaitSeconds(resetHour, resetMinute, currentTime);
    }

    // Try bare hour with am/pm (e.g., "11pm", "3am")
    resetTime = output.match(/\b(\d{1,2})\s*(am|pm)\b/i);
    if (resetTime) {
      const resetHour = parseResetHour(parseInt(resetTime[1], 10), resetTime[2]);
      return calculateWaitSeconds(resetHour, 0, currentTime);
    }
  }

  return 0;
}

/**
 * Parse the reset hour, accounting for am/pm modifier.
 * @param hour The hour (1-12 for 12-hour format, 0-23 for 24-hour format)
 * @param ampm Optional am/pm modifier
 * @returns The hour in 24-hour format (0-23)
 */
function parseResetHour(hour: number, ampm?: string): number {
  if (!ampm) {
    // No am/pm specified, assume 24-hour format
    return hour;
  }

  const lowerAmpm = ampm.toLowerCase();
  if (lowerAmpm === 'pm' && hour !== 12) {
    return hour + 12; // 1pm -> 13, 11pm -> 23
  } else if (lowerAmpm === 'am' && hour === 12) {
    return 0; // 12am -> 0 (midnight)
  }
  return hour; // 12pm -> 12, other am times unchanged
}

/**
 * Calculate wait seconds from now to the reset time.
 * Handles next-day rollover if the reset time is in the past.
 * @param resetHour Hour in 24-hour format (0-23)
 * @param resetMinute Minute (0-59)
 * @param now Current time
 * @returns Wait time in seconds
 */
function calculateWaitSeconds(resetHour: number, resetMinute: number, now: Date): number {
  // Create a Date for the reset time today
  const resetToday = new Date(now);
  resetToday.setUTCHours(resetHour, resetMinute, 0, 0);

  // If reset time is in the future, return the delta
  if (resetToday > now) {
    return Math.ceil((resetToday.getTime() - now.getTime()) / 1000);
  }

  // If reset time is in the past, assume it's tomorrow
  const resetTomorrow = new Date(resetToday);
  resetTomorrow.setUTCDate(resetTomorrow.getUTCDate() + 1);
  return Math.ceil((resetTomorrow.getTime() - now.getTime()) / 1000);
}

/** Test helper: true if `output` matches the out-of-credits signature. */
export function detectsOutOfCredits(output: string): boolean {
  return OUT_OF_CREDITS_RE.test(output);
}

/** Test helper: true if `output` matches the auth-failure signature. */
export function detectsAuthFailure(output: string): boolean {
  return AUTH_FAILURE_RE.test(output);
}

/** Test helper: true if `output` matches the model-unavailable signature. */
export function detectsModelUnavailable(output: string): boolean {
  return MODEL_UNAVAILABLE_RE.test(output);
}

/**
 * Scan stdout lines for a stream-json usage event and extract token counts.
 * Returns undefined when no usage event is found or parsing fails.
 */
function parseTokenUsage(stdout: string): TokenUsage | undefined {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.type === 'usage' && typeof parsed.input_tokens === 'number' && typeof parsed.output_tokens === 'number') {
        const usage: TokenUsage = {
          input: parsed.input_tokens as number,
          output: parsed.output_tokens as number,
        };
        if (typeof parsed.cache_read_input_tokens === 'number') {
          usage.cacheRead = parsed.cache_read_input_tokens as number;
        }
        if (typeof parsed.cache_creation_input_tokens === 'number') {
          usage.cacheCreation = parsed.cache_creation_input_tokens as number;
        }
        return usage;
      }
    } catch {
      // Not valid JSON — skip line
    }
  }
  return undefined;
}

export class ClaudeProvider implements LLMProvider {
  /**
   * Run Claude with --print mode. Captures output for analysis.
   * Used only for truly non-interactive one-shot queries.
   */
  async invoke(options: InvokeOptions): Promise<InvokeResult> {
    const args = this.buildArgs(options);

    if (options.prompt) {
      args.push('--print', '--output-format', 'text', '-p', options.prompt);
    }

    // Stream stdout/stderr to terminal while also capturing for analysis.
    // stdin is explicitly closed: without this, Claude's CLI waits ~3s for
    // piped input on TTY and logs "no stdin data received in 3s" per call.
    const result = await execa('claude', args, {
      reject: false,
      stdin: 'ignore',
      stdout: ['pipe', 'inherit'],
      stderr: ['pipe', 'inherit'],
      env: this.buildEnv(options),
      cwd: options.cwd,
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

    // Check auth failure first (highest priority), gated on non-zero exit.
    // Then model availability and rate limit — these are also only valid
    // error states (exit !== 0).
    const authFailure = exitCode !== 0 && AUTH_FAILURE_RE.test(output);
    // Out-of-credits is a soft notice on a ZERO exit code, so it is NOT gated on
    // exitCode !== 0 (unlike the hard model-unavailable error). It still means
    // "this model can't run" → fold into modelUnavailable so the ladder walks to
    // a model with credits.
    const outOfCredits = OUT_OF_CREDITS_RE.test(output);
    const modelUnavailable =
      outOfCredits || (exitCode !== 0 && MODEL_UNAVAILABLE_RE.test(output));
    const rateLimited = exitCode !== 0 && RATE_LIMIT_RE.test(output);
    const sessionExpired =
      STALE_SESSION_RE.test(output) || SESSION_IN_USE_RE.test(output);
    const tokenUsage = parseTokenUsage(stdout);

    return {
      // An out-of-credits notice rides on exit 0 but is not a real success —
      // no work was done and no artifact written. Never report it as success,
      // or the step's completion check reads a confusing "no artifact" halt.
      success: exitCode === 0 && !outOfCredits,
      output,
      exitCode,
      authFailure: authFailure || undefined,
      rateLimited: rateLimited || undefined,
      sessionExpired: sessionExpired || undefined,
      modelUnavailable: modelUnavailable || undefined,
      tokenUsage,
    };
  }

  /**
   * Run Claude with stdio inherited — user sees output live.
   *
   * Default: every step uses `-p` (print mode) so the session exits when the
   * skill completes. Matches bin/conduct; prevents the harness from hanging
   * waiting for `/quit`. The autonomous vs. collaborative distinction is
   * purely about the `--dangerously-skip-permissions` flag — collaborative
   * steps still see Claude's permission prompts on the shared terminal.
   *
   * `interactive: true` is a deliberate opt-in (used by the recovery menu's
   * "interactive fix" option) that opens a REPL instead of auto-exiting, so
   * the user can debug with Claude manually.
   */
  async invokeInteractive(options: InvokeOptions): Promise<void> {
    const args = this.buildArgs(options);

    if (options.prompt) {
      if (options.interactive) {
        // REPL mode — positional arg; session stays open until user /quits.
        args.push(options.prompt);
      } else {
        // Print mode — auto-exit when done.
        args.push('-p', options.prompt);
      }
    }

    // In REPL mode the user types, so stdin must be inherited. In print mode
    // (`-p`, the default — including every interactive step under --auto) stdin
    // must be IGNORED: `claude -p` with an inherited TTY stdin blocks waiting
    // for EOF that never comes, hanging the step silently. stdout/stderr stay
    // inherited so output is still live. (Mirrors `invoke`'s `stdin: 'ignore'`.)
    await execa('claude', args, {
      stdio: options.interactive ? 'inherit' : ['ignore', 'inherit', 'inherit'],
      reject: false,
      env: this.buildEnv(options),
      cwd: options.cwd,
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
      args.push('--append-system-prompt', options.systemPrompt);
    }

    if (options.model) {
      args.push('--model', options.model);
    }

    return args;
  }

  /**
   * Build an env overlay for the Claude subprocess. We pass effort via
   * CLAUDE_CODE_EFFORT_LEVEL because (a) it overrides settings.json + skill
   * frontmatter, and (b) it cascades to subagents spawned inside the session
   * (so e.g. assess's CTO subagents inherit the parent step's effort).
   *
   * Returns undefined when no override is needed so execa uses the default
   * inherited environment.
   */
  private buildEnv(options: InvokeOptions): NodeJS.ProcessEnv | undefined {
    if (!options.effort) return undefined;
    return { ...process.env, CLAUDE_CODE_EFFORT_LEVEL: options.effort };
  }
}
