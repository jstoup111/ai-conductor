# Halt record

Status: halted
Slug: manual-reviewer-edits-cannot-be-landed-safely-in-t
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/c2/manual-reviewer-edits-cannot-be-landed-safely-in-t
Head SHA: 077f90c28c30e0bc780756d6e356b7d8dfefb2f2
Halted at: 2026-10-27T16:01:30.084Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
restack conflict child 3
commit 738673eb318492e84f0076c1768dbc2076be167c; paths: src/conductor/src/engine/rewind.ts, src/conductor/src/engine/stack-land-cli.ts, src/conductor/src/engine/stack-owners-cli.ts, src/conductor/test/engine/n1-golden-routing-guard.test.ts, src/conductor/test/engine/rewind-closed-child.realgit.test.ts, src/conductor/test/engine/slice-topology-consumer-boundary.test.ts, src/conductor/test/engine/stack-land-cli.test.ts, src/conductor/test/engine/stack-owners-cli.realgit.test.ts
replay commit 5f59a54509446a34e17a4f9eaa78441d8c4b6b73; .docs/halted/manual-reviewer-edits-cannot-be-landed-safely-in-t.md lines 3-28 (status header and HALT block); source intends to record the stale 2026-10-27T02:34Z 'halted' restack-conflict record (later todo commits fac7cff658, e66077a485, 4937b6f5e4 replay further 02:34-04:56Z snapshots); upstream 5827a1d36a already holds a newer 'resolved' record (resolved 2026-10-27T15:58:50Z, cascade-cap halt history); missing decision: whether stale branch-local halt-record commits are dropped as superseded by upstream's newer record (making them empty, which is a skip outside sweep mode) or replayed over it (regressing the durable record). Replays 1-11 were validated and committed, including 738673eb31 as fbce11a7ef with changes identical to the source; targeted tests: 48/48 passed
```
