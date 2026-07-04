import { Command } from 'commander';
import { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { PushMetricExporter } from '@opentelemetry/sdk-metrics';

type StepName = 'bootstrap' | 'memory' | 'assess' | 'explore' | 'prd' | 'complexity' | 'stories' | 'conflict_check' | 'plan' | 'architecture_diagram' | 'architecture_review' | 'worktree' | 'acceptance_specs' | 'build' | 'manual_test' | 'prd_audit' | 'architecture_review_as_built' | 'retro' | 'rebase' | 'finish' | 'remediate';
type StepStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped' | 'stale';
type Phase = 'SETUP' | 'UNDERSTAND' | 'DECIDE' | 'BUILD' | 'SHIP';
type ComplexityTier = 'S' | 'M' | 'L';
/** The work track decided in `explore`: a product feature vs technical-only work. */
type Track = 'product' | 'technical';
type EnforcementLevel = 'advisory' | 'gating' | 'structural' | 'mechanical';
type RunMode = 'default' | 'auto' | 'interactive';
type ViewMode$1 = 'dashboard' | 'output';
interface StepDefinition {
    name: StepName;
    label: string;
    phase: Phase;
    enforcement: EnforcementLevel;
    prerequisites: StepName[];
    skippableForTiers: ComplexityTier[];
    /**
     * Tracks (product/technical) for which this step is skipped. `prd` is skipped
     * on the `technical` track (no product requirements to spec). Empty/absent →
     * runs on every track. The conductor resolves the track from state and treats
     * a track-skipped step as satisfied (same as a tier-skip).
     */
    skippableForTracks?: Track[];
    isCheckpoint: boolean;
    skillName?: string;
    /**
     * This step participates in the gate-driven tail loop (build…finish): its
     * objective verdict is recomputed after it runs and the selector may route
     * to/over it. The conductor derives the loop region and the front/loop
     * boundary from this flag, so a custom config step inserted among the loop
     * steps joins the loop. Built-ins: build, manual_test, retro, finish.
     */
    loopGate?: boolean;
    /**
     * This upstream gate can be re-opened by a downstream kickback (build /
     * manual_test writing `{satisfied:false, kickback.from}`). The conductor
     * derives KICKBACK_TARGETS + the selector's region start from this flag.
     * Built-ins: stories, plan.
     */
    kickbackTarget?: boolean;
    /**
     * Skip this step whenever the named upstream step ended up `skipped`,
     * regardless of why (tier, config-disable, `when:` skip). Expresses a
     * data dependency: e.g. `architecture_review_as_built` audits shipped code
     * against APPROVED ADRs, so if `architecture_review` was skipped there are no
     * ADRs to audit and the as-built gate has nothing to do. Honored by the
     * selector and by the conductor's linear + looped-region skip passes.
     */
    skipWhenSkipped?: StepName;
}

/**
 * Mode detected by the bootstrap skill when it first runs in a project.
 * Persisted to state so downstream steps (notably `assess`) can branch on
 * whether the project has a real codebase worth evaluating.
 *
 * - `new`            — empty directory at bootstrap time; bootstrap scaffolds
 *                      the project itself. Nothing to assess. Conductor skips
 *                      `assess` for this mode.
 * - `fresh`          — project code exists but no harness artifacts were
 *                      present. Assess runs normally.
 * - `partial`        — harness artifacts partially present (interrupted
 *                      bootstrap). Assess runs.
 * - `re-bootstrap`   — harness fully installed; bootstrap is refreshing
 *                      detection only. Assess runs.
 */
type BootstrapMode = 'new' | 'fresh' | 'partial' | 're-bootstrap';
/**
 * Matches the flat JSON structure of conduct-state.json.
 * Step names are keys with StepStatus values. Metadata keys are mixed in.
 * This flat structure is required for backward compatibility with the bash conductor.
 */
type ConductState = {
    [K in StepName]?: StepStatus;
} & {
    feature_desc?: string;
    complexity_tier?: ComplexityTier;
    /**
     * Work track decided in `explore` (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location). `product` features author a
     * PRD; `technical` features skip the `prd` step (and `prd-audit` at SHIP). A
     * missing track defaults to `product` (back-compat: pre-track specs are PRDs).
     */
    track?: Track;
    bootstrap_mode?: BootstrapMode;
    run_started_at?: number;
    /**
     * Epoch ms of the most recent `Conductor.run()` invocation. Set on every
     * entry to `run()` so SHIP-phase completion gates can compare artifact
     * mtimes against the current session's start and reject anything left
     * over from a previous run. Old state files without this field are
     * tolerated (gates fail open when undefined).
     */
    session_started_at?: number;
    last_step?: StepName;
    pr_url?: string;
    worktree_dir?: string;
    worktree_branch?: string;
    feature_status?: 'complete';
    /**
     * Per-file approval records keyed by the artifact's absolute path (or a
     * stable relative path from projectRoot — implementation decides). The sha256
     * is recomputed on each review pass; unchanged files skip re-prompting.
     */
    artifact_approvals?: Record<string, ArtifactApproval>;
    bootstrap?: StepStatus;
    assess?: StepStatus;
};
interface ArtifactApproval {
    sha256: string;
    approved_at: string;
}
interface TaskStatus {
    status: 'pending' | 'in_progress' | 'completed';
}
type TaskStatusFile = Record<string, TaskStatus>;
type StateError = {
    type: 'corrupted' | 'missing' | 'io_error';
    message: string;
};
type StateResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: StateError;
};

