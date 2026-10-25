# Conflict Check: FINISH reports the real PR-publish failure (#3376)

**Date:** 2026-10-24
**New stories:** `.docs/stories/finish-pr-body-publish-fails-on-token-scope-and-ha.md` (Stories 1–3)
**Result:** PASSED — 0 blocking, 0 degrading conflicts

## Inventory

- Stories corpus: all 625 files in `.docs/stories/`. Narrowed by subject (FINISH `author_pr_prose`,
  `publication_transition_unmoved`, `github-operation` CLI results, the sibling ledger and its tail,
  human-required reasons, bot-credential fallback) to 9 files, each read and compared pairwise in
  both directions against Stories 1–3.
- ADR corpus: all 363 `adr-*` files in `.docs/decisions/`. 46 matched the subject keywords and
  were read. The ADRs below govern behavior these stories address. The rest were narrowed out
  because their matching text concerns build-review, rebase, or stacking, which none of these
  stories touches.

## Pairs examined (no conflict)

| Counterpart | Shared surface | Both directions hold? | Reasoning |
|---|---|---|---|
| adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns | The fixed-point guard on `author_pr_prose` | Yes (80%) | The ADR's rule covers a transition that *completes* without moving its dimension. Story 2 treats a pass whose guarded publish failed as a failed effect and never runs the guard on it (adr-2026-10-24-finish-surfaces-guarded-publish-failures D4). That is the same shape as the existing region-restore errors, which already coexist with this ADR. Story 3 keeps the guard verbatim for a completed pass with no recorded failure. Re-observation stays authoritative in both. |
| adr-2026-08-08-finish-human-required-halt-rendering D3 | The closed human-required reason union | Yes | Story 2 adds `publication_operation_failed` with a message and next action, which keeps the map exhaustive. |
| adr-2026-08-08-pipeline-owned-closeout-timestamps D2 | One writer per ledger | Yes | Story 1 forbids the CLI from writing this event to `events.jsonl` itself. |
| adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry D3 (amended by this spec) | The admitted external kinds | Yes | The amendment adds `github_operation_failed`. Story 1 asserts it gets no `unadmitted-type` diagnostic. |
| adr-2026-09-11-github-operation-ownership (D9 fallback, token secrecy) | CLI events and token handling | Yes | Tokens are never placed in argv or events. Story 1 strips argv and caps the error. The ADR's "no command output" rule is scoped to the fallback and co-author events, not to failure events. |
| adr-2026-08-01-engine-owned-resumable-finish-publication D1, D4 | Who authors and publishes PR prose | Yes | The provider still publishes. Stories only change how the engine reads the outcome. |
| `use-a-dedicated-bot-identity-for-daemon-github-act.md` Story (fallback classification) | Bot-token failures | Yes | Its criteria limit fallback to verbatim 401, 403 permission, and bad-credential responses, and keep other `gh` errors as failures. The #3376 missing-scope error reached the provider as `kind: failed` with no operator retry, which is consistent with that classification. Stories 1–3 do not change fallback. |
| `closeout-timing-events-record-wrong-units-inflatin.md` (tail admits only admitted kinds) | Tail re-emission | Yes | Admission grows by one kind, and unadmitted kinds are still diagnosed. |
| `build-post-task-tail-telemetry.md` (tail re-emits admitted events, skips partial lines) | Tail behavior | Yes | Story 2's malformed-line tolerance in the pass-window read matches the tail's skip semantics. |
| `finish-deadlocks-when-the-prose-judge-asks-for-rev.md` Stories 1–3 | `author_pr_prose` routing and the unmoved guard | Yes | Routing and the retry-path guard are unchanged. Story 2 acts only after a successful dispatch on placeholder prose. |
| `finish-publication-burns-its-retry-budget-on-an-un.md` | The unmoved detail and the retry budget | Yes | The unmoved detail is unchanged, and a publish-failure halt consumes no retry. |
| `stacked-features-cannot-be-published-reviewed-and-.md` | The unmoved guard on `establish_child_prs` | Yes | A different transition, untouched. |
| `finish-s-stop-gate-does-not-stop-a-correct-refusal.md`, `pipeline-batch-evaluators-remain-an-unenforced-sec.md`, `remove-retrospectives-full-and-micro-from-feature-.md` | Keyword match only (refusal and sibling-ledger mentions) | Yes | None asserts behavior for `author_pr_prose` failures or for admission of this kind. |

Every type was checked: contradiction, behavioral overlap, state conflict, resource contention,
sequencing, and oscillation. None was found.
