**Status:** Accepted

# Stories: Parse heading-decorated as-built verdict lines (#2203)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the as-built review's verdict line: the
decoration it tolerates, the diagnostics it keeps when no recognized verdict is present, and the
agreement between every engine reader of that line. The `Outcome delivered:` line is owned by #2175
and is exercised here only in its already-supported plain form.

## Story 1: Read a decorated verdict line as the verdict it states

As the operator of an autonomous build, I want an as-built review whose verdict carries a recognized
value to be read as that verdict even when the reviewer decorates the line as a markdown heading, so
that a complete approving review does not become a needs-human halt over formatting.

### Acceptance Criteria

#### Happy Path

- Given an as-built report whose verdict line is written as a markdown heading carrying `APPROVED WITH DRIFT NOTES`, when the as-built outcome is classified, then it is classified as approved rather than as a missing verdict line.
- Given an as-built report whose verdict line combines a heading prefix, bold markers, a closing heading marker, and a lower-case value, when the verdict line is read, then it yields the same recognized verdict as the undecorated form of that line.

#### Negative Paths

- Given an as-built report whose only `Verdict` heading carries no colon and states its value on a later line, when the as-built outcome is classified, then it is still classified invalid with the missing-verdict-line cause.
- Given an as-built report whose heading-decorated verdict line states a value outside the closed vocabulary, when the as-built outcome is classified, then it is classified invalid with the unrecognized-verdict cause carrying that raw value.

### Done When

- [ ] The as-built outcome classifier returns the approved outcome for a heading-decorated approving report.
- [ ] Decorated and undecorated forms of the same recognized verdict produce identical reader results.
- [ ] The colon-less heading report and the unknown-value heading report keep their existing invalid causes and diagnostics.

## Story 2: Keep every reader of the verdict line in agreement

As the operator, I want the halt body and the retained shipment findings to read the verdict line the
same way the gate does, so that widening the gate cannot silently drop a blocking-findings detail or a
delivered plan-gap record for the same report.

### Acceptance Criteria

#### Happy Path

- Given a heading-decorated blocked report carrying a valid blocking-findings table, when the as-built halt body is rendered, then it lists the parsed blocking findings instead of an empty detail.
- Given a heading-decorated delivered plan-gap report whose outcome line is in its plain form, when the retained shipment findings are collected, then the plan-gap finding is recorded exactly as it is for the undecorated report.

#### Negative Paths

- Given a report carrying no recognizable verdict line, when the halt body is rendered and the retained shipment findings are collected, then the halt body carries no blocking-findings detail and no plan-gap finding is recorded.

### Done When

- [ ] A heading-decorated blocked report reaches the operator-facing halt with its blocking findings enumerated.
- [ ] A heading-decorated delivered plan-gap report yields the same retained finding as its undecorated counterpart.
- [ ] A report with no recognizable verdict line yields neither a blocking-findings detail nor a retained plan-gap finding.
- [ ] Exactly one verdict-line reader exists in the engine sources; a search of the engine source tree finds no second regex matching the verdict label.

## Negative-category review

Invalid input is the live category and is covered three ways: a heading with no colon, a heading whose
value is outside the closed vocabulary, and a report with no recognizable verdict line at all — each
must keep its existing fail-closed diagnostic, because a widened reader that starts accepting these is
the precise way this change could ship a review that was never approved. Data integrity is covered by
the agreement criteria: a verdict the gate now accepts must not be invisible to the halt renderer or
the shipment record. The subject is a pure, synchronous string reader over an already-read artifact,
so auth and permission failures, timeouts and network errors, concurrent access, resource exhaustion,
partial failure and rollback, dependency unavailability, cascade deletion, immutability, exception
hierarchies, and dedup keys have no surface here and are inapplicable. Idempotency is trivially held:
the reader is a pure function of its input.
