# ADR: The engine stamps the rubric judged-result envelope; the provider returns only findings

**Date:** 2026-08-19
**Status:** APPROVED
**Approved:** Operator-approved 2026-08-19
**Deciders:** James Stoup (operator) and architecture review for issue #1683
**Amends:** `adr-2026-08-13-engine-managed-build-review-rubric-branches` §2 — the sentence
requiring branch results to repeat the lap ID and snapshot digest. That ADR's branch topology,
closed-projection principle, skill-owned judgement policy, skip semantics, cache identity, and
fail-closed rules are otherwise unchanged and remain authoritative.
**Conforms to (does not supersede):** `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`
D1/D2; `adr-2026-08-18-content-anchored-finding-reference-schema`; `adr-2026-08-16-closed-build-review-finding-vocabularies` D3/D4; `adr-2026-07-13-retry-classify-rerun-vs-route`

## Context

`build_review` discards rubric judgements that are semantically complete. Two recorded instances:

- **`reporting_app`, 2026-08-16, `rootCause`.** Two consecutive provider outputs carried
  `findings: []` — a clean PASS — but used `"status": "judged"` and then `"type": "judged"`
  instead of `"kind"`, and carried neither `lapId` nor `snapshotDigest`. Both settled as
  `invalid-provider-result`. `scope` and `completeness` complied on the same lap.
- **`ai-conductor`, 2026-08-19, `completeness`.** A fully conformant v3 envelope carrying a
  substantive, correct finding was rejected four times across two laps, and the feature
  terminal-halted `needs-human` with roughly $1–3 of provider spend per re-dispatch cycle and no
  state change.

The coordinator's settlement predicate requires the provider to echo two values the coordinator
already holds:

```ts
result.rubric === rubric && result.lapId === projection.lapId &&
  result.snapshotDigest === projection.snapshotDigest
```

Six top-level fields must be correct for a judgement to count — `kind`, `rubric`,
`contractVersion`, `lapId`, `snapshotDigest`, `findings` — and the engine already holds five of
them with certainty. It minted the lap ID, selected the rubric from its own registry, froze the
snapshot digest, and rendered the contract version from its own constant. Only `findings` is
judgement.

Three forces make the echo indefensible rather than merely redundant:

1. **The engine already classifies these values as provenance, not evidence.** `lapId` and
   `snapshotDigest` are members of `BUILD_REVIEW_PROVENANCE_KEYS`, whose contract is "rebase-volatile
   identities of the same content" — they are recursively stripped from the projection digest that
   forms cache identity, and the vocabulary's own comment describes them as "non-digested anchors
   for grader reads". Asking a model to re-transmit them is asking it to reproduce bookkeeping the
   engine deliberately excluded from meaning.
2. **The cache-hit path already binds instead of validating.** §7 of the amended ADR has the
   coordinator stamp a cached judgement "into the current lap's rubric artifact with its current lap
   and snapshot identities" — a judgement authored under a *different* lap is written under the
   current one. Only the fresh-dispatch path demands an echo. The asymmetry is the defect.
3. **Prompt-level enforcement has already been tried and has already failed.**
   `adr-2026-08-13`'s dispatch path embeds the exact JSON template and adds one bounded repair turn
   instructing the model to "Echo lapId … and snapshotDigest … verbatim". The 2026-08-16 evidence
   shows that repair turn firing and the second attempt drifting to a *different* wrong envelope
   key. This repository's own design principle names the remedy: machinery that computes the value
   rather than a stronger instruction asking a model to reproduce it.

The `ai-conductor` instance additionally exposes a diagnosis defect. The authoritative predicate
receives the full projection; the rejection diagnosis receives only `{lapId, snapshotDigest}`. When
no enumerated check explains a failure, control reaches a catch-all that asserts a
`verdict`/`passed` contradiction it never tested. The 2026-08-19 payload contained neither field.
The repair turn therefore carried an instruction that could not change anything, the re-emitted
output was byte-identical three times, and the retry budget drained into a terminal halt. This is
in scope here because §2's closed-projection principle — the skill receives the projection, and
every field it may depend on participates in that projection — is precisely what the diagnosis
asymmetry violates.

## Options Considered

### Option A: Bind lapId and snapshotDigest only
Delete the two identity equality checks; overwrite both from the projection at settlement. Leave
`kind`, `rubric` and `contractVersion` provider-supplied.
- **Pros:** Smallest diff. No change to the four shipped rubric contracts. Narrowest amendment.
- **Cons:** Does not fix the recorded failures. The 2026-08-16 outputs drifted on the *discriminator*
  as well, so both attempts would still be rejected. It removes two of five bookkeeping fields the
  model must reproduce and leaves three, so the same class recurs with a different field named.

