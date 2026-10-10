# Intake origin: a-rejected-case-transition-halts-as-corrupt-case-h

Source-Ref: jstoup111/ai-conductor#3123
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3123 digest=12e55624a97e1d8184dfcc74d8d198291fa5d833e894d77f3e8d838a867476a6 >>>
## Desired outcome

- A next state rejected by the case store is reported as a rejected transition, distinct from unreadable or corrupt persisted history.
- The halt names the rejected transition's offending case and source IDs and the invariant it violated, enough for the operator to act.
- Valid persisted history is never described as malformed or corrupt.
- The operator has a recovery path that does not require deleting case history or accepting unresolved findings.
- Genuinely corrupt persisted history is still reported as corrupt.
<<< END INBOUND >>>
