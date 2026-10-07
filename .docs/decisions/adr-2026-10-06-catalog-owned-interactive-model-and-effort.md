# ADR: The provider catalog owns interactive model and effort selection

**Date:** 2026-10-06
**Status:** APPROVED
**Deciders:** James Stoup (operator), composer DECIDE for jstoup111/ai-conductor#2985

<!-- Filename convention: adr-{{DATE}}-<kebab-slug>.md (no sequential numbers).
     The ADR's identifier is its filename stem — cite that when superseding or referencing. -->

## Context

Monitor guided sessions (#2985) must launch with an operator-chosen provider, model, and effort.
Today two modules know how to build an interactive provider invocation:

- the provider catalog's `interactiveLaunch` descriptor
  (adr-2026-09-24-built-in-provider-catalog-and-boot-discovery D9), consumed by the composer
  launcher in `engineer-cli.ts`; its `argv(prompt, env)` reads `CONDUCT_ENGINEER_PERMISSION_MODE`
  for Claude;
- a private per-provider table inside the monitor's interactive launch seam
  (`execution/interactive-launch.ts`), which adr-2026-09-20-operator-launched-sessions-retain-conductor-authority
  D3 makes the sole spawn point for monitor sessions. It hardcodes Claude's permission mode to
  `default` and has no Pi entry.

Neither carries a model or an effort. The non-interactive adapters already map both per provider
(Claude `--model` plus the `CLAUDE_CODE_EFFORT_LEVEL` env var; Codex `--model` plus
`--config model_reasoning_effort="…"`; Pi `--model` plus `--thinking`). Adding model/effort to the
monitor's private table would create a third copy of that mapping.

Evidence gathered for this decision:

- Claude Code 2.1.291 `claude --help` lists `--model <model>` and
  `--effort <level>` with values `low, medium, high, xhigh, max` for the interactive session
  (verified locally, 2026-10-06). Interactive Claude therefore takes effort as an argument; the env
  var path is not needed.
- Codex CLI 0.159.2 `codex --help` lists `-m, --model` and `-c, --config <key=value>`. Codex's
  `ReasoningEffort` enum (`codex-rs/protocol/src/openai_models.rs`, via Context7 `/openai/codex`)
  accepts `none, minimal, low, medium, high, xhigh, max, ultra, persistent`. That is a superset of
  the harness vocabulary, but each model advertises its own `supported_reasoning_levels` subset.
- The harness effort vocabulary is `low|medium|high|xhigh|max` (`engine/config.ts` `VALID_EFFORTS`).
  Both the Claude and Codex model policies use the full five-level `effortOrder`.
- The Claude policy's `explore` step is `opus`/`high`; Codex's is `gpt-5.6-sol`/`high`
  (`engine/provider-model-policy-defaults.ts`).

## Options Considered

### Option A: Extend the monitor seam's private table
- **Pros:** Smallest diff; the composer is untouched.
- **Cons:** Two interactive invocation tables keep drifting (the Pi gap and the hardcoded
  permission mode are already drift). The per-provider model/effort flag mapping exists twice.
  Validity rules (accepted efforts) would live in a launch module rather than with the provider.

### Option B: Extend the catalog's `interactiveLaunch` descriptor; the seam derives from it
- **Pros:** One owner per provider for its interactive invocation and its accepted values. The
  seam stays the sole monitor spawn point (adr-2026-09-20 D3) and only stops owning
  provider-specific argv. Pi remains refused by the same D9 capability rule.
- **Cons:** Changes the shape of a shared contract, so the composer call site must adapt.

### Option C: Route the composer through the monitor seam too
- **Pros:** One spawn point for everything.
- **Cons:** adr-2026-09-20 D8 (amendment, 2026-10-03) explicitly exempts the composer, and the
  operator previously refused it as over-scope. Rejected.

## Decision

1. **The catalog's interactive-launch capability is the single owner of every provider's
   interactive invocation, including model and effort.** The descriptor's argv builder takes one
   explicit options value: the opening prompt, an optional model, an optional effort, and the
   permission mode for providers that have one. It no longer reads the process environment itself.
   Claude renders `--permission-mode «mode»`, then `--model «model»` and `--effort «effort»` when
   present, then the prompt. Codex renders `--model «model»` and
   `--config model_reasoning_effort="«effort»"` when present, then the prompt. The composer call
   site resolves its permission mode from `CONDUCT_ENGINEER_PERMISSION_MODE` as today and passes it
   in, passing no model or effort, so its invocation is byte-for-byte unchanged.

2. **Each interactive-capable descriptor declares the effort levels it accepts.** Today Claude and
   Codex both declare the full harness vocabulary `low, medium, high, xhigh, max`, as the evidence
   above supports. The declaration exists so that a provider whose accepted set is narrower is
   rejected before spawn, naming the value and the provider. It is not a promise about per-model
   support: a model that rejects a level the provider CLI accepts surfaces the CLI's own error at
   launch. Per-model effort tables are out of scope.

3. **The monitor seam builds its invocation from the descriptor and keeps no per-provider table.**
   The seam (adr-2026-09-20 D3/D4) remains the sole spawn point for monitor guided sessions and
   keeps its terminal check and its ENOENT handling. It resolves the executable through the catalog
   and asks the descriptor for argv, passing the permission mode `default` explicitly, which
   preserves today's monitor behavior. A provider without the capability is refused with a message
   naming the provider and `interactiveLaunch`, consistent with D9's refusal (#1007), not the
   generic "unregistered provider" message.

4. **Guided-session selection is resolved once, purely, before any spawn.** A resolver takes the
   per-run overrides, the project's guided-session settings, and the build provider selection, and
   returns either a refusal or a selection whose provider, model, and effort each carry the source
   they came from: override, config, or default. Precedence is per-run override, then project
   guided-session setting, then the build selection's first provider. A per-run provider override
   without its own model/effort overrides resets both to that provider's defaults (PRD FR-6).
   Defaults are the provider's built-in model-policy values for the `explore` step. They are not
   re-resolved through project step overrides, because guided triage is not the `explore` step and
   must not silently follow a DECIDE pin.

5. **Model values are checked for shape, never against an allowlist, except where the provider has
   an authoritative model catalog.** A well-formed model is non-empty, contains no whitespace or
   control characters, and does not begin with `-`, so it can never be parsed as a CLI option. A
   provider that declares a model catalog (Pi today) also requires membership; Pi is refused for
   lack of interactive launch before this check would apply.

## Consequences

### Positive
- One place answers "how does provider X start an interactive session with model M and effort E".
- The monitor gains model/effort with no new spawn path; the composer is ready to gain them later
  without another table.
- Refusals are mechanical and fire before spawn.

### Negative
- The interactive argv contract changes shape, so every consumer and its tests must move together.
- Accepted-effort declarations are provider-level, so per-model mismatches still surface only at
  launch, from the provider CLI.
- Defaults come from built-in policy, not project step overrides. An operator who wants triage to
  follow a project's `explore` pin must set the guided-session setting explicitly.

### Follow-up Actions
- [ ] Extend the catalog `interactiveLaunch` type with an options-based argv builder and an
      accepted-efforts declaration; update the Claude and Codex descriptors.
- [ ] Adapt the composer call site to pass its permission mode explicitly; prove its argv is unchanged.
- [ ] Retire the seam's private table; the seam derives its invocation from the descriptor.
- [ ] Add the pure guided-session resolver and wire it into the monitor command before queue
      processing.
