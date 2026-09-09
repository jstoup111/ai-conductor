**Status:** Accepted

# Stories: Self-host gate HALT resume procedure (#1775)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the shared resume procedure printed into every self-host finish-gate HALT and the module header sentence that repeats it. Gate reasons, halt classification, redaction, and every other halt writer remain outside this slice.

## Story 1: Print only resume steps that apply to a self-hosting repository

As the operator recovering a parked self-build, I want the halt's resume procedure to list only actions that do something in this repository so that I do not spend recovery time on a wrong-context command.

### Acceptance Criteria

#### Happy Path

- Given a self-host finish gate refuses with a reason, when the engine writes the self-host halt marker, then the printed resume procedure instructs the operator to run neither the harness installer nor a `/verify` command.
- Given the same halt marker, when the operator follows the printed procedure in order, then it directs them to address the gate reason, clear the halt marker and its class sidecar, and merge the pull request themselves.

#### Negative Paths

- Given a gate reason carrying a redactable safety token, when the engine writes the self-host halt marker, then the token is absent from the written body and the resume procedure still lists its full set of numbered steps.

### Done When

- [ ] A unit assertion proves the written halt body contains no harness-installer invocation and no `/verify` instruction.
- [ ] A unit assertion proves the body's numbered steps name addressing the reason, clearing the halt marker and its class sidecar, and merging the pull request.
- [ ] A unit assertion proves a canary-bearing reason is redacted while the body still carries every numbered resume step.

## Story 2: Preserve the halt's dashboard reason and its merge invariant

As the operator triaging from the daemon dashboard, I want the rewritten body to keep surfacing the gate's own reason first and to keep stating who merges so that the rewrite costs no diagnostic information.

### Acceptance Criteria

#### Happy Path

- Given a self-host gate halt is written, when a reader takes the body's first non-empty line, then it is the gate's own reason rather than any resume step or heading.
- Given the same halt body, when the operator reads past the reason, then it still states that the daemon never merges under ADR-005/ADR-010 and that the operator performs the merge.

#### Negative Paths

- Given a gate reason that is empty or whitespace only, when the engine writes the self-host halt marker, then the marker is still classified `needs-human` and the body still carries the complete resume procedure.

### Done When

- [ ] A unit assertion proves the caller's reason text precedes the resume procedure in the written body.
- [ ] A unit assertion proves the ADR-005/ADR-010 daemon-never-merges sentence survives the rewrite.
- [ ] A unit assertion proves an empty reason still produces a `needs-human` class sidecar and a body containing the resume procedure.

## Negative-category review

Invalid input is covered by the empty/whitespace-only reason case; data integrity by the redaction case, which proves the rewrite did not move the reason outside the redacted span. Auth, timeout, dependency-unavailability, concurrency, resource-exhaustion, and partial-rollback categories are inapplicable: the helper takes a string, calls one existing best-effort marker writer, and adds no external call, no lock, and no multi-step transaction. Marker write failure is existing behavior owned by the marker module's own tests and is deliberately not re-litigated here. Cascade deletion, immutability, exception-hierarchy, and dedup categories have no subject in this change.
