// engineer/intake/sanitize.ts — deterministic pre-publication scrub for intake text.
//
// An intake issue is, by design, mostly pasted evidence: commands, logs, config
// excerpts, stack traces. That is what makes it useful to a zero-context
// engineer, and it is also exactly the material that carries credentials and
// operator-identifying paths. Filing publishes it to a tracker, which may be
// public and is in any case outside the operator's machine — so the scrub runs
// at the filing choke point, not as a rule the filer is asked to remember.
//
// Two deliberate limits:
//
//   1. Every pattern here is high-precision. A regex that mangles legitimate
//      evidence costs a debuggable issue, so a value is redacted only when its
//      SHAPE identifies it (a token prefix, a key block, an assignment to a
//      secret-named key) — never on the mere presence of a suspicious word.
//   2. It cannot recognize semantic confidentiality — a customer name, an
//      unreleased product, an internal hostname, proprietary source. Those stay
//      the author's judgement; `skills/intake/SKILL.md` §7 owns that half. This
//      module is the mechanical net under it, not a replacement for it.

/** What a single pattern class recognizes. Stable strings — reported to the operator. */
export type RedactionCategory =
  | 'private-key-block'
  | 'github-token'
  | 'anthropic-key'
  | 'openai-key'
  | 'aws-access-key-id'
  | 'slack-token'
  | 'google-api-key'
  | 'jwt'
  | 'bearer-token'
  | 'url-credentials'
  | 'assigned-secret'
  | 'home-path'
  | 'email';

export interface Redaction {
  category: RedactionCategory;
  /** How many occurrences this category replaced. */
  count: number;
}

export interface SanitizeResult {
  text: string;
  /** Non-empty only when something was replaced; ordered by first match. */
  redactions: Redaction[];
}

interface Rule {
  category: RedactionCategory;
  pattern: RegExp;
  /**
   * Replacement. A string replaces the whole match; a function receives the
   * match groups so a rule can keep its identifying prefix (`AWS_SECRET=` stays,
   * its value does not) — the reader still learns WHAT leaked without the value.
   */
  replace: string | ((...args: string[]) => string);
}

const PLACEHOLDER = (c: RedactionCategory): string => `[redacted:${c}]`;

// Order is load-bearing: the most specific shape must consume its text before a
// more general rule (assigned-secret, email) can partially match inside it.
const RULES: Rule[] = [
  {
    // Whole PEM block, any key type, including the armor lines.
    category: 'private-key-block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: PLACEHOLDER('private-key-block'),
  },
  {
    // ghp_/gho_/ghu_/ghs_/ghr_ classic tokens and fine-grained github_pat_.
    category: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    replace: PLACEHOLDER('github-token'),
  },
  {
    category: 'anthropic-key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
    replace: PLACEHOLDER('anthropic-key'),
  },
  {
    // Generic `sk-` keys. Runs AFTER sk-ant- so Anthropic keys keep their label.
    category: 'openai-key',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    replace: PLACEHOLDER('openai-key'),
  },
  {
    category: 'aws-access-key-id',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replace: PLACEHOLDER('aws-access-key-id'),
  },
  {
    category: 'slack-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replace: PLACEHOLDER('slack-token'),
  },
  {
    category: 'google-api-key',
    pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g,
    replace: PLACEHOLDER('google-api-key'),
  },
  {
    // Three base64url segments starting with a `{"` header — a real JWT shape.
    category: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: PLACEHOLDER('jwt'),
  },
  {
    // Keep the scheme word so the reader knows an auth header was present.
    category: 'bearer-token',
    pattern: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    replace: (_m: string, scheme: string) => `${scheme} ${PLACEHOLDER('bearer-token')}`,
  },
  {
    // https://user:pass@host — credentials inline in a URL.
    category: 'url-credentials',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
    replace: (_m: string, scheme: string) => `${scheme}${PLACEHOLDER('url-credentials')}@`,
  },
  {
    // KEY=value / key: value where the KEY names a secret. The key is kept, the
    // value is not. Bare mentions of a variable NAME (no assignment) are left
    // alone — naming `CLAUDE_CODE_OAUTH_TOKEN` in prose is not a leak.
    category: 'assigned-secret',
    // The `(?!\[redacted:)` guard keeps placeholders inert: a more specific rule
    // above may already have replaced this value, and without the guard this
    // rule would relabel its output — breaking repeat-safety and losing the
    // more precise category the reader needs.
    pattern:
      /\b([A-Za-z0-9_.-]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIALS?)[A-Za-z0-9_.-]*)(\s*[:=]\s*)(["']?)((?!\[redacted:)[^\s"']{8,})\3/gi,
    replace: (_m: string, key: string, sep: string, quote: string) =>
      `${key}${sep}${quote}${PLACEHOLDER('assigned-secret')}${quote}`,
  },
  {
    // Absolute home directories carry the operator's account name and machine
    // layout. `~` keeps every path in the evidence readable and reproducible.
    category: 'home-path',
    pattern: /\/(?:home|Users)\/[A-Za-z0-9._-]+/g,
    replace: '~',
  },
  {
    // Left last so an address inside an already-redacted span is never counted.
    // `noreply@` and example.com are conventional placeholders, not contacts.
    category: 'email',
    pattern: /\b(?!noreply@)[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replace: PLACEHOLDER('email'),
  },
];

/**
 * Redact credentials and operator-identifying paths from intake text.
 *
 * Pure and idempotent: running it on its own output replaces nothing further,
 * because every placeholder is inert under all the rules above.
 */
export function sanitizeIntakeText(input: string): SanitizeResult {
  let text = input;
  const redactions: Redaction[] = [];

  for (const rule of RULES) {
    let count = 0;
    text = text.replace(rule.pattern, (...args: unknown[]): string => {
      count++;
      return typeof rule.replace === 'string'
        ? rule.replace
        : (rule.replace as (...a: string[]) => string)(...(args as string[]));
    });
    if (count > 0) redactions.push({ category: rule.category, count });
  }

  return { text, redactions };
}

/** One-line operator summary, e.g. `github-token x1, home-path x4`. */
export function describeRedactions(redactions: Redaction[]): string {
  return redactions.map((r) => `${r.category} x${r.count}`).join(', ');
}
