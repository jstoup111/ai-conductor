import type { ComplexityTier, EnforcementLevel, StepName, Phase } from './steps.js';

/**
 * Claude's native reasoning effort levels — set per invocation via
 * `CLAUDE_CODE_EFFORT_LEVEL` env var. Controls adaptive thinking budget.
 *
 * Model support:
 *   - Opus 4.7: all five (low / medium / high / xhigh / max)
 *   - Opus 4.6, Sonnet 4.6: low / medium / high / max (no xhigh)
 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Artifact-review flow per step. Fixed per step (not user-configurable) —
 * set in resolved-config.ts's DEFAULT_STEP_REVIEW table:
 *   - auto: silently record approval; no prompt
 *   - manual: always prompt the user
 *   - conditional: auto-approve unless the skill wrote
 *     `.pipeline/review-required-<step>` (signalling it found issues
 *     worth human attention)
 */
export type ReviewMode = 'auto' | 'manual' | 'conditional';

/**
 * Overrides that kick in when the feature's current complexity tier matches.
 * Every field is optional — unset falls back to the step/phase/default value.
 * Applied ON TOP of the step's base config at resolve time.
 */
export interface TierOverride {
  model?: string;
  effort?: EffortLevel;
  max_retries?: number;
}

/**
 * A branch inside a `parallel` group. Each branch has a name and its own
 * step configuration (model, effort, skill, etc.).
 */
export interface ParallelBranch {
  /** Unique name within the group. Used to form synthetic state key: <group>__<branch>. */
  name: string;
  /** Skill to run for this branch. */
  skill?: string;
  /** Model override for this branch. */
  model?: string;
  /** Effort override for this branch. */
  effort?: EffortLevel;
  /**
   * When false (default): a failure in this branch blocks the group and
   * propagates as a group failure. When true: this branch's failure is
   * logged but the group continues and succeeds.
   */
  advisory?: boolean;
}

/**
 * Configuration for a single step. Every key is optional — unset values fall
 * back through phases > defaults > hardcoded baselines.
 *
 * Built-in steps (those declared in ALL_STEPS) may set any subset of keys.
 * Custom steps (not in ALL_STEPS) MUST set both `after` and `skill` so the
 * registry knows where and how to insert them.
 */
export interface StepConfig {
  /** Claude model: alias ("haiku"|"sonnet"|"opus"|"fable") or full ID. */
  model?: string;

  /** Claude `/effort` level — sets CLAUDE_CODE_EFFORT_LEVEL for this step. */
  effort?: EffortLevel;

  /** Retry budget before recovery-menu escalation. */
  max_retries?: number;

  /** Skip this step entirely. Built-in gating/structural steps cannot be disabled. */
  disable?: boolean;

  /** Replace the default SKILL.md file with this path. */
  skill?: string;

  /** Shell hooks run before/after the step. Paths are project-relative. */
  hooks?: {
    before?: string;
    after?: string;
  };

  /** Tier-specific overrides applied when state.complexity_tier matches. */
  by_tier?: Partial<Record<ComplexityTier, TierOverride>>;

  // --- Custom-step-only fields -----------------------------------------------

  /** (Custom steps only) Insert after this existing step. */
  after?: StepName | string;

  /** (Custom steps only) Enforcement level. Required when adding a step. */
  enforcement?: EnforcementLevel;

  /**
   * (Custom steps only) Force gate-loop membership. When omitted, the step
   * inherits its `after` target's loop membership — so a custom step inserted
   * among the loop steps (build…finish) joins the loop automatically. Set
   * `gate: false` to keep a step in the loop region out of the loop.
   */
  gate?: boolean;

  /**
   * (Custom steps only) Mark this upstream gate as re-openable by a downstream
   * kickback. Opt-in (default false).
   */
  kickback_target?: boolean;

  // --- Conditional + Parallel primitives ------------------------------------

  /**
   * Boolean expression evaluated against current conductor state. When the
   * expression evaluates to false the step is skipped and a `when_skip` event
   * is emitted. Mutually exclusive with `parallel`.
   *
   * Supported forms:
   *   tier == L
   *   tier in [M, L]
   *   phase == BUILD
   *   ${state_key} == value
   *   A && B   (conjunction of any two of the above)
   */
  when?: string;

  /**
   * Concurrent branch group. When present, the step runs each branch via
   * Promise.all. Mutually exclusive with `skill`.
   *
   * Synthetic state keys written to conduct-state.json:
   *   <step_name>__<branch_name>  → "done" | "skipped" | "failed"
   */
  parallel?: ParallelBranch[];
}

