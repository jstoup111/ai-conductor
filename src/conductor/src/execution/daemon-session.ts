/**
 * Deterministic daemon-session boundary enforcement for the conduct-ts CLI.
 *
 * LLM maker sessions dispatched by the engine (daemon builds, reviews,
 * interactive-conductor steps, self-host candidates) have attempted to run
 * `conduct-ts` themselves from inside their session — recursively invoking
 * daemon subcommands (park/unpark/restart), reseal, and other state-mutating
 * conductor operations that belong exclusively to the engine that dispatched
 * them. Per the repo's design principle — machinery over prompt discipline —
 * this module makes that impossible at two seams no call path can bypass:
 *
 *  1. **Marker injection.** Every provider child session the engine spawns
 *     (both providers, invoke and interactive paths, self-host included)
 *     carries `CONDUCT_DAEMON_SESSION=1` in its environment via
 *     {@link withDaemonSessionMarker}, applied inside the provider adapters'
 *     env builders — the same adapter boundary that enforces fresh sessions
 *     (see fresh-session.ts).
 *
 *  2. **Entry guard.** The conduct-ts entry point calls
 *     {@link guardDaemonSessionInvocation} before any subcommand parsing and
 *     refuses to run when the marker is present, except for the small
 *     session-sanctioned worker-command set below that the harness's own
 *     skills and hooks REQUIRE maker sessions to run.
 *
 * There is deliberately no config off-switch. The only bypass is the
 * test-only env valve `CONDUCT_DAEMON_SESSION_UNSAFE_ALLOW=1`, mirroring the
 * fresh-session valve: nothing in production sets it, and no config key maps
 * to it. A structural test pins the valve name to this module and tests.
 */

/** Env var stamped into every engine-dispatched provider session. */
export const DAEMON_SESSION_MARKER = 'CONDUCT_DAEMON_SESSION';

/**
 * Return a copy of `env` with the daemon-session marker set. Used by the
 * provider adapters when composing the child session environment; never
 * mutates the engine's own `process.env`.
 */
export function withDaemonSessionMarker(
  env?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return { ...env, [DAEMON_SESSION_MARKER]: '1' };
}

/**
 * Worker subcommands the harness's own session-facing instructions mandate a
 * dispatched maker session to run. These are session-scoped, telemetry or
 * verification commands — none can park, unpark, restart, reseal, or
 * otherwise steer the daemon or another feature's lifecycle. Each entry is a
 * deliberate, documented exemption; everything else is refused. Keep this
 * list in lockstep with the referenced SKILL.md/hook contracts — do NOT add
 * daemon/engineer/state-mutating verbs here.
 */
const SESSION_SANCTIONED_SUBCOMMANDS: ReadonlySet<string> = new Set([
  // skills/tdd/SKILL.md + skills/pipeline/SKILL.md — scoped VERIFY runs the
  // affected-test union through `conduct-ts scoped-run <selectors...>`.
  'scoped-run',
  // skills/plan/SKILL.md + skills/architecture-review/SKILL.md — advisory
  // overlap scan required before the plan is committed.
  'overlap-scan',
  // skills/plan/SKILL.md — protected-target checklist gate on the plan file.
  'plan-protected-targets',
  // skills/manual-test/SKILL.md — records results/skip into the worktree's
  // own .pipeline; the manual-test gate reads this artifact.
  'manual-test-record',
  // skills/pipeline/SKILL.md — evaluator closeout telemetry event.
  'closeout-event',
  // hooks/claude/post-commit-derive-feedback.sh — the advisory post-commit
  // hook invokes the engine derive path from inside the session's git commit.
  'derive-feedback',
  // git-hook-assets.ts — the commit-msg hook records advisory containment
  // evidence for a commit authored inside the daemon-managed maker session.
  'scope-check',
]);

export type DaemonSessionGuardVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly message: string };

/** First non-flag argv token after the node/script prefix. */
function firstSubcommand(argv: readonly string[]): string | undefined {
  return argv.slice(2).find((token) => !token.startsWith('-'));
}

/**
 * Decide whether this conduct-ts invocation may proceed. Refuses everything
 * except the session-sanctioned worker set when the daemon-session marker is
 * present; always allows when it is absent.
 */
export function guardDaemonSessionInvocation(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): DaemonSessionGuardVerdict {
  if (env[DAEMON_SESSION_MARKER] !== '1') return { allowed: true };
  // Test-only valve (mirrors the fresh-session valve): nothing in production
  // sets it and there is no config key for it.
  if (env.CONDUCT_DAEMON_SESSION_UNSAFE_ALLOW === '1') return { allowed: true };
  const subcommand = firstSubcommand(argv);
  if (subcommand !== undefined && SESSION_SANCTIONED_SUBCOMMANDS.has(subcommand)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    message:
      'conduct-ts may not be invoked from inside a daemon-managed session; ' +
      'the engine owns all conductor operations for this run ' +
      `(blocked subcommand: ${subcommand ?? '<none>'}).`,
  };
}
