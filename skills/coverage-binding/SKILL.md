---
name: coverage-binding
disable-model-invocation: true
description: "Judge whether the cited Done when checks assert the supplied criterion."
enforcement: gating
phase: build
---

## Judgement policy

Each claim is judged independently against its cited task's `Done when` checks. For each claim,
answer this one question: does at least one cited check assert that claim's criterion? No claim's
verdict may be inferred from another claim.

Return `asserts` only when a cited check explicitly requires the criterion's behavior. Topical
adjacency, related implementation work, or a plausible inference is `does-not-assert` when the
check does not actually require that behavior.

Judge observable outcomes, not wording. A check that requires the same observable outcome with
equal or greater precision asserts it, even when phrased differently: "rejected naming the field"
asserts "the rejection names the field", and "byte-identical" asserts "equal". A check with lesser
precision does not: "deep-equal" does not assert "byte-identical". A criterion clause that only
restates the consequence of an asserted check's failure under an existing gate (for example "fails
before the change can land" when the check asserts the integrity suite fails) is asserted by that
check.
Every other outcome in the criterion, including absence and no-op outcomes, still needs a check
that requires it.

A check asserts every outcome its required observable state entails. A check that pins an exact
final state asserts the absence of any other change to that state: "the inbox listing equals the
seeded listing minus the claimed file" asserts "no other inbox file is renamed", and "`ledger.json`
is byte-identical before and after" asserts "no entry's status, attempts, or timestamps change".
Judge entailment from the supplied text alone; do not assume implementation behavior.

Judge only the supplied criterion's own clauses. Never require an outcome the criterion does not
state, and never require a check to restate a criterion word whose observable outcome the check
already pins. Before returning `does-not-assert`, name in `missingAssertion` the exact criterion
clause no cited check requires, quoted from the criterion; if you cannot quote one, the verdict is
`asserts`.

## Amendment claims

An amendment claim supplies a DECIDE artifact path, its `> **Amended …**` block, and every plan
task with its `Done when` checks. Judge it independently. Return `carried` only with one or more
issued task ids that explicitly carry the amendment's obligation. Return `not-carried` with a
non-empty `missingObligation` when the plan omits required work. Return `no-plan-obligation` when
the amendment creates no plan obligation. `contradictsCompleted`, when present, is an optional list
of only issued completed task ids; do not include it otherwise.

Do not read files, inspect a diff, use a transcript, or infer facts beyond the supplied pair.

## Result contract

Return exactly one JSON object and no surrounding prose:

```json
{ "verdicts": [ { "id": "c1", "verdict": "asserts" }, { "id": "c2", "verdict": "does-not-assert", "missingAssertion": "..." } ] }
```

Return one entry per supplied claim, keyed by the supplied claim `id` copied exactly. `verdict` is closed to `asserts`
or `does-not-assert`. Include a non-empty `missingAssertion` only with `does-not-assert`.
