# Architecture Review: batched coverage-binding judge with per-batch checkpoints (#2493)

**Date:** 2026-09-18
**Mode:** lightweight (tier M) — §2 Feasibility and §4 Alignment in full
**Stories reviewed:** none yet (pre-stories review); input is `.docs/track/<slug>.md`, the explore
decision (`.memory/decisions/2026-09-18-coverage-binding-batched-judge.md`), and the diagram
`.docs/architecture/<slug>.md`
**Verdict:** APPROVED WITH CONDITIONS

Scope boundary (binding, from the track marker): bounded batches, one fresh session per batch,
digest-keyed verdicts, per-batch atomic checkpoint, resume re-dispatches only unjudged/invalid
digests; amend `adr-2026-08-31-coverage-binding-judge-step` D5. Excluded: concurrent fan-out of
one-claim sessions, the land-time criterion contract, tree-attesting eligibility, the default-on flip.

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency. Every seam exists: the sequential claim loop in `runCoverageBinding` (`step-runners.ts`, `for (const claim of claims)`), `claimDigest` / `parseJudgePayload` / `writeCoverageBindingEnvelope` (`coverage-binding-envelope.ts`), `executeAuxiliaryProviderCandidates` via `dispatchProviderWithLifecycleSupervision`, `CoverageBindingPayloadError`, and the fail-closed config validator for the `coverage_binding.judge` block (`config.ts` `CONFIG_CONSUMER_KEY_SETS`). Verified by reading each. |
| Prerequisites | Amendment D12–D15 on the governing ADR (written in this pass, pending operator approval). A new config key `coverage_binding.judge.batch_size` (positive integer, default 8) registered beside `enabled`. A new envelope status `partial` in `COVERAGE_BINDING_ENVELOPE_STATUSES` and excluded from `COVERAGE_BINDING_COMPLETION_STATUSES` (consumed by `artifacts.ts` completion check). `skills/coverage-binding/SKILL.md` result contract becomes the multi-claim `{ verdicts: [...] }` shape; `docs/reference/configuration.md` gains the key. |
| Integration surface | Three modules inside `src/conductor`: envelope module, step runner, config. Skill prompt text. No external API beyond the existing provider dispatch. |
| Data implications | `.pipeline/coverage-binding.json` gains one status value; every existing envelope still parses (`parseCoverageBindingEnvelope` accepts the widened status set; entries are unchanged). No migration. A previous `partial` envelope written by this change is readable by the same parser. |
| Performance risk | A 36-claim spec goes from 36 sessions to ⌈36/8⌉ = 5 on first dispatch and ≤ 1 batch of re-work after an interruption. Prompt size is bounded by `batch_size` × (criterion + Done when checks), which caps the prompt-bloat class recorded in #2585. |
| Worktree isolation | All state stays in the per-feature-worktree `.pipeline/` envelope. No ports, services, or shared files. Batches run sequentially; no new executor. |

**Documentation-only?** No — engine, envelope schema, config, and skill behavior change.

## Alignment

