# Architecture Review: every remediation budget halt is recoverable by one kickback-budget raise (#2185)
**Date:** 2026-09-24
**Mode:** pre-stories, lightweight (Tier M) — Feasibility and Alignment only
**Inputs reviewed:** `.docs/track/offer-ship-or-continue-at-remediation-budget.md` (scope: continue-only),
`.docs/complexity/offer-ship-or-continue-at-remediation-budget.md`,
`.docs/architecture/offer-ship-or-continue-at-remediation-budget.md`, the explore decision record;
ADR sweep: all 317 `adr-*.md` status-screened, ~55 Decision sections read (every halt, kickback,
budget, cap, lap, growth, ledger, grant, and event-sink ADR). No other governing ADR was found.
**Verdict:** APPROVED WITH CONDITIONS (BLOCKED at first pass; resolved by operator amendment, 2026-09-24)

## Feasibility

Buildable on the current stack with no new dependency, store, halt class, or event type. Verified
against source at `33e6d69f1`:

- The remediation router has three budget exits, all `kickback-cap`. The per-gate `prd_audit` and
  `architecture_review_as_built` exits call `recordKickbackCapEvidence` with lap-shaped values
  (`consumed: priorLaps`, `limit: lapCap`) **even when the exhausted allowance is growth**. The
  shared plan-growth exit records no evidence and prints no `Kickback halt generation:` line. (95%,
  verified by reading the three exits in `conductor.ts`.)
- The growth cap is re-derived from config on every read (`prdAuditAppendCap`, called by
  `readRemediationGateAppendBudget`). No ledger field can override it. (95%, verified.)
