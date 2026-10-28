# Architecture Review: Done-when `[test]` checks close as verified citing tests that don't assert the check (#3200)
**Date:** 2026-10-21
**Mode:** Lightweight (Tier M): Technical Feasibility and Architectural Alignment
**Stories reviewed:** none yet. This is the pre-stories review; its input is the operator-confirmed
explore outcome in `.docs/track/done-when-closes-as-verified-citing-tests-that-don.md`.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency. Provenance uses `git merge-base --is-ancestor` and `git diff <startHead> HEAD -- <path>`. The judgement uses the native-schema one-shot dispatch that `prd_audit` already uses (`executeProviderAwareSkillOneShot` with `nativeSchema`, `step-runners.ts` near `PRD_AUDIT_JUDGMENT_SCHEMA`). Claude passes `--json-schema`; Codex passes `--output-schema`. Verified by reading, ~90%. |
| Prerequisites | None. `conduct task start` already writes the task-status row and the `.pipeline/current-task` stamp (`task-cli.ts` `runTaskStart`), so `startHead` is an additive field on that write. Verified. |
| Integration surface | Engine-internal: task close, BUILD completion, the conductor's BUILD post-session path, repair-obligation admission, the event spine, and one top-level CLI command. No external API. |
| Data implications | Additive `.pipeline/` and `engine-state.json` fields only: `startHead` on task rows, three new close-record sources, and a per-check refusal count plus `done-when-citation` obligations in the existing versioned repair section (adr-2026-09-06 D1/D3). No committed format and no migration of committed state. |
| Performance risk | Mechanical closes add one `git diff` per tagged check. One judgement dispatch per BUILD session end, and only when a pending citation exists. Cost is bounded to untouched-test citations. Every bad closure in the #3200 sweep was in that class. |
| Worktree isolation | All state lives in the feature worktree's `.pipeline/`. The operator command resolves the feature worktree by `--feature`, as `build-review accept` does. Nothing is shared across worktrees. |

**Key verified facts behind the design**

- **Where a judge can run.** `conduct task done` runs in the agent's CLI subprocess, which has no provider runtime and no event emitter (`task-cli.ts` `runTaskDone` → `task-progress.ts` `completeTaskDoneWhen`). So the judgement belongs in the conductor. Verified.
- **The BUILD-completion seam already handles this shape.** The conductor evaluates BUILD completion after the session ends. The D8 nudge (`artifacts.ts` `unverifiedDoneWhenNudgeCompletion`, with the not-done → `buildRetryHint` → retry path in `conductor.ts`) is the precedent for "withhold completion and re-enter BUILD with a named reason inside the same step". Verified.
- **A refused close had no teeth.** `resolveTaskIdsWithDiagnostics` adds any plan id that has a `Task:` trailer on the branch to the resolved set, except when an open repair obligation exists (adr-2026-09-06 D4). Reusing the repair obligation for a refusal (D14, plus the 09-06 D13 amendment) gives the reopen trailer immunity, restart recovery, and fresh-close resolution without new resolver code. Verified.
- **The lever must sit outside `task`.** The daemon-session guard sanctions `task` as a whole top-level subcommand (`execution/daemon-session.ts` `SESSION_SANCTIONED_SUBCOMMANDS`), so a `task accept-citation` would be runnable by the BUILD agent. A new top-level `done-when` command is refused in every dispatched session by the existing policy with no new code, the same way `build-review accept` is. Verified.

## Alignment

- **Governing ADRs reused, not duplicated.** The change amends the two ADRs that own the decisions:
  - `adr-2026-08-22-done-when-evidence-at-task-close` D10–D18: provenance, pending judgement, the BUILD-boundary judgement, the bounded reopen, demotion, the operator lever, the source set, and events.
  - `adr-2026-09-06-reopened-task-resolution` decision 13: the `done-when-citation` repair source.

  No new ADR. The reopen is a new admitted source on the existing durable state-transition design, which is how `coverage_binding` D10 was added before it was retired.
