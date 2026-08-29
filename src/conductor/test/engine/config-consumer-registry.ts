import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIG_CONSUMER_KEY_SETS } from '../../src/engine/config.js';

export interface ConsumerDeclaration {
  consumer: string | 'none';
  reason?: string;
}

export type ConfigKeySets = Record<string, readonly string[]>;

export function flattenedConfigKeys(sets: ConfigKeySets): string[] {
  return Object.entries(sets).flatMap(([block, keys]) =>
    keys.map((key) => (block === 'top' ? key : `${block}.${key}`)),
  );
}

const consumer = (path: string): ConsumerDeclaration => ({ consumer: path });
const none = (reason: string): ConsumerDeclaration => ({ consumer: 'none', reason });

// Consumer paths used more than once. Named so a moved module is one edit, and
// so the declaration table below stays scannable.
const RESOLVED_CONFIG = 'src/conductor/src/engine/resolved-config.ts';
const CONDUCTOR = 'src/conductor/src/engine/conductor.ts';
const STEPS = 'src/conductor/src/engine/steps.ts';
const DAEMON_CLI = 'src/conductor/src/daemon-cli.ts';
const STEP_RUNNERS = 'src/conductor/src/engine/step-runners.ts';
const AUTORESOLVE = 'src/conductor/src/engine/autoresolve.ts';
const AS_BUILT_POLICY = 'src/conductor/src/engine/as-built-policy.ts';
const PROJECT_PRELUDE = 'src/conductor/src/engine/project-prelude.ts';
const BUILD_PROGRESS_WATCHER = 'src/conductor/src/engine/build-progress-watcher.ts';
const FULL_SUITE_EXECUTOR = 'src/conductor/src/engine/full-suite-executor.ts';
const FULL_SUITE_FINGERPRINT = 'src/conductor/src/engine/full-suite-fingerprint.ts';
const HARNESS_COMMON = 'bin/lib/harness-common.sh';
const OTEL_CONFIG = 'src/conductor/src/engine/otel/otel-config.ts';

/**
 * Every documented config key maps to its OWN production consumer declaration
 * (adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal
 * decision 4). Sibling keys in one block share a path only where each was
 * separately verified to be read there; the validator is never a consumer.
 */
