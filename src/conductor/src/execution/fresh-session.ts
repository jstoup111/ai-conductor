import { randomUUID } from 'node:crypto';
import { formatNextAction } from '../engine/daemon-log.js';
import type { InvokeOptions } from './llm-provider.js';

/**
 * Deterministic fresh-session enforcement at the provider adapter boundary.
 *
 * Provider session reuse was removed from this harness by design: every
 * provider invocation must be a fresh session (no-session-resume). On
 * 2026-08-14 a store-derived session id resurrected a previously-used Claude
 * conversation on the build_review rubric-branch path: all four rubric
 * branches shared a ~1.28M-token "conversation" that grew across the day and
 * eventually failed one-turn calls with "Prompt is too long". Per the repo's
 * design principle — machinery over prompt/call-site discipline — this
 * boundary makes fresh sessions an invariant no call path can bypass: any
 * caller-supplied session id is replaced with a freshly minted UUID and
 * `resume` is forced off before either can reach a provider CLI.
 */
export function enforceFreshSessionOptions(
  options: InvokeOptions,
  provider: string,
): InvokeOptions {
  const freshSessionId = randomUUID();
  const suppressedResume = options.resume === true;
  if (suppressedResume) {
    const notice =
      `Provider ${provider}: resume was suppressed` +
      formatNextAction({
        kind: 'none',
        why: 'every provider dispatch starts a fresh session by design',
      });
    try {
      if (options.diagnosticLog) {
        options.diagnosticLog(notice);
      } else {
        console.warn(notice);
      }
    } catch {
      // Visibility is best-effort; never affects provider dispatch.
    }
  }
  return { ...options, sessionId: freshSessionId, resume: false };
}
