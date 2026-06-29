# ADR 021: Memory Resilience — Best-Effort, Write-Fallback & Reconcile-on-Reconnect

**Date:** 2026-06-29
**Status:** DRAFT
**Deciders:** James (operator), Claude (architecture-review)

## Context

FR-13 requires memory to be **best-effort**: a misconfigured/unavailable platform or a failed persist
**never aborts** a harness run. FR-13a (no-loss on write failure): when the active platform cannot
accept a write, the entry is **saved to the default local store instead** (with a warning) so it is not
lost. FR-13b (reconcile on reconnect): fallback entries held in the default local store are
**reconciled into the active platform once it is available again**, after which they recall normally;
until reconcile, they are **not surfaced from the active platform** — a known, bounded gap. This was
the explicit subject of conflict-check (memory note: "FR-13b reconcile-on-reconnect"). This behavior
cuts across ADR-015 (provider integration) and ADR-017 (the default local store), so it gets its own
decision record.

Forces:
- Memory is a side-channel; nothing about it may block the SDLC flow (FR-13, also a Non-Functional
  Requirement).
- The **default local store** (ADR-017) is always available (zero-dependency), making it the natural
  **fallback sink** for writes the active provider rejects.
- Reconcile is **one-directional** (fallback → active) and **idempotent** (re-running must not
  duplicate already-reconciled entries).
- Warnings must be **bounded** (not flooding) even under repeated failures (story FR-13 negative path).

## Options Considered

### Option A: Default local store as fallback sink + one-directional idempotent reconcile on reconnect
- **How:**
  - **Recall failure (active unavailable):** surface a bounded warning, continue the run; recall what
    is available (nothing, or the default store if that is the active one). Never block (FR-13).
  - **Write failure (active rejects/unavailable):** write the entry to the **default local store**
    (ADR-017 canonical store), tag it as a **pending-reconcile fallback entry**, surface a bounded
    warning. The entry is safe and not lost (FR-13a).
  - **Reconcile (active back online):** on the next run where the active provider is available, the
    agent **moves pending fallback entries into the active platform** (provider persist), then clears
    their pending tag. Idempotent: an already-reconciled entry is not re-sent. After reconcile they
    recall normally from the active platform (FR-13b).
  - **Until reconcile:** fallback entries are **not surfaced from the active platform** (the known,
    bounded gap FR-13b accepts) — they live only in the default store meanwhile.
  - **Bounded warnings:** memory warnings are de-duplicated/capped per run so repeated failures don't
    flood output (FR-13 negative path).
- **Pros:** No memory loss (FR-13a); self-healing once the platform returns (FR-13b); reuses the
  always-available default store as the sink; never blocks (FR-13).
- **Cons:** A bounded visibility gap (fallback entries invisible via the active platform until
  reconcile) — explicitly accepted by FR-13b; pending-state bookkeeping needed.

### Option B: Block/retry writes until the active platform accepts
- **Cons:** Violates FR-13 (memory would block the run). Rejected.

### Option C: Drop writes the active platform can't take (warn only)
- **Cons:** Violates FR-13a (memory lost). Rejected.

## Decision

Adopt **Option A**: the **default local store is the write-fallback sink**, with **one-directional,
idempotent reconcile** when the active platform returns.

- Memory operations are **best-effort and non-blocking** (FR-13): recall/persist failures produce
  bounded warnings and the run always continues.
- A write the active platform cannot accept is **saved to the default local store** and tagged
  pending-reconcile — **not lost** (FR-13a).
- When the active platform is available again, pending fallback entries are **reconciled into it**
  (idempotently), then recall normally; **until then they are not surfaced from the active platform**
  (the bounded, accepted gap) (FR-13b).
- Warnings are **bounded** (de-duplicated/capped) so repeated failures never flood or abort (FR-13
  negative path).

This is consistent with FR-3: reconcile is the **agent** persisting entries into the platform (the
agent owns the operation); the harness adds no retrieval/ranking — it only provides the fallback store
and the pending bookkeeping.

Why: it is the only option among the three that simultaneously satisfies "never block" (FR-13),
"never lose" (FR-13a), and "self-heal" (FR-13b), and it does so by reusing the always-available default
store ADR-017 already establishes.

## Consequences

### Positive
- Memory never blocks a run and never loses an entry (FR-13/FR-13a).
- Self-healing: transient platform outages resolve automatically on reconnect (FR-13b).
- Reuses the default local store as the sink — no new infrastructure.

### Negative
- A **bounded visibility gap**: fallback entries are invisible via the active platform until reconciled
  (accepted by FR-13b, but real — recall during an outage may miss recent entries).
- Requires durable **pending-reconcile bookkeeping** (which entries await reconcile) and an idempotent
  reconcile to avoid duplicates.
- Warning de-duplication/capping logic must be implemented to honor the bounded-warnings requirement.

### Follow-up Actions
- [ ] Implement the fallback write path (active reject → default store + pending tag + bounded warning).
- [ ] Implement idempotent, one-directional reconcile on active-platform availability; clear pending
      tags on success; never duplicate.
- [ ] Implement bounded/de-duplicated memory warnings (per-run cap).
- [ ] Negative-path coverage: misconfigured → warn+continue; unavailable-at-recall → warn+continue;
      write-reject → saved-to-default (not lost); reconnect → reconciled+recallable; repeated failures
      stay bounded and never abort.
- [ ] Document the bounded visibility gap so operators understand recall during an outage may omit
      not-yet-reconciled entries.
