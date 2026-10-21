# Track: Growth-exhausted BUILD halt shows the pending growth charge and the halting gate's findings

Track: technical

Scope boundary: Issue outcomes (intake jstoup111/ai-conductor#3153, consolidating #3247 and #3314; operator-confirmed). Included: one pure pending-growth projection (settled added, pending growth per gate and in total, cap, minimum raise that admits the pending repair) computed from the flat `ledger.pendingRepair.charges`, used by `settlePendingRepair`'s growth admission decision and rendered by the BUILD growth-exhausted halt, `ai-conductor daemon status`, and `ai-conductor kickback-budget inspect` (human line plus a JSON field mirroring `pendingLaps`); the halt's `Findings:` line names the halting gate's findings (as-built finding ids for `architecture_review_as_built`, prd_audit criteria for `prd_audit`); a halt where settled growth alone reaches the cap still reports correctly; with no pending repair every surface is unchanged. Excluded: routed-host round receipts (their single receipt growth charge renders unchanged); lap-allowance halts and per-gate sequential lap halts (#2060); the cap formula, config keys, raise/reset binding to cap evidence, and the ledger schema; duplicate suffixed remediation task ids inflating plan block counts (#3316); any new event, sidecar, or CLI flag.

Internal operator tooling diagnostics with no product requirements; it adds observable output, so it is not a maintenance change. Acceptance criteria live in stories.

## Approach decision

- **Chosen — shared pending-growth projection (not derived from the filer's sketch).** A pure function over `(settled growth, pendingRepair.charges, cap)` returns `{ settled, pendingByGate, pendingTotal, cap, minimumRaise }`. Settlement's growth refusal (`kickback-ledger.ts` `settlePendingRepair`, currently the sequential `nextGrowth.added + charge.growth > cap`) and every operator surface read it, so the minimum raise the halt prints is by construction the raise that admits the pending repair. Est. effort ~half day (S). Impact: the displayed and enforced growth figures cannot drift — the recurring defect class behind #2577, #2822, #3247, #3314.
- **Rejected — thread `pendingRepair.charges` into `renderKickbackBudgetView` (filer hypothesis).** Smallest diff, but the view re-derives admission arithmetic independently of settlement, leaving "raise by exactly N admits it" without a single source of truth. Est. ~2-3h.
- **Rejected — fold pending growth into the `Plan growth` numerator.** Conflates settled with authorized growth, breaks the `remaining` semantics pinned by accepted stories, and disagrees with settlement and the `plan_growth` event. Est. ~2h.

## Verified facts (source on main `4ee0afbe44`)

- Settlement charges gates sequentially against one shared cap and returns `exhausted` before writing anything, so a refusal charges nothing (`src/conductor/src/engine/kickback-ledger.ts:1585-1606`). Minimum admitting raise is therefore `settled.added + Σ charges.growth − cap`. Basis: verified (95%).
- The halt renders `renderKickbackBudgetView(..., growthView)` from settled growth only, and picks `Findings:` from `pendingRepair.prdAuditCriteria` whenever non-empty, regardless of the halting gate (`src/conductor/src/engine/conductor.ts:10115-10125`). Basis: verified.
- `kickback-budget-view.ts` renders a pending *lap* line only; no surface reads `pendingRepair.charges[*].growth` except settlement. `daemon-observe-cli.ts` and `kickback-budget-cli.ts` pass `pendingLaps` but no pending growth. Basis: verified.
- The growth cap is shared (`ledger.effectiveGrowthCap`), so one growth raise bound to the halting gate's cap evidence admits every gate's pending growth (`kickback-budget-cli.ts:328-334`). Basis: verified.
- All reported occurrences quote the flat `pendingRepair.charges`; routed rounds keep a single receipt growth charge (`routing/round-receipt.ts:160-171`). Basis: inferred (90%); routed exclusion operator-confirmed.
