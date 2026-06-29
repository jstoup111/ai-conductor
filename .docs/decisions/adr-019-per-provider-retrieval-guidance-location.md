# ADR 019: Per-Provider Retrieval Guidance Location

**Date:** 2026-06-29
**Status:** DRAFT
**Deciders:** James (operator), Claude (architecture-review)

## Context

FR-4 requires each **non-default** platform to carry the LLM-facing guidance needed to recall from and
persist to it, and that guidance to be **in effect when the platform is active**. FR-9 requires the
default platform to keep today's behavior (its guidance is the existing `skills/memory/SKILL.md`, no
separate guidance needed). Story FR-4 negative path: missing/incomplete non-default guidance must yield
a **defined safe behavior**, not silent incorrect behavior. Open Question 5 asks *where per-platform
retrieval guidance lives — bundled with each platform vs. a central, source-aware skill*.

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

### Option A: Guidance bundled with the provider plugin; activated via the skill-override mechanism
- **How:** Each non-default `memory_provider` plugin ships a guidance document (referenced from its
  `plugin.yml`, ADR-015). When that provider is the active one, the harness activates its guidance for
  the `/memory` skill by routing through the existing skill-override resolution (the provider's
  guidance overrides/augments the default `skills/memory/SKILL.md` body for recall/persist). The
  **default** provider supplies **no** override — the base skill is its guidance (FR-9).
- **Pros:** Provider is self-describing (PRD KD-3, FR-4); reuses the existing override mechanism rather
  than inventing distribution; default path unchanged; guidance stays prose for the agent (FR-3-safe).
- **Cons:** Depends on the skill-override mechanism (ST-060/061) being available; activation must be
  keyed to the *resolved active provider* (ADR-016), not a static project override.

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

Adopt **Option A**: **per-provider guidance is bundled with the provider plugin and activated through
the existing skill-override mechanism, keyed to the resolved active provider.**

- The **default** provider ships no override; `skills/memory/SKILL.md` *is* its guidance, unchanged
  (FR-9).
- A **non-default** provider's `plugin.yml` references a guidance document; when that provider is
  active (per ADR-016 resolution), its guidance is in effect for recall/persist (FR-4).
- **Missing/incomplete guidance → defined safe degradation (FR-4 negative path):** if an active
  non-default provider supplies no usable guidance, the harness surfaces a clear warning and the
  `/memory` skill falls back to **default-platform recall/persist semantics** (read-and-judge against
  the available store) rather than attempting unguided, possibly-incorrect provider operations. This is
  a known, safe degradation — never silent misbehavior.
- Activation keys on the **resolved active provider** (ADR-016), so switching providers switches
  guidance for subsequent memory operations (FR-10 "switching does not break behaviors").

Why: it makes each provider a self-describing unit (PRD KD-3, FR-4) and reuses the harness's own
skill-override path for varying guidance, while keeping the default and FR-3 invariant untouched.

## Consequences

### Positive
- Providers are self-describing; adding one needs no edit to the core `/memory` skill (FR-4, KD-3).
- Default behavior is literally unchanged (FR-9).
- Missing-guidance degradation is explicit and safe (FR-4 negative path).

### Negative
- Depends on the skill-override mechanism (ST-060/061); if that isn't ready, a thin transport
  (Option C) is the fallback for *activating* the provider's guidance — track as a dependency.
- The override must be driven by the **runtime-resolved** active provider, not a static project file —
  a small extension to the override resolver (key on active provider).

### Follow-up Actions
- [ ] Define the `plugin.yml` `guidance` reference for `memory_provider` plugins (ADR-015).
- [ ] Extend skill-override resolution to key on the resolved active `memory_provider` (ADR-016),
      or specify the conductor-injection transport (Option C) if override-by-active-provider isn't
      available yet.
- [ ] Specify the missing-guidance safe-degradation path in the `/memory` skill.
- [ ] Confirm the default provider supplies no override and the base skill is unchanged (FR-9 parity).