interface TokenUsage {
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreation?: number;
}

type RecoveryOption = 'retry' | 'interactive' | 'back' | 'skip' | 'quit';
/**
 * Extra state threaded into onRecovery so the UI can adapt its menu
 * without the engine dictating the layout.
 *
 * - `recoveryCount` — how many times the user has entered the recovery
 *   menu for this step in the current session (0 on first entry).
 * - `retriesExhausted` — `true` when the per-step recovery-retry budget
 *   has been hit. The UI SHOULD drop `retry` from the offered options
 *   when this is set; the engine will loop back to the menu if it
 *   receives `retry` anyway (so the worst case is the user sees the
 *   same menu twice, not an infinite retry storm).
 */
interface RecoveryContext {
    recoveryCount: number;
    retriesExhausted: boolean;
}
type ConductorEvent = {
    type: 'step_started';
    step: StepName;
    index: number;
} | {
    type: 'step_completed';
    step: StepName;
    status: StepStatus;
    tail?: string[];
    tokenUsage?: TokenUsage;
} | {
    type: 'step_failed';
    step: StepName;
    error: string;
    retryCount: number;
} | {
    type: 'step_retry';
    step: StepName;
    attempt: number;
    maxAttempts: number;
    reason: string;
} | {
    type: 'checkpoint_reached';
    step: StepName;
} | {
    type: 'recovery_needed';
    step: StepName;
    options: RecoveryOption[];
} | {
    type: 'gate_blocked';
    step: StepName;
    reason: string;
} | {
    type: 'tier_skip';
    step: StepName;
    tier: ComplexityTier;
} | {
    type: 'config_skip';
    step: StepName;
} | {
    type: 'navigation_back';
    from: StepName;
    to: StepName;
} | {
    type: 'rate_limit';
    waitSeconds: number;
} | {
    type: 'session_reset';
    reason: string;
} | {
    type: 'credentials_park';
    reason: string;
} | {
    type: 'feature_complete';
    prUrl?: string;
    featureDesc?: string;
    sessionStartedAt?: number;
} | {
    type: 'dashboard_refresh';
} | {
    type: 'auto_heal';
    step: StepName;
    healed: number;
    skipped: number;
} | {
    type: 'mode_skip';
    step: StepName;
    mode: BootstrapMode;
    reason: string;
} | {
    type: 'build_stall';
    step: StepName;
    reason: 'no_task_progress' | 'halt_marker';
    resolvedBefore: number;
    resolvedAfter: number;
} | {
    type: 'renderer_error';
    rendererName: string;
    error: string;
} | {
    type: 'when_skip';
    step: StepName;
    expression: string;
    /** Set when a `${key}` reference resolved to undefined in state. */
    undefinedKey?: string;
} | {
    type: 'parallel_started';
    step: StepName;
    branches: string[];
} | {
    type: 'parallel_completed';
    step: StepName;
    branches: string[];
} | {
    type: 'parallel_failure';
    step: StepName;
    branch: string;
    error: string;
} | {
    /** A gate's objective verdict was (re)computed by the loop. */
    type: 'gate_verdict';
    step: StepName;
    satisfied: boolean;
    reason?: string;
} | {
    /** A downstream step re-opened an upstream gate (plan/stories). */
    type: 'kickback';
    from: StepName;
    to: StepName;
    evidence?: string;
    /** How many times this gate has been re-opened this feature. */
    count: number;
} | {
    /** The gate loop stopped without converging (kickback/stuck cap). */
    type: 'loop_halt';
    reason: string;
    /**
     * URL of the auto-opened needs-remediation draft PR, when the conductor
     * irrecoverably HALTs in auto mode and escalation succeeded. Absent when
     * mode is not 'auto', on rebase-conflict halts, or when escalation could
     * not create a PR (zero commits, push failure, gh error).
     */
    prUrl?: string;
} | {
    /** The gate loop reached a fully-satisfied state (.pipeline/DONE). */
    type: 'loop_converged';
} | {
    /** The branch was already current with the base — rebase was a no-op. */
    type: 'rebase_noop';
} | {
    /** A clean rebase changed code/test paths → downstream re-verification. */
    type: 'rebase_changed';
    changedPaths: string[];
} | {
    /** A CHANGELOG-only conflict was auto-resolved (FR-7). */
    type: 'rebase_changelog_resolved';
} | {
    /** A non-trivial/mixed conflict parked the feature (FR-8). */
    type: 'rebase_conflict_halt';
    reason: string;
    conflicts: string[];
} | {
    /** One attempt at auto-resolving a conflict; index is 1-based, cap is the total budget. */
    type: 'rebase_resolution_attempt';
    index: number;
    cap: number;
} | {
    /** The conflict was successfully resolved by the auto-resolver. */
    type: 'rebase_resolution_succeeded';
} | {
    /** A single resolution attempt failed; the engine may retry up to cap. */
    type: 'rebase_resolution_failed';
} | {
    /** All resolution attempts exhausted without success — feature is halted. */
    type: 'rebase_resolution_exhausted';
};

