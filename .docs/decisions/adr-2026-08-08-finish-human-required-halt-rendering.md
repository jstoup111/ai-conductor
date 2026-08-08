# ADR: FINISH human-required halts render reason, next action, and provider detail

**Date:** 2026-08-08
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer loop (intake jstoup111/ai-conductor#1107)

## Context

FINISH is engine machinery. A blocker that only a human can clear is expressed as
`PublicationDisposition { kind: 'human_required'; reason: string }`, which
`routeFinishPublicationDisposition` turns into `{ kind: 'halt', reason }`, which the conductor
writes verbatim via `writeHaltMarker(route.reason, 'needs-human')`
(`conductor.ts:5712-5719`). `daemon-rekick.ts:186` already refuses to re-kick a `needs-human`
HALT, so the *routing* is correct and is not in question here.

Two forces make the current shape inadequate:

1. **The halt text is an identifier, not an explanation.** `reason` carries a token such as
   `judgment_refused` or `ambiguous_pr_identity`. That token is what lands in `.pipeline/HALT`
   and what the operator reads. The actual blocker — the thing that would tell them what to do —
   remains only in `daemon.log` prose. This is the unmet half of #1107.

   The module already solves this problem once, for a different disposition arm:
   `PUBLICATION_CONDITIONS` maps each condition code to `{ message, nextAction }`. The
   `human_required` arm has no equivalent.

2. **The `refused` verdict is unreachable.** `PrProseJudgmentResult` includes a `refused` kind, and
   `mapPrProseJudgmentResult` maps it to `human_required`. But `skill-invocation.ts:49` dispatches
   `/finish` with zero arguments, so `skills/finish/SKILL.md` is the provider's entire instruction
   set — and it never states the `{"kind": ...}` verdict contract. That vocabulary appears only in
   `finish-publication*.ts` and its own tests (verified by repo-wide grep excluding `node_modules`
   and `dist-versions`). A genuinely refusing provider therefore replies in prose,
   `parseFinishPrProseJudgment` finds no JSON object, and `decodePrProseJudgment` fails closed —
   post-#1372, to `malformed_response`, which routes to `publication_retry`. The refusal is not
   merely misnamed; it is spent as a retry and never reaches the operator at all. (See the
   Amendment below: before #1372 this degraded to a halt named `judgment_malformed_prose`, which
   named the wrong cause but at least stopped.)

There are 15 `human_required` construction sites spanning 10 distinct reason tokens: the four in the
judgment/PR-identity arm (`judgment_refused`, `judgment_halt_prose`, `ambiguous_pr_identity`,
`invalid_shipped_record`) and six in intent resolution (`interactive_intent_deferred`,
`interactive_intent_declined`, `interactive_intent_destructive_choice`,
`interactive_intent_unrecognized`, `unattended_intent_destructive_choice`,
`unattended_intent_unauthorized_outcome`).

## Options Considered

### Option A: Reason-expansion map plus an optional provider-supplied `detail`
- **Pros:** Mirrors `PUBLICATION_CONDITIONS`, a pattern already resident in the same module, so the
  change reads as native. Fixes both the wording and the reachability defect. No new durable
  artifact, so no new staleness or sweep semantics. Rendering can live inside
  `routeFinishPublicationDisposition`, leaving `conductor.ts` completely untouched.
- **Cons:** `isExactDisposition`'s `human_required` arm is an exact-key guard
  (`hasOnly('kind', 'reason')`), so admitting `detail` moves the guard, every construction site,
  and the tests that assert the exact shape.

### Option B: Publish the verdict contract only
- **Pros:** ~1h, zero engine risk; `refused` becomes reachable and stops being spent as a
  `judgment_malformed_response` retry.
- **Cons:** Leaves the halt text an enum token. The operator still reads the blocker out of
  `daemon.log`, which is the complaint that motivated the intake.

### Option C: A structured blocker artifact (`.pipeline/finish-blocker.json`)
- **Pros:** Machine-readable by `daemon-triage` and the dashboard, not merely human-readable.
- **Cons:** Introduces a second durable artifact whose staleness and sweep semantics must be
  designed and maintained, to carry routing that `.pipeline/HALT` + `.pipeline/HALT.class` already
  carry. Its one unique benefit — a programmatic seam — has no consumer today.

## Decision

**Option A**, with two conditions attached by the operator at review.

The rendering happens inside `routeFinishPublicationDisposition`'s `human_required` arm, not in a
new export the conductor is expected to call. `route.reason` therefore arrives at the existing
`writeHaltMarker` site already in prose form, and `conductor.ts` requires no change at all. This
keeps the production wiring surface at exactly one caller, which is the caller that exists today.

**Condition 1 — the reason union must be closed.** `PublicationDisposition`'s `human_required.reason`
is currently typed `string` (`finish-publication.ts:408`) while the inner routing union at :1008 is
closed. A map keyed on `string` gets no exhaustiveness checking from the compiler, so a future
reason token would silently render nothing. Narrow the field to the closed union of the 10 tokens so
the map is exhaustive by construction, **and** retain a fail-closed generic rendering for any token
that still fails to resolve at runtime. Both, not either — the compiler check prevents the omission,
the runtime fallback prevents a blank halt if one slips through a boundary the compiler does not see
(the guard accepts `unknown` precisely because a future adapter can hand it a malformed value).

**Condition 2 — the reliance on provider compliance is recorded as an accepted cost.** This
repository's Design Principle prefers deterministic machinery over prompt discipline, and publishing
the verdict contract in `SKILL.md` is prompt discipline: `refused` becomes reachable only if the
provider actually emits the documented JSON. This is accepted because the failure mode is already
safe — `decodePrProseJudgment` fails closed, so a non-compliant provider degrades to a halt carrying
a generic reason and never to a false pass. The cost is a less precise halt reason, never an
unsound one. Should a machinery-only route to reachability appear, it supersedes this.

## Consequences

### Positive
- The operator reads the blocker and its next action directly from `.pipeline/HALT`.
- The `refused` verdict becomes reachable, so a deliberate refusal is finally distinguishable from
  malformed prose in the halt record.
- Adding a future `human_required` reason without a map entry becomes a compile error.
- `conductor.ts` is untouched; the blast radius stays inside one module, its tests, and one
  `SKILL.md`.

### Negative
- The exact-key guard, all 14 construction sites, and the tests asserting the exact disposition
  shape move together. This is the single largest reason the feature is tier M rather than S.
- Reachability depends on provider compliance with a documented contract, which this repository's
  Design Principle disfavors (see Condition 2 for why it is accepted).
- `finish-publication.ts` is declared by roughly 29 unmerged spec branches, so rebase-conflict
  exposure on this file is high irrespective of this design.

### Follow-up Actions
- [ ] Narrow `human_required.reason` to the closed 12-token union and widen `isExactDisposition` to
      admit an optional non-empty `detail`.
- [ ] Add `HUMAN_REQUIRED_REASONS` mapping every token to `{ message, nextAction }`, mirroring
      `PUBLICATION_CONDITIONS`.
- [ ] Render `message + nextAction + detail` inside `routeFinishPublicationDisposition`, with a
      fail-closed generic rendering for an unresolved token.
- [ ] Carry a provider-supplied blocker sentence into `detail` for `refused` and
      `revision_required`.
- [ ] Publish the PR-prose verdict JSON contract in `skills/finish/SKILL.md`.
- [ ] Update `docs/runbooks/stalled-or-stuck-feature.md` and `docs/reference/steps.md` for the
      changed operator-visible halt text.

## Amendment — 2026-08-08, post-#1372

**Amended by:** James Stoup (operator), interactive session. **Status is unchanged: the decision
stands.** Option A, both conditions, and every follow-up above remain in force. This amendment
corrects premises and an inventory that merged commit `5bbc109e8` (#1372) invalidated after this
ADR was accepted; it re-decides nothing.

`acceptance_specs` refused to author specs against the un-amended artifacts and wrote a
`needs-human` HALT naming the conflict. That refusal was correct and is the reason this section
exists.

**What #1372 changed.** It split the decoder's fail-closed fallback out of the verdict union:
`malformed_response` is now a distinct kind (`finish-publication.ts:883`), deliberately not
collapsed into `structurally_incomplete` "because the two need opposite routing". Unparseable
provider output routes to `publication_retry` (:1075-1083); it no longer halts. `revision_required`
with `placeholder` or `structurally_incomplete` routes to `author_pr_prose` (:1091-1101). The
tokens `judgment_placeholder_prose` and `judgment_malformed_prose` no longer exist.

**Corrections applied above.**

| Was | Now | Verified at |
|---|---|---|
| unstructured prose → `revision_required`/`structurally_incomplete` → halt `judgment_malformed_prose` | → `malformed_response` → `publication_retry`, no halt | `finish-publication.ts:883`, :1075-1083 |
| 14 construction sites, 12 tokens | 15 sites, 10 tokens | mechanical grep of `finish-publication.ts` |
| judgment arm of six tokens | four: `judgment_refused`, `judgment_halt_prose`, `ambiguous_pr_identity`, `invalid_shipped_record` | :1008-1013 |
| `human_required.reason` at :396, inner union at :926 | :408 and :1008 | line drift only; the `string` typing defect is unchanged and still unfixed |

**The motivation strengthened rather than weakened.** Before #1372 a refusing provider's prose
produced a halt with the wrong name. It now produces a *retry*, so the refusal is consumed by the
publication progress allowance and the operator never sees it. Publishing the verdict contract
(Follow-up 5) is what makes a deliberate refusal expressible at all, and it is now load-bearing
rather than a nicety.

**Condition 2 is unaffected but its cost is now higher**, because the non-compliant degradation
path is a retry rather than a halt. It remains sound — the allowance is bounded, so a
non-converging provider still stops — but it fails *later* and less legibly than when this ADR was
accepted.