/**
 * Phase-wide defaults. Apply to every step in the phase unless overridden.
 */
export interface PhaseConfig {
  model?: string;
  effort?: EffortLevel;
  max_retries?: number;
  by_tier?: Partial<Record<ComplexityTier, TierOverride>>;
}

/**
 * Global defaults. Apply to every step unless the step or its phase overrides.
 */
export interface DefaultsConfig {
  model?: string;
  effort?: EffortLevel;
  max_retries?: number;
}

/**
 * User-level global state: harness update channel, detected version, last
 * check timestamp. Lives in ~/.ai-conductor/config.yml. Project configs
 * should not override this block — it's per-user, not per-repo.
 */
export interface ConductorConfig {
  update_channel?: 'tagged' | 'main';
  auto_check?: boolean;
  current_version?: string;
  last_checked_at?: string;
}

/**
 * Markdown viewer resolution: used by conduct artifact-review + changelog
 * rendering to invoke the user's preferred viewer. `command` + `args` are
 * the resolved form (a preset pre-fills these). `{file}` in any arg is
 * substituted with the file path at invocation time.
 */
export interface MarkdownViewerConfig {
  preset?: string;
  command: string;
  args: string[];
  mode: 'inline' | 'blocking' | 'external';
}

/**
 * Preferred Mermaid renderer — turns the ```mermaid blocks inside generated
 * `.md` artifacts (architecture diagrams, ADRs) into visuals at the approval
 * gate. Parallels {@link MarkdownViewerConfig}. `command` is empty for the
 * `html`/`none` presets (which need no external tool). `{file}` is substituted
 * with the source path and `{out}` with the rendered output path at invocation.
 */
export interface MermaidRendererConfig {
  preset?: string;
  command: string;
  args: string[];
  mode: 'inline' | 'blocking' | 'external';
}

/**
 * Staleness thresholds for the project-level `assess` prelude step. Either
 * signal (time OR commit count) being exceeded makes an existing assessment
 * "stale"; the user is prompted before a re-run is triggered. Defaults live
 * in `project-prelude.ts` (`DEFAULT_ASSESS_STALE_*`).
 */
export interface AssessConfig {
  stale_after_days?: number;
  stale_after_commits?: number;
}

/**
 * OpenTelemetry exporter configuration. When present in HarnessConfig, the
 * OTel visualizer plugin is constructed and attached to the event bus.
 * Absent means disabled (FR-1 default-off).
 */
export interface OtelConfig {
  /** Transport: 'otlp' pushes to an OTLP endpoint; 'file' writes OTLP-JSON lines. */
  exporter: 'otlp' | 'file';
  /** OTLP endpoint URL. Required when exporter='otlp'. */
  endpoint?: string;
  /** File path for file transport. Defaults to '.pipeline/otel.jsonl'. */
  file?: string;
  /** OTLP wire protocol. Defaults to 'http/protobuf' (port 4318). */
  protocol?: 'http/protobuf' | 'grpc';
}

/**
 * How harness self-host mode is decided (adr-2026-06-30-self-host-detection-seam):
 *   - 'auto'      → path-based auto-detection (build repo root == harness root)
 *   - 'force_on'  → treat ANY repo as the harness self-build (testing)
 *   - 'force_off' → never self-host, even for the harness repo (escape hatch)
 */
export type SelfHostActivation = 'auto' | 'force_on' | 'force_off';

/**
 * Self-host guardrail configuration (sibling to `otel` / owner-gate keys).
 * ABSENT means the safe default: auto-detect, all gates ON. Every field is
 * optional; an omitted gate toggle defaults to ENABLED — a partial config can
 * never silently disable a guardrail (TR-11). Validated in `validateConfig()`.
 */
export interface HarnessSelfHostConfig {
  /** Activation strategy. Omitted → 'auto'. */
  activation?: SelfHostActivation;
  /** Relink harness skills before dispatch (TR-4). Omitted → true. */
  skill_relink_preflight?: boolean;
  /** Run the self-build under a throwaway CLAUDE_CONFIG_DIR (TR-5/6). Omitted → true. */
  sandbox_build_env?: boolean;
  /** HALT for operator VERSION-bump approval at finish (TR-7). Omitted → true. */
  version_approval_gate?: boolean;
  /** HALT on integrity/CHANGELOG/migration gate failure (TR-8/9/10). Omitted → true. */
  release_artifact_gate?: boolean;
  /**
   * Declared version freeze (#261): the operator's standing "current version,
   * no bump" approval. While it matches the repo VERSION the approval gate
   * self-satisfies (records the approval marker, no HALT); any other VERSION
   * still halts — a freeze never approves an actual bump. Omitted → no freeze.
   */
  version_freeze?: string;
}