/**
 * Claude's native reasoning effort levels — set per invocation via
 * `CLAUDE_CODE_EFFORT_LEVEL` env var. Controls adaptive thinking budget.
 *
 * Model support:
 *   - Opus 4.7: all five (low / medium / high / xhigh / max)
 *   - Opus 4.6, Sonnet 4.6: low / medium / high / max (no xhigh)
 */
type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/**
 * Artifact-review flow per step. Fixed per step (not user-configurable) —
 * set in resolved-config.ts's DEFAULT_STEP_REVIEW table:
 *   - auto: silently record approval; no prompt
 *   - manual: always prompt the user
 *   - conditional: auto-approve unless the skill wrote
 *     `.pipeline/review-required-<step>` (signalling it found issues
 *     worth human attention)
 */
type ReviewMode = 'auto' | 'manual' | 'conditional';
/**
 * Overrides that kick in when the feature's current complexity tier matches.
 * Every field is optional — unset falls back to the step/phase/default value.
 * Applied ON TOP of the step's base config at resolve time.
 */
interface TierOverride {
    model?: string;
    effort?: EffortLevel;
    max_retries?: number;
}
/**
 * A branch inside a `parallel` group. Each branch has a name and its own
 * step configuration (model, effort, skill, etc.).
 */
interface ParallelBranch {
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
interface StepConfig {
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
interface PhaseConfig {
    model?: string;
    effort?: EffortLevel;
    max_retries?: number;
    by_tier?: Partial<Record<ComplexityTier, TierOverride>>;
}
/**
 * Global defaults. Apply to every step unless the step or its phase overrides.
 */
interface DefaultsConfig {
    model?: string;
    effort?: EffortLevel;
    max_retries?: number;
}
/**
 * User-level global state: harness update channel, detected version, last
 * check timestamp. Lives in ~/.ai-conductor/config.yml. Project configs
 * should not override this block — it's per-user, not per-repo.
 */
interface ConductorConfig {
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
interface MarkdownViewerConfig {
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
interface MermaidRendererConfig {
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
interface AssessConfig {
    stale_after_days?: number;
    stale_after_commits?: number;
}
/**
 * OpenTelemetry exporter configuration. When present in HarnessConfig, the
 * OTel visualizer plugin is constructed and attached to the event bus.
 * Absent means disabled (FR-1 default-off).
 */
interface OtelConfig {
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
type SelfHostActivation = 'auto' | 'force_on' | 'force_off';
/**
 * Self-host guardrail configuration (sibling to `otel` / owner-gate keys).
 * ABSENT means the safe default: auto-detect, all gates ON. Every field is
 * optional; an omitted gate toggle defaults to ENABLED — a partial config can
 * never silently disable a guardrail (TR-11). Validated in `validateConfig()`.
 */
interface HarnessSelfHostConfig {
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
    /**
     * Timeout in minutes for OAuth token park-and-poll recovery (TR-2/3/4/5).
     * Default: 60 (one hour). When the pre-flight detects an expired operator
     * OAuth token, it parks the build and polls for token refresh until this
     * timeout elapses. 0 disables the timeout (immediate credentials-specific HALT).
     * Omitted → 60.
     */
    auth_park_timeout_minutes?: number;
}
interface HarnessConfig {
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

/**
 * Handlers may be sync or async. `emit()` awaits async handlers before
 * returning, so the engine can know the UI has finished rendering before it
 * prompts the user. Without this, an async dashboard render races with
 * readline's prompt() output and the two interleave on the terminal.
 */
type EventHandler = (event: ConductorEvent) => void | Promise<void>;
declare class ConductorEventEmitter {
    private handlers;
    /**
     * Dispatch `event` to every registered handler and await any Promises they
     * return. Handler errors are swallowed so one failing subscriber doesn't
     * crash the engine.
     */
    emit(event: ConductorEvent): Promise<void>;
    on(type: ConductorEvent['type'], handler: EventHandler): void;
    off(type: ConductorEvent['type'], handler: EventHandler): void;
    once(type: ConductorEvent['type'], handler: EventHandler): void;
    waitFor(type: ConductorEvent['type']): Promise<ConductorEvent>;
}

/**
 * Plugin system types and error classes for the conductor harness.
 */
/**
 * Valid plugin kinds in the conductor plugin system.
 */
type PluginKind = 'llm_provider' | 'ui_renderer' | 'step' | 'hook' | 'visualizer' | 'memory_provider';
/**
 * Valid plugin kinds as a list for validation and error messages.
 */
declare const VALID_PLUGIN_KINDS: readonly PluginKind[];
/**
 * Plugin manifest schema from plugin.yml.
 */
interface PluginManifest {
    kind: PluginKind;
    name: string;
    entrypoint: string;
    harness_version?: string;
    capabilities?: Record<string, unknown>;
    /**
     * Optional skill reference for LLM-facing guidance (memory_provider manifests; adr-2026-06-29-per-provider-retrieval-guidance-location).
     * When present, the harness surfaces this path so the agent can query it for context
     * on how to interact with the provider. The harness does NOT parse or index the file.
     */
    guidance?: string;
}
/**
 * A visualizer plugin subscribes to the ConductorEventEmitter as a listener
 * (via .on(...)) and exports observations to an external system (e.g. OTel).
 * It renders nothing to the terminal. Multiple visualizers may be active at once.
 *
 * Lifecycle mirrors EventPersister: start() registers listeners, stop() unregisters
 * and flushes pending data.
 */
interface VisualizerPlugin {
    /** Unique plugin name, used as the registry key. */
    readonly name: string;
    /**
     * Attach to the event emitter. Called once at run start.
     * Implementations must only call emitter.on() — never modify emission sites.
     */
    start(emitter: ConductorEventEmitter): void;
    /** Detach from the emitter and flush pending export data. Returns when flush completes. */
    stop(): Promise<void>;
}
/**
 * Error thrown when plugin manifest validation fails.
 */
declare class PluginManifestError extends Error {
    readonly filePath?: string | undefined;
    constructor(message: string, filePath?: string | undefined);
}
/**
 * Error thrown when plugin harness version requirement doesn't match.
 */
declare class PluginVersionError extends Error {
    readonly harnessVersion: string;
    readonly requiredRange: string;
    constructor(message: string, harnessVersion: string, requiredRange: string);
}
/**
 * Error thrown when plugin file or entrypoint cannot be loaded.
 */
declare class PluginLoadError extends Error {
    constructor(message: string);
}
/**
 * Error thrown when requested plugin is not found in registry.
 */
declare class PluginNotFoundError extends Error {
    readonly kind: PluginKind;
    readonly name: string;
    constructor(message: string, kind: PluginKind, name: string);
}
/**
 * Error thrown for registry state violations.
 */
declare class PluginRegistryError extends Error {
    constructor(message: string);
}

type ViewMode = 'full' | 'focus' | 'log';

interface CLIOptions {
    featureDesc?: string;
    resume: boolean;
    fresh: boolean;
    auto: boolean;
    status: boolean;
    from?: string;
    cleanup: boolean;
    step?: string;
    reset: boolean;
    output: boolean;
    cooldown: number;
    /**
     * Claude model override applied to every step. Overrides config and defaults.
     * Useful for testing ("--model haiku") or forcing a specific model across the board.
     */
    model?: string;
    /** Dashboard layout: full (default), focus (current step + tail), log (tail only). */
    view: ViewMode;
    /** Max lines of last-step stdout to display. 0 disables the tail pane. */
    tailLines: number;
    /** Run every step in interactive Claude REPL mode (no -p flag). */
    interactive: boolean;
    /**
     * Non-mutating diagnostic. Loads state for the named (or auto-detected)
     * feature, re-verifies the SHIP-phase completion predicates, and prints
     * any inconsistencies. Exits 0 when state is consistent, 1 when state
     * is marked complete but evidence is missing. Never modifies anything.
     */
    diagnose: boolean;
    /**
     * Print run summary from .pipeline/events.jsonl and exit.
     * Renders step durations, retry hotspots, and token spend tables.
     * Read-only — does NOT start a Claude session.
     */
    report: boolean;
}
declare function createProgram(): Command;
declare function parseArgs(argv: string[]): CLIOptions;

/**
 * Options carried from `conduct daemon …` into `runDaemonMode`. A subset of
 * DaemonModeOptions (projectRoot/baseBranch are supplied by the dispatcher).
 */
interface DaemonCommandOptions {
    /** Parallel workers (>= 1). Default 1. */
    concurrency: number;
    /** Stop after this many features (default: drain the backlog once). */
    maxItems?: number;
    /** Continuous: idle-poll for new features instead of draining once. */
    continuous: boolean;
    /** Global output-token ceiling across all features. */
    maxCostTokens?: number;
    /** Wall-clock ceiling in seconds. */
    maxRuntimeSeconds?: number;
    /** Idle poll interval in seconds (continuous mode). Default 5. */
    idlePollSeconds?: number;
    /** Stop after this many consecutive empty polls (continuous mode). */
    maxIdlePolls?: number;
}

/** Callable that executes tmux with the given argv and returns exit code + stdout. */
type TmuxRunner = (args: string[], opts: {
    inherit: boolean;
}) => {
    code: number;
    stdout: string;
};
declare function sessionNameForRepo(repoPath: string): string;
/** Returns true when the named tmux session exists. */
declare function hasSession(name: string, run?: TmuxRunner): Promise<boolean>;
/**
 * Result of a respawnPane call. `scrollbackPreserved` is true when the prior
 * pane history was successfully captured and will be re-emitted above the
 * relaunched daemon's boot output; false when capture failed (or returned
 * nothing) and the pane was respawned bare — callers must not claim
 * scrollback preservation in that case (FR-20).
 */
interface RespawnOutcome {
    scrollbackPreserved: boolean;
}
/**
 * Respawns the daemon pane in place (terminates the foreground process and
 * relaunches `cmd` in the SAME pane) without touching the session, window
 * layout, or any other pane. Targets the session's active pane (which is the
 * single pane created by newDetachedSession) so operator windows opened
 * later in the same session are never addressed.
 *
 * Uses respawn-pane -k to kill the existing process and re-run the command.
 * The -k flag handles killing the process; remain-on-exit (already set)
 * prevents the pane/window/session from closing.
 *
 * `respawn-pane -k` clears the pane's terminal scrollback (ADR-2026-07-04).
 * To preserve continuity, the pane's current history is captured via
 * `capture-pane -S - -p` into a temp file BEFORE respawning, and the
 * respawned command is wrapped so it re-emits that file's contents (then
 * deletes it) before exec'ing the real daemon command. This keeps the prior
 * output visible above the new process's boot messages. If capture fails for
 * any reason (tmux error, fs write error, empty scrollback), the pane is
 * respawned with the bare `cmd` — never a crash, but the caller is told via
 * the returned `scrollbackPreserved: false` so it can report the degradation
 * honestly instead of claiming scrollback was kept.
 *
 * Throws if the respawn-pane call itself exits non-zero (e.g. the targeted
 * pane no longer exists) — that is a real restart failure, distinct from a
 * scrollback-capture failure, which only degrades the outcome.
 */
declare function respawnPane(name: string, run?: TmuxRunner, cmd?: string): Promise<RespawnOutcome>;

/**
 * Resolved OTel config. A discriminated union:
 *   { enabled: false }            — exporter is off; error is set if config was invalid
 *   { enabled: true, ...fields }  — exporter is active with validated transport fields
 *
 * `resolveOtelConfig` NEVER throws. All invalid configs produce `enabled: false` + `error`.
 */
type ResolvedOtelConfig = {
    enabled: false;
    error?: string;
} | {
    enabled: true;
    exporter: 'otlp';
    endpoint: string;
    protocol?: 'http/protobuf' | 'grpc';
} | {
    enabled: true;
    exporter: 'file';
    file: string;
};

/**
 * OtelVisualizer — visualizer plugin that exports conductor events as OTel
 * traces and metrics.
 *
 * Packaging: implements VisualizerPlugin (types/plugin.ts). Constructed and
 * started only when resolveOtelConfig().enabled (FR-1 gate in index.ts).
 *
 * Architecture (ADR-014 / R1):
 *  - Subscribes to the ConductorEventEmitter via .on(). Handlers are
 *    synchronous — they call OTel span/metric APIs that enqueue to the
 *    BatchSpanProcessor / PeriodicExportingMetricReader. No await, no
 *    network call happens inline (emit() awaits handlers; blocking here
 *    stalls the bus).
 *  - stop() calls forceFlush() on both providers. This IS awaited — it
 *    happens after the run, not on the hot path. shutdown() is intentionally
 *    NOT called so that InMemorySpanExporter retains spans for test assertions.
 *
 * Dependency injection:
 *  - ctx.spanExporter / ctx.metricExporter: override the transport exporters
 *    (used in tests to inject InMemorySpanExporter / InMemoryMetricExporter).
 *  - When not provided, exporters are built from the resolved config via
 *    buildExporters() (OTLP or file transport).
 *
 * Error isolation (FR-8):
 *  - All export / flush errors are caught and surfaced via ctx.onWarning at
 *    most ONCE (bounded). The run is never affected by transport failures.
 */

interface OtelVisualizerContext {
    /** Deterministic run ID. When absent, buildResource() resolves from the session file. */
    runId?: string;
    /** Path to the .pipeline directory (for session-id file when runId absent). */
    pipelineDir?: string;
    /** Feature name for resource attributes. */
    feature: string;
    /** Project name for resource attributes. */
    project: string;
    /** Inject a span exporter (replaces transport; used in tests). */
    spanExporter?: SpanExporter;
    /** Inject a metric exporter (replaces transport; used in tests). */
    metricExporter?: PushMetricExporter;
    /** Optional warning callback. Receives O(1) warning strings; never throws. */
    onWarning?: (msg: string) => void;
    /**
     * Timeout (ms) for a single export call. If an endpoint does not respond
     * within this bound the export is abandoned and a warning is emitted.
     * Defaults to EXPORT_TIMEOUT_MS (5 000 ms). Override in tests to keep
     * test suite fast even with a hung/refused transport.
     */
    exportTimeoutMillis?: number;
}
/**
 * The OTel visualizer plugin. Attach to the event bus via start(); detach and
 * flush via stop(). Only construct when resolveOtelConfig().enabled (FR-1).
 */
declare class OtelVisualizer implements VisualizerPlugin {
    readonly name = "otel";
    private readonly tracerProvider;
    private readonly meterProvider;
    private readonly spanManager;
    private readonly metricsRecorder;
    /**
     * Bounded warning emitter (FR-8). When ctx.onWarning is provided, this is a
     * once-wrapper shared by both the exporter callback path AND the stop() flush
     * catch path — so exactly ONE warning fires regardless of how the failure
     * manifests.
     */
    private readonly warnOnce?;
    /** Registered handlers, kept for potential off() cleanup (currently no off needed). */
    private emitter;
    /**
     * Promise from the first stop() call. Set on first invocation; all subsequent
     * calls return the same promise (idempotent — no double-flush, no deadlock).
     */
    private stopPromise;
    /**
     * Bound signal handler. Stored so it can be unregistered in stop() without
     * leaking across OtelVisualizer instances or test runs.
     */
    private sigHandler;
    constructor(config: ResolvedOtelConfig, ctx: OtelVisualizerContext);
    /**
     * Stash tokenUsage from step_completed events so the SpanManager's onStepClose
     * callback can pass it to MetricsRecorder. Keyed by step name.
     */
    private readonly pendingTokenUsage;
    /**
     * Attach to the emitter. Called once at run start.
     * All handlers return void (synchronous) to keep emit() non-blocking (R1).
     *
     * Also registers SIGINT/SIGTERM handlers that call stop() on process termination
     * (T21). Handlers are unregistered in stop() to prevent leaks across instances.
     */
    start(emitter: ConductorEventEmitter): void;
    /**
     * Force-close open spans (FR-9), flush the batch processors, and optionally
     * shut down providers. Idempotent — safe to call from signal handlers or
     * directly; subsequent calls return the same promise from the first invocation
     * (not a new wrapper — callers can use reference equality to detect re-entry).
     *
     * NOTE: We intentionally call forceFlush() ONLY and NOT shutdown() here.
     * BatchSpanProcessor.shutdown() calls exporter.shutdown() which clears
     * InMemorySpanExporter._finishedSpans — making spans unreadable after stop().
     * Callers (tests, acceptance spec) read spans AFTER stop(), so we must not
     * clear the exporter. In production (OTLP / file), the process exits after
     * stop() so the providers are GC'd naturally.
     */
    stop(): Promise<void>;
    /** Internal flush implementation. Only ever called once (guarded by stopPromise). */
    private _doStop;
    private handleEvent;
}

declare function deriveMode(opts: {
    auto: boolean;
    interactive: boolean;
}): RunMode;

/**
 * Start every visualizer plugin by calling `.start(emitter)`. Returns the same
 * array (for chaining). Called immediately after EventPersister is started.
 */
declare function buildVisualizers(visualizers: VisualizerPlugin[], emitter: ConductorEventEmitter): VisualizerPlugin[];
/**
 * Stop every visualizer plugin, swallowing individual errors so one failing
 * exporter cannot prevent the others from flushing.
 */
declare function stopVisualizers(visualizers: VisualizerPlugin[]): Promise<void>;
/**
 * Build the options object passed into `runDaemonMode` for a `daemon` CLI
 * invocation (FR-9 wiring). Wires the self-restart callback when this daemon
 * is running under a tmux session (started via `daemon start`): at idle
 * boundary a queued restart fires respawn-in-place instead of falling through
 * to the T30 bare-run consume-and-exit path. No session (e.g. `conduct daemon`
 * run directly in a foreground shell) → leave triggerSelfRestart undefined,
 * preserving the bare-run behavior.
 *
 * Extracted as a pure(ish) function — with the tmux helpers as injectable deps
 * — so tests can exercise the REAL dispatch logic (which fields end up in the
 * options object under which `hasSession` outcome) without invoking main() or
 * a real tmux binary.
 */
declare function buildDaemonModeOptions(projectRoot: string, daemonCmd: DaemonCommandOptions, deps?: {
    sessionNameForRepo: typeof sessionNameForRepo;
    hasSession: typeof hasSession;
    respawnPane: typeof respawnPane;
}): Promise<DaemonCommandOptions & {
    projectRoot: string;
    triggerSelfRestart?: () => Promise<void>;
}>;
/**
 * Construct an OtelVisualizer with production wiring (FR-8).
 *
 * Bridges `onWarning` to a `renderer_error` ConductorEvent on the shared bus so
 * transport failures surface to the operator as structured events instead of
 * silent drops. Constructor errors (e.g. disabled config passed by mistake) are
 * caught, surfaced as `renderer_error`, and null is returned so the run proceeds
 * with OTel disabled.
 *
 * Exported so integration tests can drive the exact production construction path
 * and verify the onWarning wiring without invoking main().
 */
declare function createOtelVisualizer(resolved: ResolvedOtelConfig, ctx: Omit<OtelVisualizerContext, 'onWarning'>, events: ConductorEventEmitter): OtelVisualizer | null;

export { type ArtifactApproval, type AssessConfig, type BootstrapMode, type CLIOptions, type ComplexityTier, type ConductState, type ConductorConfig, type ConductorEvent, type DefaultsConfig, type EffortLevel, type EnforcementLevel, type HarnessConfig, type HarnessSelfHostConfig, type MarkdownViewerConfig, type MermaidRendererConfig, type OtelConfig, type ParallelBranch, type Phase, type PhaseConfig, type PluginKind, PluginLoadError, type PluginManifest, PluginManifestError, PluginNotFoundError, PluginRegistryError, PluginVersionError, type RecoveryContext, type RecoveryOption, type ReviewMode, type RunMode, type SelfHostActivation, type StateError, type StateResult, type StepConfig, type StepDefinition, type StepName, type StepStatus, type TaskStatus, type TaskStatusFile, type TierOverride, type Track, VALID_PLUGIN_KINDS, type ViewMode$1 as ViewMode, type VisualizerPlugin, buildDaemonModeOptions, buildVisualizers, createOtelVisualizer, createProgram, deriveMode, parseArgs, stopVisualizers };
