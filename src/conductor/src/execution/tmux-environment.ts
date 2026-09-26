/** Environment variables tmux uses to resolve an implicit target pane. */
export const TMUX_ENVIRONMENT_KEYS = ['TMUX', 'TMUX_PANE'] as const;

/** Return a copy of `env` with every tmux target variable masked. */
export function scrubTmuxEnvironment(env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = { ...env };
  for (const key of TMUX_ENVIRONMENT_KEYS) scrubbed[key] = undefined;
  return scrubbed;
}