### Option B: Tolerant parsing — accept `kind`/`type`/`status` as discriminator aliases, default missing identity from the projection
- **Pros:** Fixes both recorded shapes without touching the contract text.
- **Cons:** This is the over-mechanization signature this repository already names: an
  ever-growing exception list whose deterministic core is string matching on model output. Each
  newly observed drift adds an alias. It also permanently obscures what the contract actually is,
  because the accepted set is no longer the stated set.

### Option C: The engine stamps the envelope; the provider returns only findings
Narrow the provider's judged-result payload to `findings`. The engine supplies `kind`, `rubric`,
`contractVersion`, `lapId` and `snapshotDigest` from values it already holds. Any envelope field a
provider still sends is ignored, never validated.
- **Pros:** The envelope cannot vary, because the model no longer writes it — the failure mode is
  removed rather than tolerated. The rejection surface collapses to findings and anchors, which is
  exactly the class the diagnosis repair makes legible. It makes the fresh path behave as the cache
  path already does. It removes five independent ways to lose a completed judgement, leaving one.
- **Cons:** All four shipped `skills/build-review-*/SKILL.md` result contracts change together, plus
  the rendered shape template. It forces an explicit ruling on `contractVersion`. It removes a
  `rubric` echo that, in principle, could have caught crossed concurrent branch results.

## Decision

**Option C**, with the following rulings.

**D1 — Identity is coordinator-stamped on the fresh-dispatch path.** `lapId` and `snapshotDigest`
are bound from the projection that produced the dispatch, exactly as the cache-hit path already
binds them. They are never compared against a provider-supplied value. The amended sentence in
`adr-2026-08-13` §2 is replaced by: *every branch result carries the lap ID and snapshot digest of
the projection it was judged against, stamped by the coordinator on both the fresh and cache-hit
paths.* The **property** that ADR protected — every persisted artifact carries the lap and snapshot
it was judged under — is preserved exactly. Only the writer changes.

**D2 — The engine stamps the whole envelope.** The provider's judged-result payload is exactly
`findings`. `kind`, `rubric`, `contractVersion`, `lapId` and `snapshotDigest` are engine-supplied.
`rubric` comes from the rubric registry, which `adr-2026-08-17-build-review-rubric-repetition-short-circuit`
D2 already establishes as "an engine-supplied enum from the rubric registry, not grader output".

> **Amended 2026-08-20 by #1748:** D2's "exactly `findings`" is narrowed to the envelope/evidence
> distinction the shipped code implements. The engine owns every **envelope** field (`kind`,
> `rubric`, `contractVersion`, `lapId`, `snapshotDigest`) exactly as ruled. The provider payload is
> `findings` plus, for tautology fixture-relocation results only, the pre-existing audit-only
> `relocationAudit` array — provider-owned **evidence**, not envelope: the artifact persists it,
> the aggregate consumes it, and the tautology contract requires it as the record that a
> relocation exemption was applied legitimately. It is validated at the trust boundary (a
> non-tautology payload carrying one is rejected with the named problem), which is evidence
> validation, not the identity-echo validation this ADR removed. **The field set is closed:** a
> third provider-supplied top-level field requires a superseding ADR, never an extension of this
> note. #1767 tracks the intended end-state — migrating the audit to a uniform channel so this
> carve-out can be retired by a superseding ADR.

**D3 — `contractVersion` does not bump; it stays `v3`.**
`adr-2026-08-16-closed-build-review-finding-vocabularies` D4 rules that "a contract version changes
only when identity semantics change". Anchors, closed vocabularies, reference kinds and
canonicalisation are untouched by this decision; what changes is which side supplies non-identity
envelope fields. The stored branch artifact and cache entry remain full envelopes — engine-stamped
rather than provider-echoed — so cache identity is unaffected and **no rubric judgement is
invalidated and no re-judge lap is spent**. The at-rest parse continues to accept `v1`, `v2` and
`v3` records unchanged, so a leftover store stays readable.

**D4 — Provider-supplied envelope fields are ignored, never validated.** A provider that continues
to emit the full v3 envelope is accepted unchanged; a provider that emits a contradictory value is
not a failure, because the engine's value is authoritative by construction. Validating an echo is
the defect being removed, and reintroducing it as a warning would reintroduce it as a failure the
first time someone made the warning fail closed.

**D5 — An engine-side rubric invariant replaces the dropped echo.** Dropping the `rubric` echo
removes a check that would in principle catch crossed concurrent branch results. The engine asserts
its own invariant instead: at settlement, the branch's rubric must equal its projection's rubric.
This is an internal assertion over two engine-held values, not a validation of model output. It
costs nothing, asks the provider nothing, and closes the gap without depending on the inference
that concurrent branch results cannot cross.

**D6 — The rejection diagnosis is bound to the same inputs as the authoritative predicate, and
never asserts an untested cause.** The diagnosis receives the projection's full finding-reference
context, so reference-scoped rejections — non-canonical plan-task references, path and content-region
membership — are diagnosable by name and by the form they require. When no enumerated check
explains a rejection, the diagnosis reports that it is unexplained. It does not name a cause it did
not test, and it never names a field absent from the payload it is rejecting.

