# ADR: Require total HALT classification with an explicit legacy boundary

**Date:** 2026-07-28
**Status:** APPROVED
**Deciders:** James Stoup (operator), Engineer architecture review
**Issue:** jstoup111/ai-conductor#1077
**Supersedes:** `adr-013-daemon-main-advance-rekick.md`

## Context

ADR-013 established base-advance re-kick by clearing every live `.pipeline/HALT`. It explicitly rejected selective classification as fragile. Issue #921 and PR #928 later added `.pipeline/HALT.class`, made `needs-human` survive every sweep, and retained auto-re-kick for `mechanical` and `unclassified`; that change did not supersede ADR-013.

The current tree now has two incompatible authorities and an incomplete writer migration:

- `conductor.ts` still has 22 direct writes to the canonical HALT marker.
- `writeHaltMarker` permits an omitted class.
- missing, unreadable, or invalid classes become `unclassified`, which the sweep automatically clears on a base advance.
- direct writes include conditions that have exhausted automatic recovery or require operator judgment.

The new contract must make classification total for new engine writes, fail closed when the new contract is violated, and preserve historical behavior for HALTs that genuinely predate the contract.

## Options Considered

### Option A: Required classified writer plus an explicit legacy migration

- **Pros:** closes every current bypass, gives old markers a bounded compatibility path, and allows compile-time plus integrity enforcement.
- **Cons:** requires a reviewed disposition for every current writer and introduces one daemon-state migration watermark.

### Option B: Central typed halt-reason registry

- **Pros:** centralizes every reason-to-class mapping and offers the strongest long-term audit surface.
- **Cons:** broad multi-day refactor across the conductor tail and every halt funnel; disproportionate v1 risk.

### Option C: Sweep-only fail-closed fallback

- **Pros:** smallest immediate safety patch.
- **Cons:** leaves engine-owned HALTs unclassified, does not satisfy #1077, and provides poor operator diagnostics.

## Decision

Adopt Option A.

### D1 — New writers have exactly two writable classes

`writeHaltMarker(projectRoot, body, haltClass)` requires its third argument. New engine writers may select only:

- `needs-human` — operator judgment or external action is required; never auto-cleared.
- `mechanical` — a base advance and canonical retry path can plausibly change the condition without operator judgment.

If retry safety is not mechanically provable at a writer, the class is `needs-human`. `legacy` is not writable through this API.

### D2 — Read disposition separates compatibility from corruption

The read side returns one of four dispositions:

- `needs-human` → retain the HALT.
- `mechanical` → preserve ADR-013's canonical clear-and-re-kick path.
- `legacy` → preserve pre-upgrade auto-re-kick behavior, with an explicit compatibility log annotation.
- `unclassified` for missing, unreadable, or invalid state → retain the HALT and log that operator action is required.

Absence never means legacy after the migration boundary.

### D3 — A one-time migration stamps only pre-boundary markers

After the daemon acquires its existing per-project lock and creates `worktreeBase`, but before backlog discovery, dispatch, or re-kick, it runs an idempotent migration:

1. If `.daemon/migrations/halt-classification-v1` exists, do nothing.
2. List worktrees with a live `HALT` and no readable class.
3. Atomically stamp each as `legacy`.
4. Atomically write the daemon-scoped completion watermark after the scan.

The lock prevents another daemon from creating a new marker during the boundary scan. A process crash before the watermark repeats the scan before any later work. If an individual legacy stamp cannot be persisted, the marker remains `unclassified` and therefore fail-closed; the migration logs the compatibility loss but never converts uncertainty into automatic retry.

### D4 — Marker and sidecar lifecycle fails toward safety

Before writing a new HALT body, the shared writer removes any stale class sidecar, then writes the body and atomically replaces the new class sidecar. A failure between body and class leaves `unclassified`, which is operator-required under D2. Clearing a HALT continues to remove its class sidecar in the same operation.

This two-file protocol cannot promise atomic visibility; its intermediate state is deliberately safe.

### D5 — Totality is mechanically enforced

Two independent checks prevent regression:

- TypeScript rejects calls to `writeHaltMarker` without a class.
- A deterministic integrity check rejects direct production writes to `.pipeline/HALT` or `HALT_MARKER` outside `halt-marker.ts`.

The check permits read-only marker consumers such as the dashboard, discovery, and re-kick sweep. It targets write operations, not imports.

### D6 — Every current writer gets an explicit reviewed disposition

Implementation must inventory every production HALT writer and record its selected class and rationale. Similar-looking funnels are not bulk-classified by string matching. Authentication exhaustion, permission denial, cap exhaustion, malformed remediation, generic hard failure, and unexpected exceptions are reviewed separately.

The default for an unresolved classification question is `needs-human`, never `mechanical`.

### D7 — Preserve ADR-013's non-classification decisions

This ADR supersedes ADR-013 because its all-halt policy and rejection of classification are no longer authoritative. It carries forward unchanged:

- genuine base-SHA advance as the re-kick trigger;
- clearing the marker as the sole route back through canonical discovery/dispatch;
- aborting an in-progress rebase before clear, with failed abort leaving the marker intact;
- the once-per-feature-per-SHA bound;
- rebase-first play-forward before gate re-verification.

Only eligibility changes: `mechanical` and explicitly `legacy` dispositions re-kick; `needs-human` and `unclassified` remain halted.

## Consequences

### Positive

- Every new engine-owned halt has an auditable disposition.
- A failed or bypassed classification cannot silently become retryable.
- Existing classless worktrees retain their historical behavior through a bounded, visible migration rather than permanent absence-based fallback.
- Compile-time and repository-integrity gates enforce the rule where violations are authored.
- ADR authority matches the behavior introduced by #921 and completed by #1077.

### Negative

- First daemon start after upgrade performs one bounded scan of existing worktrees and writes a daemon migration watermark.
- Misclassifying a retryable halt as `needs-human` reduces automation until an operator clears it; this is the accepted fail-closed direction.
- Every new halt funnel must choose and test a class.
- Old external tooling that writes bare `HALT` files will now produce operator-required `unclassified` state unless it participates in the explicit migration or adopts the writer contract.

### Follow-up Actions

- [ ] Inventory and classify every current production HALT writer.
- [ ] Add the lock-protected legacy migration and compatibility telemetry.
- [ ] Require the writer argument and migrate every call site.
- [ ] Add deterministic direct-write enforcement to the harness integrity suite.
- [ ] Update daemon operations, artifact reference, and stalled-feature recovery documentation.
- [ ] On approval, mark `adr-013-daemon-main-advance-rekick.md` superseded by this ADR.

## Verify-Claims

- Verified: the daemon lock is held before worktree scanning and dispatch setup.
- Verified: `.daemon/` is durable daemon-scoped state in the main checkout.
- Verified: current clearing already removes the class sidecar.
- Operator-approved: explicit legacy compatibility, followed by fail-closed missing/invalid classification.
- No unconfirmed load-bearing assumptions remain.