- **Trailers stay telemetry.** Provenance comes from the engine-recorded `startHead`, never from `Task:` trailers, so adr-2026-07-21's demotion and adr-2026-07-23's routing/authority split are unchanged. The only narrowing of trailer resolution is the one 09-06 D4 already defines for open obligations.
- **Judgement placement follows the Design Principle.** Machinery handles the bookkeeping: provenance, scoping the judged subset, the refusal bound, the persisted verdicts, and demotion. One schema-constrained judgement answers the inherently judgement-shaped question ("does this test assert this check?").
- **Lessons from retired judges are honored.** `adr-2026-10-10-source-grounded-adversarial-plan-review-step` (context) requires any new judge to be "hard-bounded and overridable". `coverage_binding` was retired for halts with no operator lever. Here a refusal never halts (D14), a judge outage never blocks (D15), the bound is two refusals per check, and the operator has `done-when accept` (D16). `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` holds.
- **One owner per review question** (`adr-2026-08-22-one-owner-per-review-question`). "Did BUILD finish each task?" stays owned by BUILD task close. The judgement runs inside BUILD and appends no plan task; only `prd_audit` appends tasks. Demoted checks reach `prd_audit` through the existing D8 input. Aligned.
- **Language-agnostic, as D6 requires.** Provenance is git plus text; the judge reads source text. Nothing parses an AST, and `bindCoversMarkers` (TypeScript only) is not reused. Consumer projects get identical behavior.
- **State management.** The close-record `source` stays a closed union matched exhaustively (D17), with no boolean flags. A per-check judgement state is derivable from the record: pending → judged | reopened | demoted | operator-accepted.
- **Diagrams.** `.docs/architecture/done-when-closes-as-verified-citing-tests-that-don.md` and its sequence match this review. One refinement: the reopen is realized through the existing repair-obligation seam, which the component view covers under "close records, refusals".

**Local pattern basis**

- **Operator acceptance command.** Precedent: `build-review accept` (`cli.ts` `detectBuildReviewAcceptCommand`, a fully bound flag grammar refused by the daemon-session guard).
  - Preserve: exact-grammar detection, which returns null on any extra or missing flag; `--feature` slug validation; a non-empty reason; operator-only by guard policy.
  - Allowed variation: flag names and the persisted record shape.
- **Native-schema judgement.** Precedent: the `prd_audit` one-shot (`step-runners.ts`, `PRD_AUDIT_JUDGMENT_SCHEMA` and its validator).
  - Preserve: the up-front refusal when no candidate provider declares native schema support (which feeds D15 here), and engine-side validation of the structured result.
  - Allowed variation: prompt and schema content.
- **Pure judge module.** Precedent: `rebase-regrade-judgement.ts` (`judgeRebaseRegrade`), an injected judge function that fails closed.
  - Preserve: the pure module boundary, so verdict application is testable without a provider.
- **Reopen.** Precedent: existing-task obligation admission per adr-2026-09-06 D1–D2 (the `coverage_binding` D10 source, now retired).
  - Preserve: idempotent admission keyed by finding id, and the serialized engine-state write seam.

## Wiring Surface

| New production surface | Where production calls it |
|---|---|
| `startHead` field on the task-status row | Written by the existing `conduct task start` handler (`task-cli.ts` `runTaskStart`) and by the Claude Code session hook's task stamping (`session-hook-assets.ts`). Preserved by seeding and restaging; mapped by `rebase-translate.ts` `translateAfterRebase`. Read by `completeTaskDoneWhen`. |
| Start-window provenance check | Called from `completeTaskDoneWhen` (`task-progress.ts`) after `verifyDoneWhenTestReference` passes, on the existing `conduct task done` path. |
| `pending-judgement` / `judged` / `operator-accepted` sources | Written by `completeTaskDoneWhen`, the conductor's judgement application, and the `done-when accept` handler. Matched exhaustively wherever close records are read (`collectUnverifiedDoneWhenChecks`, repair-close evidence). |
| Citation judgement module (prompt, native schema, verdict application) | Invoked by the conductor's BUILD post-session path, before `checkStepCompletion('build')`, through a new `DefaultStepRunner` dispatch method declared in `step-runner-types.ts`. |
| `done-when-citation` repair-obligation admission | Through the existing obligation admission seam (adr-2026-09-06 D1–D2), called from the judgement application. |
| `ai-conductor done-when accept` | Detected in `cli.ts` and dispatched from `index.ts` `dispatchCliCommand`, after the daemon-session guard. Named in `KNOWN_BLOCKED_SUBCOMMANDS` so refusals report a bounded identity. |
| Citation judgement and acceptance events | Members of the `ConductorEvent` union (`types/events.ts`) with `EVENT_SINKS` rows (`event-sinks.ts`). Emitted by the conductor (judgement) and by the accept handler through `startOperatorEventSpine`, as the plan-gap HALT does. |
| BUILD-agent guidance | `skills/pipeline/SKILL.md` step 6: what a pending close means and how to answer a refused citation. |

