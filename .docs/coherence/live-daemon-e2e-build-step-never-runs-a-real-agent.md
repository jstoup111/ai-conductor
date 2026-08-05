# Coherence Check: Live daemon E2E build step never runs a real agent (#1311)

**Date:** 2026-08-04
**Tier:** M
**Track:** Technical
**Plan stem:** `live-daemon-e2e-build-step-never-runs-a-real-agent`
**Result:** COVERED — zero gaps

No `fr` rows are required: this is a technical-track spec with no PRD, so acceptance criteria
live directly in the stories. Outcome ids are 1-based in the order the bullets appear under the
**Desired outcome** heading of jstoup111/ai-conductor#1311.

Every `covered` verdict below was confirmed by reading the counterpart id in its own artifact
file, not inferred from a phrase match.

## Traceability

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1 | covered | "The build step produces a genuine agent turn — non-zero turns and token usage." Story 1 tags DO-1; its first happy-path criterion requires exactly that, contrasted against the observed zero-of-both return. |
| outcome | outcome-2 | story-1 | covered | "The seeded fixture task completes with `madeCommit`, `touchedFixture`, and `taskTrailer`." Story 1 tags DO-2 and names all four assertion keys including `terminal`. |
| outcome | outcome-3 | story-2, story-3 | covered | "An unavailable step command fails naming that specific cause." Story 2 supplies the before-spend preflight naming the command, its rendered string, and the directory searched; story 3 stops the provider reporting the same condition as a success. Both tag DO-3. |
| outcome | outcome-4 | story-3, story-4 | covered | "A genuine build regression still fails and is distinguishable." Story 4 tags DO-4 directly; story 3's negative paths keep a real dispatch from being misclassified as an environment failure. |
| outcome | outcome-5 | story-2, story-5 | covered | "The signal holds for any harness step command, not only `/pipeline`." Story 5 requires registry derivation with no hardcoded name and states the non-covered surface; story 2's negative path requires a command other than `pipeline` to fail the same way. |
| story | story-1 | task-1, task-2, task-3, task-4, task-5, task-7 | covered | Copy-semantics provisioning (1), fail-closed on a missing `skills/` (2), teardown plus an untouched source checkout (3), no Claude credential on a non-Claude leg (4), `selfHost` injection (5), and the live dispatch proving the outcome assertions (7). |
| story | story-2 | task-6, task-9, task-10, task-11, task-12, task-16, task-17 | covered | Advisory runs still skip (6), preflight passes when all resolve (9), names the command plus string plus path (10), reports every miss and is not build-step-specific (11), spends nothing (12), runs before any dispatch with a counter proving it (16), and counts unmetered results rather than reading them as zero (17). |
| story | story-3 | task-18, task-19, task-20, task-21, task-22, task-23 | covered | Custom-step resolution evidence (18), pinned real envelope (19), classification as unsuccessful (20), prose and bare zero-turn negatives (21), zero-token and exit-code independence (22), no-retry plus HALT class (23). |
| story | story-4 | task-24, task-25 | covered | The two failure classes stay distinct with diagnostics preserved (24); the tier's static source contract is re-verified rather than assumed (25). |
| story | story-5 | task-8, task-13, task-14, task-15 | covered | Registry derivation excluding engine-native steps (8), the structural guard against a hardcoded name (13), per-provider rendering (14), and the stated non-covered surface plus the install-freshness split (15). |
| task | task-1 | story-1 | covered | Type infrastructure; supplies the copied provider home Story 1's happy path depends on. |
| task | task-2 | story-1 | covered | Negative path — provisioning fails closed on a root with no `skills/`. |
| task | task-3 | story-1 | covered | Negative path — home removed on both branches and the source checkout unchanged including untracked paths. |
| task | task-4 | story-1 | covered | Negative path — a non-Claude leg carries no `CLAUDE_CODE_OAUTH_TOKEN`. |
| task | task-5 | story-1 | covered | Type infrastructure; the transport carrying the provisioned env to the provider. |
| task | task-6 | story-2 | covered | Negative path — an uncredentialed advisory run skips and provisioning never executes. |
| task | task-7 | story-1 | covered | Happy path — non-zero turns and all four outcome assertions true. |
| task | task-8 | story-5 | covered | Type infrastructure; the registry-derived command set every later preflight task consumes. |
| task | task-9 | story-2 | covered | Happy path — the preflight passes when every command resolves. |
| task | task-10 | story-2 | covered | Negative path — the failure names the command, its rendered string, and the directory. |
| task | task-11 | story-2 | covered | Negative path — every missing command is named, with no build-step special case. |
| task | task-12 | story-2 | covered | Negative path — no provider, subprocess, or network call. |
| task | task-13 | story-5 | covered | Negative path — a hardcoded skill name fails the suite. |
| task | task-14 | story-5 | covered | Negative path — the reported command string uses the shared renderer, so the reserved Codex leg reports correctly. |
| task | task-15 | story-5 | covered | Negative path — config-declared custom and parallel-branch steps are recorded as non-covered, and the install-freshness split is stated. |
| task | task-16 | story-2 | covered | Type infrastructure; places the preflight ahead of any spend and proves it with a dispatch counter. |
| task | task-17 | story-2 | covered | Negative path — unmetered results are counted, not silently read as zero. |
| task | task-18 | story-3 | covered | Type infrastructure; settles review condition C-6 before the classification can redden this repository's own SHIP tail. |
| task | task-19 | story-3 | covered | Type infrastructure; pins the observed envelope rather than a guessed shape (review condition C-2). |
| task | task-20 | story-3 | covered | Happy path — an unresolved command is classified as unsuccessful with a named reason. |
| task | task-21 | story-3 | covered | Negative path — prose, bare zero turns, and a mismatched command name stay unclassified. |
| task | task-22 | story-3 | covered | Negative path — turns read from the envelope; the exit code does not gate the classification. |
| task | task-23 | story-3 | covered | Negative path — no retry, no escalation, no ladder walk, and an explicit `mechanical` HALT class. |
| task | task-24 | story-4 | covered | Negative path — a real dispatch that fails to finish stays a build failure, with diagnostics intact. |
| task | task-25 | story-4 | covered | Type infrastructure; re-verifies the tier's static source contract against the new shape. |

## Notes on coverage boundaries

- **Review condition C-3 has no task by design.** The documentation update to
  `docs/contributing/testing.md` is routed through this repository's
  `maintain-documentation` custom step, so it is required before the PR is complete but is
  not a plan task. This is not a coverage gap in the outcome-to-task mapping.
- **Two review conditions are encoded as dependencies, not prose.** Task 7 gates the
  preflight and provider seams on the mechanism being proven (C-1); Task 18 gates the
  classification on the custom-step question being settled (C-6). Neither can be built past
  without being answered.
- **Outcome 5's coverage is bounded, and the bound is itself covered.** Story 5 and Task 15
  state that config-declared custom and parallel-branch steps dispatch outside the registry
  and are not covered by the preflight, rather than claiming a guarantee the code does not
  provide.
- **No outcome maps to a workflow change.** `live-daemon-e2e.yml` is deliberately untouched;
  the fix is in the fixture and the provider, so no row cites it.
