# Conflict Check: Provider substitution policy and exhaustion suppression (#1492)

**Date:** 2026-09-23
**Stories scanned:** `.docs/stories/usage-exhaustion-re-dispatches-the-exhausted-provi.md` (Stories 1-6), plus every existing file in `.docs/stories/`
**ADR corpus:** `repo_wide` (`conflict_check.adr_corpus` in `.ai-conductor/config.yml:163-164`)
**Result:** 1 blocking conflict resolved, 2 degrading conflicts resolved. Re-check clean.

## Corpus accounting

318 ADR files present. 10 excluded as unambiguously fully superseded; 308 examined by subject.
Narrowed to the 28 whose subject overlaps these stories' behavior, entities, fields, or gates:

`adr-2026-07-05-daemon-rate-limit-episode-coordinator`, `adr-2026-07-03-reactive-model-fallback-ladder`,
`adr-2026-07-05-retry-as-escalation-ladder`, `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`,
`adr-2026-07-30-provider-preparation-lifecycle-supervision`, `adr-2026-08-24-one-dispatch-member-on-the-provider-contract`,
`adr-2026-07-26-event-sink-registry-exhaustiveness`, `adr-2026-08-11-halt-events-ride-the-persisted-spine`,
`adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal`, `adr-2026-07-04-auth-failure-park-and-poll`,
`adr-2026-07-22-auth-failure-classification-observed-401-patterns`, `adr-2026-07-22-daemon-level-missing-credential-gate`,
`adr-2026-07-27-cold-start-within-step-retries`, `adr-2026-07-13-retry-classify-rerun-vs-route`,
`adr-2026-08-19-unretryable-step-runner-failures-route-by-kind`, `adr-2026-08-24-refused-step-status`,
`adr-2026-07-29-engine-observed-provider-time-partition`, `adr-2026-09-10-shared-step-lifecycle-telemetry`,
`adr-014-otel-observability-exporter`, `adr-2026-08-27-daemon-dispatcher-executor-seam`,
`adr-2026-07-27-codex-never-resumes-a-harness-minted-session`, `adr-2026-07-29-codex-readiness-probe-failure-disposition`,
`adr-2026-08-12-live-provider-coverage-from-plugin-registry`, `adr-2026-08-12-per-provider-live-smoke-legs`,
`adr-2026-07-28-total-halt-classification-legacy-boundary`, `adr-2026-08-05-blocked-is-a-distinct-state-from-halted`,
`adr-2026-07-06-migration-gate-waiver`, `adr-2026-08-11-deprecated-no-op-step-retirement`.

Narrowed out: the remaining 280 approved ADRs, whose subjects (memory subsystem, intake claim and
ledger, rebase and conflict resolution, PR publication and release mechanics, build_review rubrics
and findings, coherence and story-token parsing, worktree reaping and park markers, attribution and
evidence judging, docs and Pages) touch no behavior, entity, field, or gate these six stories
address. Narrowing was performed by reading every ADR title in the corpus, not by keyword search.

## Conflict: Suppression scope swallows the auth-failure recovery path

