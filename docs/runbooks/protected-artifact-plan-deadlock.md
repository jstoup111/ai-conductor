# Protected-artifact plan deadlock

## Symptom

`build_review` reports a completeness `missing-outcome` finding, but its evidence cites only the
plan and the implementation diff. The finding requires an outcome that would amend another
feature's sealed DECIDE artifact. The event stream also contains one or more
`remediation_sealed_artifact_redirect` events, and there is no legal autonomous BUILD or
remediation route to produce that amendment.

## Diagnosis

This is the accepted mid-BUILD residue described by the governing
[ADR §5](../../.docs/decisions/adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md#5-a-mid-build-discovery-returns-to-decide-there-is-no-build-side-route),
not a defect that needs a seal bypass. BUILD may not mutate the sealed artifact; remediation must
redirect the gap to its owning DECIDE step. The missing outcome is therefore not autonomously
deliverable from the current BUILD state.

## Recovery

Accept the exact current finding with a rationale that identifies the sealed artifact and the
DECIDE-owned amendment:

```bash
conduct-ts build-review accept \
  --feature <slug> \
  --lap <lap> \
  --finding <finding-id> \
  --rationale 'Sealed-artifact residue: <artifact> requires a DECIDE-owned amendment; no autonomous BUILD route exists.'
```

The command requires the current lap and finding identity, an interactive terminal, local operator
identity, and a non-empty rationale. Do not use acceptance to authorize a task mutation or a seal
bypass.

## Durable fix

Return the assertion to its owning DECIDE step. Amend the accepted artifact there, then re-author
the affected task against the corrected DECIDE artifact. Never create a BUILD task that mutates the
sealed artifact.

## Verification

Confirm the accepted finding is recorded for the current lap, the redirect events identify the
sealed artifact, and the replacement plan task does not direct a mutation of another feature's
protected artifact.
