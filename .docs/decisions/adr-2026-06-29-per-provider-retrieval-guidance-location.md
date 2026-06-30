# ADR: Per-Provider Retrieval Guidance Location

**Date:** 2026-06-29
**Status:** APPROVED
**Deciders:** James (operator), Claude (architecture-review)

> **Model (operator decision, 2026-06-29):** a memory-guidance **skill exists for every provider —
> including the default** — and the harness **selects the skill that matches the installed/active
> provider**. This is a uniform per-provider-skill selection, not a "default base + non-default
> override" split. The default provider's skill is today's `skills/memory/SKILL.md`.

## Context

FR-4 requires each **non-default** platform to carry the LLM-facing guidance needed to recall from and
persist to it, and that guidance to be **in effect when the platform is active**. FR-9 requires the
default platform to keep today's behavior (its guidance is the existing `skills/memory/SKILL.md`, which
in this model is simply the **default provider's skill**). Story FR-4 negative path: missing/incomplete
provider guidance must yield a **defined safe behavior**, not silent incorrect behavior. Open Question 5
asks *where per-platform retrieval guidance lives — bundled with each platform vs. a central,
source-aware skill*.

The operator's answer: **every provider has its own memory-guidance skill (the default included), and
the harness picks the skill matching the installed/active provider.** Selection — not a central skill
that branches internally, and not a "default-is-special" asymmetry.

Forces:
- Guidance is **LLM-facing prose** (how to recall/persist on this platform), the same medium as
  `skills/memory/SKILL.md` — it should be authored and delivered as skill content, not code.
- The harness already has (planned) a **skill-override mechanism**: project `.harness/skills/<name>/`
  overrides harness `skills/<name>/`, with resolution order project > harness (ST-060), plus skill
  hooks that wrap a skill (ST-061). This is the existing way to vary skill guidance.
- FR-3 forbids the harness from doing retrieval; guidance must instruct *the agent*, never add harness
  logic.
- A provider is "a usable, self-describing unit" (PRD Key Decision 3) — adopting it should also supply
  its guidance, so guidance naturally **travels with the provider plugin**.

## Options Considered

### Option A (chosen): A memory-guidance skill per provider; the harness selects the one for the active/installed provider
- **How:** Each `memory_provider` — **default and non-default alike** — has a corresponding
  memory-guidance skill. The default provider's skill is today's `skills/memory/SKILL.md`; a non-default
  provider ships its own skill (bundled with its plugin and present once installed, referenced from its
  `plugin.yml`, adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration). At run start the harness **selects the skill matching the resolved active
  provider** (adr-2026-06-29-per-project-memory-provider-selection) and that skill's recall/persist guidance is what the `/memory` step uses.
  Mechanically this is the existing skill-resolution/override path keyed on the active provider (project
  `.harness/skills/` > harness `skills/`, ST-060/061), but the *model* is uniform selection: one skill
  per provider, pick by installed provider.
- **Pros:** Every provider is self-describing (PRD KD-3, FR-4); the default is not a special case — it
  is just "the skill for `local`"; switching providers switches skills (FR-10); guidance stays prose
  for the agent (FR-3-safe).
- **Cons:** Depends on skill-resolution (ST-060/061) being able to key on the *runtime-resolved* active
  provider, not a static project file (a small resolver extension); a provider that ships no skill must
  degrade safely (below).

### Option B: One central, source-aware `/memory` skill with a per-provider section it self-selects
- **How:** The single skill contains guidance blocks for every known provider and picks the active
  one.
- **Cons:** Not self-describing — adding a provider means editing the core skill (violates PRD KD-3 /
  FR-4 "platform carries its own guidance"); the core skill grows unboundedly; couples the harness to
  every provider. Rejected.

### Option C: Guidance injected as runtime context by the conductor
- **Cons:** Possible, but spreads memory guidance across conductor code rather than the skill medium;
  harder for an operator to read/author; weaker "self-describing unit." Kept only as the *transport*
  detail if the override mechanism can't key on the active provider. Not preferred.

## Decision

Adopt **Option A**: **a memory-guidance skill exists for every provider (default included), and the
harness selects the skill matching the installed/active provider.**

- **Default = `local`'s skill:** today's `skills/memory/SKILL.md` is simply the skill selected when the
  active provider is `local` — behavior-identical to today (FR-9), no special-casing.
- **Non-default = the provider's own skill:** a non-default provider ships its memory-guidance skill
  (bundled with its plugin, referenced from `plugin.yml`, present once installed). When that provider is
  the resolved active one (adr-2026-06-29-per-project-memory-provider-selection), its skill's recall/persist guidance is in effect (FR-4).
- **Selection keys on the resolved active provider** (adr-2026-06-29-per-project-memory-provider-selection), so switching providers switches the
  selected skill for subsequent memory operations (FR-10 "switching does not break behaviors").
- **Missing skill for an active provider → defined safe degradation (FR-4 negative path):** if the
  active provider has no usable guidance skill, the harness surfaces a clear warning and the `/memory`
  step falls back to **default (`local`) recall/persist semantics** (read-and-judge against the
  available store) rather than attempting unguided, possibly-incorrect provider operations — a known,
  safe degradation, never silent misbehavior.

Why: a skill-per-provider with selection-by-active-provider makes every provider self-describing
(PRD KD-3, FR-4), removes the default-is-special asymmetry, and reuses the harness's own
skill-resolution path — while keeping the FR-3 invariant (guidance is prose for the agent, no harness
retrieval logic) untouched.

## Consequences

### Positive
- Every provider is self-describing; adding one ships its own skill, no edit to a central skill (FR-4, KD-3).
- The default is not special — it is `local`'s skill, behavior unchanged (FR-9).
- Missing-skill degradation is explicit and safe (FR-4 negative path).

### Negative
- Depends on the skill-override mechanism (ST-060/061); if that isn't ready, a thin transport
  (Option C) is the fallback for *activating* the provider's guidance — track as a dependency.
- The override must be driven by the **runtime-resolved** active provider, not a static project file —
  a small extension to the override resolver (key on active provider).

### Follow-up Actions
- [ ] Define how each `memory_provider` plugin ships its guidance skill (the `plugin.yml` reference, adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration).
- [ ] Treat `skills/memory/SKILL.md` as the `local` provider's skill (no behavior change, FR-9).
- [ ] Extend skill resolution to **select the skill matching the resolved active `memory_provider`**
      (adr-2026-06-29-per-project-memory-provider-selection), or specify the conductor-injection transport (Option C) if select-by-active-provider
      isn't available yet.
- [ ] Specify the missing-skill safe-degradation path (fall back to `local` semantics + warning).
