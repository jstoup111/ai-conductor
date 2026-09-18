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

Do not read files, inspect a diff, use a transcript, or infer facts beyond the supplied pair.

## Result contract

Return exactly one JSON object and no surrounding prose:

```json
{ "verdicts": [ { "digest": "...", "verdict": "asserts" }, { "digest": "...", "verdict": "does-not-assert", "missingAssertion": "..." } ] }
```

Return one entry per supplied claim, keyed by the supplied `digest`. `verdict` is closed to `asserts`
or `does-not-assert`. Include a non-empty `missingAssertion` only with `does-not-assert`.
