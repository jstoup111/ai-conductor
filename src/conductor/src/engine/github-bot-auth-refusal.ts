/** Closed reasons for a bot credential refusal eligible for operator fallback. */
export type GithubBotAuthRefusalReason =
  | 'token-unavailable'
  | 'auth-refused'
  | 'unsupported-remote-transport';

/**
 * A typed, secret-safe signal from a bot-authenticated transport to its
 * authorized fallback boundary. Callers must branch on this class, never on
 * command output.
 */
export class GithubBotAuthRefusalError extends Error {
  readonly reason: GithubBotAuthRefusalReason;

  constructor(reason: GithubBotAuthRefusalReason) {
    super('GitHub bot credential is unavailable for this operation.');
    this.name = 'GithubBotAuthRefusalError';
    this.reason = reason;
  }
}

function stderrOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('stderr' in error)) return null;
  const { stderr } = error as { stderr?: unknown };
  return typeof stderr === 'string' ? stderr : null;
}

/**
 * Classify only GitHub CLI diagnostics with a specific authentication signal.
 * Status codes alone are deliberately insufficient: 401/403 also represent
 * unrelated API and rate-limit failures.
 */
export function classifyGhAuthRefusal(error: unknown): 'auth-refused' | null {
  const stderr = stderrOf(error);
  if (stderr === null) return null;

  if (/\bbad credentials\b/i.test(stderr) && /\bHTTP\s*401\b/i.test(stderr)) {
    return 'auth-refused';
  }
  if (/\bresource not accessible by personal access token\b/i.test(stderr)
    && /\bHTTP\s*403\b/i.test(stderr)) {
    return 'auth-refused';
  }
  return null;
}

/**
 * Classify only git-push diagnostics that explicitly identify credential or
 * permission refusal. Push conflicts, lease failures, and network failures
 * intentionally remain ordinary command failures.
 */
export function classifyGitPushAuthRefusal(error: unknown): 'auth-refused' | null {
  const stderr = stderrOf(error);
  if (stderr === null) return null;

  if (/\bauthentication failed for ['"]https:\/\/github\.com\//i.test(stderr)) {
    return 'auth-refused';
  }
  if (/\bpermission to \S+\.git denied to \S+\./i.test(stderr)
    && /\bhttps:\/\/github\.com\//i.test(stderr)
    && /\b(?:HTTP\s*)?403\b/i.test(stderr)) {
    return 'auth-refused';
  }
  return null;
}
