import { execa } from 'execa';
import type { LLMProvider, InvokeOptions, InvokeResult, TokenUsage } from './llm-provider.js';

// Task 17: Extended to include session-limit family (observed 2026-07-03 incident)
// Patterns: "rate limit", "429", "overloaded"
const RATE_LIMIT_RE = /rate limit|429|overloaded/i;

// Session-limit and usage-limit messages. Unlike RATE_LIMIT_RE, this is checked
// regardless of exit code (similar to OUT_OF_CREDITS_RE) because session-limit
// can ride on exit=0 as a "soft notice" that the session quota is exhausted.
// Patterns matched:
// - "You've hit your session/usage limit" (exact CLI message)
// - "session/usage limit reached" (variant)
// - "session/usage limit · resets" (with reset time)
// Precedence: checked BEFORE AUTH_FAILURE_RE so a message like
// "You've hit your session limit and not logged in" classifies as session-limit,
// not auth failure. Avoids false positives by requiring context beyond bare
// "session limit" in prose.
const SESSION_LIMIT_RE = /you've hit your (?:session|usage) limit|session limit reached|usage limit reached|(?:session|usage) limit\s+·\s+resets/i;
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
// - "Failed to authenticate" / "Invalid bearer token" / "API Error: 401" —
//   observed rejected-credential shapes from the underlying API (FR-4,
//   task 1). These are anchored to specific phrasing so a bare "401"
//   appearing in unrelated prose (e.g. "expects a 401 response") does not
//   false-positive.
export const AUTH_FAILURE_RE =
  /not logged in|invalid api key|please run \/login|failed to authenticate|invalid bearer token|api error:\s*401/i;

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
 * Result of parsing a rate-limit message.
 * Contains both fallback waitSeconds and an optional deadline when timezone parsing succeeds.
 */
export interface ParseRateLimitResult {
  waitSeconds: number;
  deadline?: number;
}

/**
 * Extract timezone from message like "(America/New_York)" or "(UTC)".
 * Returns the timezone string (e.g., "America/New_York") or undefined if not found.
 */
function extractTimezone(output: string): string | undefined {
  const match = output.match(/\(([A-Za-z/_]+)\)/);
  return match ? match[1] : undefined;
}

/**
 * Get the current time's components in a specific timezone using the Intl API.
 * Returns { hours, minutes, seconds } in 24-hour format for that timezone.
 * Returns undefined if the timezone is invalid.
 */
function getTimeInTimezone(
  date: Date,
  timeZone: string,
): { hours: number; minutes: number; seconds: number } | undefined {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    let hours = 0,
      minutes = 0,
      seconds = 0;
    for (const part of parts) {
      if (part.type === 'hour') hours = parseInt(part.value, 10);
      if (part.type === 'minute') minutes = parseInt(part.value, 10);
      if (part.type === 'second') seconds = parseInt(part.value, 10);
    }
    return { hours, minutes, seconds };
  } catch {
    return undefined;
  }
}

/**
 * Get the date components (year, month, date) in a specific timezone.
 * Returns { year, month, date } or undefined if the timezone is invalid.
 */
function getDateInTimezone(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number } | undefined {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    let year = 0,
      month = 0,
      day = 0;
    for (const part of parts) {
      if (part.type === 'year') year = parseInt(part.value, 10);
      if (part.type === 'month') month = parseInt(part.value, 10);
      if (part.type === 'day') day = parseInt(part.value, 10);
    }
    return { year, month, day };
  } catch {
    return undefined;
  }
}

/**
 * Parse rate limit wait time from output.
 * Handles three patterns:
 * 1. Duration-based: "retry after 450 seconds", "retry in 120 seconds", "try again after 60 seconds"
 *    - Applies a minutes heuristic: if extracted value < 60, treats it as minutes and converts to seconds.
 * 2. Time-based with timezone: "resets 3:20pm (America/New_York)"
 *    - Task 18: Extracts timezone, calculates deadline in that timezone, clamps to cap
 *    - Returns both waitSeconds and an absolute deadline (ms since epoch)
 * 3. Time-based without timezone: "resets at 23:00", "resets 11pm", "resets 3am"
 *    - Calculates wait time as the delta from "now" to the reset time
 *    - Handles next-day rollover: if the parsed time is in the past, adds 86400 seconds (one day)
 *
 * @param output The error message to parse
 * @param now Optional Date object for deterministic testing (defaults to current time)
 * @returns ParseRateLimitResult with waitSeconds (always present) and optional deadline (when timezone parsing succeeds)
 */
