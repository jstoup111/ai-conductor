# PRD: Monitor guided sessions — choose provider, model, and effort

**Date:** 2026-10-06
**Status:** Approved

> **Product-only.** State goals and requirements (the *what* and *why*). Do NOT name the *new
> internal mechanism* for this feature — commands/flags, file paths, config keys, function/class/type
> names, library/protocol/mechanism choices, schemas, ports. Name capabilities/behaviors instead, and
> put any load-bearing technical choice under **Open Questions** for architecture-review. Pre-existing
> *external* constraints/dependencies may be named under Dependencies / Non-Functional Requirements.

Source: jstoup111/ai-conductor#2985.

## Problem / Background

The monitor's guided triage session — the interactive session an operator opens to work a queued
daemon halt — always runs on the project's primary build provider, and it never selects a model or
an effort level, so the provider's own CLI defaults decide both. An operator therefore cannot:

- triage on a different (or cheaper) provider or model than the one builds use, without changing
  the build's provider selection;
- see which model and effort the triage session is actually running with.

Projects whose primary build provider is one the monitor cannot launch interactively (Pi today) get
an opaque "unregistered provider" failure rather than a clear refusal naming the unsupported
capability. Every halt the monitor queues is affected, and halt triage is the operator's main
recovery loop.

## Goals & Non-Goals

**Goals**
- An operator can choose the provider, model, and effort for monitor guided sessions independently
  of the provider/model/effort used for builds — both persistently for a project and for a single
  monitor run.
- With nothing configured, a guided session still opens with no extra setup, using the build
  provider and a harness-stated, named default model and effort.
- The provider, model, and effort actually applied are visible to the operator at launch.
- An unsupported selection fails fast with a message naming the offending value and provider —
  never silently dropped.
- Guided sessions and the composer's interactive launch share one definition of how a provider is
  launched interactively, so the two cannot drift.