Advisory overlap scan, run 2026-10-21 over these paths: it found overlap only with stale, unmerged legacy branches (`spec/daemon-self-host-guardrails`, `spec/self-host-phase6-wiring`, `spec/untracked-root-node-modules-symlink-gets-committed`) on `conductor.ts` and `step-runners.ts`. No open spec PR touches either amended ADR.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The judge wrongly refuses a genuine untouched-test citation (the `coverage_binding` failure class) | Technical | Medium | Medium | A refusal never halts. The bound is two per check, then demotion to `unverified`. The operator overturns it with `done-when accept`. A judge outage demotes (D15). |
| BUILD learns to dodge the judge by trivially editing a test's title line | Technical | Low | Medium | Accepted residual. A weak test the task wrote itself was out of scope by operator decision. The sweep showed every bad closure cited an untouched test. The build_review test-quality rubric remains the opt-in backstop. |
| A reopen re-enters BUILD and trips the no-progress breaker or the daemon `no_task_progress` stall | Integration | Medium | Medium | D14: the refusal-caused retry never increments `noEvidenceAttempts` (as D8's nudge), and the next session end settles every refused check (re-judged or demoted), so a refusal costs at most one BUILD attempt and an ignored reopen cannot stall. Story 5 proves it. |
| On the Claude Code host the session hook, not `conduct task start`, marks tasks started, so no start commit would be recorded and every citation would go to the judge | Integration | High | Medium | D10: every start path records HEAD, including the session hook's inline `node -e` stamping (adr-2026-07-10-session-hook-task-stamping D6 still holds: no dist, no CLI). |
| A refusal on BUILD's final attempt exhausts retries and fails the step | Technical | Medium | High | D14 demotes instead of reopening when no BUILD attempt remains. |
| A rebase rewrites `startHead` out of HEAD's ancestry | Data | Low | Low | D10: rebase translation maps `startHead` with the row's other SHAs; an unmapped one routes to the judge (D12), failing toward judgement, never toward acceptance. |
| Two refused checks on one task mint two obligations and the older goes stale | Data | Medium | Medium | 09-06 decision 13: one live `done-when-citation` obligation per task covering every open refused check, superseding under the existing current-obligation rule. |
| The new top-level CLI command trips the self-host release gate (`bin/conduct CLI` surface) | Integration | High | Low | Condition 2 below. |

## ADRs Created

None. Amended, both APPROVED and on main:

- `adr-2026-08-22-done-when-evidence-at-task-close` (D10–D18)
- `adr-2026-09-06-reopened-task-resolution` (decision 13)

The plan must carry Architecture Obligation Coverage rows for every decision of both ADRs.

## Assumptions

| Assumption | Confidence | Basis | Impact if wrong | Status |
|---|---|---|---|---|
| A judgement at the BUILD-completion boundary, inside the same BUILD step, satisfies "sent back to BUILD at close time" | 75% | inferred | The judge would need a provider runtime inside `task done` | APPROVED by operator 2026-10-21 |
| Provenance is the start→close window, not trailers; a test another concurrent task added in that window counts as new | 85% | inferred | Concurrent tasks could launder a test | APPROVED by operator 2026-10-21 |
| "Added or changed" is satisfied mechanically only by a title on an added line; a test with only its body edited goes to the judge | 90% | verified | Extra judge cost on body-only edits | APPROVED by operator 2026-10-21 |
| At the bound, demote to `unverified` (D8 path) rather than halt | n/a | operator decision | — | APPROVED by operator 2026-10-21 |
| A judge outage demotes and never blocks | n/a | operator decision | — | APPROVED by operator 2026-10-21 |
| The lever is the top-level `done-when accept`; its durable record is the close record plus a spine event (no PR-body section) | n/a | operator decision | — | APPROVED by operator 2026-10-21 |

## Conditions

1. **Reuse, don't parallel.** The reopen must go through the existing repair-obligation admission and resolver (09-06 decision 13), and the BUILD re-entry through the existing completion → retry-hint path. No new reopen store, resolver branch, or retry counter beyond the per-check refusal count.
2. **Release gate.** `done-when accept` is an additive top-level command. The build must carry either a `## Migration` block or a `.docs/release-waivers/<plan-stem>.md` waiver naming `bin/conduct CLI` with an internal-additive rationale. Decide this in the plan, not at SHIP.
3. **Stall safety.** A story must prove that a refusal-reopen followed by a re-close does not trip the no-progress breaker or the daemon `no_task_progress` stall.
4. **Exhaustive sources.** Every reader of close-record `source` matches all seven values exhaustively, with no catch-all default.

## Blocking Issues

None.
