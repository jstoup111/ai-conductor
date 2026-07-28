// self-host/environment-claim-audit.ts — deterministic refutation of claimed
// environmental blockers (#1106).
//
// A self-build dispatch once halted with:
//
//   "**Blocker:** The environment's write-fence sandbox blocks both `git push`
//    and `gh pr` operations. ... Neither path is executable in this sandbox
//    environment."
//
// That blocker could not exist. The step ran under the `claude` provider, which
// is dispatched with `--dangerously-skip-permissions`, no OS sandbox, and full
// environment inheritance; and the only environmental control installed for it
// is the write fence, whose generated script denies nothing but writes under the
// live harness checkout outside the build worktree. The fabricated blocker
// arrived formatted exactly like the four genuinely-verified gate results above
// it, so nothing distinguished invention from diagnosis — and completed, tested
// work never shipped.
//
// Per the repo Design Principle (CLAUDE.md): deterministic where possible. The
// engine knows, at dispatch time, the facts the agent was guessing at — which
// provider ran, and what the provisioned write fence can actually deny. So a
// claimed environmental blocker naming an operation the engine can prove is
// unfenced is REJECTED at the moment it is written, and the dispatch fails with
// the refutation as its retry reason, instead of being trusted as prose.
//
// The audit is deliberately asymmetric: it only ever refutes a claim the engine
// can positively disprove. Anything it cannot disprove (unknown provider, a
// sandboxed provider, a fence that really does match the named operation) is
// left entirely alone.

import { generateFenceScript } from './write-fence.js';

/**
 * Marker prefix on every engine-authored refutation. It exists so the audit
 * never re-refutes its own message when a later attempt quotes the refutation
 * back in its output (which would otherwise loop the step to budget exhaustion).
 */
export const ENVIRONMENT_CLAIM_REFUTED = 'ENVIRONMENT_CLAIM_REFUTED';

/**
 * The remote operations agents blame on the environment. Each carries the token
 * a write-fence rule would have to mention in order to deny it — the fence is a
 * bash script, so a rule for an operation cannot exist without its verb
 * appearing somewhere in the generated text.
 */
const AUDITED_OPERATIONS = [
  { operation: 'git push', claim: /git\s+push/i, fenceToken: /\bpush\b/ },
  { operation: 'gh', claim: /\bgh\s+(pr|api|repo|release|auth)\b/i, fenceToken: /\bgh\b/ },
] as const;

/** An operation this module knows how to audit. */
export type AuditedOperation = (typeof AUDITED_OPERATIONS)[number]['operation'];

/** Words that attribute a failure to the environment rather than to the work. */
const ENVIRONMENTAL_CAUSES: readonly RegExp[] = [
  /write[-\s]?fence/i,
  /sandbox/i,
  /permission[s]?\s+(denied|blocked|restriction)/i,
  /read-only\s+file\s?system/i,
  /environment(al)?\s+(restriction|constraint|limitation|block)/i,
  /the\s+environment('s)?\s/i,
];

/** Words that assert the operation could not be performed. */
const BLOCKING_ASSERTIONS: readonly RegExp[] = [
  /\bblock(s|ed|ing)?\b/i,
  /\bprevent(s|ed|ing)?\b/i,
  /\bden(y|ies|ied)\b/i,
  /\bcannot\b|\bcan't\b|\bcan not\b/i,
  /\bunable\b/i,
  /\bnot\s+(executable|permitted|allowed|possible|available)\b/i,
  /\bdisallow(s|ed)?\b/i,
  /\bforbid(s|den)?\b/i,
  /\brefus(e|es|ed|ing)\b/i,
];

/** Providers whose dispatch runs under an OS sandbox that CAN restrict network. */
const PROVIDER_OS_SANDBOX: Readonly<Record<string, boolean>> = {
  // claude-provider.ts passes `--dangerously-skip-permissions` with no sandbox
  // flags and inherits the full environment.
  claude: false,
  // codex-provider.ts passes `sandbox_mode="workspace-write"` in unattended
  // runs, which really can restrict what a command reaches.
  codex: true,
};

/** One claim the engine positively disproved. */
export interface RefutedEnvironmentClaim {
  /** The offending sentence, verbatim and trimmed. */
  claim: string;
  /** The operation the claim said the environment blocked. */
  operation: AuditedOperation;
}

/** The dispatch facts the engine knows and the agent was guessing at. */
export interface DispatchEnvironmentFacts {
  /** The resolved provider key for this dispatch (e.g. `claude`, `codex`). */
  provider: string;
  /** Whether the self-build write fence was provisioned for this dispatch. */
  writeFenceInstalled: boolean;
}

/** Result of auditing one dispatch's output. */
export interface EnvironmentClaimAudit {
  refuted: readonly RefutedEnvironmentClaim[];
  /** Operator/agent-facing refutation, or null when nothing was disproved. */
  message: string | null;
}

/**
 * The audited operations the provisioned write fence could actually deny,
 * derived from the fence generator itself rather than from a hardcoded belief.
 * Sentinel roots are used because only the RULE text is inspected; if someone
 * later teaches the fence to deny `git push`, this set grows automatically and
 * the audit stops refuting that claim on its own.
 */
export function writeFenceDeniableOperations(): ReadonlySet<AuditedOperation> {
  const script = generateFenceScript(
    '/nonexistent/environment-claim-audit/worktree',
    '/nonexistent/environment-claim-audit/harness',
  );
  const deniable = new Set<AuditedOperation>();
  for (const op of AUDITED_OPERATIONS) {
    if (op.fenceToken.test(script)) deniable.add(op.operation);
  }
  return deniable;
}

function matchesAny(patterns: readonly RegExp[], line: string): boolean {
  return patterns.some((pattern) => pattern.test(line));
}

/**
 * Find every line that blames the environment for blocking an audited remote
 * operation. Conservative by construction: a line must carry ALL THREE of an
 * environmental cause, a blocking assertion, and a named operation. Prose that
 * merely mentions the sandbox, or that reports a real command failure without
 * an environmental cause, is not a claim.
 */
function detectClaims(output: string): RefutedEnvironmentClaim[] {
  const claims: RefutedEnvironmentClaim[] = [];
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    // Never audit the engine's own refutation quoted back at us.
    if (line.includes(ENVIRONMENT_CLAIM_REFUTED)) continue;
    if (!matchesAny(ENVIRONMENTAL_CAUSES, line)) continue;
    if (!matchesAny(BLOCKING_ASSERTIONS, line)) continue;
    for (const op of AUDITED_OPERATIONS) {
      if (op.claim.test(line)) claims.push({ claim: line, operation: op.operation });
    }
  }
  return claims;
}

