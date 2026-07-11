/**
 * Marker env for engine-authored (bookkeeping) `git commit` invocations.
 *
 * The commit-msg hook (git-hook-assets.ts, #505 Task 7) exempts any commit
 * made with `CONDUCT_ENGINE_COMMIT=1` set in its process env from the
 * Task: trailer requirement — these commits are system bookkeeping (rebase
 * mechanics, quarantine, shipped-record, engineer scaffolding/spec landing),
 * never dispatched implementation work, so they must never be forced to
 * carry a Task: trailer.
 *
 * Single source of truth so every engine commit call site spreads the same
 * shape into its spawn env rather than re-typing the literal.
 */
export const ENGINE_COMMIT_ENV = { CONDUCT_ENGINE_COMMIT: '1' } as const;

/** `process.env` merged with the engine-commit marker, for spawn `env:` options. */
export function withEngineCommitEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...base, ...ENGINE_COMMIT_ENV };
}
