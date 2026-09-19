/**
 * Child-environment scrubbing shared by every seam that spawns a provider
 * session or a test/verification subprocess on the engine's behalf.
 *
 * The daemon runs inside a tmux session (`cc-daemon-*`). Any child that
 * inherits `TMUX` / `TMUX_PANE` and runs a tmux command without an explicit
 * target (`tmux respawn-pane -k`, `tmux new-session`, `tmux kill-pane`) has
 * tmux resolve the target to the *daemon's own pane* — a test in a worktree
 * has already killed the daemon this way (exit 0, no log line). Per the repo's
 * design principle this is process environment, which only machinery can
 * shape: a prompt rule cannot stop a spawned test from calling tmux.
 *
 * The scrub sets the keys to `undefined` rather than deleting them. Node's
 * child_process drops `undefined`-valued entries, and execa's default
 * `extendEnv: true` re-merges `process.env` underneath the supplied overlay —
 * a deleted key would silently come back from the parent, while an
 * `undefined` value masks it in both the overlay and the extended form.
 */

/** Environment variables tmux uses to resolve an implicit target pane. */
export const TMUX_ENVIRONMENT_KEYS = ['TMUX', 'TMUX_PANE'] as const;

/**
 * Return a copy of `env` with every tmux target variable masked. Never
 * mutates the input (nor `process.env`).
 */
export function scrubTmuxEnvironment(env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = { ...env };
  for (const key of TMUX_ENVIRONMENT_KEYS) scrubbed[key] = undefined;
  return scrubbed;
}

/**
 * adr-2026-09-10-portable-build-review-policy D5: a contained reviewer keeps
 * provider runtime/auth needs and receives no unrelated plugin, MCP, tracker,
 * or service state. Under the review profile the child environment is built
 * from this allowlist instead of the ambient process environment, so tracker
 * and service credentials (GH_TOKEN, GITHUB_TOKEN, JIRA_*, cloud keys, …) and
 * every other ambient variable are withheld by construction, not by an
 * ever-growing denylist.
 */
const REVIEW_AMBIENT_KEYS: ReadonlySet<string> = new Set([
  // Basic process identity and locale. HOME/TMPDIR/XDG_* are NOT inherited:
  // the engine overlay redirects them into the candidate-private scratch.
  'PATH', 'LANG', 'LANGUAGE', 'TERM', 'COLORTERM', 'NO_COLOR', 'FORCE_COLOR', 'TZ', 'USER', 'LOGNAME', 'SHELL',
  // Transport the provider client needs to reach its API at all.
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
]);

const REVIEW_AMBIENT_PREFIXES: readonly string[] = ['LC_'];

/** Each provider's own auth/config namespace; the other provider's is withheld. */
const REVIEW_PROVIDER_PREFIXES: Readonly<Record<'claude' | 'codex', readonly string[]>> = {
  claude: ['ANTHROPIC_', 'CLAUDE_'],
  codex: ['OPENAI_', 'CODEX_'],
};

/**
 * The complete child environment for a provider launched under the review
 * containment profile: allowlisted ambient variables, then the engine overlay
 * (which always wins), with tmux targets masked. The caller MUST spawn with
 * `extendEnv: false`; execa's default would re-merge `process.env` underneath.
 */
export function buildReviewChildEnvironment(
  provider: 'claude' | 'codex',
  ambient: NodeJS.ProcessEnv,
  overlay: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const prefixes = [...REVIEW_AMBIENT_PREFIXES, ...REVIEW_PROVIDER_PREFIXES[provider]];
  const allowed: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(ambient)) {
    if (value === undefined) continue;
    if (REVIEW_AMBIENT_KEYS.has(key) || prefixes.some((prefix) => key.startsWith(prefix))) allowed[key] = value;
  }
  return scrubTmuxEnvironment({ ...allowed, ...overlay });
}