- **Governing ADRs (full sweep of 291 APPROVED ADRs).** Conflicts with exactly one clause,
  `adr-2026-08-31` D5 ("one fresh session per claim") — amended in place as D12–D15 rather than
  superseded, because D1–D4 and D6–D11 are unchanged and the judge's identity, vocabulary, cache,
  and failure lane are preserved. Constrained by, and honored as follows:
  - `adr-2026-09-11-finish-mergeability-respects-active-review-inputs` D7 — coverage binding stays
    non-tree-attesting and gains no resume-validity stamp; D14 derives resume from digest cache hits.
  - `adr-2026-09-11-selective-post-rebase-verification` D4 — the rebase-refresh path runs the same
    runner/cache/envelope; nothing bypasses it.
  - `adr-2026-08-24-refused-step-status` D1–D3 — no new refusal kind; batch identity failures are
    infrastructure failures, not refusals.
  - `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D1 — faults route on the typed
    `CoverageBindingPayloadError`, never on reason text (D13 reuses it).
  - `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope` D2/D5 — the engine issues digests
    and validates the returned set against its own issue list; a provider-echoed digest is never
    trusted as identity.
  - `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` D4 — `batch_size` joins
    `CONFIG_CONSUMER_KEY_SETS['coverage_binding.judge']` with a validator entry (D15).
  - `adr-2026-07-05-retry-as-escalation-ladder` D7/D8 — a rejected batch fails the step; escalation
    derives from the ordinary `attempt`, no batch-local counter.
  - `adr-2026-07-29-deterministic-build-verification-fanout` D2 — not engaged: batches are
    sequential, so no second `Promise.all` executor is introduced (and the scope boundary excludes
    concurrency).
  - `adr-2026-07-22-coherence-gate-placement-and-validation-split` (amended) — placement unchanged:
    BUILD-phase, config-gated, `land` gains no model dependency.
- **Domain boundaries.** The judge still answers exactly the one question
  `adr-2026-08-22-one-owner-per-review-question` assigns it; batching is execution shape, not a new
  owner or a new question.
- **Pattern consistency.** Fresh-session-per-unit, closed projection in the prompt, engine-stamped
  identity, atomic temp-file+rename write — all already the coverage_binding pattern; the unit
  changes from claim to batch. Precedent for engine-side cardinality/identity validation before any
  stamp is written: `adr-2026-07-11-semantic-attribution-verification-lane` D4/D5.
- **Focused local pattern basis (batch validation).** Precedent: `parseJudgePayload` in
  `coverage-binding-envelope.ts` — exact-key checks, closed vocabulary, typed `{ok:false, reason}`
  result. Traits to preserve: fail-closed parsing, exact key sets, reason strings naming the
  violated rule, no partial acceptance. Why it applies: the batch payload is the same contract
  lifted to an array keyed by digest. Allowed variation: the array wrapper and the set-equality
  check against the issued digests. Rediscovery hints: `parseJudgePayload`, `exactKeys`,
  `CoverageBindingPayloadError` in `step-runners.ts`.
- **State management.** Envelope status is a closed union; `partial` is added to it and kept out of
  the completion set — an interrupted run cannot be misread as done. No boolean flags.
- **Diagram accuracy.** `.docs/architecture/<slug>.md` matches D12–D15 (both blocks render).
- **Security boundaries.** Prompt carries only criterion text, task ids, `Done when` lines, and
  engine-issued digests. No new input surface.
- **Production DI defaults.** None introduced; the verdict store remains the filesystem envelope.

## Wiring Surface

| New / changed production surface | Called from |
|---|---|
| Batch planner (partition + chunk) in `runCoverageBinding` (`step-runners.ts`) | the existing `coverage_binding` branch of `DefaultStepRunner.run`, replacing the per-claim loop |
| Batch payload parser (`parseJudgeBatchPayload`, `coverage-binding-envelope.ts`) | `runCoverageBinding` after each batch dispatch, before any entry is recorded |
| `partial` envelope status (`coverage-binding-envelope.ts`) | written by `runCoverageBinding` after the cache pass and each accepted batch; read by the next run's cache pass; excluded from `artifacts.ts` completion check |
| `coverage_binding.judge.batch_size` (`config.ts`, `resolved-config.ts`) | read by `runCoverageBinding` at dispatch; validated fail-closed in the `coverage_binding.judge` block; registered in `CONFIG_CONSUMER_KEY_SETS` |
| `skills/coverage-binding/SKILL.md` multi-claim result contract | rendered into the batch prompt by `renderAuxiliarySkillInvocation('coverage-binding', …)` |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Judge quality drifts across a large batch (verdicts bleed between claims) | Technical | Medium | Medium | Bounded `batch_size` default 8; each claim carries its own digest and Done when; skill text forbids cross-claim inference |
| Provider returns a digest set that mismatches the batch | Integration | Medium | Low | D13 rejects the whole batch to the retry ladder; earlier batches are kept (D14) |
| `partial` envelope mistaken for completion by a consumer | Data | Low | High | `COVERAGE_BINDING_COMPLETION_STATUSES` unchanged (`disabled`, `done`); test asserts `partial` is excluded |
| Post-rebase refresh path reads a stale `partial` envelope as cache | Data | Low | Medium | Cache identity is the digest of `(criterion, Done when)`; a rebase that changes either text misses the cache by construction |

## ADRs Created

None. `adr-2026-08-31-coverage-binding-judge-step` amended in place (D12–D15, additive note under
`## Decision`); the amendment is pending operator approval in this session.

## Conditions

1. The D12–D15 amendment must be operator-approved before `/stories`; the ADR stays APPROVED with
   the additive note, no DRAFT state is introduced.
2. `partial` must be added to `COVERAGE_BINDING_ENVELOPE_STATUSES` and must NOT be added to
   `COVERAGE_BINDING_COMPLETION_STATUSES`; a test must prove the exclusion.
3. `batch_size` follows the `enabled` key's exact wiring: `CONFIG_CONSUMER_KEY_SETS`, the
   fail-closed validator block, `resolved-config.ts`, and `docs/reference/configuration.md`.
4. `coverage_binding_judged` stays per-claim; no new event type, no sidecar file.
5. Batches are sequential; concurrency is out of scope and must not be introduced.