**Non-Goals**
- Making Pi launchable as an interactive session (owned by #1007).
- Maintaining an allowlist of valid model identifiers for providers that publish no authoritative
  model catalog.
- Changing how the build's provider, model, or effort is selected or resolved.
- Adding model/effort selection to the composer launcher (it benefits from the shared launch
  definition later, but its operator surface is unchanged here).

## Users / Personas

- **Harness operator** running the monitor to triage daemon halts across one or more projects; wants
  triage on a model/effort suited to diagnosis (often different from the build's) and wants to know
  what the session is running on.

## Functional Requirements

**Selection & precedence**

- **FR-1:** An operator can persistently set, per project, the provider used for monitor guided
  sessions, separately from the build's provider selection. Changing it does not change which
  provider builds use.
- **FR-2:** An operator can persistently set, per project, the model and the effort level used for
  monitor guided sessions. Each may be set independently of the other and of the provider.
- **FR-3:** An operator can override the guided-session provider, model, and effort for a single
  monitor run from the command line, without editing project configuration. A per-run override takes
  precedence over the persisted setting for that run only.
- **FR-4:** When no guided-session provider is set (persistently or per run), guided sessions use
  the first provider of the build's provider selection — today's behavior.
- **FR-5:** When no guided-session model or effort is set, the session uses a harness-stated default
  model and effort for the resolved provider: the defaults that provider's model policy assigns to
  interactive exploration work. The default is a concrete named value, not "whatever the provider CLI
  picks".
- **FR-6:** A persisted model or effort that was chosen for one provider is not silently carried onto
  a different provider selected by a per-run override; when the provider is overridden for a run
  without also overriding model/effort, the overriding provider's harness-stated defaults apply.

**Applied & visible**

- **FR-7:** The resolved model and effort are actually applied to the launched interactive session
  for every provider that supports interactive launch (Claude and Codex today).
- **FR-8:** Before the session starts, the monitor's launch output states the provider, model, and
  effort being applied, and for each indicates whether it came from a per-run override, project
  configuration, or the harness default.

**Validation & refusal**

- **FR-9:** An effort level the resolved provider does not accept is rejected before any session is
  launched, with an error naming the effort value and the provider. Each provider declares the effort
  levels it accepts.
- **FR-10:** A model value that is empty or not a well-formed model identifier is rejected before any
  session is launched, with an error naming the value and the provider. For a provider that publishes
  an authoritative model catalog, a model absent from that catalog is likewise rejected. A
  well-formed model for a provider with no catalog is passed through unvalidated.
- **FR-11:** A provider that is not a built-in provider is rejected before launch with an error
  naming it (today's behavior preserved).
- **FR-12:** Selecting a built-in provider that does not support interactive launch (Pi today) is
  refused before launch with a clear message naming the provider and the missing interactive-launch
  capability, rather than the generic "unregistered provider" failure.
- **FR-13:** Invalid persisted guided-session settings (an unknown provider, an effort outside the
  harness's effort vocabulary) are reported when project configuration is loaded, naming the setting
  and value, consistent with how other configuration errors are reported.
- **FR-14:** Every rejection or refusal in FR-9 through FR-13 leaves the monitor queue and halt state
  unchanged and exits non-zero; no partial session is started.

**Single launch definition**

- **FR-15:** Monitor guided sessions and the composer's interactive launch derive each provider's
  interactive launch invocation (executable, permission mode, prompt, model, effort) from one shared
  provider definition; the monitor no longer carries its own separate launch table. The composer's
  existing interactive launch behavior is unchanged.

## Non-Functional Requirements

- **Isolation:** guided sessions remain operator-owned interactive sessions; they must not carry the
  daemon-session marker, and their launch remains bypassing the non-interactive build adapters (as
  today).
- **Determinism:** resolution of provider/model/effort is pure given configuration and per-run input;
  testable without spawning a provider process.
- **Backward compatibility:** a project with no guided-session settings behaves as today except that
  a concrete default model and effort are now applied and displayed.

## Acceptance Criteria / Success Metrics

- Every FR is covered by a passing automated test that exercises the monitor command path with a
  mocked process boundary.
- With a project configured for a triage provider/model/effort different from the build's, a
  monitor guided session launches with those values, and the build's selection is unchanged.
- With nothing configured, a guided session launches on the build provider with the stated defaults,
  and the launch output names them.
- Selecting Pi, an unaccepted effort, or a malformed model each fails before launch with a message
  naming the value and provider.
- The composer's interactive launch tests pass unchanged.

## Scope

### In Scope
- Persistent per-project guided-session provider/model/effort settings, with config-load validation.
- Per-run overrides for provider/model/effort on the monitor command.
- Harness-stated per-provider defaults for model and effort.
- Per-provider accepted-effort declarations and model-shape/catalog validation.
- Launch output naming applied values and their source.
- One shared interactive launch definition for monitor and composer; retirement of the monitor's
  separate launch table.
- Operator documentation for the new settings and overrides.

### Out of Scope
- Pi interactive launch (#1007).
- Model allowlists for providers without an authoritative catalog.
- Any change to build provider/model/effort resolution.
- New composer-launcher options for model/effort.

## Key Decisions & Rationale

- **Separate from the build selection, falling back to it.** Triage is a different workload from
  building; coupling them forced operators to change builds to change triage. Falling back keeps
  zero-config behavior working.
- **Named defaults, not provider-CLI defaults.** The issue requires the applied model and effort be
  visible; a concrete harness-stated default can be displayed and reasoned about, "provider default"
  cannot. Interactive exploration work is the closest existing workload to halt triage.
- **Strict effort, lenient model.** Effort levels are a small, known set per provider, so strict
  checking catches real mistakes. Claude and Codex publish no authoritative model catalog, so a
  strict model allowlist would block newly released models; shape validation catches empty/garbled
  values without that cost.
- **Refuse Pi clearly rather than enable it.** Enabling Pi interactive launch also changes the
  composer and is already tracked by #1007; the operator chose the balanced scope.
- **One launch definition.** A second launch table is how this gap arose; consolidating prevents the
  monitor and composer drifting again.

## Dependencies

- Existing provider CLIs' interactive modes and their native ways of selecting a model and effort
  level (Claude Code, Codex CLI) — external constraints the launch must live within.
- Existing project configuration loading/merging and its error reporting.
- The existing provider catalog and per-provider model policy (source of default model/effort).
- #1007 — Pi interactive launch (not required; this feature refuses Pi until it lands).

## Open Questions

- **Where the shared launch definition lives and how it expresses model/effort** (extending the
  provider catalog's existing interactive-launch descriptor vs a separate launch module the catalog
  references) — trade-off for architecture-review; explore's selected approach favors the catalog.
- **Which per-provider accepted effort sets are correct** (e.g. whether Codex accepts the harness's
  highest levels, and whether Claude's interactive mode honors every harness effort level) — must be
  verified against each CLI during architecture-review/build.
- **How effort reaches an interactive Claude session** (the non-interactive adapter passes it
  through the environment rather than an argument) — the shared definition must cover environment as
  well as arguments; architecture-review to confirm.
- ~~FR-6 precedence~~ — resolved: operator approved (2026-10-06) that a per-run provider override resets model and effort to that provider's defaults unless each is explicitly overridden too.
