# ADR 009: Intake adapter port (hexagonal) + Envelope contract

**Date:** 2026-06-26
**Status:** APPROVED
**Deciders:** James (solo dev) + harness architecture-review
**Feature:** Phase 9.3 (redesign) — engineer loop, intake port & daemon liveness
**Decision surfaces:** intake seam (FR-13), claude-session adapter (FR-14), idempotency (FR-15),
Envelope validation (FR-16)

## Context

Ideas reach the engineer from different sources. Today only the chat matters; later (9.3b) a
`github-issues` poll and **bidirectional write-back** are wanted. The shipped design hard-wired idea
capture into the loop, so adding a source would mean touching routing/DECIDE. We want the engineer
**core to depend on one stable seam** so a new source is one adapter file + config, with **zero**
changes to routing/DECIDE/daemon.

Scope decision for this phase (operator-approved): wire **only** the `claude-session` (chat) adapter.
`github-issues`, the on-disk inbox poll/async buffer, and write-back are **deferred to 9.3b** — but the
port must be shaped to accept them additively (and write-back implies the port is **bidirectional-
ready**: each adapter will later gain a `report()` keyed by `sourceRef`).

Forces:
- Loose coupling (hexagonal ports/adapters) is the standard way to keep the core source-agnostic.
- `source + sourceRef` is the natural idempotency key **and** the back-reference write-back will use.
- Over-building the inbox/async machinery now (for a single synchronous chat source) is waste; the
  **contract** is what must be right, not the buffering.

## Options Considered

### A (chosen): A hexagonal **intake port** with an **Envelope** contract; adapters implement it
The engineer core imports **only** the port interface. An adapter produces `Envelope` values:
`{ id, source, sourceRef, text, hintRepo?, status: pending|routed|deciding|done, receivedAt }`.
This phase ships the `claude-session` adapter (synchronous; rides the chat). `report()` (write-back)
and on-disk inbox buffering are part of the port's *future* surface, stubbed/absent now, added in 9.3b.
- **Pros:** new source later = one file + config; idempotency + write-back both key off `sourceRef`;
  testable contract; matches the handoff's locked design.
- **Cons:** an abstraction with a single adapter today (accepted — the contract is the deliverable).

### B: Inline chat capture, refactor to a port when the second source arrives
- **Pros:** least code now.
- **Cons:** guarantees a later refactor of routing/DECIDE (the coupling we are trying to avoid); the
  handoff explicitly wants the seam locked now so 9.3b is additive. *Rejected.*

## Decision

**Adopt the hexagonal intake port (A).** Define the `Envelope` as the sole contract; the engineer core
depends only on the port; the `claude-session` adapter is the only wired implementation this phase.

**Mechanism (locked):**
- **Envelope:** `{ id, source, sourceRef, text, hintRepo?, status, receivedAt }` with
  `status ∈ {pending, routed, deciding, done}`. Validated at the port boundary: **empty/whitespace
  `text` → reject** with a field-named error (FR-16, never a silent drop); `status` outside the set →
  reject; missing required field → reject naming it.
- **`claude-session` adapter (FR-14):** builds an Envelope from operator chat input —
  `source = "claude-session"`, `sourceRef` = the originating chat turn (**never empty** — idempotency
  depends on it), `status = "pending"`. Sole adapter this phase; **no github poll/timer starts**
  (asserted).
- **Idempotency (FR-15):** the dedup key is **`source + sourceRef`** (not `text`). A repeat
  `(source, sourceRef)` is a recognized duplicate (reported, not silently dropped); **same `text` with
  a different `sourceRef` → both process** (no false-positive blocking of a re-stated idea).
- **Loose coupling (FR-13):** engineer core imports the port interface only — **not** the
  `claude-session` (or any) concrete adapter; a dependency/import test asserts this.
- **Bidirectional-ready:** the port reserves a `report(sourceRef, status)` capability for 9.3b
  write-back; `claude-session`'s `report()` is a no-op/echo (there is no external sink for a chat
  idea). On-disk inbox buffering + the capture/processing split are **9.3b** — this phase processes the
  chat Envelope **synchronously** through the same port.

## Consequences

### Positive
- 9.3b (`github-issues` + inbox poll + write-back) is purely additive — one adapter file + config.
- Idempotency and future write-back share one key (`source+sourceRef`); the contract is unit-testable.

### Negative
- A port abstraction with a single adapter today (deliberate — locks the seam; minimal extra surface).

### Follow-up Actions
- [ ] Typed `Envelope` schema + port interface; boundary validation (empty text / bad status / missing
      field → field-named rejection).
- [ ] `claude-session` adapter (pending Envelope, non-empty `sourceRef`); assert no github poll starts.
- [ ] Idempotency on `source+sourceRef`: duplicate → reported no-op; same-text/different-ref → both
      process (test both directions).
- [ ] Import/dependency test: engineer core → port only (no concrete-adapter import).
- [ ] Reserve `report()` on the port (no-op for claude-session) for 9.3b write-back.
