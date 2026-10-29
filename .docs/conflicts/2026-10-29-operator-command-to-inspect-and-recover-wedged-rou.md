# Conflict Check: Operator command to inspect and recover wedged routed rounds

**Date:** 2026-10-29
**Stories checked:** `.docs/stories/operator-command-to-inspect-and-recover-wedged-rou.md` (Stories 1–4) against
every story file that touches routing rounds, route records or operator stack commands.
**Result:** Clean. 0 blocking, 0 degrading.

## Inventory

Story files compared, selected by `route record`, `routing round`, `routed round` or `refs/conductor/*/routes`:
`routed-repair-opens-a-new-round-while-an-earlier-r.md` (#3445), `routed-remediation-skips-re-run-steps-on-stale-chi.md`
(#3455), `manual-reviewer-edits-cannot-be-landed-safely-in-t.md` (#3203), `whole-feature-audit-fixes-cannot-land-in-the-stack.md`,
`a-routed-fix-is-never-carried-up-the-stack-or-foll.md`, `a-routed-fix-cannot-be-built-charged-and-reviewed-.md`,
`admitted-whole-feature-fixes-in-a-stacked-feature-.md`, `routed-round-growth-halt-misreports-cap-overrun-as.md`,
`stack-preflight-refusals-end-the-run-with-no-halt-.md`, `stacked-repair-restack-conflict-above-the-repaired.md`,
`build-loop-cannot-complete-a-feature-child-by-chil.md`, `a-change-to-one-stacked-child-cannot-be-carried-in.md`,
`compose-sealed-content-and-engine-remediation-appe.md`, `stacked-features-cannot-be-published-reviewed-and-.md`.
Other story files do not touch routing state and were narrowed out.

ADRs examined: `adr-2026-10-12-routed-whole-feature-repair`, as amended by #3203, #3445, #3455 and #3459 (D6, D7 and D16 are
directly relevant); `adr-2026-10-24-operator-route-round-for-closed-stacked-children`;
`adr-2026-10-01-daemon-session-command-contracts`; `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine`. All other
ADRs were narrowed out because they do not govern route records, operator CLIs or routing events. None of the examined
ADRs is superseded.

## Pairs examined (both directions)

| Pair | If A holds, does B hold? | If B holds, does A hold? | Verdict |
|---|---|---|---|
| #3459 Story 2 (operator closes a superseded audit round, pending hosts → `done`) vs #3445 Story 3 (reconciliation drains an r3/r4 state: r4's host finishes, then r3 host 2 runs) | Yes. #3445's drain runs only when the operator has not closed r3. After a close, r3 is `closed` and the drain skips it. | Yes. When the drain has already closed r3, #3459 refuses with "not open" (Story 3). | No conflict. The close is operator-elective and recorded (reason, dropped finding ids). The surviving round's leaf return re-audits. |
| #3459 Story 3 (sole non-closed round never closable) vs #3445 Story 1 (a settled round with no other non-closed round performs the leaf return) | Yes. The refusal is what keeps the leaf return reachable. | Yes. | No conflict. The two reinforce each other. |
| #3459 Story 2 (closed round's pending hosts written `done`) vs adr-2026-10-12 D6 recovery table (`closed` written when last host is `restacked`, `done` or `rerouted`) | Yes. The #3459 amendment to D6 adds this writer explicitly. | Yes. | No conflict. Governed by the amended D6. |
| #3459 Story 3 (operator rounds refused, pointing to `stack land --abandon`) vs #3203 Story 9 (abandon restores an operator round) | Yes. | Yes. | No conflict. Disjoint round kinds. |
| #3459 Story 4 (daemon-session refusal, lease, identity) vs #3203 Story 1 (`stack land` refused under `CONDUCT_DAEMON_SESSION=1`) and adr-2026-10-01-daemon-session-command-contracts (only the sanctioned worker set runs) | Yes. `stack` is not in `SESSION_SANCTIONED_SUBCOMMANDS`. | Yes. | No conflict. The same entry guard covers both. |
| #3459 Story 2 (event `routing_round_superseded` via route outbox, dedup by `eventId`) vs whole-feature-audit Story (outbox at-least-once, persister dedup by `eventId`) and adr-2026-10-12 D16 | Yes. | Yes. | No conflict. Extends the same outbox and dedup list. |
| #3459 Story 2 (HALT files untouched by close) vs #3445 Story 4 (identical stuck stops counted; a changed set of non-closed rounds restarts the count) | Yes. A close changes the non-closed set, so the next stall starts at count one. | Yes. | No conflict. |
| #3459 Story 2 (ledger unchanged across close) vs routed-round-growth Story and a-routed-fix-cannot-be-built Story (receipts settle once at dispatch) | Yes. Settled receipts are retained, and unsettled ones were never charged. | Yes. | No conflict. |
| #3459 Story 1 (inspect writes nothing) vs #3455 Story 4 (parked exit writes a named HALT) | Yes. | Yes. | No conflict. |

No oscillating pair was found: no two stories gate the same artifact in opposite directions.

## Gap closed during the check (not a conflict)

#3203 Story 1 refuses `stack land` in a daemon session. The #3459 stories initially had no equivalent criterion. Story 4
now asserts the entry-guard refusal under `CONDUCT_DAEMON_SESSION=1`.
