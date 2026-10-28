# Track: A recurring concern at a resolved anchor escapes its prior case's retry limits

Track: technical

Scope boundary: Balanced. An unbound `act` proposal whose source's authoritative link
(adr-2026-08-29-mixed-build-review-laps D5.5) belongs to a resolved `act` case is admitted as a new
case, as today, but the engine records it as a recurrence of that case unless the proposal
explicitly declares it distinct with a reason. Recurrences form a lineage that shares one BUILD
attempt count of 3 (the original case plus two recurrence repairs), so the limit continues instead
of resetting. Only exhausting the lineage halts, and that halt names the lineage. A declared
distinct case starts a fresh lineage. The declaration is persisted and shown to the operator next
to the case it is distinct from. Resolved rows stay byte-identical. Nothing infers sameness or
distinctness from prose. One remediate contract serves both Claude and Codex. The operator goal is
fewer halts, so the safe default is a bounded autonomous repair, not a halt. Excluded: non-`act`
dispositions (they charge nothing); decision stops and escalations (#3005); explicit
`existingCaseId` rebinds, which keep the D7 regression halt and carry; reopening resolved cases; a
configurable lineage cap.

Internal engine invariant and provider-contract change with no user-facing product capability;
acceptance criteria live in stories. Source: intake jstoup111/ai-conductor#3124.
