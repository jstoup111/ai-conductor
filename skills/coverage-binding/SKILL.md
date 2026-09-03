---
name: coverage-binding
disable-model-invocation: true
description: "Judge whether the cited Done when checks assert the supplied criterion."
enforcement: gating
phase: build
---

## Judgement policy

Judge only the supplied criterion and the cited task's `Done when` checks. Answer this one question:
does at least one cited check assert the criterion?

Return `asserts` only when a cited check explicitly requires the criterion's behavior. Topical
adjacency, related implementation work, or a plausible inference is `does-not-assert` when the
check does not actually require that behavior.

Do not read files, inspect a diff, use a transcript, or infer facts beyond the supplied pair.

## Result contract

Return exactly one JSON object and no surrounding prose:

```json
{ "verdict": "asserts" }
```

or:

```json
{ "verdict": "does-not-assert", "missingAssertion": "what the Done when checks fail to require" }
```

`verdict` is closed to `asserts` or `does-not-assert`. Include a non-empty `missingAssertion` only
with `does-not-assert`.
