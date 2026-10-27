# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-10-27T18:09:18.448Z
Slug: build-review-re-raises-already-decided-findings-ev
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/c1/build-review-re-raises-already-decided-findings-ev
Head SHA: c6a98a98abfac398b91ef9a91c962aff53ecc715
Halted at: 2026-10-27T17:59:22.595Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
restack conflict child 2
commit 8943b0dfb5447b81960c5b99e5392778801b7722; paths: src/conductor/src/engine/step-runners.ts, src/conductor/test/engine/step-runners.test.ts
replay commit dda8ddb453bebaeb63e1c905b8456e971cf72e8f; src/conductor/src/engine/step-runners.ts conflict hunks at lines 4334-4360 (early scope-empty exit in dispatchInstalledBuildReviewPolicy) and 4594-4668 (scope reconciliation inside the prepared candidate); source intends to resolve custom review scope once in the candidate using context.candidate.model, remove the early scope-empty exit, keep passing customReviewScopes[entry.id] at the call site, and handle scope-empty by emitting build_review_rubric_skipped and returning the member (later child-2 commit 05ec2c5f97 adds the branch-artifact write; 40331484ac and f54b0d0285 update build-review-step.test.ts for this design); upstream 6f8b86b3e2 (child 1, round r7, rem-prd-audit-25) intends to resolve scope again for each fallback model inside context.invoke, keep the early exit only when no resolver is passed, pass undefined as the call-site scope, and return empty custom-findings that are rewritten to scope-empty output; missing decision: whether child 2's version is replaced by upstream 6f8b86b3e2 (drop it and remove or adapt 05ec2c5f97, 40331484ac and f54b0d0285) or whether its branch-artifact write, rubric_skipped event and call-site scope must be merged into upstream's per-model path
```
