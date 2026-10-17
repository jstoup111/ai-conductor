# Conflict Check: Publish, review and ship a stacked feature as a GitHub native stack (#2945)

**Date:** 2026-10-17
**New stories:** `.docs/stories/stacked-features-cannot-be-published-reviewed-and-.md` (Stories 1–12)

**Method:** two read-only scans, both directions on every pair that shares a behaviour, entity or
gate:
- story against story;
- APPROVED ADR against story.

The operator approved the full resolution set on 2026-10-17.

**ADR corpus:** repo-wide (355 ADRs), narrowed by subject.
- **Examined** (decision text read):
  - all 14 ADRs amended by `adr-2026-10-17-stacked-feature-publication-as-native-stack`;
  - `adr-2026-08-01-engine-owned-resumable-finish-publication`;
  - `adr-2026-08-06` progress disposition;
  - `adr-2026-08-13` dimension rule;
  - `adr-2026-07-07-finish-record-primitive`;
  - `adr-2026-08-16` publication fence;
  - `adr-2026-07-26-rebase-tail`;
  - the halt-PR rehabilitation and presentation ADRs;
  - the false-ship guard;
  - `adr-2026-08-09-one-pr-per-branch-halt-is-a-state`;
  - the halt-state clear;
  - `adr-2026-08-23-committed-halt-record`;
  - the halt events ADR;
  - the kickback-budget halt class;
  - both `adr-2026-07-20` ci-fix ADRs;
  - `adr-2026-07-04` autoresolve;
  - adr-015 labelling;
  - `adr-2026-07-27` ancestry park reconciliation;
  - `adr-2026-08-07` worktree-removal guard;
  - `adr-2026-07-03-post-rebase-force-with-lease`;
  - `adr-2026-09-23-engine-git-guard-on-agent-path`;
  - `adr-2026-07-26` event-sink registry;
  - `adr-2026-10-12-routed-whole-feature-repair`;
  - the sliced-plan ownership and plan-slice manifest ADRs;
  - `adr-2026-08-01-bot-owned-release-pr`;
  - observed-close and intake closed-issue reconciliation.
- **Narrowed out by subject:**
  - release migration and smoke gates;
  - the teardown hook;
  - park verbs and scheduling;
  - the rebase-resolution family;
  - intake routing;
  - owner-gate identity and provenance;
  - cost rollup;
  - the ship-tail verdict;
  - the audit-trail sink;
  - daemon session commands;
  - dependency reconciliation.
- **Excluded as fully superseded:**
  - gated-writeback announcements;
  - the operator park marker;
  - the finish-only mergeability gate;
  - completeness as a build-review rubric;
  - removal-, verify-only and preservation-anchored exemptions;
  - build-review remediate-case adjudication;
  - operator-authorized kickback-budget recovery.

