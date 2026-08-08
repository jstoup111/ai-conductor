**Status:** Accepted

# Stories: FINISH refusal reaches the operator with its reason

Technical track (no PRD) · Tier M · intake jstoup111/ai-conductor#1107
Source of intent: `adr-2026-08-08-finish-human-required-halt-rendering.md` (APPROVED)
Review: `architecture-review-2026-08-08-finish-s-stop-gate-does-not-stop-a-correct-refusal.md`
(APPROVED WITH CONDITIONS)

The twelve `human_required` reason tokens in scope: `judgment_refused`,
`judgment_placeholder_prose`, `judgment_halt_prose`, `judgment_malformed_prose`,
`ambiguous_pr_identity`, `invalid_shipped_record`, `interactive_intent_deferred`,
`interactive_intent_declined`, `interactive_intent_destructive_choice`,
`interactive_intent_unrecognized`, `unattended_intent_destructive_choice`,
`unattended_intent_unauthorized_outcome`.

Documentation updates required by review Condition 3 (`docs/runbooks/stalled-or-stuck-feature.md`,
`docs/reference/steps.md`) deliberately carry **no story** — they accompany functional work and are
tracked as plan tasks, per the stories skill's documentation boundary.

---

## Story 1: The human-required reason becomes a closed union and the guard admits a bounded detail

**Requirement:** ADR Follow-up 1 · Review Condition 1 (first half)

As the conductor engine, I want `human_required.reason` typed as the closed twelve-token union and
`isExactDisposition` to admit an optional non-empty `detail`, so that a future reason token cannot
be added without a rendering and a malformed disposition still cannot reach the halt marker.

### Acceptance Criteria

#### Happy Path
- Given a disposition `{ kind: 'human_required', reason: 'judgment_refused' }` with no `detail`,
  when `isExactDisposition` evaluates it, then it returns true and the disposition routes unchanged.
- Given a disposition `{ kind: 'human_required', reason: 'judgment_refused', detail: 'CHANGELOG
  carries an unsubstituted token' }`, when `isExactDisposition` evaluates it, then it returns true.
- Given source that constructs a `human_required` disposition with a reason token outside the
  twelve, when the package is type-checked, then compilation fails.

#### Negative Paths
- **Invalid input:** Given `{ kind: 'human_required', reason: 'judgment_refused', detail: '' }`,
  when `isExactDisposition` evaluates it, then it returns false and the router yields
  `{ kind: 'halt', reason: 'Unknown or contradictory FINISH publication disposition; human review
  required.' }` — an empty `detail` is rejected rather than rendered as a blank line.
- **Invalid input:** Given `{ kind: 'human_required', reason: 'judgment_refused', detail: 42 }`,
  when `isExactDisposition` evaluates it, then it returns false (non-string `detail` rejected).
- **Invalid input:** Given `{ kind: 'human_required', reason: 'judgment_refused', extra: 'x' }`,
  when `isExactDisposition` evaluates it, then it returns false — the guard stays exact-key and does
  not become permissive as a side effect of admitting `detail`.
- **Data integrity:** Given `{ kind: 'human_required' }` with no `reason` at all, when
  `isExactDisposition` evaluates it, then it returns false.
- **Dependency unavailability:** Given a disposition arriving from a future adapter as `unknown`
  with `reason: 'some_unlisted_token'`, when `isExactDisposition` evaluates it, then it returns
  false and the run halts on the contradictory-disposition path — the runtime boundary stays
  fail-closed even though the compiler now constrains in-repo construction sites.

### Done When
- [ ] `PublicationDisposition`'s `human_required` arm declares `reason` as a union of exactly the
      twelve tokens and `detail?: string`.
- [ ] `isExactDisposition` accepts `hasOnly('kind','reason')` and `hasOnly('kind','reason','detail')`,
      requires `detail` to be a non-empty string when present, and rejects every other key set.
- [ ] All fourteen in-repo `human_required` construction sites compile against the narrowed union
      with no cast or `as` escape.
