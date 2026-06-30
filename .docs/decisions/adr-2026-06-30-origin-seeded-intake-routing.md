# ADR: Origin-seeded routing for GitHub-intake ideas (human gate preserved)

**Date:** 2026-06-30
**Status:** APPROVED
**Deciders:** James (solo dev) + harness architecture-review
**Amends:** adr-008-agent-hosted-loop-and-in-chat-authoring (routing surface DS-2; ADR-007 is
already SUPERSEDED by ADR-008 and is not the target)
**Feature:** Background Auto-Intake on the Conduct Loop (spec 2026-06-30, FR-3)

<!-- Filename stem is the identifier: adr-2026-06-30-origin-seeded-intake-routing -->

## Context

ADR-008 establishes the engineer loop as agent-hosted and **human-gated**, retaining ADR-007's
routing **discriminated union** (`confirmed | redirected | create | declined`, exhaustive switch,
zero-writes-on-decline) with the proposal produced by **LLM inference over the registry**
(idea × {name, remote, path, recent features} → ranked candidate + rationale, human confirms).

The background-intake feature (FR-3) auto-routes a captured idea to its **originating repo**: a
GitHub issue filed on `owner/X` belongs to `owner/X`. This is mechanical and unambiguous — and it
must be, because the brain loop is zero-token (FR-9) and runs with no human present. The tension:
ADR-008's routing proposal is an LLM-over-registry inference confirmed interactively; auto-routing
sets a target without that inference and without a confirmation at capture time.

## Options Considered

### Option A: Origin seeds the routing proposal; human still confirms/redirects at DECIDE-claim
- **Pros:** Deterministic + zero-token for the unambiguous case (issue→its repo); preserves the
  ADR-008 human gate (the operator can `redirect`/`decline` when they claim the idea for DECIDE);
  no LLM call needed for origin-bearing ideas.
- **Cons:** The "confirm routing" gate moves from *before capture* to *at DECIDE-claim*; the routing
  union must accept a pre-seeded target rather than always inferring from scratch.

### Option B: Keep ADR-008 unchanged — origin is only a non-binding hint; LLM infers from scratch
- **Pros:** No amendment.
- **Cons:** Spends an LLM call (breaks FR-9 zero-token intent) to re-derive an answer the issue
  origin already gives unambiguously; less automation value.

## Decision

**Option A.** For an idea captured from a GitHub issue, the brain loop sets the routing **proposal**
to the originating repo (mechanically, via the envelope's origin/source-ref). The ADR-008 routing
**discriminated union and human gate are unchanged**: when the operator claims the idea for DECIDE,
the pre-seeded target is presented and they may `confirmed` (accept), `redirected` (choose another
registered repo), or `declined` (drop, zero writes). Only the *proposal source* changes — origin
instead of LLM-over-registry — and only for origin-bearing intake ideas. Chat/CLI ideas without an
origin keep ADR-008's LLM-over-registry inference unchanged.

We chose A because origin routing for a GitHub issue is unambiguous and must be token-free, while
the human gate that ADR-008 exists to protect is fully retained — the operator still affirmatively
accepts or redirects before any authoring.

## Consequences

### Positive
- Zero-token, deterministic routing for the common (intake) case; FR-9 honored.
- The human gate is preserved exactly — no unattended routing *decision* is finalized; the operator
  confirms/redirects at DECIDE time (consistent with ADR-008 and spec FR-11).

### Negative
- The routing union must accept a pre-seeded `confirmed`-candidate; a small change to where the
  proposal originates (origin vs inference).

### Follow-up Actions
- [ ] Seed the routing proposal from the captured idea's origin (source-ref) for GitHub-intake ideas.
- [ ] At DECIDE-claim, present the pre-seeded target through the existing `confirmed|redirected|
      declined` gate (redirect/decline still zero-writes-on-decline).
- [ ] Leave LLM-over-registry inference intact for origin-less (chat/CLI) ideas.