**Story corpus:** 603 files, narrowed by subject.
- **Examined:**
  - the stacked chain: #2940, #2941, #2942, #2943, #2944, #3210 and #3211;
  - autoresolve, ci-fix and readiness (#438, ship-ci, ci-fix resolver);
  - FINISH publication (#1342, #1487);
  - PR-body regions and the release disposition;
  - shipment evidence (#916, #1461);
  - reap and reclaim (#1091, #1510);
  - park reconciliation;
  - halt records;
  - mergeability-first finish;
  - re-kick rebase;
  - base refresh;
  - force-with-lease;
  - ownership.
- **Not in the corpus:** #3212 has no stories file yet.

**Result:** PASSED.
- Zero blocking conflicts remain.
- No oscillating conflict was found.
- Five degrading conflicts are accepted by the operator.

## Resolved conflicts

| # | Conflict | Type | Parties | Resolution |
|---|---|---|---|---|
| S2, A11 | The automatic `feature-repair` restack and the routed exit could still rewrite published children locally | contradiction (blocking) | Story 10 vs #2943 Story 9, #2942 Done When, restack D9 | Every restack producer refuses `published-stack`. Local-work producers halt `needs-human`, and route admission refuses (ADR decision 11, Story 10) |
| S4, A3 | A retargeted leaf with zero checks reported `no-checks`, against #438 and readiness D2 | contradiction (blocking) | Story 5 vs #438 Story 3, `adr-2026-10-09-shipped-pr-readiness-verdict` D2 | The change is dropped. A retargeted leaf stays `ci-pending` (ADR decision 5, Story 5) |
| A1 | New halt class with no halt-classification amendment | contradiction | Story 10 vs `adr-2026-07-28-total-halt-classification-legacy-boundary` D1 | 07-28 D1 amended to admit `stack-tip-diverged` for FINISH stack publication only |
| A2 | Child-branch deletion had no recorded deletion authority, and could drop commits past the merged head | contradiction | Story 11 vs `adr-2026-08-01-multi-proof-park-deletion-authority` decisions 1–2 | A third proof, stack-member identity, is recorded: merged, squash commit an ancestor of `origin/main`, local tip equal to `headRefOid`, deleted by compare-and-swap (ADR decision 12, Story 11) |
| A4, S3 | Refused base refresh left FINISH and re-kick behaviour unspecified, against the mandatory play-forward | contradiction | Story 10 vs `adr-2026-09-11-finish-mergeability-respects-active-review-inputs` decisions 5–6, #2943 Story 10 | 09-11 decisions 5 and 6 amended. FINISH proceeds and re-kick retries on the current base (Story 10) |
| A5, S5 | ci-fix ineligibility not recorded in the ci-fix ADRs | overlap | Story 10 vs `adr-2026-07-07-ship-ci-feedback-loop` decision 2, `adr-2026-10-09-shipped-pr-readiness-verdict` decision 3 | Both amended |
| A6 | Time block required to match goldens it is excluded from | contradiction | Story 1 vs umbrella decision 14 | Story 1: Cost against the golden, Time keeps its structure |
| A7 | Engine pushes named child refs from the leaf worktree | contradiction | Story 2 vs ownership D2 (#2940 note) | Ownership D2 amended for FINISH stack publication only |
| A9 | Missing head ref fails the always-reporting premerge check | overlap | Story 7 vs shipment decision 4 | Shipment decision 4 amended |
| A10, S8 | Reap depended on reachability and failure reporting | contradiction | Stories 8, 11 vs reap decisions 3, 7 and #1091 S2 | The worktree is removed in the same pass. Reachability gates only child and ref deletion. Reap decisions 3 and 7 amended |
| A12 | New create-only push form at a new site | overlap | Story 2 vs `adr-2026-07-03-post-rebase-force-with-lease` D1, `adr-2026-09-23-engine-git-guard-on-agent-path` D14 | Removed by design: a child is a plain push of its closure SHA after `ls-remote`. No new push form |
| A13 | The publication record read as a progress ledger | overlap | Story 4 vs resumable-finish D1 | ADR decision 2: the record is never trusted as progress. Transitions are selected from the observed snapshot |
| A14 | Story 2 halted on halt-record-only commits past a closure | overlap | Story 2 vs build-region decision 1 | The closure SHA is pushed, and halt-record commits stay local (Story 2) |
| A15, S6 | A skipped halt-record push might emit no event | overlap | Story 10 vs committed-halt-record decision 5, halt-record stories | The skip emits `halt_record_push_failed` with reason `stack-tip-mismatch` and keeps the note. `adr-2026-08-23-committed-halt-record` decision 5 amended |
| Re-check | Six consistency defects found by the bounded re-check: build-region note push form, `stack.add` needing the number before verification, the two `stack.read` targets, `tornDown` missing from the freeze notes, committed-halt-record decision 5, and the halt-class scope | — | — | All fixed. The stack number is recorded on read or create, and `verified` is set after verification |
| A16 | Allowance formula ambiguous at nine transitions | overlap | Story 1 vs bounded-allowance D1 | 08-06 D1 amended: twice the transitions the feature can select |
| A17 | `## Stack` re-render is an unlisted leaf body rewrite | overlap | Story 3 vs regions decision 6 | Regions decision 6 amended. Story 3 asserts that regions survive the rewrite |
| S7 | A kept publication record could poison slug reuse | state conflict | Stories 8, 11 vs #2943 Story 14, #2944 intent | The kept record is marked `tornDown` and ignored by the observer, freeze and guard. A reusing feature replaces it |
| S9 | An agent could push a child before FINISH and guarantee a publication halt | sequencing | Story 2 vs #2940 Story 5 | `conduct github-operation` refuses child pushes and PR binds until the record lists the member (ADR decision 13, Story 12) |
| S10 | Routed repair could open a round after publication, outside the freeze | sequencing | Story 10 vs #3211 Story 1 | Route admission refuses `published-stack` once the record has members. #3212 is specced against this |
| Notes | Five amendment notes were inaccurate (reap decision 2, ownership D1, regions decision 4, identity follow-up, ci-fix placement) | — | — | All reworded or added |

## Accepted degrading conflicts

**C1. #2943 says no child branch is pushed at FINISH.**
- **Parties:** Story 2 vs `a-change-to-one-stacked-child-cannot-be-carried-in.md` Story 10, and
  `build-loop-cannot-complete-a-feature-child-by-chil.md` Story 13 Done When.
- **Story opposing sentence (verbatim):** "Given a stacked FINISH, when publication runs, then no `feat/c<k>/demo` branch is pushed."
- **New story sentence (verbatim):** "Given the three-member stack after `establish_pr`, when `establish_child_prs` runs, then `feat/c1/demo` is pushed and opened as a draft PR with base `main`, and then `feat/c3/demo` is pushed and opened as a draft PR with base `feat/c1/demo`, in that order and in one effect."
- **Accepted because:** that story records #2943's delivered behaviour before publication existed.
  The APPROVED ADR's decision 4, and its amendment of build-region decision 11, govern from #2945
  on. The build loop itself still pushes no child.

**C2. #2943 says stacked features always restack at FINISH and re-kick.**
- **Parties:** Story 10 vs #2943 Story 10 Done When, `mergeability-first-finish.md` FR-6.
- **Story opposing sentence (verbatim):** "Stacked features always restack at FINISH and re-kick; unstacked features rebase as today."
- **Accepted because:** it is still true before publication. After publication, ADR decision 11
  and the 09-11 amendment govern.

**C3. #438 and #2943 make a red leaf eligible for ci-fix.**
- **Parties:** Story 10 vs `shipped-is-fire-and-forget-no-reconciliation-sweep.md` Story 3 and #2943
  Story 14.
- **Story opposing sentence (verbatim):** "…the sweep removes `needs-remediation` and the PR becomes eligible for the existing ci-fix path on that tick or the next."
- **Accepted because:** it holds for every PR whose feature has no published stack members. The
  operator chose the freeze, and #3268 and #3270 own the stacked case.

**C4. A declared child PR is classified `stack-child`, not by its `Plan:` declaration.**
- **Parties:** Story 7 vs `prevent-quoted-plan-paths-from-creating-false-ship.md` Story 1, and
  `durable-shipped-record-enforcement-and-backfill-916-936.md` reconcile AC1.
- **Story opposing sentence (verbatim):** "Given a declared implementation has missing or invalid shipment evidence, when the required check runs, then it fails with the existing evidence refusal."
- **Accepted because:** the override is intentional and is recorded in ADR decision 8 and
  shipment-evidence decisions 3, 4, 5 and 7. A child head can never be the feature's
  implementation PR.

**C5. #3211's reviewer framing assumes a child PR exists during routed repair.**
- **Parties:** Story 2 vs `a-routed-fix-cannot-be-built-charged-and-reviewed-.md` Story 1.
- **Accepted because:** routed repair runs before publication, and the reviewer reads the fix in
  the child PR once it is published. No behaviour conflicts.

**C6. The restack ADR's triggers and lease table are narrowed for published stacks, with no amendment note on that ADR.**
- **Parties:** Story 10 vs `adr-2026-10-10-stacked-restack-journaled-replay` decisions 9 and 11.
- **ADR filename stem:** adr-2026-10-10-stacked-restack-journaled-replay
- **Story ID:** Story 10
- **ADR opposing sentence (verbatim):** "| R equals the recorded tip | Push `--force-with-lease=refs/heads/<branch>:<R>`. |"
- **Story opposing sentence (verbatim):** "Given every remote tip matches, when an engine push to a member would rewrite history so the recorded tip is not an ancestor of the source, then the push is refused and the remote branch is unchanged."
- **Accepted because:** the later APPROVED `adr-2026-10-17-stacked-feature-publication-as-native-stack`
  decision 11 governs both narrowings: every restack producer refuses a published stack, and a
  published member accepts only fast-forward pushes. The new ADR records this in its Amendments
  section. On 2026-10-17 the operator chose to drop the amendment notes on the restack ADR, so the
  plan-review prompt fits its 400,000-character cap (#3278). This follows the #3210 precedent of
  accepting a conflict governed by a later approved ADR. The restack ADR's text is unchanged, and
  its decisions still hold for every unpublished stack.

## Pairs judged compatible

- **Autoresolve:**
  - #2943 Story 10's `published-stack` escalation;
  - `auto-resolve-open-pr-conflicts`;
  - `mergeable-autoresolve-tier-2`.
- **Child identity (#2940 Story 4):** the child refusal in `finish-record`, park deleting no child,
  and no merged-PR lookup from a child head.
- **Publication progress (#1342, #1487):** 2 × 7 for N=1, 2 × 9 for a stack, and the dimension map
  gains two entries.
- **Release:** the release-disposition and changelog stories, and bot-owned-release decisions 3 and
  4, are satisfied by `no-note` children and a single leaf note.
- **PR-body regions:** leaf-only capture; the leaf keeps today's presentation repair.
- **Ownership:** `enforce-ownership` Stories 3 and 5 and ownership decisions 5 and 7 agree with
  Story 12.
- **Force pushes:** force-push and lease stories; no new push form exists.
- **Workflows:** only `ci.yml` filters on base, so `shipped-record.yml` and `release-metadata.yml`
  are unaffected.
- **Flag off:** a flag-off feature has no positions ref (build-region decision 1), so Story 1's
  flag-off rule is consistent with #2940's golden cell.
- **Ship-start draft:** ship-start decisions 6 and 9; halt-presentation decision 3.
- **One PR per branch:** every branch still has exactly one PR.