export function parseRateLimitWaitSeconds(
  output: string,
  options?: { now?: Date },
): ParseRateLimitResult {
  const now = options?.now || new Date();

  try {
    // Try duration-based patterns first: "retry after N seconds", "retry in N seconds", etc.
    const durationMatch = output.match(/(?:retry|try).*(after|in)\s*([0-9]+)/i);
    if (durationMatch && durationMatch[2]) {
      const value = parseInt(durationMatch[2], 10);
      // Check for NaN or non-positive values — default to 300
      if (isNaN(value) || value <= 0) {
        return { waitSeconds: 300 };
      }
      // Apply minutes heuristic: if value < 60, treat as minutes and convert to seconds
      if (value < 60) {
        return { waitSeconds: value * 60 };
      }
      return { waitSeconds: value };
    }

    // Try time-based patterns: "resets at 23:00", "resets 11pm", etc.
    if (/resets?(?:\s+at)?\s+[0-9a-z]/i.test(output)) {
      // Task 18: Try to extract timezone for deadline-aware parsing
      const timezone = extractTimezone(output);
      if (timezone) {
        // Try to parse with timezone
        const timeInTz = getTimeInTimezone(now, timezone);
        const dateInTz = getDateInTimezone(now, timezone);

        if (timeInTz && dateInTz) {
          // Try HH:MM format first (e.g., "23:00", "11:30", with optional am/pm)
          let resetMatch = output.match(/(\d{1,2}):(\d{2})\s*(?:(am|pm))?/i);
          if (resetMatch) {
            const resetHour = parseResetHour(parseInt(resetMatch[1], 10), resetMatch[3]);
            const resetMinute = parseInt(resetMatch[2], 10);

            // Calculate deadline in the specified timezone
            const deadline = calculateDeadlineInTimezone(
              now,
              timezone,
              dateInTz,
              timeInTz,
              resetHour,
              resetMinute,
            );

            // Calculate fallback waitSeconds for comparison
            const waitSeconds = calculateWaitSecondsLegacy(resetHour, resetMinute, now);

            return {
              waitSeconds,
              deadline,
            };
          }

          // Try bare hour with am/pm (e.g., "11pm", "3am")
          resetMatch = output.match(/\b(\d{1,2})\s*(am|pm)\b/i);
          if (resetMatch) {
            const resetHour = parseResetHour(parseInt(resetMatch[1], 10), resetMatch[2]);

            // Calculate deadline in the specified timezone
            const deadline = calculateDeadlineInTimezone(
              now,
              timezone,
              dateInTz,
              timeInTz,
              resetHour,
              0,
            );

            // Calculate fallback waitSeconds
            const waitSeconds = calculateWaitSecondsLegacy(resetHour, 0, now);

            return {
              waitSeconds,
              deadline,
            };
          }
        }
      }

      // Fallback: timezone not found or parsing failed; use legacy UTC-based parsing
      const currentTime = now;

      // Try HH:MM format first (e.g., "23:00", "11:30", with optional am/pm)
      let resetTime = output.match(/(\d{1,2}):(\d{2})\s*(?:(am|pm))?/i);
      if (resetTime) {
        const resetHour = parseResetHour(parseInt(resetTime[1], 10), resetTime[3]);
        const resetMinute = parseInt(resetTime[2], 10);
        return { waitSeconds: calculateWaitSecondsLegacy(resetHour, resetMinute, currentTime) };
      }

      // Try bare hour with am/pm (e.g., "11pm", "3am")
      resetTime = output.match(/\b(\d{1,2})\s*(am|pm)\b/i);
      if (resetTime) {
        const resetHour = parseResetHour(parseInt(resetTime[1], 10), resetTime[2]);
        return { waitSeconds: calculateWaitSecondsLegacy(resetHour, 0, currentTime) };
      }
    }

    return { waitSeconds: 300 };
  } catch {
    return { waitSeconds: 300 };
  }
}

/**
 * Calculate the absolute deadline (ms since epoch) for a reset time in a specific timezone.
 * Task 18: Handles timezone-aware deadline calculation with clamping.
 *
 * @param now Current UTC time
 * @param timezone Timezone string (e.g., "America/New_York")
 * @param dateInTz Current date components in the timezone
 * @param timeInTz Current time components in the timezone
 * @param resetHour Reset hour in 24-hour format
 * @param resetMinute Reset minute
 * @returns Absolute deadline in ms, clamped to cap (≈3600s); past/negative → default (60s)
 */
