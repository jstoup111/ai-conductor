import { isAbsolute } from 'node:path';

import {
  SessionEventProducer,
  type SessionEventProducerContext,
} from './session-event-producer.js';
import type { SessionCommandRefusedEvent } from '../types/events.js';

/**
 * Deterministic daemon-session boundary enforcement for the ai-conductor CLI.
 *
 * LLM maker sessions dispatched by the engine (daemon builds, reviews,
 * interactive-conductor steps, self-host candidates) have attempted to run
 * `ai-conductor` themselves from inside their session — recursively invoking
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
 *  2. **Entry guard.** The ai-conductor entry point calls
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
const SESSION_SANCTIONED_SUBCOMMANDS = [
  // skills/tdd/SKILL.md + skills/pipeline/SKILL.md — scoped VERIFY runs the
  // affected-test union through `ai-conductor scoped-run <selectors...>`.
  'scoped-run',
  // skills/pipeline/SKILL.md — provider-native task dispatch stamps and clears
  // the current worktree's task; completion remains gate-owned.
  'task',
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
  // engine/conductor.ts FINISH publication prompts + skills/pr/SKILL.md — the
  // author_pr_prose / repair passes submit PR edits as a guarded
  // `pull-request.edit` request. github-operations.ts enforces feature
  // ownership, and shared-write approval needs an interactive TTY a daemon
  // session never has, so admitting it cannot reach another feature.
  'github-operation',
] as const;

const SESSION_SANCTIONED_SUBCOMMAND_SET: ReadonlySet<string> = new Set(SESSION_SANCTIONED_SUBCOMMANDS);

/**
 * Bounded identity emitted with a refusal. Unknown command text is never
 * reflected into the result, so consumers cannot accidentally persist argv.
 */
export type DaemonSessionSubcommand =
  | (typeof SESSION_SANCTIONED_SUBCOMMANDS)[number]
  | 'daemon'
  | 'config'
  | 'test-suite'
  | 'build-review'
  | 'finish-record'
  | 'unknown'
  | 'none';

const KNOWN_BLOCKED_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'daemon',
  'config',
  'test-suite',
  'build-review',
  'finish-record',
]);

export type DaemonSessionGuardVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly subcommand: DaemonSessionSubcommand;
      readonly message: string;
    };

/** First non-flag argv token after the node/script prefix. */
function firstSubcommand(argv: readonly string[]): string | undefined {
  return argv.slice(2).find((token) => !token.startsWith('-'));
}

function boundedSubcommand(subcommand: string | undefined): DaemonSessionSubcommand {
  if (subcommand === undefined) return 'none';
  if (
    SESSION_SANCTIONED_SUBCOMMAND_SET.has(subcommand)
    || KNOWN_BLOCKED_SUBCOMMANDS.has(subcommand)
  ) {
    return subcommand as DaemonSessionSubcommand;
  }
  return 'unknown';
}

function renderSubcommand(subcommand: DaemonSessionSubcommand): string {
  return subcommand === 'none' ? '<none>' : subcommand;
}

/**
 * The one production command policy shared by the entry guard and source
 * compatibility audit. It deliberately has no environment/config input: the
 * test-only bypass is an entry-guard valve, never an audit exemption.
 */
export function evaluateDaemonSessionCommandPolicy(
  argv: readonly string[],
): DaemonSessionGuardVerdict {
  const subcommand = firstSubcommand(argv);
  if (subcommand !== undefined && SESSION_SANCTIONED_SUBCOMMAND_SET.has(subcommand)) {
    return { allowed: true };
  }
  const bounded = boundedSubcommand(subcommand);
  return {
    allowed: false,
    subcommand: bounded,
    message:
      'ai-conductor may not be invoked from inside a daemon-managed session; ' +
      'the engine owns all conductor operations for this run ' +
      `(blocked subcommand: ${renderSubcommand(bounded)}).`,
  };
}