**D7 — A repair turn that cannot converge does not consume the remaining allowance.** A repair whose
output is byte-identical to the output it was asked to repair is evidence that the instruction was
unactionable, not that the diff is at fault. It settles the branch without spending the remaining
retries.

**D8 — Conformance with the mechanical-fault lane, not duplication of it.** This decision does not
implement `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D1/D2's total
branch-reason-to-closed-cause mapping, which the in-flight
`review-infrastructure-failures-are-operator-unreco` feature owns. It *reduces that mapping's
inputs*: under D1–D2, rubric, lap and snapshot mismatches become structurally impossible rather
than differently-named, so the surviving rejection classes are parse failure and finding
canonicalisation. The retry-budget accounting and the operator lever for a drained budget remain
that feature's territory. Every failure this decision produces stays on the infrastructure side of
`adr-2026-08-17-build-review-rubric-repetition-short-circuit` D3 and on the `absent` side of
`adr-2026-07-13-retry-classify-rerun-vs-route`, so no semantic-churn counter ticks and no kickback
budget is consumed.

**D9 — Normalizing a plan-task reference introduces no new reference kind.**
`adr-2026-08-18-content-anchored-finding-reference-schema` closes the reference schema at three
kinds and requires operator supersession to add a fourth. Accepting `Task N: <title>` and
normalizing it to the bare canonical id is input normalization ahead of the existing plan-task
kind — the identity that results is byte-identical to the one a bare id produces. No supersession
is required and none is taken.

**D10 — A parser-enforced grammar that is not stated in the contract is a defect, and is pinned
mechanically.** The regression this issue records was introduced by tightening
`anchor.planTask` to a canonical grammar in the same commit that rewrote the contract prose,
without that prose ever stating the grammar. A drift guard already pins closed vocabularies between
the engine definition and the four rubric contracts; it is extended to cover parser-enforced
reference grammars, so the next tightening cannot ship without its instruction.

## Consequences

### Positive
- A completed judgement can be lost in one way (its findings or anchors) instead of six.
- The fresh-dispatch and cache-hit paths become symmetric; the special case disappears rather than
  being documented.
- No cache invalidation, no contract-version bump, no re-judge lap for in-flight features.
- Every surviving rejection falls in the class D6 makes diagnosable, so the bounded repair turn
  carries an instruction the model can act on.
- The provider prompt shrinks: the rendered template no longer carries five echo placeholders.

### Negative
- Four shipped rubric contracts, the rendered shape template, and their drift guard move together;
  a partial change leaves the contract text describing a shape the engine no longer requires.
- Nothing verifies that the model's findings were shaped by the contract version the engine stamps.
  The prompt renders that version from the same constant the engine stamps
  (`CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION`), so they cannot disagree — but this is now an
  invariant of the assembly code rather than a checked property of the result.
- The at-rest and on-the-wire judged-result shapes differ. A reader of the stored artifact sees a
  full envelope and may infer the provider supplied it. D2 must be discoverable from the parse
  boundary, not only from this ADR.

### Assumption ledger
| Assumption | Basis | Confidence | If wrong |
|---|---|---|---|
| The identity echo carries no freshness protection not already carried elsewhere | Verified — `BUILD_REVIEW_PROVENANCE_KEYS` excludes both from cache identity; the cache-hit path already stamps; `adr-2026-07-23` places fresh-base protection in input assembly; `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch` places anti-staleness in a pre-dispatch recheck | 92% | A stale judgement could settle under a current lap. D5's invariant and the unchanged cache identity remain; the exposure would be a judgement produced against a superseded projection within one dispatch, which the closed projection makes unreachable. |
| Concurrent branch results cannot be crossed, so the `rubric` echo has no protective value | Inferred — each result returns to its own per-branch closure in `runAuxiliaryGroupBranches` | 90% | D5's engine-side invariant catches it regardless. This assumption is deliberately not load-bearing. |
| The prompt and the engine cannot disagree on `contractVersion` | Verified — both render from `CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION` | 95% | Findings shaped by one contract would be stamped with another. Recorded as a negative consequence above. |
| The `reporting_app` engine dist on 2026-08-16 post-dated the repair turn's introduction | Unverified — that project is not registered here and its pinned dist cannot be read from this checkout | — | Affects only how the 2026-08-16 evidence is narrated, never the decision. The echo requirement is present on current `main` regardless. |

### Follow-up Actions
- [ ] Add the additive amendment note to `adr-2026-08-13-engine-managed-build-review-rubric-branches` §2
- [ ] Update `docs/explanation/gates.md`, which currently documents `invalid-provider-result` as the single settled reason for a contract miss
- [ ] Coordinate with `review-infrastructure-failures-are-operator-unreco` at implementation time: read the current branch-reason mapping rather than trusting this ADR's description of it
