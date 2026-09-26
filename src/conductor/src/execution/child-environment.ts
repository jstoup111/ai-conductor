import { BUILT_IN_PROVIDERS } from './provider-catalog.js';

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

export { scrubTmuxEnvironment, TMUX_ENVIRONMENT_KEYS } from './tmux-environment.js';

/** Provider-owned namespaces whose review environments must be scrubbed. */
export const REVIEW_PROVIDER_PREFIXES = BUILT_IN_PROVIDERS.map(
  (provider) => provider.environmentPrefix,
);
