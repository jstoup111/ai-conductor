# Architecture Review: build_review rubric findings arrive as typed, structurally keyed output (#2384)

**Date:** 2026-09-22
**Mode:** pre-stories, full (Large tier — all sections)
**Track:** technical
**Stories reviewed:** none yet — this review runs before `/stories`, against the explore output,
the operator-confirmed scope boundary in `.docs/track/build-review-rubric-findings-arrive-as-typed-struc.md`,
and the approved diagrams in `.docs/architecture/build-review-rubric-findings-arrive-as-typed-struc.md`
and `.docs/architecture/sequences/build-review-rubric-findings-arrive-as-typed-struc.md`.
**ADR corpus swept:** repo_wide — all 596 files in `.docs/decisions/`, one delegated full pass
reading every title and status and every candidate ADR in full.
**Verdict:** APPROVED WITH CONDITIONS

## Summary

The issue as filed is three-quarters shipped and one-quarter contradicted by approved ADRs. The
engine-stamped `judged` envelope, the content-anchored finding identity, the field-named rejection
diagnosis, the `confidence` field and its operator floor, and the `case-v1` adjudicator that
consumes typed findings all exist. What does not exist is the seam the operator actually asked for:
one engine-owned contract that every rubric — built-in or project-declared — fills in, so that the
input the grader sees and the output the engine accepts are declared once and enforced by the
provider's native structured output rather than scraped from prose. Two dispatch paths grew
independently instead. The design under review collapses them onto a rubric contract descriptor and
consumes the #2429 native-schema seam. It fits inside every governing ADR with six additive
amendments, none of which changes finding identity. The one part of the issue text this design
declines — re-keying identity to plan position — is excluded by the operator-confirmed scope boundary
because three APPROVED ADRs rule the other way; it is recorded here so a later spec does not
rediscover the collision.

## Feasibility

**Stack compatibility.** No new dependency. Both provider adapters already declare and implement
native structured output (`claude-provider.ts` passes `--json-schema`; `codex-provider.ts` writes an
engine-owned schema file and passes `--output-schema`), and `provider-execution.ts` already gates
candidates on `nativeOutputSchema` capability and tears down the schema scratch home. Confidence
95%, verified by reading the adapter and execution code.

**Prerequisites.** #1986 (portable policy: `build-review-policy-contract.ts`, `-resolver.ts`,
`-bundle.ts`) and #2429 (`InvokeOptions.nativeSchema`, `InvokeResult.finalStructuredResult`) are
merged; #2429's halt record is `Status: resolved` (2026-09-10) and its shipped record exists. No
open prerequisite. Confidence 95%, verified.

**Integration surface.** Engine modules: `step-runners.ts` (built-in rubric dispatch ~L3171–3520 and
custom-policy dispatch ~L2600–2900 collapse to one path), `build-review-coordinator.ts` (stamp,
validate, fault classification), `build-review-domain.ts` (`renderBuildReviewProviderPayloadShape`,
`renderBuildReviewJudgedResultShape`, `BUILD_REVIEW_CUSTOM_REVIEWER_PAYLOAD_SCHEMA`,
`parseBuildReviewJudgedResult`, `describeBuildReviewJudgedResultRejection`),
`build-review-registry.ts` (descriptor attaches to each registry entry), `build-review-projections.ts`
(per-rubric projection branches become descriptor builders), `build-review-policy-contract.ts`
(renders the reviewer shape from the descriptor schema), `build-review-finding-identity.ts`
(unchanged canonicalizers wrapped by the descriptor). Skills: two SKILL.md files lose their
`## Result contract (v3)` blocks and shape-asserting `## Verification` items. Tests:
`build-review-skill-contract.test.ts`, `build-review-rubric-skills.test.ts`,
`check_build_review_rubric_skill_vocabularies.sh`, `test_provider_skill_contracts.sh`. Docs:
`docs/explanation/gates.md` L529–543, `docs/reference/skills.md` L852–868. This crosses more than
three module boundaries, which is why the tier is Large.

**Data implications.** No persisted store changes shape. `contractVersion` stays `v3`, so every
existing disposition record, suppression-history entry, and adjudication case remains valid and
binding. The cache key's `engineIdentity` component (engine stamp + SKILL.md digest) changes because
the skills are rewritten, so every cached judgement misses once and re-judges — a bounded one-time
cost the operator accepts, and the same cost any SKILL.md edit already incurs
(adr-2026-08-21-engine-identity-in-build-review-cache-key).

