# Track: Recover stale conduct-state lease recovery claims

Track: technical

Source: jstoup111/ai-conductor#2170

Scope boundary: Repair the existing shared conduct-state lease recovery protocol, including dead recovery claims, accurate failure messages, malformed claims, uncertain process liveness, and concurrent recovery/replacement races. Exclude the separately tracked full-suite lock, unrelated intake queue recovery, and replacement of the locking technology.

The operator confirmed this breadth with “aligned” and selected approach A with “a” after presentation of the technical track on 2026-09-11. This is internal persistence reliability; acceptance criteria belong in technical stories without a PRD.

## Selected approach

Retain the shared filesystem lease and repair recovery within its existing ownership contract. Recover only provably dead claims; preserve live or ambiguous ownership; prevent a delayed recoverer from disturbing a replacement claim or lease. Continue to bound acquisition and report the actual blocker.

Replacing the lease with process-lifetime locking was rejected because it broadens compatibility and migration work beyond repairing this protocol. The trade-off is straightforward and needs no separate memory decision.

## Scope check

A. Audience: consumer-facing — this shared engine primitive serves installed harness state stores and intake, independently of self-host operation.
B. Catalog: n/a — no skill is added.
C. Provider: agnostic — filesystem ownership and process liveness are host-independent engine concerns.
Registration: none. Implementation documentation must describe the corrected recovery behavior in the existing operator guide.