export interface HarnessConfig {
  harness_version?: string;
  defaults?: DefaultsConfig;
  phases?: Partial<Record<Phase, PhaseConfig>>;
  /**
   * Keyed by step name. Includes both built-in steps (override their knobs)
   * and custom steps (new entries with `after` + `skill`).
   */
  steps?: Record<string, StepConfig>;
  complexity?: {
    default_tier?: ComplexityTier;
  };
  /** User-level global state — loaded from ~/.ai-conductor/config.yml. */
  conductor?: ConductorConfig;
  /** Preferred markdown viewer — user-level default, project can override. */
  markdown_viewer?: MarkdownViewerConfig;
  /** Preferred Mermaid renderer — user-level default, project can override. */
  mermaid_renderer?: MermaidRendererConfig;
  /** Project-level assess staleness thresholds (optional). */
  assess?: AssessConfig;
  /**
   * Extra glob patterns the `acceptance_specs` completion check should accept,
   * ADDED to (never replacing) the built-in defaults in
   * `STEP_ARTIFACT_GLOBS.acceptance_specs`. Lets a repo declare where its specs
   * actually live so the gate doesn't false-halt. Monorepos whose specs sit
   * under package subdirectories use a leading `*\/` to match any immediate
   * subdir without naming each package, e.g.
   * `['*\/spec/**', '*\/__tests__/**']`. Literal prefixes (`api/spec/**`) work
   * too. (The `\` above is only to keep this comment from closing early.)
   */
  acceptance_spec_globs?: string[];
  /** Plugin selection: which LLM provider to use (defaults to 'claude'). */
  llm_provider?: string;
  /** Plugin selection: which UI renderer to use (defaults to 'terminal'). */
  ui_renderer?: string;
  /**
   * Plugin selection: which memory provider to use (defaults to 'local').
   * Set in `.ai-conductor/config.yml`; resolved once at run start so every
   * memory-using step sees the same active provider (adr-2026-06-29-per-project-memory-provider-selection).
   */
  memory_provider?: string;
  /** OpenTelemetry exporter config. Absent = disabled (default off, FR-1). */
  otel?: OtelConfig;
  /**
   * Owner-gate (adr-2026-06-30-owner-gate-identity-resolution / FR-1): the
   * configured operator identity the daemon builds specs for. Wins over the
   * gh-login fallback. Absent/blank → fall through the resolution chain.
   * Naming boundary (ADR-1): this is the OPERATOR concept — never conflated
   * with `daemon-lock.ts`'s lock holder.
   */
  spec_owner?: string;
  /**
   * Owner-gate grandfather cutover (FR-10): the ISO-8601 instant before which
   * un-owned specs are grandfathered (built) and on/after which they are
   * skipped. Validated at load time — a malformed (unparseable) value is
   * REJECTED rather than silently defaulted, so an un-owned spec is never
   * misclassified. Absent → no grandfather window (un-owned specs are treated
   * as indeterminate and skipped).
   */
  owner_gate_cutover?: string;
  /**
   * Maximum number of Claude-assisted conflict-resolution attempts inside the
   * rebase step before the engine halts for operator intervention.
   * Default: 3. Set to 0 to disable automated resolution (conflict always
   * halts immediately). Negative or non-numeric values fall back to 3.
   */
  rebase_resolution_attempts?: number;
  /**
   * Harness self-host guardrails (adr-2026-06-30-self-host-detection-seam):
   * activation override + per-gate toggles. Absent → auto-detect, all gates on
   * (the safe default). Scoped to harness self-builds; no effect on other repos.
   */
  harness_self_host?: HarnessSelfHostConfig;
  /**
   * Ordered list of model aliases/IDs to fall back through when the primary
   * model is unavailable (model-availability-fallback-ladder). Absent/empty
   * array → no fallback. Each entry must be a non-empty string.
   */
  model_fallback_ladder?: string[];
  /**
   * Timeout in minutes for OAuth token park-and-poll recovery (TR-5).
   * Default: 60 (one hour). When the daemon detects an expired operator
   * OAuth token, it parks the build and polls for token refresh until this
   * timeout elapses. 0 disables the timeout (polls indefinitely). Negative or
   * non-numeric values fall back to 60.
   */
  auth_park_timeout_minutes?: number;
}