**Performance risk.** None new. The projection byte bound (`max_projection_bytes`, `projection-oversized`)
is unchanged. The prompt loses the prose shape block and gains nothing; the schema travels as a CLI
option or scratch file, not prompt bytes.

**Worktree isolation.** The Codex schema file already lives under the engine-owned invocation scratch
home with self-host write containment preserved (adr-2026-09-07 D6). No shared resource is added.

**Load-bearing assumption (verify-claims).** The build_review rubric dispatch is never an interactive
REPL invocation. Basis: rubric candidates run through `executeAuxiliaryProviderCandidates`, and the
Claude adapter refuses `nativeSchema` on an interactive dispatch with `nativeSchemaUnsupported: true`
(`claude-provider.ts` ~L655). If a rubric dispatch could be interactive, every built-in rubric
would fault `native-schema-unsupported` in interactive conductor runs. Confidence 85%, inferred
from the auxiliary-candidate code path; not yet pinned by a test. **Impact if wrong:** interactive
runs lose all rubric coverage. **Confirm:** a story asserts that rubric dispatch is non-interactive
under both conductor modes (Condition C-1).

## Complexity

**High**, by the skill's table: it touches 4+ engine modules, both provider adapters' native
output options, and a state machine (the mechanical-fault lane gains two closed causes). Splitting
was considered and rejected: the descriptor without the native-schema migration leaves the
scrape-and-parse path as a second contract source, and the native-schema migration without the
descriptor migrates only the built-in path, which is exactly the shape the operator declined. The
two halves are one seam. Not a spike — every primitive exists and has a production caller today.

## Alignment

### A-1 — Engine/skill ownership (adr-2026-08-13 §1, §2; adr-2026-08-22-one-owner-per-review-question D1) — fits

§1 already names the engine as sole owner of result validation and finding identity, and a skill as
owner of judgement instructions only. This design is enforcement of §1, not new policy: it removes
the last place a skill stated a result shape. No new plan-append path is created; the gate still
fails or halts and never directs BUILD. Amended: adr-2026-08-13 D1.1, D1.2, D2.2 name the descriptor
and the single dispatch path (additive).

### A-2 — Native-schema seam (adr-2026-09-07 D6) — fits, second consumer recorded

D6 said no other parser migrates in #2429 and forbade a competing second option. This design
consumes the same `InvokeOptions.nativeSchema` / `finalStructuredResult` seam with no new option.
Amended: D6.1 records build_review as the second consumer and routes its named mechanical failures
through the existing lane.

### A-3 — Envelope, repair turn, and grammar pinning (adr-2026-08-19 D2, D3, D6, D7, D10) — fits with two amendments

The provider field set stays closed at four; D2.3 restates it under the schema. D3 holds:
`contractVersion` stays `v3` because identity semantics do not change. D6 (field-named rejection)
is preserved verbatim and is the mechanism the issue's first Done-when asks for. **D7's bounded
repair turn is retired (D7.1)** — the provider now enforces shape before the engine sees the result,
and a residual parser rejection (content-hash membership, duplicate identity) is a semantic defect
the mechanical-fault lane already reruns under its three-lap bound; a repair prompt over structured
output has no free text to repair. **D10 inverts (D10.1):** the stated grammar is the descriptor's
JSON Schema, and SKILL.md carries judgement only. Both are judgement calls the operator should
confirm at ADR review (Condition C-2).

### A-4 — Closed vocabularies (adr-2026-08-16 D1–D5) — fits with D5.1

D5 required each SKILL.md to *enumerate* its vocabulary as a result-contract block bound to the
engine set. D5.1 moves the enumeration to a JSON Schema `enum` on the descriptor (D3 already said the
model sees the vocabulary through the engine-rendered schema) and keeps the SKILL.md naming every
member as a *judgement definition*. The bidirectional integrity check binds descriptor enum ⇄ the
kinds the skill defines. No `other` member. Unchanged in substance; relocated in form.

### A-5 — Portable custom policy (adr-2026-09-10 D4, D7; adr-2026-09-10-separate-custom-review-coverage-identity D1–D4) — fits with D7.1