function renderFacts(facts: DispatchEnvironmentFacts): string[] {
  const lines: string[] = [
    `  - provider: ${facts.provider} — dispatched with no OS sandbox and full environment inheritance; ` +
      'network and `gh` authentication are reachable.',
  ];
  lines.push(
    facts.writeFenceInstalled
      ? '  - write fence: installed as a PreToolUse hook. Its generated script denies exactly one thing — ' +
          'writes targeting the live harness checkout outside this build worktree. It contains no rule ' +
          'matching the operation above.'
      : '  - write fence: NOT installed for this dispatch. No fence rule of any kind applied.',
  );
  return lines;
}

/**
 * Audit a dispatch's output against the engine's own dispatch facts.
 *
 * A claim is refuted only when BOTH hold:
 *   1. the provider is known NOT to run under an OS sandbox (an unknown or
 *      sandboxed provider is never refuted — the engine cannot disprove it), and
 *   2. no write fence rule could match the named operation.
 *
 * Everything else returns `{ refuted: [], message: null }`, leaving genuine
 * blockers, real command failures, and unrecognized environments untouched.
 */
export function auditEnvironmentBlockerClaims(
  output: string | null | undefined,
  facts: DispatchEnvironmentFacts,
): EnvironmentClaimAudit {
  const none: EnvironmentClaimAudit = { refuted: [], message: null };
  if (output == null || output.trim() === '') return none;

  // Unknown provider, or one that really is sandboxed: the engine has no proof,
  // so it does not get a verdict.
  if (PROVIDER_OS_SANDBOX[facts.provider] !== false) return none;

  const deniable = facts.writeFenceInstalled
    ? writeFenceDeniableOperations()
    : new Set<AuditedOperation>();
  const refuted = detectClaims(output).filter((claim) => !deniable.has(claim.operation));
  if (refuted.length === 0) return none;

  // Each quote carries the marker so a later attempt that echoes the whole
  // refutation back cannot re-trigger the audit on its own quoted claim.
  const quoted = [...new Set(refuted.map((r) => r.claim))].map(
    (claim) => `  [${ENVIRONMENT_CLAIM_REFUTED}] claimed: "${claim}"`,
  );
  const operations = [...new Set(refuted.map((r) => r.operation))].join(', ');
  const message = [
    `${ENVIRONMENT_CLAIM_REFUTED}: this step blamed the environment for blocking ` +
      `${operations}, and the engine disproved it from the dispatch it actually performed.`,
    ...quoted,
    'Engine facts for THIS dispatch:',
    ...renderFacts(facts),
    `Therefore ${operations} is NOT blocked by this environment. Run the operation for real and ` +
      'report its actual exit code and stderr. If it then fails, quote that output — do not halt, ' +
      'park, or hand off on an environmental cause you have not observed.',
  ].join('\n');
  return { refuted, message };
}