function calculateDeadlineInTimezone(
  now: Date,
  timezone: string,
  dateInTz: { year: number; month: number; day: number },
  timeInTz: { hours: number; minutes: number; seconds: number },
  resetHour: number,
  resetMinute: number,
): number {
  // Calculate seconds until reset within the same day in the timezone
  const nowTotalSeconds = timeInTz.hours * 3600 + timeInTz.minutes * 60 + timeInTz.seconds;
  const resetTotalSeconds = resetHour * 3600 + resetMinute * 60;

  const diffSeconds = resetTotalSeconds - nowTotalSeconds;

  // Constants
  const CAP_SECONDS = 3600; // 1 hour max
  const DEFAULT_SECONDS = 60; // 60 seconds for past/negative

  let finalWaitSeconds = DEFAULT_SECONDS;

  if (diffSeconds > 0) {
    // Reset is in the future today (in the timezone)
    finalWaitSeconds = Math.min(diffSeconds, CAP_SECONDS);
  } else if (diffSeconds <= 0) {
    // Reset is in the past today; assume it's tomorrow (midnight rollover)
    const nextDaySeconds = 86400 + diffSeconds; // Add 24 hours, subtract the past offset
    if (nextDaySeconds > 0) {
      finalWaitSeconds = Math.min(nextDaySeconds, CAP_SECONDS);
    } else {
      // Safeguard: extremely negative, use default
      finalWaitSeconds = DEFAULT_SECONDS;
    }
  }

  // Return absolute deadline: now + waitSeconds (in ms)
  return now.getTime() + finalWaitSeconds * 1000;
}

/**
 * Legacy wait-seconds calculation (UTC-based, for fallback).
 * This is the original algorithm used when timezone is not available.
 */
function calculateWaitSecondsLegacy(resetHour: number, resetMinute: number, now: Date): number {
  // Create a Date for the reset time today (in UTC)
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

/** Test helper: true if `output` matches the out-of-credits signature. */
export function detectsOutOfCredits(output: string): boolean {
  return OUT_OF_CREDITS_RE.test(output);
}

/** Test helper: true if `output` matches the session-limit signature. */
export function detectsSessionLimit(output: string): boolean {
  return SESSION_LIMIT_RE.test(output);
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

    // Deliver the prompt on STDIN, never as a `-p <prompt>` command-line
    // argument. A single argv string is capped at MAX_ARG_STRLEN (128 KiB on
    // Linux); the build_review grader's prompt (plan + full diff) routinely
    // exceeds that, and passing it as an argument makes exec() fail instantly
    // with E2BIG ("Argument list too long") BEFORE claude starts — surfacing as
    // an empty-output, non-zero exit that no classifier catches and that halts
    // every large feature at build_review. `claude --print` reads the prompt
    // from stdin when no positional prompt is given, which has no length limit.
    const hasPrompt = typeof options.prompt === 'string' && options.prompt.length > 0;
    if (hasPrompt) {
      args.push('--print', '--output-format', 'text');
    }

    // Stream stdout/stderr to terminal while also capturing for analysis.
    // With a prompt, feed it on stdin (execa closes stdin after writing). With
    // no prompt, stdin is explicitly closed: otherwise Claude's CLI waits ~3s
    // for piped input on a TTY and logs "no stdin data received in 3s" per call.
    const result = hasPrompt
      ? await execa('claude', args, {
          reject: false,
          input: options.prompt,
          stdout: ['pipe', 'inherit'],
          stderr: ['pipe', 'inherit'],
          env: this.buildEnv(options),
          cwd: options.cwd,
        })
      : await execa('claude', args, {
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

    // PRECEDENCE (highest to lowest):
    // 1. Session-limit: check regardless of exit code (soft notice can ride exit=0),
    //    checked BEFORE auth-failure so a combined message classifies as session-limit
    // 2. Out-of-credits: soft notice on exit=0 (model unavailable)
    // 3. Model unavailable: only on exit !== 0
    // 4. Rate limit (non-session): only on exit !== 0
    // 5. Auth failure: only on exit !== 0
    // 6. Session expired: checked regardless of exit code

    const sessionLimit = SESSION_LIMIT_RE.test(output);
    const outOfCredits = OUT_OF_CREDITS_RE.test(output);
    const modelUnavailable =
      outOfCredits || (exitCode !== 0 && MODEL_UNAVAILABLE_RE.test(output));
    const rateLimited = sessionLimit || (exitCode !== 0 && RATE_LIMIT_RE.test(output));
    // Auth failure only if NOT a session-limit case
    const authFailure = !sessionLimit && exitCode !== 0 && AUTH_FAILURE_RE.test(output);
    const sessionExpired =
      STALE_SESSION_RE.test(output) || SESSION_IN_USE_RE.test(output);
    const tokenUsage = parseTokenUsage(stdout);

    let deadline: number | undefined;
    let waitSeconds: number | undefined;
    if (rateLimited) {
      const parseResult = parseRateLimitWaitSeconds(output, { now: new Date() });
      waitSeconds = parseResult.waitSeconds;
      deadline = parseResult.deadline;
    }

    return {
      // Session-limit and out-of-credits notices ride exit 0 but are not real
      // successes — no work was done and no artifact written. Never report them
      // as success, or the step's completion check reads a confusing "no artifact" halt.
      success: exitCode === 0 && !outOfCredits && !sessionLimit,
      output,
      exitCode,
      authFailure: authFailure || undefined,
      rateLimited: rateLimited || undefined,
      sessionExpired: sessionExpired || undefined,
      modelUnavailable: modelUnavailable || undefined,
      tokenUsage,
      waitSeconds,
      deadline,
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
