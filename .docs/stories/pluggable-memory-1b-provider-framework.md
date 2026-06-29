**Status:** Accepted

# Stories: Pluggable Memory — Slice 1b (Provider Framework)

**Umbrella:** `pluggable-memory.md` · **PRD:** `.docs/specs/2026-06-29-pluggable-memory-source.md`
**ADRs:** 015 (non-default = agent-queried MCP), 016 (selection — non-default), 018 (`conduct memory
add|remove|status`), 019 (guidance-skill selection), 021 (write-fallback + reconcile).

**Depends on:** slice **1a** (the `memory_provider` kind, the built-in `local` provider, the
config field + resolver, and the durable store must exist first).

**Scope of 1b:** the *pluggable surface* — selecting/adopting/removing a non-default platform,
activating its agent-facing guidance, and the best-effort write-fallback/reconcile resilience.
Phase 1 ships **no concrete external platform** (those are Phase 2); 1b is built and tested against
a **test-double provider**.

**Stories in 1b (full):** FR-4, FR-6, FR-7, FR-13/FR-13a/FR-13b.
**Stories in 1b (completing the 1a subset):** FR-1 (a non-default platform is the active one),
FR-2 (installed-but-unavailable → fallback), FR-10 (behaviors under an alternative provider +
switching).

Story text per FR is the umbrella file's corresponding section (not duplicated, to avoid drift).
This slice file is the **build scope contract** for
`.docs/plans/<date>-pluggable-memory-1b-provider-framework.md` (authored after 1a ships).

## Coverage contract (criteria 1b must satisfy)

| FR | Criteria 1b owns |
|----|------------------|
| FR-1 | A chosen alternative platform is active for that project; resolves independently of other projects |
| FR-2 | A selected platform that exists but is unavailable at run start → warn + fall back to `local` + run continues |
| FR-4 | A non-default platform's recall/persist guidance is in effect when active; missing/incomplete guidance → defined safe degradation to `local` semantics + warning (not silent misbehavior) |
| FR-6 | Adopt a platform in one action (`conduct memory add`); idempotent re-add; no clobber of existing config; missing-credentials notice (not half-config); interrupted add re-runs cleanly |
| FR-7 | Remove/disable a platform (`conduct memory remove`) → project returns to `local`; idempotent re-remove; other config untouched; removed active provider → next run cleanly uses `local`, no dangling ref |
| FR-10 | The memory step / recall-using design step / project setup work under an **alternative** provider; switching platforms breaks nothing and reads from the active source |
| FR-13 | Misconfigured/unavailable platform → warning + run completes (never abort) |
| FR-13a | Active platform rejects a write → entry saved to the default `local` store with a pending-reconcile tag + warning; not lost |
| FR-13b | Pending fallback entries reconciled into the active platform on reconnect (idempotent, one-directional); not surfaced from the active platform until reconcile; bounded warnings under repeated failure |

## Done When (slice 1b)

- [ ] An alternative platform can be adopted for one project and used by the agent, while another
      project still uses `local`; adopting twice is a no-op; removing returns to `local` cleanly.
- [ ] A non-default platform's guidance is in effect when active; missing guidance degrades safely.
- [ ] A misconfigured/unavailable platform warns and the run completes.
- [ ] A write the active platform can't accept is saved to `local` (not lost), warns, and on
      reconnect is reconciled into the active platform and recalled normally.
- [ ] Repeated failures stay bounded and never abort the run.
</content>