- `kickback-budget raise` moves only `effectiveLapCap` for remediation gates
  (`applyKickbackBudgetAdjustment`). It refuses the shared-growth halt ("no current cap
  evidence"). On a per-gate growth halt it accepts a lap raise that cannot unblock the feature, so
  the next dispatch re-halts. (90%, verified by reading; not executed.)
- The consequence: every growth-exhaustion halt today needs a config edit and a main commit. In
  the ~10h retained daemon log (2026-09-24), 2 of 5 budget halts were growth halts.

The design extends the existing ledger entry, the `plan-growth` record, the CLI's stage/apply
path, the budget view, and the authorization event. The daemon's
`consumeResumeAuthorizations` → atomic clear → resume path is reused unchanged.

## Alignment

**First-pass blocking conflict.** `adr-2026-08-29-operator-authorized-kickback-budget-recovery`
D2, as amended by #2190 (2026-09-05), says: "Plan-growth allowance is not adjustable by this family
(#2119)." The successor ADR's D4 carries it forward. Raising growth contradicts it. The #2190
stories show the clause was a scope deferral while #2119 was in flight ("Plan-growth allowance is
out of scope (#2119)"), not a rejected design. #2119 has shipped.

**Resolution (operator, 2026-09-24): amend.** D5 is added to
`adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class`. It lifts the exclusion and
makes raise grow the allowance the live typed evidence names. This follows #2190's own precedent:
that feature let a feature-local lap cap override the repository's `max_remediation_laps`
(adr-2026-08-25 decision 4) by amending only the 08-29 family. Growth now overrides
adr-2026-08-22 decision 5's config cap the same way. No new ADR is created.

Other governing ADRs — all SUPPORT or CONSTRAIN, none conflict:

| ADR | Effect on this feature |
|---|---|
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback D5/D6 (+#2119) | Config-derived cap stays the default; growth record `{authored, added, byGate}` is extended additively; existing-task dispositions still charge laps only |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route D4, D9 | The three exits keep `kickback-cap`; laps and growth stay separately metered |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class D1–D4 + 09-01 amendment | Typed evidence, not prose or class, authorizes; CLI never clears; daemon consumes authorization |
| adr-2026-08-31-kickback-ledger-read-fails-closed | A malformed `allowance` or growth-cap field fails closed; gate-scoped where the field is gate-scoped |
| adr-2026-07-26-cross-dispatch-kickback-livelock-bound D1 | Reason text is diagnostic only — applies to the new halt-body command line |
| adr-2026-07-28-total-halt-classification-legacy-boundary D1 | No new halt class |
| adr-2026-07-26-event-sink-registry-exhaustiveness | The event gains a field, not a type; registry unchanged |
| adr-2026-08-22-one-owner-per-review-question | No new appender; `planRemediation` stays the only append seam |

**Event spine.** No new channel. The occurrence is the existing `kickback_budget_adjustment_authorized`
event, which gains the allowance. Budget and cap are durable control state in the kickback ledger
(exception C, already granted by 08-29 D7).

**State.** `allowance` is a closed two-value union (`laps | growth`), never a boolean. Evidence
written before this change has no `allowance` and reads as `laps`. That is exactly what the
per-gate lap exit wrote, and a growth halt from before the upgrade stays unrecoverable by raise, as
it is today.

**Scope-check.** The daemon and `kickback-budget` run in every registered project, so this is
consumer-facing. Docs to update: `docs/runbooks/stalled-or-stuck-feature.md` (Kickback loops), and
`docs/reference/cli.md` if it documents `kickback-budget`. `raise` keeps the same grammar, with no
new flag, so no migration block is needed.

## Wiring Surface

| Surface | Called from |
|---|---|
| `allowance` on typed cap evidence | written by `recordKickbackCapEvidence` at all three remediation exits in the `conductor.ts` remediation router; read by `stageKickbackBudgetAdjustment`/`applyKickbackBudgetAdjustment` and the budget view |
| Evidence at the shared plan-growth exit | the shared-growth `kind: 'halt'` return in the same router, which gains the evidence write and the generation line |
| Feature-local effective growth cap | its own kickback-ledger field beside `growth` (not inside it, so `readGrowth`'s recompute of the counts never drops it); written by `applyKickbackBudgetAdjustment` under the ledger lease; read by `readRemediationGateAppendBudget` in place of `prdAuditAppendCap` when present |
| Allowance-directed `raise` / growth-refusing `reset` | existing `kickback-budget` dispatch in `kickback-budget-cli.ts` (pre-boot CLI table beside `decide-grant`) |
| Recovery command line in the HALT body | the three exits' `detail` strings |
| Allowance in `inspect` and daemon status | `kickback-budget-view.ts` (one renderer, 08-29 D8), consumed by `kickback-budget inspect` and the `KICKBACK BUDGET` line in `daemon-observe-cli.ts` |
| Allowance on `kickback_budget_adjustment_authorized` | `types/events.ts` member; written by `kickback-budget-cli.ts` through the sibling ledger; `audit-trail.ts`/`closeout-tail.ts` pass it through |

Early overlap scan (2026-09-24, advisory): `conductor.ts` overlaps `spec/daemon-self-host-guardrails`
and `spec/self-host-phase6-wiring`. Both are old unmerged spec branches with no functional overlap
with the remediation router. No other named file overlapped.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Raising growth admits more plan appends, against the completeness stance that appends are not a remediation outcome | Technical | Medium | Medium | Every raise is one attributed, TTY-bound operator decision, and the bound stays active at the new cap. #2184 removes as-built appends at the source. |
| A pre-upgrade growth halt carries lap-shaped evidence, so a raise still grows laps | Data | Low | Low | Evidence with no `allowance` reads as `laps`, matching what was written. The stories state the growth-halt recovery applies to halts written after this change. |
| A raised growth cap outlives a rebase and credit | Data | Low | Medium | Store it as non-lap-counting, like `effectiveLapCap` (08-29 D2 survival rule). A fresh feature session clears it with the ledger. |
| The growth-count recompute (#1805 Story 14) drops a raised cap | Data | Medium | Medium | The cap lives in its own ledger field beside `growth`, so recomputing the counts never touches it (conflict-check C1/C2) |

## ADRs Created

None. `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` is amended with D5
(operator-approved 2026-09-24).

## Conditions

1. Implement D5 items 1–4 exactly. `reset` stays laps-only and refuses growth evidence with a message
   naming `raise`.
2. Evidence is written at all three exits before the halt, and the shared-growth exit's body gains the
   `Kickback halt generation:` line. Authorization keys on evidence plus generation, never on prose or
   class.
3. Absent `allowance` normalizes to `laps`. Any other value, or a malformed growth-cap field, fails
   closed per adr-2026-08-31.
4. No unattended grant, no ship-as-draft path, no new halt class, event type, store, or CLI flag.
5. The runbook's Kickback loops section documents the growth recovery.

## Claim and Assumption Ledger

- [verified] Shared-growth exit writes no cap evidence; per-gate growth exits write lap-shaped evidence.
- [verified] Growth cap is config-derived on every read; raise moves `effectiveLapCap` only.
- [verified] The #2190 exclusion is recorded as out-of-scope in #2190's stories, citing #2119.
- [operator-approved 2026-09-24] Lift the exclusion by amendment; raise may grow plan growth.
- [operator-approved 2026-09-24] Continue-only scope; no unattended auto-grant.

No unconfirmed load-bearing assumption remains.