**Stories involved:** Story 3 (provider not re-dispatched for the rest of its window) vs ADR: Auth failure park-and-poll
**Files:** [.docs/stories/usage-exhaustion-re-dispatches-the-exhausted-provi.md] vs [.docs/decisions/adr-2026-07-04-auth-failure-park-and-poll.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-07-04-auth-failure-park-and-poll
**Story ID:** 3
**ADR opposing sentence (verbatim):** "On refresh: **re-copy credentials into the existing sandbox** (a copy, preserving TR-6) and resume the same attempt with the retry budget intact."
**Story opposing sentence (verbatim):** "Given a provider observed usage-exhausted during a step, when a later step in the same run resolves candidates, then that provider is refused without a subprocess while its window is unexpired."

**Description:** The suppression trigger the stories describe sits behind
`hasRecoveryPrecedence` (`engine/provider-execution.ts:322-328`), which is a single guard covering
`authFailure`, `rateLimited`, and `sessionExpired` together. An implementation that suppresses on
that guard rather than on usage exhaustion specifically would suppress a provider that merely
failed authentication. The ADR's park-and-poll then waits for the operator to refresh credentials
and resumes **the same attempt** — but that resumed attempt now meets a suppressed provider and is
refused, so the park can never succeed and the credential refresh it waited for is wasted.

Direction check: fully satisfying the ADR leaves Story 3 intact, because usage exhaustion is
untouched by the auth path. Fully satisfying an unscoped Story 3 breaks the ADR. One direction
fails, so this is an ordinary contradiction rather than an oscillation.

**Resolution Options:**
1. Scope suppression to usage exhaustion alone, stating in the stories that the auth-failure and
   expired-session classes never open a suppression window.
2. Suppress on the whole guard, and have the park-and-poll path clear the suppression before it
   resumes.
3. Suppress on the whole guard, and exempt the resumed attempt from admission.

**Recommendation:** Option 1, because it is the narrowest change, keeps the two mechanisms
independent, and avoids giving the admission gate a bypass — the thing ADR D1 of this feature's own
decision record exists to prevent. Options 2 and 3 both introduce exactly such a bypass.

**Resolution applied (operator-selected):** Option 1. Story 3's requirement line now scopes
suppression to usage exhaustion and excludes the auth-failure and expired-session classes; two
negative-path criteria and one Done-When checkbox assert that neither class opens a window. Story 5
gains a criterion stating an auth failure creates no window to expire from.

## Conflict: Candidate refusal and step-level refused status share a word

**Stories involved:** Story 6 (refusing every candidate still waits) vs ADR: Refused step status
**Files:** [.docs/stories/usage-exhaustion-re-dispatches-the-exhausted-provi.md] vs [.docs/decisions/adr-2026-08-24-refused-step-status.md]
**Type:** resource-contention
**Severity:** degrading
**ADR filename stem:** adr-2026-08-24-refused-step-status
**Story ID:** 6
**ADR opposing sentence (verbatim):** "`refused` means: this step's own work did not fail — an entry condition, environmental guard, or human-judgement boundary ended the attempt."
**Story opposing sentence (verbatim):** "Given every candidate for a step is suppressed, when the step runs, then it yields the rate-limited outcome and the conductor enters its existing wait."

**Description:** "Refusal" is used at two layers. The ADR makes `refused` a `StepStatus` whose
decision 2 states it does not satisfy prerequisites, and whose decision 3 adds a `step_refused`
event with a closed refusal-kind vocabulary. This feature's refusals are candidate-level skips
recorded on `provider_attempt`. The two do not contradict, but the shared word invites an
implementer reading "every candidate refused" to stamp the step `refused` — which would convert
this feature's intended wait into a non-satisfying step status behind a halt, the exact R1 failure
the architecture review registered as High impact.

**Resolution Options:**
1. State in Story 6 that an all-suppressed step stamps no step-level refused status and emits no
   step-refusal event.
2. Rename this feature's candidate-level concept to avoid the word entirely.
3. Leave it, relying on review to catch a wrong stamp.

**Recommendation:** Option 1. Option 2 discards the `provider_attempt` record's existing
vocabulary for no behavioral gain, and option 3 relies on discipline where a criterion is cheap.

**Resolution applied (operator-selected):** Option 1. Story 6 gains a negative-path criterion and a
Done-When checkbox asserting the step carries no refused status and emits no step-refusal event.

## Conflict: A new durability event would owe a sink declaration

**Stories involved:** Story 3 (suppression survives the dispatch boundary) vs ADR: Event sink registry exhaustiveness
**Files:** [.docs/stories/usage-exhaustion-re-dispatches-the-exhausted-provi.md] vs [.docs/decisions/adr-2026-07-26-event-sink-registry-exhaustiveness.md]
**Type:** sequencing
**Severity:** degrading
**ADR filename stem:** adr-2026-07-26-event-sink-registry-exhaustiveness
**Story ID:** 3
**ADR opposing sentence (verbatim):** "Adding a member to `ConductorEvent` therefore fails compilation until that member declares where it goes."
**Story opposing sentence (verbatim):** "The suppression record reaching the daemon-wide ledger is not feature-forwarded, proven by asserting it is present in that ledger after a feature-run emission."

**Description:** Story 4 extends the existing `rate_limit` record with optional fields and owes the
registry nothing. Story 3's durability requirement, however, leaves open whether the daemon-origin
suppression record is that same extended event or a new union member — and this feature's own ADR
records that choice as a `/plan` follow-up. If it is a new member, the registry is total and the
declaration is due at introduction, not later.

**Resolution Options:**
1. Attach the obligation to Story 3 conditionally, so it binds only if a new type is introduced.
2. Decide the mechanism now, in stories.
3. Defer entirely to `/plan`.

**Recommendation:** Option 1. Option 2 would put mechanism into a story, which stories are not for;
option 3 risks the obligation being discovered at compile time rather than stated as acceptance.

**Resolution applied (operator-selected):** Option 1. Story 3 gains a conditional Done-When
checkbox binding the sink declaration if a new event type is introduced.

## Examined and clean

- **adr-2026-07-03-reactive-model-fallback-ladder** — a precedent, not a conflict. Its decision 4
  pre-invoke cache consult is the same shape as this feature's admission gate, and its decision 3
  guarantee that "the retry budget is structurally incapable of being consumed by downgrades"
  agrees with Story 6. Layering is consistent: admission runs at the candidate layer, above the
  per-provider model ladder, so a suppressed provider never reaches the ladder.
- **adr-2026-07-05-retry-as-escalation-ladder** — decisions 2 and 4 govern attempt-indexed
  escalation and the retry-budget floor. Story 6's requirement that suppression not consume the
  budget matches the existing rate-limit contract rather than competing with it.
- **adr-2026-08-24-one-dispatch-member-on-the-provider-contract** — decision 1 makes `invoke` the
  sole dispatch member. The admission gate sits strictly before it and adds no second member.
- **adr-2026-07-05-daemon-rate-limit-episode-coordinator** — the governing prior decision, cited
  and preserved by this feature's ADR decision 8 rather than superseded. Its decision 2 dispatch
  gate and decision 10 shared escalation counter are untouched; Story 6 asserts the module is
  unmodified.
- **adr-2026-07-28-total-halt-classification-legacy-boundary** and
  **adr-2026-08-05-blocked-is-a-distinct-state-from-halted** — Story 6's negative paths keep the
  suppressed case out of both vocabularies entirely, so neither closed set is extended.
- **adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal** — decision 4's total
  registry binds the new key; Story 1's Done-When carries it. An obligation, not a conflict.
- The remaining narrowed ADRs were compared pairwise against all six stories in both directions
  with no contradiction, overlap, state conflict, resource contention, sequencing conflict, or
  oscillation found.

## Re-check

Re-run after the three resolutions: **zero blocking conflicts, zero unresolved degrading
conflicts.** Conflict check passed.
