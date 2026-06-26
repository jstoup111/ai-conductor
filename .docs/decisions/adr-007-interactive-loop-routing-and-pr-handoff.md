# ADR 007: Interactive brain loop — routing inference + spec-PR handoff

**Date:** 2026-06-25
**Status:** APPROVED
**Deciders:** James (solo dev) + harness architecture-review
**Feature:** Phase 9.3 — supervisor/brain (capstone)
**Decision surfaces:** DS-2 (routing inference, FR-3/4), DS-4 (spec-PR opener, FR-7)

## Context

`conduct brain` is a long-lived interactive loop (FR-1/2): for each free-text idea it must propose a
target project, get **human confirmation** before any authoring, and hand off a spec PR. Two
external touchpoints need a decision: how routing is **inferred** (idea × registry), and how the
**spec PR** is opened.

Forces:
- Routing must never author without an **affirmative** human confirm (FR-3 negative path: decline →
  zero repo writes).
- A freshly `create`d project may be **local-only** (no remote yet) — handoff must degrade, not crash.
- Reuse over reinvention (PRD NFR): prefer existing PR machinery.

## Options Considered

### Routing inference (DS-2)
- **A LLM over registry records (name/remote/path/recent features) × idea → ranked candidates +
  rationale; human confirms/redirects; below-threshold → offer `create`.** *Pros:* handles fuzzy
  idea→project matching; rationale aids the human gate. *Cons:* non-deterministic; needs a no-fit
  threshold + tie handling.
- **B keyword/string match only.** *Pros:* deterministic, cheap. *Cons:* brittle for natural-language
  ideas; the brain's value is judgment.

### Spec-PR opener (DS-4)
- **A reuse the existing `/pr` (finish/pr) machinery.** *Pros:* one PR path, consistent body/title,
  no second opener to maintain. *Cons:* must run it against the *target* repo (composes with ADR-004
  subprocess cwd).
- **B brain-specific PR opener.** *Pros:* tailor the spec-PR body. *Cons:* duplicate PR logic; drift.

## Decision

**Routing = Option A (LLM inference, human-gated). PR opener = Option A (reuse existing PR
machinery).**

**Mechanism (locked):**
- **Routing outcome is a discriminated union (Condition 1, now authoritative):**
  `{ kind: 'confirmed', project } | { kind: 'redirected', project } | { kind: 'create', name } |
  { kind: 'declined' }`. No boolean status flags (`isConfirmed`, etc.); the consumer switches
  **exhaustively** with no catch-all `default`. The `declined` variant carries **no project**, so the
  zero-writes-on-decline guarantee (FR-3) is **type-enforced** — there is structurally nothing to
  author against — rather than guarded by discipline.
- **Routing (FR-3):** infer ranked candidates from the registry × idea with a short rationale;
  **authoring is gated on an affirmative confirm** — decline/empty → no authoring, no writes, back to
  prompt (the `declined` outcome). Redirect to a **registered** project retargets (`redirected`); an
  unknown name is rejected/re-prompted (no invented path). Similarly-scoring candidates are
  **surfaced** for the human to choose (no silent auto-pick).
- **No-fit → create (FR-4):** below the fit threshold, offer 9.2 `create`; on confirm, scaffold +
  register (ADR-003) and route to the new repo's canonical path. Create failure → no authoring, no
  orphan branch/PR.
- **PR handoff (FR-7):** reuse the existing PR machinery, run against the **target** repo (ADR-004
  cwd isolation); report the PR URL; **never** `gh pr merge`, **never** build (ADR-005). **No-remote
  fallback:** if the target has no remote/GitHub (e.g. a fresh local-only `create`), commit the spec
  on the `spec/<feature>` branch and report a **non-fatal** PR-skip — the work is preserved.

## Consequences

### Positive
- One PR path (reused), consistent with the rest of the harness; routing uses the brain's judgment
  while the human stays the gate.

### Negative
- Routing is non-deterministic → tests must assert the *gate behavior* (confirm/decline/redirect),
  not an exact inferred pick.
- A no-fit threshold + tie policy must be tuned.

### Follow-up Actions
- [ ] Routing-outcome discriminated union (`confirmed`/`redirected`/`create`/`declined`); exhaustive
      switch, no catch-all `default`; `declined` carries no project (type-enforced zero-writes).
- [ ] Routing inference (registry × idea → candidates + rationale); no-fit threshold; tie → surface.
- [ ] Confirm/redirect/decline handling with the zero-writes-on-decline guarantee + test.
- [ ] PR handoff via existing machinery against the target repo; no-remote non-fatal fallback + test.