- [ ] `npm run typecheck` (or the package's equivalent) passes with zero new errors.

---

## Story 2: Every human-required reason token carries an operator-facing message and next action

**Requirement:** ADR Follow-up 2 · Review Condition 1 (second half)

As an operator reading `.pipeline/HALT`, I want each reason token mapped to a message and a next
action, so that the halt tells me what went wrong and what to do rather than naming an identifier.

### Acceptance Criteria

#### Happy Path
- Given the reason `judgment_refused`, when `HUMAN_REQUIRED_REASONS` is consulted, then it yields a
  `{ message, nextAction }` pair whose `message` is a reader-facing sentence and whose `nextAction`
  is a verb-led token, matching the shape `PUBLICATION_CONDITIONS` already uses.
- Given each of the twelve tokens in turn, when the map is consulted, then every one resolves to a
  distinct, non-empty `message` and `nextAction`.

#### Negative Paths
- **Data integrity:** Given the map and the reason union, when the package is type-checked, then a
  map missing any of the twelve keys fails compilation — exhaustiveness is enforced by the compiler,
  not by a test that could drift.
- **Invalid input:** Given a `message` or `nextAction` that is empty or whitespace-only, when the
  suite runs, then a test fails naming the offending token — a present-but-blank entry is as useless
  to the operator as a missing one.
- **Data integrity:** Given two tokens sharing an identical `message`, when the suite runs, then a
  test fails — indistinguishable halt text would reintroduce the ambiguity this feature removes.

### Done When
- [ ] `HUMAN_REQUIRED_REASONS` exists in `finish-publication.ts` as a `Record` keyed by the twelve-
      token union, with `{ message, nextAction }` values, mirroring `PUBLICATION_CONDITIONS`.
- [ ] Removing any key from the map produces a compile error, demonstrated by a type-level test or
      an explicit `satisfies Record<HumanRequiredReason, …>` annotation.
- [ ] A test asserts all twelve entries are non-empty and all twelve messages are distinct.

---

## Story 3: A human-required halt marker reads as prose, and the conductor is unchanged

**Requirement:** ADR Follow-up 3 · Review Condition 1 (fail-closed half)

As an operator, I want `routeFinishPublicationDisposition` to emit already-rendered prose for a
`human_required` disposition, so that `.pipeline/HALT` explains the blocker without any change to
the conductor's halt handling.

### Acceptance Criteria

#### Happy Path
- Given `{ kind: 'human_required', reason: 'ambiguous_pr_identity' }`, when
  `routeFinishPublicationDisposition` runs, then it returns `{ kind: 'halt', reason }` whose text
  contains that token's `message` and its `nextAction`, and does not consist solely of the raw
  token.
- Given the same disposition carrying `detail: 'two open PRs match this branch'`, when the router
  runs, then the returned halt text contains the message, the next action, AND the detail sentence.
- Given any `human_required` disposition, when the conductor's FINISH route handling reaches
  `route.kind === 'halt'`, then it writes the halt via the existing `writeHaltMarker(route.reason,
  'needs-human')` call with no new call site and no signature change.

#### Negative Paths
- **Data integrity:** Given a `human_required` disposition whose reason resolves to no map entry at
  runtime (a value that crossed the `unknown` boundary), when the router runs, then it returns a
  halt whose text names the unresolved token verbatim and states that no guidance is registered for
  it — never an empty string, never a thrown exception.
- **Partial failure:** Given a reason that resolves but whose `detail` is absent, when the router
  runs, then the halt text is well-formed with the message and next action only — no dangling
  separator, no literal `undefined`.
- **Concurrent access:** Given two FINISH attempts for different worktrees rendering halts in the
  same process, when both route concurrently, then each halt text reflects only its own disposition
  — the rendering holds no shared mutable state.
- **Invariant side-effect on alternate branches:** Given every non-`human_required` route arm
  (`complete`, `progress_finish`, `retry_finish`, `retry_build`) and the contradictory-disposition
  early return, when the router runs, then their returned values are byte-identical to the current
  behavior — rendering is confined to the `human_required` arm and leaks into no other outcome.
- **Data integrity:** Given the full test suite, when it runs, then `conductor.ts` shows no diff for
  this feature — a change there means the rendering escaped its intended boundary.

### Done When
- [ ] `routeFinishPublicationDisposition`'s `human_required` arm returns rendered prose containing
      message, next action, and `detail` when present.
- [ ] An unresolved reason token yields a non-empty fail-closed halt text naming the token.
- [ ] `git diff` for the delivered change contains no hunk in `src/conductor/src/engine/conductor.ts`.
- [ ] A test asserts the written `.pipeline/HALT` body for at least one refusal contains the
      message, the next action, and the detail, and that `.pipeline/HALT.class` is `needs-human`.
- [ ] Existing tests asserting the other four route arms pass unmodified.

---

## Story 4: A refusing provider's blocker sentence survives into the halt, bounded

**Requirement:** ADR Follow-up 4

As an operator, I want the provider's own stated blocker carried into the halt as `detail`, so that
the halt names the concrete problem and not merely its category — while a runaway provider cannot
author an unreadable marker.

### Acceptance Criteria

#### Happy Path
- Given a provider verdict `{ "kind": "refused", "detail": "CHANGELOG carries an unsubstituted
  {{IMPLEMENTATION_PR}} token" }`, when `decodePrProseJudgment` and `mapPrProseJudgmentResult` run,
  then the resulting disposition is `{ kind: 'human_required', reason: 'judgment_refused', detail:
  '<that sentence>' }`.
- Given a provider verdict `{ "kind": "revision_required", "reason": "placeholder", "detail": "the
  body still carries the not-yet-authored markers" }`, when the same path runs, then the disposition
  is `judgment_placeholder_prose` carrying that detail.

#### Negative Paths
- **Invalid input:** Given a verdict `{ "kind": "refused" }` with no `detail`, when the path runs,
  then the disposition is `{ kind: 'human_required', reason: 'judgment_refused' }` with `detail`
  absent, and the halt renders cleanly from the map entry alone — an omitted detail is legal.
- **Resource exhaustion:** Given a verdict whose `detail` exceeds the specified character bound,
  when the path runs, then the detail is truncated to the bound with a visible truncation marker and
  the halt marker remains readable.
- **Invalid input:** Given a verdict whose `detail` is an empty or whitespace-only string, when the
  path runs, then `detail` is dropped rather than carried, so the guard's non-empty requirement
  cannot be violated from this source.
- **Invalid input:** Given a verdict whose `detail` is a non-string (number, object, array), when
  the path runs, then `detail` is dropped and the reason still routes correctly.
- **Data integrity:** Given a `detail` containing newlines and Markdown control characters, when the
  halt marker is written, then the text is preserved verbatim within the bound and does not corrupt
  the marker's structure or the `HALT.class` sidecar.
- **Timeouts:** Given a verdict of `{ "kind": "timed_out" }` or `{ "kind": "provider_unavailable" }`,
  when the path runs, then it still maps to `publication_retry`, not to `human_required` — this
  story adds `detail` to the refusal arms only and must not reclassify the retryable ones.

### Done When
- [ ] `PrProseJudgmentResult`'s `refused` and `revision_required` arms accept an optional `detail`.
- [ ] `isPrProseJudgmentResult` validates `detail` as an optional string and rejects other types.
- [ ] `mapPrProseJudgmentResult` forwards `detail` into the `human_required` disposition for both
      arms.
- [ ] The `detail` character bound is a named constant, and a test proves truncation at that bound.
- [ ] Tests cover: detail present, detail absent, detail blank, detail non-string, detail
      over-length, and the two retryable verdict kinds still routing to `publication_retry`.

---

## Story 5: The provider is told the verdict contract, so a refusal is expressible

**Requirement:** ADR Follow-up 5 · ADR Condition 2 (accepted cost)

As the FINISH provider session, I want `skills/finish/SKILL.md` to state the PR-prose verdict
contract, so that a genuine blocker can be reported as `refused` instead of degrading to
`judgment_malformed_prose`.

### Acceptance Criteria

#### Happy Path
- Given `skills/finish/SKILL.md`, when it is read, then it states the exact JSON verdict object the
  provider must emit, enumerating `accepted`, `refused`, and `revision_required` with the latter's
  three `reason` values (`placeholder`, `halt`, `structurally_incomplete`), and documents the
  optional `detail` field with its purpose and bound.
- Given a provider that emits `{"kind":"refused","detail":"…"}` per that documentation, when
  `parseFinishPrProseJudgment` runs over the response, then it extracts the object and
  `decodePrProseJudgment` returns `{ kind: 'refused', detail: '…' }`.

#### Negative Paths
- **Invalid input:** Given a provider that replies in prose with no JSON object, when
  `decodePrProseJudgment` runs, then it still fails closed to
  `{ kind: 'revision_required', reason: 'structurally_incomplete' }` — the documented contract adds
  a capability and removes no existing safety.
- **Invalid input:** Given a provider that emits a JSON object with an unrecognized `kind`, when
  `decodePrProseJudgment` runs, then it fails closed to `revision_required/structurally_incomplete`
  rather than accepting the unknown verdict.
- **Auth/permission failure:** Given a provider dispatch that fails outright (`success: false`), when
  `decodePrProseJudgment` runs, then it returns `provider_unavailable`, which routes to
  `publication_retry` — an infrastructure failure must never be recorded as a deliberate refusal.
- **Data integrity:** Given the harness validation suite, when `test/test_harness_integrity.sh`
  runs, then `skills/finish/SKILL.md` still passes frontmatter, section-numbering, and cross-skill
  reference checks after the contract section is added.
- **Data integrity:** Given the documented contract and the engine's `isPrProseJudgmentResult`, when
  a test compares them, then every `kind` and `reason` value named in `SKILL.md` is one the validator
  accepts — the documentation cannot drift from the parser it instructs.

### Done When
- [ ] `skills/finish/SKILL.md` contains a verdict-contract section with the exact JSON shape, all
      verdict kinds, all `revision_required` reasons, and the optional bounded `detail`.
- [ ] A test asserts the vocabulary documented in `SKILL.md` and the vocabulary accepted by
      `isPrProseJudgmentResult` agree.
- [ ] `test/test_harness_integrity.sh` passes.
- [ ] A test proves an unstructured prose reply still fails closed to
      `revision_required/structurally_incomplete`.

---

## Traceability

| Story | ADR follow-up | Review condition |
|---|---|---|
| 1 | Follow-up 1 | Condition 1 (closed union, guard) |
| 2 | Follow-up 2 | Condition 1 (compiler exhaustiveness) |
| 3 | Follow-up 3 | Condition 1 (fail-closed rendering) |
| 4 | Follow-up 4 | — |
| 5 | Follow-up 5 | Condition 2 (accepted cost recorded) |
| *(no story — plan tasks only)* | Follow-up 6 | Condition 3 (documentation upkeep) |
