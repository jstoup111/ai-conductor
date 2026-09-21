# Halt record

Status: halted
Slug: file-changing-rebase-rewinds-past-test-suite-and-r
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-file-changing-rebase-rewinds-past-test-suite-and-r
Head SHA: 5c9210a84f651b2daf18196ec2c9d2659d462bcb
Halted at: 2026-09-21T12:48:33.267Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 1 happy: Given that replay changes aggregate verification or runtime inputs, when the loop continues, then current aggregate proof is established before required downstream reviews and applicable manual testing still runs for changed runtime behavior.
Task ids: 11
Done when checks: A real conductor rebase flow records zero additional acceptance_specs, BUILD, build_review, prd_audit, and as-built dispatches for valid same-file disjoint replay while establishing current suite proof and running applicable manual testing. | Changed-resolution and unproved-comparison conductor flows dispatch the explicit affected review set, never acceptance_specs or established BUILD by position, and never report unproved replay as unchanged. | After a completed code-changing rebase, the next selected lifecycle step is test_suite or later; required coverage refresh runs in place and cannot select an intervening authoring or BUILD step.
Missing assertion: The checks do not explicitly require that changed aggregate-verification or runtime inputs establish current aggregate proof before downstream reviews.
```
