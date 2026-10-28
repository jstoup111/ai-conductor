# Conflict Check: Pipeline batch evaluators remain an unenforced second review authority

**Date:** 2026-10-12
**Stories checked:** `.docs/stories/pipeline-batch-evaluators-remain-an-unenforced-sec.md` Stories 1–8, against every
file in `.docs/stories/`. The candidate set came from searching for evaluator, `review.json`, closeout, sibling-ledger
tail, and security-default subjects; non-matching files share no behavior, entity, or gate with this spec.
**Result:** Clean on re-check. Two blocking conflicts were found and resolved by the operator; no degrading conflicts
were accepted.

## ADR corpus

**Examined (subject overlaps the stories):**
- adr-2026-08-22-one-owner-per-review-question
- adr-2026-08-22-build-review-opt-in-rubric-container
- adr-2026-08-08-pipeline-owned-closeout-timestamps
- adr-2026-08-26-remove-retrospectives-one-shot
- adr-2026-08-13-stable-build-review-finding-dispositions
- adr-2026-08-09-hook-owned-containment-event-ledger
- adr-2026-08-09-reseal-audit-rides-the-existing-event-spine
- adr-2026-09-06-inbound-intake-trust-boundary
- adr-2026-10-01-daemon-session-command-contracts
- adr-2026-07-17-verify-only-judged-closure
- adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator
- adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry (new)

**Narrowed out:** every other APPROVED ADR in `.docs/decisions/`. None governs batch-boundary review, closeout events,
the sibling ledger, build_review rubric defaults, or evaluator routing. No ADR was excluded as fully superseded.

## Conflict: Removing the batch evaluator removes D3's gate-enforced closeout emission

**Stories involved:** Story 1 (batch boundary advances on simplify, lint, affected tests) vs ADR: Pipeline emits closeout events onto the bus from its own process
**Files:** [.docs/stories/pipeline-batch-evaluators-remain-an-unenforced-sec.md] vs [.docs/decisions/adr-2026-08-08-pipeline-owned-closeout-timestamps.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-08-08-pipeline-owned-closeout-timestamps
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "The existing blocking batch-boundary gate (`skills/pipeline/SKILL.md:288-299`, which today stat-checks `review.json` for non-emptiness) extends to require that the obligation's event was recorded"
**Story opposing sentence (verbatim):** "Given a pipeline session whose `.pipeline/pipeline-events.jsonl` holds no closeout record of any kind, when the orchestrator reaches the batch boundary, then the `/pipeline` skill names no closeout record or `closeout-event` call as a precondition and instructs no `closeout-event` invocation."

**Description:** The evaluator is the only emitter of closeout events. Verified (95%): no skill, agent, or hook calls
`closeout-event` for any other obligation. Retiring it leaves D3's gate with nothing to enforce, and leaves the whole
closeout-telemetry channel without a producer. The root is in the design, so architecture was re-opened in amendment mode.

**Resolution Options:**
1. Amend D3 to tolerant-only telemetry and keep the vocabulary.
2. Move the gate onto a `/simplify` closeout bracket.
3. Retire the closeout-obligation telemetry channel.

**Resolution (operator, 2026-10-12):** Option 3, folded into this spec with tier raised to Large. Recorded as
adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry (APPROVED). That ADR supersedes adr-2026-08-08 D1, D3, and
D4's closeout timeline, and keeps D2's sibling ledger for the build-review and kickback-budget events. Additive
amendment notes were placed in adr-2026-08-08 and adr-2026-08-26-remove-retrospectives-one-shot decision 3. Stories 2,
7, and 8 now carry the retirement, the tail's admitted-type check, and the reduced rollup.

## Conflict: Accepted stories on main assert removed or changed behavior

**Stories involved:** Stories 1, 2, 4, 5, 7, and 8 vs accepted stories in ten earlier spec files
**Files:** [.docs/stories/pipeline-batch-evaluators-remain-an-unenforced-sec.md] vs the ten files listed below
**Type:** contradiction
**Severity:** blocking

**Description:** Earlier accepted stories assert behavior this spec removes or changes. The assertions fall into five
groups:
- **Batch-boundary gate:** the batch boundary blocks on `review.json` and the evaluator closeout event.
- **Closeout CLI and events:** `closeout-event start|end evaluator` exits 0. Closeout events reach the OTel histogram,
  span, renderer, and daemon log. The rollup carries a closeout segment.
- **Pipeline evaluator routing:** a pipeline evaluator scaling table carries a risk-domain override. Evaluator dispatch
  rules stay unchanged.
- **Security default:** `security` resolves `enabled: false` by default, and only `implementationQuality` dispatches
  under a default config.
- **Event lists:** `pipeline_closeout` appears among persisted and metered event kinds.

For each pair, fully satisfying this spec makes the earlier criterion false. The reverse is also true: keeping the
earlier criterion makes this spec's story false.

Files:
- `build-post-task-tail-telemetry.md` (Stories 2–6)
- `closeout-timing-events-record-wrong-units-inflatin.md` (Stories 1–4)
- `fix-otel-step-duration-histogram-bucket-saturation.md` (Story 2)
- `remove-retrospectives-full-and-micro-from-feature-.md` (Story 3)
- `loop-halt-never-reaches-events-jsonl-so-a-halt-is-.md` (persist:false event list)
- `feature-cost-and-shipment-metrics-cannot-be-groupe.md` (Story 5)
- `simplify-evaluator-model-routing-to-a-two-way-risk.md` (Stories 1–2)
- `pipeline-scope-per-task-verify-to-affected-tests-f.md` (batch-boundary story)
- `grade-the-diff-for-security-defects-before-ship-vi.md` (Stories 1 and 5)
- `medium-tier-evaluator-policy-enforce-at-the-conduc.md` (Story 1)

**Resolution Options:**
1. Rewrite each superseded assertion in place as current behavior.
2. Leave the shipped stories as history and accept the conflicts as degrading.

**Resolution (operator, 2026-10-12):** Option 1. Each superseded assertion was replaced in place with current behavior,
with no amendment record. The pre-existing amendment blocks in the touched files were folded into their text, and the
id-less headings in `pipeline-scope-per-task-verify-…` gained ids. This was committed before landing as
`spec: amend closeout ADRs and superseded stories for batch-evaluator retirement (#3056)`.

## Pairs examined and found compatible

- **Story 7 vs `build-review-rubric-dispositions-and-fan-out` (merged reader, external writers):** Story 7 keeps every
  admitted build-review kind re-emitting, and the merged reader is untouched.
- **Story 4 vs adr-2026-08-22-build-review-opt-in-rubric-container decision 1:** compatible after the #3056 amendment
  note, which is committed on the spec branch.
- **Story 3 vs adr-2026-07-17-verify-only-judged-closure:** that ADR already refuses evaluator APPROVE as completion
  evidence. Story 3 removes the remaining claims, so the two agree.
- **Story 5 vs `simplify-evaluator-model-routing-…` (as rewritten):** the `/code-review` row keeps its default plus
  risk-domain switch, so the two agree.
- **Story 1 vs `pipeline-scope-per-task-verify-…` Story 3 (as rewritten):** both keep `/simplify`, lint, and
  `BATCH_AFFECTED_TESTS` at the boundary.
- **Oscillation sweep:** for every pair above, each story still holds when the other is fully satisfied. No two-way
  failure was found.
