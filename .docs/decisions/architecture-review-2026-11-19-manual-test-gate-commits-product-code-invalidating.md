# Architecture review for protected SHIP validation

**Date:** 2026-11-19  
**Inputs reviewed:** Approved technical track and validation sequence for #3685  
**Verdict:** APPROVED

## Feasibility

Verified in the manual-test skill and the approved validation-group join ADR that manual testing starts a server and exercises it through HTTP or a browser. The build-review Claude policy in claude-read-only-review-policy.ts grants shell access to selected read-only Git commands. Reusing that policy would remove capabilities required for manual testing. The self-host deriveBindSet in live-containment.ts deliberately mounts the feature worktree writable. Its existing probe therefore proves a different property.

## Alignment and wiring surface

The serial and grouped validator paths in src/conductor/src/engine/conductor.ts must both request protected execution through src/conductor/src/engine/provider-execution.ts. The join remains the sole writer of group state under adr-2026-07-10-validation-group-join. It can reuse the preserve/rerun judgment in src/conductor/src/engine/gate-code-validity.ts under adr-2026-07-22-gate-evidence-code-validity-on-redispatch. Before routing FAIL rows or audit findings, distinguish evidence for a superseded revision from malformed evidence or a failed run-identity handshake. Only the former belongs to code-change recovery.

The overlap scan found eight other spec branch names touching conductor.ts. Its matches were file-level only.

## Host compatibility

The operator approved warning and continuing on hosts where protection is unavailable or unproven. At each serial, parallel or retry dispatch, apply the available verified protection. Otherwise publish a prominent warning through the conductor event spine before launching the validator. Identify the validator, the failed capability and the fact that processing continues without enforced write protection. The fallback covers protection availability only. Evidence checks, required runtime checks and normal repair routing still apply.

Bind evidence to the inspected code at dispatch. On return, account for tracked and newly created product changes, including uncommitted edits, without attributing shared-worktree writes to an individual sibling. Preserve changes and route unverified product changes through BUILD, test_suite and build_review before shipping. On a stale verdict, rerun affected members after applicable build gates. Exclude harness-owned evidence writes from product-change classification.

## ADRs created

See adr-2026-11-19-ship-validator-protection-fallback.md for the operator's compatibility decision.

## Handoff amendment

The dispatch owns the fallback checkout and captures its changes. A separate Git directory prevents a normal validator commit from moving a shared branch. Existing repair ownership selects the BUILD destination. The engine verifies the captured content before disposing of its source and makes repeat delivery idempotent. This preserves the dirty-switch contract in adr-2026-10-07-per-child-build-region. Fallback isolation is operational separation, not a security guarantee.