/**
 * Decide whether this ai-conductor invocation may proceed. Refuses everything
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
  return evaluateDaemonSessionCommandPolicy(argv);
}

/** The minimal producer boundary used by entry-point refusal reporting. */
export interface DaemonSessionRefusalWriter {
  refusal(input: { readonly subcommand: unknown }): SessionCommandRefusedEvent;
  append(event: SessionCommandRefusedEvent): Promise<unknown>;
}

export interface DaemonSessionRefusalTelemetryDependencies {
  readonly environment?: NodeJS.ProcessEnv;
  readonly createProducer?: (context: SessionEventProducerContext) => DaemonSessionRefusalWriter;
  readonly diagnostic?: (message: string) => void;
}

/**
 * Record a refused command only with the immutable context the engine put in
 * the child environment. Missing or inconsistent context degrades telemetry;
 * it never guesses a feature from cwd or another environment value.
 */
export async function emitDaemonSessionRefusal(
  verdict: Exclude<DaemonSessionGuardVerdict, { readonly allowed: true }>,
  dependencies: DaemonSessionRefusalTelemetryDependencies = {},
): Promise<'recorded' | 'unavailable' | 'failed'> {
  const environment = dependencies.environment ?? process.env;
  const diagnostic = dependencies.diagnostic ?? console.error;
  const context = managedSessionProducerContext(environment);
  if (!context) {
    diagnostic('session refusal telemetry unavailable');
    return 'unavailable';
  }

  try {
    const createProducer: (context: SessionEventProducerContext) => DaemonSessionRefusalWriter = dependencies.createProducer
      ?? ((value) => new SessionEventProducer(value));
    const producer = createProducer(context);
    await producer.append(producer.refusal({ subcommand: verdict.subcommand }));
    return 'recorded';
  } catch {
    diagnostic('session refusal telemetry degraded');
    return 'failed';
  }
}

function managedSessionProducerContext(environment: NodeJS.ProcessEnv): SessionEventProducerContext | undefined {
  const raw = environment.CONDUCT_MANAGED_SESSION_CONTEXT;
  if (typeof raw !== 'string') return undefined;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value)
    || !isAbsoluteString(value.projectRoot)
    || !isAbsoluteString(value.worktreeRoot)
    || !isAbsoluteString(value.producerRoot)
    || !isIdentity(value.dispatchId)
    || !isIdentity(value.provider)
    || !isScope(value.scope)) return undefined;

  const context: SessionEventProducerContext = {
    projectRoot: value.projectRoot,
    worktreeRoot: value.worktreeRoot,
    producerRoot: value.producerRoot,
    dispatchId: value.dispatchId,
    provider: value.provider,
    scope: value.scope,
  };
  return environmentMatchesContext(environment, context) ? context : undefined;
}

function environmentMatchesContext(environment: NodeJS.ProcessEnv, context: SessionEventProducerContext): boolean {
  if (!matchesIfPresent(environment.CONDUCT_MANAGED_PROJECT, context.projectRoot)
    || !matchesIfPresent(environment.CONDUCT_MANAGED_WORKTREE, context.worktreeRoot)
    || !matchesIfPresent(environment.CONDUCT_MANAGED_PRODUCER_ROOT, context.producerRoot)
    || !matchesIfPresent(environment.CONDUCT_MANAGED_DISPATCH, context.dispatchId)
    || !matchesIfPresent(environment.CONDUCT_MANAGED_PROVIDER, context.provider)) return false;
  const feature = environment.CONDUCT_MANAGED_FEATURE;
  return context.scope.kind === 'feature'
    ? matchesIfPresent(feature, context.scope.featureSlug)
    : feature === undefined;
}

function matchesIfPresent(value: string | undefined, expected: string): boolean {
  return value === undefined || value === expected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAbsoluteString(value: unknown): value is string {
  return typeof value === 'string' && isAbsolute(value);
}

function isScope(value: unknown): value is SessionEventProducerContext['scope'] {
  return isRecord(value) && (value.kind === 'project'
    || (value.kind === 'feature' && isIdentity(value.featureSlug)));
}

function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}
