# ADR: OVER_SCOPE decision block and durable refusals

Status: APPROVED
Date: 2026-08-24
Issue: jstoup111/ai-conductor#1846

## Context

An OVER_SCOPE prd-audit halt renders exactly one machine-readable acceptance candidate
(`OVER_SCOPE_ACCEPT:` line), selected by `.find(f => !f.accepted)`, and the clear-path reader
matches a single line. N blocking findings cost N halt/clear/re-dispatch round trips, and the
selector can offer a finding that is not blocking (unaccepted but not `outside-visible`),
recording the wrong criterion and re-halting identically with no bound. Refusal is not a
representable state: the candidate's `accepted: false` field is written but never read.

## Decision

1. **Blocking-only selection.** A finding blocks iff grade `OVER_SCOPE`, intent relation
   `outside-visible`, and no durable decision for its criterion. Both conductor halt sites and
   `routePrdAuditOverScope` share this predicate; a non-blocking finding is never offered.

2. **One fenced decision block, all blocking findings.** The halt body (composed and passed to
   `writeHaltMarker` — never written directly, per adr-2026-07-28 D5) carries one fenced
   ```` ```json over-scope-decisions ```` block: an array with one entry per blocking finding —
   `{ criterion, summary, relation, decision: "pending" }`. The body keeps human prose naming
   the blocking set and the operator lever ("edit each `decision` to `accept` or `refuse` with a
   `rationale`, then clear"), per adr-2026-08-08 and adr-2026-08-05
   (every-dispatch-outcome-leaves-an-operator-lever). Machine data rides in the operator-owned
   body — inverting the sidecar-for-machine-data pattern (adr-2026-08-05 build-settle D7) —
   because the operator must *author* the decisions, which no engine-written sidecar affords.

3. **Wholesale reader; `pending` is inert.** On the next prd_audit lap the conductor parses the
   `HALT.cleared` block wholesale. Only explicit `decision: "accept"` or `"refuse"` entries with
   a non-empty `rationale` are recorded. `pending` (or absent decision) records nothing — so a
   machine clear (daemon rekick rename, rewind, reseal `--clear-halt`) can never mint an
   acceptance or refusal (adr-2026-08-19 D6 anti-laundering).

4. **Durable decisions, one record, format overwritten in place.** `.pipeline/accepted-widenings.json`
   keeps `version: 1` but its schema is redefined: `decisions: [{ criterion, summary,
   decision: accept|refuse, rationale, operator, decidedAt }]`. No version bump — the tolerant
   reader treats any store failing the new validator (including every old-shape store) as
   absent, which is the identical outcome with less ceremony. Operator identity resolves per adr-2026-07-01
   (machine-scoped-operator-identity); rationale is never absent (adr-2026-08-09
   non-blocking-plan-scope-containment D2). One writer (the conductor's harvest); atomic
   temp+rename; tolerant read; the write is best-effort and never throws into the halt/clear
   seam (adr-2026-07-11 D1). A later `accept` for a criterion overrides a prior `refuse`
   (append-only entries; last decision wins per criterion). A refusal is moot once the audit no
   longer flags the criterion. These are **operator decisions on prd_audit OVER_SCOPE findings**
   — a distinct concern from the commit-trailer `Scope:` "accepted scope widenings" harvest
   (adr-2026-08-09 hook-owned-containment-event-ledger Concern 2); the shared filename is
   historical and the schemas are disjoint.

5. **No backwards compatibility (operator-authorized pre-v1 break).** The single-line
   `OVER_SCOPE_ACCEPT:` marker, its single-match reader, and the old record shape are removed
   in the same change. An old-shape store or an old-form `HALT.cleared` body reads as absent.
   This deliberately departs from adr-2026-08-11 (deprecated-no-op-step-retirement) and the
   read-and-upgrade-in-place pattern (adr-2026-07-26 protected-artifact-seal-rebaseline D4):
   the feature is not live for any consumer, and the operator explicitly accepted that any
   in-flight old-form state is lost (2026-08-24).

6. **Refusal semantics.** A refused criterion still blocks the gate, but the next halt is a
   changed body: it names the refused criteria as "refused — rework required" and offers
   decisions only for still-pending blocking findings (partial coverage still blocks, naming
   the remainder — adr-2026-07-22 coherence-waiver precedent). A refusal never routes to
   DECIDE, never appends plan tasks, and never becomes off-plan work (adr-2026-08-22
   one-owner-per-review-question; adr-2026-08-22 done-when-evidence D: plan-gap-shaped halts).
   The same halt with the same blocking set never reappears unchanged after a decided clear.

7. **Fail-closed evidentiary defects.** A malformed block, an entry naming a criterion the
   audit did not flag, or an accept/refuse without rationale is an evidentiary defect
   (adr-2026-08-24 evidentiary-defects-are-not-waivable): nothing is recorded, a spine event
   names the defect, and the re-halt states what was unreadable — never a silent null.

8. **Spine events.** Recording a decision emits a new `ConductorEvent` (declared in the total
   `EVENT_SINKS` registry, adr-2026-07-26); the re-halt rides the existing `loop_halt` path.
   Recorded decisions project into the prd_audit verdict artifact and the shipped record
   through the existing renderer path (adr-2026-08-22 prd-audit-stories-authority D8;
   adr-2026-08-13 §6 — a recorded decision that cannot be rendered blocks rather than
   silently disappearing). The prd_audit gate surface already invalidates on feature-runtime
   change; the decisions file participates in `classifyPrdAuditGaps`'s clean computation so an
   accepted widening changes routing on the next lap (adr-2026-07-13 D1).

## Consequences

- N-finding audits resolve in one operator pass; the mis-selection infinite loop is removed.
- Machine clears are inert with respect to acceptance; operator authority stays with explicit
  per-entry edits. This remains a weaker channel than adr-2026-08-13 §4's TTY-gated verb
  (amended accordingly); the `pending` default plus rationale + identity requirements are the
  compensating controls.
- Any in-flight old-form OVER_SCOPE halt at upgrade time re-halts in the new form and the old
  clear is lost — accepted.
- Docs owed in the same PR: `docs/reference/artifacts.md` (HALT.class table gains `over-scope`;
  decisions file inventory), `docs/runbooks/stalled-or-stuck-feature.md` (over-scope clear
  procedure — never `rm -f` the body), `docs/explanation/gates.md`, `skills/daemon-triage`
  (over-scope row).