export const configConsumerRegistry: Record<string, ConsumerDeclaration> = {
  // ── Top-level keys ────────────────────────────────────────────────────────
  harness_version: consumer(PROJECT_PRELUDE),
  defaults: consumer(RESOLVED_CONFIG),
  phases: consumer(RESOLVED_CONFIG),
  steps: consumer(STEPS),
  complexity: none('inert compatibility block after #1025 removed default_tier'),
  conductor: consumer(HARNESS_COMMON),
  markdown_viewer: consumer(HARNESS_COMMON),
  mermaid_renderer: consumer('src/conductor/src/engine/render-cli.ts'),
  assess: consumer(PROJECT_PRELUDE),
  acceptance_spec_globs: consumer('src/conductor/src/engine/artifacts.ts'),
  test_suite: consumer('src/conductor/src/engine/full-suite-verifier.ts'),
  llm_provider: consumer('src/conductor/src/engine/provider-selection.ts'),
  ui_renderer: consumer('src/conductor/src/engine/plugin-loader.ts'),
  visualizers: consumer('src/conductor/src/index.ts'),
  memory_provider: consumer('src/conductor/src/engine/local-memory-provider.ts'),
  otel: consumer(OTEL_CONFIG),
  build_progress: consumer(BUILD_PROGRESS_WATCHER),
  provider_stream: consumer(STEP_RUNNERS),
  spec_owner: consumer('src/conductor/src/engine/owner-gate/identity.ts'),
  owner_gate_cutover: consumer(CONDUCTOR),
  attribution_audit_sample_pct: consumer('src/conductor/src/engine/attribution-telemetry.ts'),
  rebase_resolution_attempts: consumer(CONDUCTOR),
  validation_concurrency: consumer(CONDUCTOR),
  harness_self_host: consumer(RESOLVED_CONFIG),
  model_fallback_ladder: consumer('src/conductor/src/engine/provider-execution.ts'),
  auto_restart_on_stale_engine: consumer('src/conductor/src/engine/stale-engine-init.ts'),
  engine_refresh_min_interval_seconds: consumer(DAEMON_CLI),
  codex_doctor_timeout_seconds: consumer('src/conductor/src/engine/plugin-loader.ts'),
  mergeable_autoresolve: consumer(AUTORESOLVE),
  build_review: consumer(RESOLVED_CONFIG),
  conflict_check: consumer('skills/conflict-check/SKILL.md'),
  prd_audit: consumer(CONDUCTOR),
  architecture_review_as_built: consumer(AS_BUILT_POLICY),
  ci_watch: consumer(DAEMON_CLI),
  build_progress_halt: consumer(DAEMON_CLI),
  retry_routing: consumer(CONDUCTOR),
  wiring: none('deprecated compatibility no-op; build_review owns wiring judgement (#1025)'),
  kickback_escalation: consumer(CONDUCTOR),
  cumulative_kickback_bound: consumer(CONDUCTOR),
  gate_code_validity: consumer('src/conductor/src/engine/gate-code-validity.ts'),
  daemon_verbose: consumer('src/conductor/src/engine/daemon-deps.ts'),
  reconcile_parked_auto_cleanup: consumer(DAEMON_CLI),
  step_heartbeat_stall_minutes: none('deprecated compatibility no-op; never grants termination authority (#1025)'),
  stale_claim_window_hours: consumer(RESOLVED_CONFIG),
  provider_preparation_timeout_minutes: consumer(RESOLVED_CONFIG),
  teardown_timeout_seconds: consumer(RESOLVED_CONFIG),
  dispatch_start_timeout_seconds: consumer(RESOLVED_CONFIG),

  // ── defaults / phases ─────────────────────────────────────────────────────
  // resolveProviderNative/NeutralStepConfig read `defaultsCfg?.<key>` and
  // `phaseCfg?.<key>` (including `phaseCfg?.by_tier`) directly.
  'defaults.model': consumer(RESOLVED_CONFIG),
  'defaults.effort': consumer(RESOLVED_CONFIG),
  'defaults.max_retries': consumer(RESOLVED_CONFIG),
  'defaults.escalate': consumer(RESOLVED_CONFIG),
  'phases.model': consumer(RESOLVED_CONFIG),
  'phases.effort': consumer(RESOLVED_CONFIG),
  'phases.max_retries': consumer(RESOLVED_CONFIG),
  'phases.escalate': consumer(RESOLVED_CONFIG),
  'phases.by_tier': consumer(RESOLVED_CONFIG),

  // ── steps.<name> ──────────────────────────────────────────────────────────
  // Split by reader: step resolution, provider selection, skill/hook
  // resolution, custom-step registry construction, and the conductor loop each
  // own a different subset. `steps.ts` reads only the custom-step fields.
  'steps.llm_provider': consumer('src/conductor/src/engine/provider-selection.ts'),
  'steps.model': consumer(RESOLVED_CONFIG),
  'steps.effort': consumer(RESOLVED_CONFIG),
  'steps.max_retries': consumer(RESOLVED_CONFIG),
  'steps.disable': consumer(RESOLVED_CONFIG),
  'steps.escalate': consumer(RESOLVED_CONFIG),
  'steps.skill': consumer('src/conductor/src/engine/skill-resolver.ts'),
  'steps.hooks': consumer('src/conductor/src/engine/hooks.ts'),
  'steps.by_tier': consumer(RESOLVED_CONFIG),
  'steps.after': consumer(STEPS),
  'steps.enforcement': consumer(STEPS),
  'steps.completion_artifact': consumer('src/conductor/src/engine/artifacts.ts'),
  'steps.gate': consumer(STEPS),
  'steps.kickback_target': consumer(STEPS),
  'steps.when': consumer(CONDUCTOR),
  'steps.parallel': consumer(CONDUCTOR),

  // ── steps.<name>.by_tier ──────────────────────────────────────────────────
  'steps.by_tier.model': consumer(RESOLVED_CONFIG),
  'steps.by_tier.effort': consumer(RESOLVED_CONFIG),
  'steps.by_tier.max_retries': consumer(RESOLVED_CONFIG),

  // ── steps.<name>.parallel[] ───────────────────────────────────────────────
  // `runParallelGroupViaCore` builds each `GroupMember` from `name`/`skill`
  // only and branches on `advisory` at join.
  'steps.parallel.name': consumer(CONDUCTOR),
  'steps.parallel.skill': consumer(CONDUCTOR),
  'steps.parallel.model': none(
    'typed and validated but unread: GroupMember carries name/skill/outcome only, so a branch model override cannot reach dispatch (#1025)',
  ),
  'steps.parallel.effort': none(
    'typed and validated but unread: GroupMember carries name/skill/outcome only, so a branch effort override cannot reach dispatch (#1025)',
  ),
  'steps.parallel.advisory': consumer(CONDUCTOR),

  // ── conductor (per-user update state) ─────────────────────────────────────
  // `conductor_cfg_key` maps each legacy field name onto the schema key and
  // `conductor_cfg_get`/`_set` read and write it; bin/update and bin/conduct
  // are its callers.
  'conductor.update_channel': consumer(HARNESS_COMMON),
  'conductor.auto_check': consumer(HARNESS_COMMON),
  'conductor.current_version': consumer(HARNESS_COMMON),
  'conductor.last_checked_at': consumer(HARNESS_COMMON),

  // ── harness_self_host ─────────────────────────────────────────────────────
  // `resolveSelfHostConfig` reads every field of the block, including the
  // nested `build_auth` object, and is the sole seam the guardrails consume.
  'harness_self_host.activation': consumer(RESOLVED_CONFIG),
  'harness_self_host.version_freeze': consumer(RESOLVED_CONFIG),
  'harness_self_host.auth_park_timeout_minutes': consumer(RESOLVED_CONFIG),
  'harness_self_host.build_auth': consumer(RESOLVED_CONFIG),
  'harness_self_host.sandbox_build_env': consumer(RESOLVED_CONFIG),
  'harness_self_host.live_containment': consumer(RESOLVED_CONFIG),
  'harness_self_host.version_approval_gate': consumer(RESOLVED_CONFIG),
  'harness_self_host.release_artifact_gate': consumer(RESOLVED_CONFIG),
  'harness_self_host_build_auth.mode': consumer(RESOLVED_CONFIG),
  'harness_self_host_build_auth.token_path': consumer(RESOLVED_CONFIG),

  // ── mergeable_autoresolve ─────────────────────────────────────────────────
  // `enabled`/`cooldownMinutes` are read inside autoresolve; `suiteCommand` is
  // read only by the daemon sweep, which passes it in as a parameter.
  'mergeable_autoresolve.enabled': consumer(AUTORESOLVE),
  'mergeable_autoresolve.cooldownMinutes': consumer(AUTORESOLVE),
  'mergeable_autoresolve.suiteCommand': consumer(DAEMON_CLI),

  // ── build_review ──────────────────────────────────────────────────────────
  // `resolveBuildReviewConfig` is the only reader of the raw block and of every
  // per-rubric policy field; the coordinator consumes the resolved object.
  // Nested OTel keys declare individually: `otel.project_name` reached the
  // documented surface under the block-level declaration alone, which decision 4
  // forbids (as-built AB-1).
  'otel.exporter': consumer(OTEL_CONFIG),
  'otel.endpoint': consumer(OTEL_CONFIG),
  'otel.file': consumer(OTEL_CONFIG),
  'otel.protocol': consumer(OTEL_CONFIG),
  'otel.project_name': consumer(OTEL_CONFIG),
  'build_review.enabled': consumer(RESOLVED_CONFIG),
  'build_review.perTaskFloor': none(
    'retired rubric-container knob: validateConfig warns and deletes it before resolution, so no resolved config ever carries it (adr-2026-08-22-build-review-opt-in-rubric-container)',
  ),
  'build_review.scopeContainmentEnforced': consumer(RESOLVED_CONFIG),
  'build_review.maxParallel': consumer(RESOLVED_CONFIG),
  'build_review.rubrics': consumer(RESOLVED_CONFIG),
  'build_review.rubrics.enabled': consumer(RESOLVED_CONFIG),
  'build_review.rubrics.llm_provider': consumer(RESOLVED_CONFIG),
  'build_review.rubrics.model': consumer(RESOLVED_CONFIG),
  'build_review.rubrics.effort': consumer(RESOLVED_CONFIG),
  'build_review.rubrics.model_fallback_ladder': consumer(RESOLVED_CONFIG),
  'build_review.rubrics.max_retries': consumer(RESOLVED_CONFIG),
  'build_review.rubrics.escalate': consumer(RESOLVED_CONFIG),

  // ── ci_watch ──────────────────────────────────────────────────────────────
  'ci_watch.enabled': consumer(DAEMON_CLI),
  'ci_watch.cooldownMinutes': consumer('src/conductor/src/engine/ci-fix.ts'),

  // ── kickback bounds ───────────────────────────────────────────────────────
  'kickback_escalation.enabled': consumer(CONDUCTOR),
  'cumulative_kickback_bound.enabled': consumer(CONDUCTOR),

  // ── conflict_check ────────────────────────────────────────────────────────
  // The corpus scope is consumed by the skill prompt, not the engine: the
  // validator normalizes the value and the skill reads it at step 2.
  'conflict_check.adr_corpus': consumer('skills/conflict-check/SKILL.md'),

  // ── prd_audit ─────────────────────────────────────────────────────────────
  'prd_audit.max_remediation_laps': consumer(CONDUCTOR),
  'prd_audit.max_appended_tasks': consumer(CONDUCTOR),
  'prd_audit.max_appended_ratio': consumer(CONDUCTOR),
  'prd_audit.halt_on_any_plan_gap': consumer(CONDUCTOR),

  // ── architecture_review_as_built ──────────────────────────────────────────
  // `checks.<check>.tiers` is the as-built policy's own input; the remediation
  // switch and the lap bound are read by the conductor's remediation routing.
  'architecture_review_as_built.checks': consumer(AS_BUILT_POLICY),
  'architecture_review_as_built.checks.tiers': consumer(AS_BUILT_POLICY),
  'architecture_review_as_built.remediation': consumer(CONDUCTOR),
  'architecture_review_as_built.remediation.enabled': consumer(CONDUCTOR),
  'architecture_review_as_built.max_remediation_laps': consumer(CONDUCTOR),

  // ── assess ────────────────────────────────────────────────────────────────
  'assess.stale_after_days': consumer(PROJECT_PRELUDE),
  'assess.stale_after_commits': consumer(PROJECT_PRELUDE),

  // ── test_suite ────────────────────────────────────────────────────────────
  // Aggregate execution reads command/working_directory/timeout_seconds; the
  // fingerprint reads inputs/environment; the scoped-run seam reads
  // scoped_command.
  'test_suite.command': consumer(FULL_SUITE_EXECUTOR),
  'test_suite.scoped_command': consumer(STEP_RUNNERS),
  'test_suite.working_directory': consumer(FULL_SUITE_EXECUTOR),
  'test_suite.timeout_seconds': consumer(FULL_SUITE_EXECUTOR),
  'test_suite.inputs': consumer(FULL_SUITE_FINGERPRINT),
  'test_suite.environment': consumer(FULL_SUITE_FINGERPRINT),

  // ── build_progress ────────────────────────────────────────────────────────
  'build_progress.poll_seconds': consumer(BUILD_PROGRESS_WATCHER),
  'build_progress.quiet_minutes': consumer(BUILD_PROGRESS_WATCHER),
  'build_progress.heartbeat_minutes': consumer(BUILD_PROGRESS_WATCHER),
  'build_progress.enabled': consumer(BUILD_PROGRESS_WATCHER),

  // ── provider_stream ───────────────────────────────────────────────────────
  'provider_stream.min_interval_ms': consumer(STEP_RUNNERS),

  // ── build_progress_halt ───────────────────────────────────────────────────
  // The attempt ceiling is enforced in the conductor's build loop; the
  // dispatch ceiling is read by the daemon's re-kick predicate builder.
  'build_progress_halt.enabled': consumer(CONDUCTOR),
  'build_progress_halt.attempt_ceiling': consumer(CONDUCTOR),
  'build_progress_halt.dispatch_ceiling': consumer(DAEMON_CLI),

  // ── kill switches ─────────────────────────────────────────────────────────
  'gate_code_validity.enabled': consumer('src/conductor/src/engine/gate-code-validity.ts'),
  'retry_routing.enabled': consumer(CONDUCTOR),

  // ── markdown_viewer / mermaid_renderer ────────────────────────────────────
  // `render_md` resolves command/args/mode for the artifact-review path. The
  // mermaid renderer dispatches on `preset` and bin/install probes its
  // `command` for PATH availability; the rest of that block is decorative.
  'markdown_viewer.preset': none(
    'written by `conduct-ts config write markdown_viewer` as provenance for the chosen catalog entry; nothing reads it back — render_md resolves command/args/mode directly (#1025)',
  ),
  'markdown_viewer.command': consumer(HARNESS_COMMON),
  'markdown_viewer.args': consumer(HARNESS_COMMON),
  'markdown_viewer.mode': consumer(HARNESS_COMMON),
  'mermaid_renderer.preset': consumer('src/conductor/src/engine/mermaid-renderer.ts'),
  'mermaid_renderer.command': consumer('bin/install'),
  'mermaid_renderer.args': none(
    'the mmdc invocation is built from mermaid-renderer.ts\'s own argv, never from the configured array (#1025)',
  ),
  'mermaid_renderer.mode': none(
    'the renderer dispatches on `preset` alone; each preset\'s open/external behavior is hardcoded in mermaid-renderer.ts (#1025)',
  ),
};

export function assertRegistryCovers(sets: ConfigKeySets, registry: Record<string, ConsumerDeclaration>, repoRoot = resolve(process.cwd(), '../..')): void {
  const accepted = new Set(flattenedConfigKeys(sets));
  for (const key of accepted) {
    const declaration = registry[key];
    if (!declaration) throw new Error(`Config key is undeclared: ${key}`);
    if (declaration.consumer === 'none') {
      if (!declaration.reason?.trim()) throw new Error(`Config key ${key} is none without a reason`);
      continue;
    }
    if (!existsSync(resolve(repoRoot, declaration.consumer))) {
      throw new Error(`Config key ${key} has unresolvable consumer: ${declaration.consumer}`);
    }
  }
  for (const key of Object.keys(registry)) {
    if (!accepted.has(key)) throw new Error(`Config-key declaration is orphaned: ${key}`);
  }
}