D7 already says the engine stamps everything after parsing and validates source regions against the
frozen input. D7.1 makes `custom-v1` a descriptor on the shared seam so the policy contract renders
its shape from the same schema the parser validates; `unsupported-policy` becomes a valid structured
alternative, not a parse failure. Custom identity grammar, case-v2, and the coverage identity are
untouched.

### A-6 — Mechanical-fault lane (adr-2026-08-18-mechanical-rubric-faults D1–D5, D2.1, D3.1) — fits with D2.2

D2 provides for new closed causes and forbids silent coercion. D2.2 adds `native-schema-unsupported`
(deterministic per lap, charged once like `projection-oversized`) and `invalid-structured-result`
(retryable under D4's bound, carrying the field-named rejection), and removes the
"no parseable JSON object" causes whose producer is retired, so the mapping stays total.

### A-7 — Finding identity (adr-2026-08-18-content-anchored-finding-reference-schema; adr-2026-08-13-stable-build-review-finding-dispositions §1; adr-2026-09-02 D6) — preserved; issue text declined

The issue asks for identity keyed to "task id + Done-when index" or "ADR stem + decision number".
The reference-schema ADR closes the set at three kinds and says a fourth is never a BUILD-time
decision; adr-2026-09-02 D6 explicitly declines ADR decision ids as a persisted reference kind. The
scope boundary excludes the re-key. Today's identity — `sha256` over rubric, contract version,
concern kind, and content-region anchor — is already structural in the sense that matters (no
summary wording, no coordinates), so the second Done-when is met by the existing grammar and this
review records that as the spec's position. Observation: adr-2026-08-21-review-bound-by-plan-done-when-criteria
D2's `boundTo` field is not present in `build-review-domain.ts` or either SKILL.md; nothing in this
design depends on it and no amendment to that ADR is needed.

### A-8 — Skill text as load-bearing runtime source (adr-2026-08-13-markdown-default-inversion; adr-2026-08-21-engine-identity) — fits

Rewriting the two SKILL.md files is a runtime change: the skill digest is in the cache key and in
`BUILD_REVIEW_POLICY_CONTRACT` rendering. The plan must land the skill rewrite, the descriptor, and
the test/audit changes in one diff so no intermediate HEAD has a skill without a contract block and
an engine still asserting one.

### A-9 — Event spine (`.agents/skills/event-spine/SKILL.md`; adr-2026-07-26-event-sink-registry-exhaustiveness) — fits

No new channel. The two new fault causes ride the existing `build_review_rubric_mechanical_fault`
event under its closed-cause field; the sink registry's exhaustiveness check must admit the new
members in the same change.

### A-10 — Provider neutrality (`test_provider_skill_contracts.sh` L375–378) — fits

The descriptor is provider-neutral; adapters translate the JSON Schema to their native option. The
audit's new forbidden-prose rule uses the existing `require_absent_pattern` primitive over the
canonical shipped sources.

## Domain Integrity

| Principle | Assessment |
|---|---|
| No primitive obsession | The descriptor is a typed record; versions are branded string literals already used by the registry; the schema is a frozen object, not a string. |
| Parse, don't validate | The descriptor's `parse(structuredResult)` is the single construction point for a provider payload; downstream code receives the parsed type. The existing per-rubric parsers are reused, not duplicated. |
| Invalid states unrepresentable | A member without a descriptor cannot be dispatched (authoring-time contract defect). `unsupported-policy` is a schema alternative, not a nullable findings array. |
| Semantic types | `RubricContractDescriptor`, `RubricOutputContract`, `RubricProjectionContract` — names answer what the thing is. |
| Exhaustive matching | The fault-cause mapping stays total (adr-2026-08-18 D2); the event-sink exhaustiveness check pins the new members. No `default` on member kind after catalog lookup, because there is no branch on member kind. |

## Wiring Surface

| New or changed production surface | Called from |
|---|---|
| `RubricContractDescriptor` type and the three descriptors | Attached to each `BUILD_REVIEW_RUBRIC_REGISTRY` entry and to each resolved custom member in the policy resolver; read by the coordinator at catalog lookup |
| Generic rubric dispatch (replaces built-in and custom dispatch in `step-runners.ts`) | The build_review step runner's fan-out over the effective catalog |
| `nativeSchema` on rubric invocations | Passed through the existing `InvokeOptions` into `provider-execution.ts` candidate execution |
| Descriptor-rendered prompt shape | Replaces `renderBuildReviewProviderPayloadShape` / `renderBuildReviewCustomReviewerPayloadShape` at the prompt-assembly sites in `step-runners.ts` and `build-review-policy-contract.ts` |
| Fault causes `native-schema-unsupported`, `invalid-structured-result` | Emitted by the coordinator's terminal classification; consumed by the mechanical-fault lane and the `build_review_rubric_mechanical_fault` sink |
| Provider-contract audit rule (forbidden output-format prose) | `test/test_provider_skill_contracts.sh`, run by `test/test_harness_integrity.sh` |
| Vocabulary drift guard (descriptor enum ⇄ SKILL.md definitions) | `test/check_build_review_rubric_skill_vocabularies.sh`, run by `test/test_harness_integrity.sh` |
| Retired: `extractJudgedResultCandidate` for build_review, the repair turn, the prose shape renderers | Removed callers in `step-runners.ts`; `code-removal` skill governs the deletion |

Overlap scan (`ai-conductor overlap-scan --files <the paths above>`): no overlap detected, no open
blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A provider's native schema enforcement rejects a schema feature the descriptor uses (e.g. `oneOf` for the custom `unsupported-policy` alternative) | Integration | Medium | High | Story pins both adapter fixtures against the real descriptor schemas; keep schemas to the JSON Schema subset both CLIs document; opt-in smoke run before merge |
| Retiring the repair turn raises `absent` rate for content-hash mismatches the repair used to fix | Technical | Low | Medium | The lane's three-lap bound already covers reruns; observe `invalid-structured-result` counts on the spine after ship; reinstating repair would be a D7.1 supersession |
| Interactive conductor mode reaches rubric dispatch and faults every rubric `native-schema-unsupported` | Technical | Low | High | Condition C-1: story asserts non-interactive dispatch in both modes |
| One-time cache invalidation re-judges every in-flight feature's rubrics | Performance | Certain | Low | Accepted; identical to any SKILL.md edit today |
| Drift guard rewrite loses a check the old prose-bound guard enforced | Knowledge | Medium | Medium | Story enumerates the old guard's fail-closed modes (`!unenforced`, `!unclassifiable`, `!baseline-rejected`) and maps each to the new descriptor-bound check |
| Skill rewrite and engine change land in separate diffs, leaving a HEAD with mismatched contract | Integration | Low | High | One feature, one diff (A-8); the plan's task tree carries no cross-feature boundary |

## ADRs Created

None. Every structural decision falls under an existing APPROVED ADR; six were amended additively
in this pass (adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts form, operator approval
pending at ADR review):

| ADR | Decisions added | Substance |
|---|---|---|
| adr-2026-08-13-engine-managed-build-review-rubric-branches | D1.1, D1.2, D2.2 | Rubric contract descriptor; one generic dispatch path; output version in the cache identity |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation | D6.1 | build_review is the second consumer of the native-schema seam |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope | D7.1, D10.1, D2.3 | Repair turn retired; stated grammar is the descriptor schema; provider field set unchanged |
| adr-2026-08-16-closed-build-review-finding-vocabularies | D5.1 | Closed set is a schema enum; SKILL.md names kinds as judgement definitions; bidirectional check relocated |
| adr-2026-09-10-portable-build-review-policy | D7.1 | custom-v1 is a descriptor on the shared seam |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane | D2.2 | Two closed causes; prose-scrape causes removed |

## Conditions

- **C-1** — A story asserts that build_review rubric dispatch is non-interactive under both conductor
  modes, so the Claude adapter's interactive `nativeSchemaUnsupported` refusal is unreachable from a
  rubric branch.
- **C-2** — The operator confirms D7.1 (repair turn retired) and D10.1 (grammar lives in the schema,
  not SKILL.md) when approving the amendments; both are judgement calls this review recommends but
  does not own.
- **C-3** — The plan lands skill rewrite, descriptor, dispatch, tests, and audits as one diff (A-8),
  and applies the `code-removal` skill to the retired scrape/repair/shape-renderer paths.
- **C-4** — The plan records the one-time cache invalidation and the `contractVersion: v3` preservation
  as explicit Done-when lines so the as-built review can check that no disposition was invalidated.
