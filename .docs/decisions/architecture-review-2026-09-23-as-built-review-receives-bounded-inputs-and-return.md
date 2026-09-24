# Architecture Review: As-built review receives bounded inputs and returns typed verdicts (#2188)

**Date:** 2026-09-23
**Mode:** pre-stories, full (Large tier — all sections)
**Track:** technical
**Stories reviewed:** none yet. This review runs before `/stories`, against the explore output,
the operator-confirmed scope boundary in
`.docs/track/as-built-review-receives-bounded-inputs-and-return.md`, and the approved diagram in
`.docs/architecture/as-built-review-receives-bounded-inputs-and-return.md`.
**ADR corpus swept:** repo_wide. All 317 `adr-*.md` files were read in two delegated halves,
each ADR's Decision section and amendments in full, with no keyword narrowing.
**Verdict:** APPROVED WITH CONDITIONS

## Summary

Today `architecture_review_as_built` receives a step header and a six-line `AS-BUILT CHECK
POLICY` block (`renderAsBuiltPolicyPrompt`, `as-built-policy.ts`). It gathers its own evidence
and writes `.pipeline/architecture-review-as-built.md`. About eight engine sites then re-parse
that Markdown with regexes:

- `readAsBuiltVerdictLine`;
- the `Outcome delivered:` line, in two divergent copies;
- `parseAsBuiltBlockedFindings`;
- the governing-clause grammar in `resolveAsBuiltGoverningClause`;
- the `## Recorded Findings` fenced-JSON scrape in `shipment-association.ts`; and
- the recorded-findings write-back into the reviewer's file.

The approved approach (explore, operator-confirmed) moves both sides of the step onto
engine-owned contracts:

1. **Input.** The engine renders a bounded, versioned input projection.
2. **Dispatch.** The step dispatches on the existing #2429 `nativeSchema` seam through the
   one-shot skill path.
3. **Validation.** The engine validates the terminal structured result and stamps it with the
   run identity.
4. **Authority.** The engine persists the stamped result as the sole authority and renders the
   human-readable report from it.
5. **Consumers.** Every consumer reads the typed verdict through one reader, and the Markdown
   parsers are deleted.

The design is feasible on shipped machinery. It requires four ADR amendments, all
operator-directed in this session and written into the ADRs, and no new ADR.

## Operator decisions taken in this review (2026-09-23)

| # | Question | Decision |
|---|---|---|
| OD-1 | Fault lane for as-built output faults | **Split by determinism.** A missing or schema-invalid structured result, or an unresolvable reference, scores `absent` and reruns within the step's existing retry budget, then halts `needs-human` on exhaustion. An unsupported provider capability, or a required input that is missing, unreadable, or over its limit, is deterministic: it halts without retry, naming the capability or dimension. |
| OD-2 | Persisting typed ADR-decision references | **Approved as a separate versioned contract**, not a fourth build_review anchor kind (adr-2026-09-02 D6.1). |
| OD-3 | How the design is recorded | **Amendments only.** No new ADR. |
| OD-4 | Review-required marker | **Preserve actual behavior.** The skill's `review-required-architecture-as-built` marker never matched the engine's `review-required-architecture_review_as_built` lookup (`conductor.ts` ~13300), so as-built conditional review has never fired. The skill instruction is removed and the engine emits nothing. An intake issue is filed on whether non-clean as-built verdicts should prompt review. |
| OD-5 | ADR scope of the projection | **Plan-cited plus diff-touched.** ADRs cited in the plan's Architecture Obligation Coverage table, together with ADRs added or modified in the feature diff, APPROVED only. Any other APPROVED ADR remains readable on demand. |
| OD-6 | Legacy in-flight verdicts (default, stated to the operator) | A worktree holding only a reviewer-written Markdown verdict reruns the review once. It is never parsed (run-identity ADR D7.1). |

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency. The `nativeSchema` / `finalStructuredResult` seam exists on both adapters: Claude uses `--json-schema` (`claude-provider.ts`, capability declared); Codex uses `--output-schema` with an engine-written scratch schema file (`codex-provider.ts`). Validation stays hand-written with an exact-key check, as in `prd-widening-contract.ts`; the repo has no schema library. Verified by code read, 90%. |
| Prerequisites | #2429 is closed and its seam shipped. #2384 (PR #2660) is merged; its descriptor seam is build_review-keyed and is not reused (A-3). The one-shot skill path (`executeProviderAwareSkillOneShot`) exists for `remediate` and must admit this step. Its step union is today `'complexity' \| 'remediate' \| 'rebase'` (`step-runners.ts` ~703). |
| Integration surface | High: about 15 engine modules. There are about 40 conductor call sites across the completion gate, validation group, serial halt, remediation planner, recorded-findings projection, shipped record, rebase preservation, rekick, stale sweep, retry classification, rewind, and the pre-finish fence. The verdict and routing semantics are unchanged; the input changes from scraped Markdown to the typed verdict. |
| Data implications | A new gitignored `.pipeline/` typed verdict artifact, classified `run` (adr-2026-07-28-feature-aware-artifact-resolution D2). The kickback ledger schema is unchanged. Legacy Markdown-only verdicts rerun once (OD-6). No committed data migration. |
| Performance risk | The projection bounds the reviewer's input. #2377 measured 186k–251k-token peaks, with about half the window spent on the reviewer's own unbounded reads. The corpus sets the limits: plan files are up to 188 KB (p99 87 KB) and stories up to 43 KB (p99 28 KB). The projection carries only task ids and `Done when` blocks from the plan, not the whole file. Limits are set no smaller than the corpus maximum at BUILD (09-07 D7.1), so no existing feature faults. |
| Worktree isolation | No new port, service, or shared resource. The Codex schema file stays under the invocation scratch directory with self-host containment preserved (09-07 D6). |

## Complexity

**High.** It crosses more than four module boundaries, and the completion and routing state
machines change their input. The approach is not a spike: every mechanism has a shipped
precedent (#2429 reconciliation, #2384 rubrics, coverage-binding D5). The complexity artifact
records Tier L. The operator chose one spec covering all seven outcomes over a split.

## Alignment

### A-1 — Verdict authority and writer (adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity D2, D3, D7) — fits with D2.1, D3.1, D7.1

The ADR assumed the skill writes the artifact and the engine observes the write. Under this
design the engine is the writer. The amendment therefore redefines the handshake as observing
a validated structured result from this dispatch. A present file with a fresh mtime proves
nothing. The mtime fallback is disabled for this step, so an always-fresh engine write cannot
launder a stale result. This also resolves, without amending them:

- adr-2026-07-13-session-fresh-verdict-artifacts: its as-built row and its "no session-id stamp"
  non-goal;
- adr-2026-07-22-gate-evidence-code-validity-on-redispatch D1 and D5: "judge writes … this
  attempt".

adr-2026-08-25 already supersedes both of those in part. `prd_audit` and `manual_test` are
untouched.

### A-2 — Finding contract and remediation route (adr-2026-08-25-as-built-remediable-findings-bounded-build-route 1–9) — fits with D1.1, D2.1, D6.1, D7.1

- **Replaced:** the table and its parser (decisions 1–2) become typed fields validated at the
  dispatch boundary.
- **Unchanged:** the class meanings, the bounded route, the caps, the single appender, the
  primacy of the validation-group join, and the `existing-task` restage (decisions 3–5, 8, 9).
  The plan must preserve them verbatim.
- **Decision 7:** it said no component outside the remediation seam reads
  `pendingAsBuiltRemediationFindings`. D7.1 admits a read-only accessor for the projection, using
  the fail-closed ledger read (adr-2026-08-31-kickback-ledger-read-fails-closed item 1).
  adr-2026-07-26-cross-dispatch-kickback-livelock-bound's tolerant read is not reused here.
- **Behavior change:** an unresolvable reference used to halt `needs-human` at
  `planRemediation`. It now reruns within the retry budget first (OD-1). This is accepted.

### A-3 — Native-schema seam and output contract (adr-2026-09-07 D6, D6.1, D7; adr-2026-08-13 D1.2) — fits with D6.2, D7.1

- **Seam:** this is the third consumer of `nativeSchema`, with no second option.
- **Single source:** the JSON Schema is both the advertised shape (rendered into the prompt) and
  the validated contract. This carries adr-2026-08-13 D1.2's single-source property without
  reusing the build_review descriptor type.
- **Why not the build_review descriptor:** `RubricContractDescriptor` is keyed to the rubric
  catalog, cache, and identity canonicalizer. As-built has none of those.
- **Why not a generic catalog:** it was rejected at explore as speculative. #191 owns it.

### A-4 — One owner per review question (adr-2026-08-22-one-owner-per-review-question D1) — fits

- The projection carries the sealed story criteria as context for the plan-gap check only.
- `prd_audit` remains the completion authority.
- The contract adds no finding class for "criterion unmet".

### A-5 — Verdict set and per-check policy (adr-2026-08-22-as-built-review-runs-always-with-plan-gap D1, D2, D4) — fits

- The verdict set is unchanged.
- "The gate parser is fail-closed as today" still holds: the typed validator is fail-closed.
- The projection carries the resolved per-check policy and the approved diagram paths.
- A missing ADR set or diagram set disables its check, never the gate (09-07 D7.1).

### A-6 — ADR references (adr-2026-09-02 items 1, 3, 6; adr-2026-08-18-content-anchored-finding-reference-schema) — fits with D6.1 (operator-approved, OD-2)

- `{kind: "adr-decision", stem, decision}` is persisted as the as-built verdict's own
  versioned contract.
- The build_review three-kind anchor set and its integrity pin are untouched.
- Decision ids come only from `parseAdrDecisions`.
- A plan-task id resolves only through the shared resolver
  (adr-2026-08-30-shared-plan-task-reference-resolver D1). A REMEDIABLE finding cites exactly one
  reference.

### A-7 — Dispatch conventions — fits

The dispatch is:

- one-shot `invoke` with `interactive: false` (adr-2026-08-24-one-dispatch-member-on-the-provider-contract,
  adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope, and adr-2026-08-25-committed-rate-card
  on why Codex interactive cannot carry the result);
- a fresh session on every retry (adr-2026-07-24-provider-aware-step-execution-fresh-session-scope D4);
- through StepRunner and the model-fallback ladder, with no bespoke spawn (adr-2026-07-20-ci-fix-dispatch-via-steprunner);
- metered through the existing envelope (adr-2026-07-22-build-dispatch-json-usage-capture).

Two classification rules apply:

- Auth, rate-limit, and model-unavailable classification precede the structured-output fault
  (adr-2026-07-04-auth-failure-park-and-poll D2, adr-2026-07-05-daemon-rate-limit-episode-coordinator D4).
- An unresolved skill command is classified by adr-2026-08-04-unresolved-step-command-fails-by-name.
  It is never read as an invalid result.

### A-8 — Validation group and SHIP tail (adr-2026-07-10-validation-group-join D2, D3, D5; adr-2026-07-10-concurrent-group-core; adr-2026-08-16-restore-the-current-head-publication-fence; adr-2026-07-26-rebase-tail-current-branch-before-publication D4) — fits

- **Faults:** a mechanical fault is a no-verdict branch. It fails the group and never becomes a
  synthetic gap.
- **Branch ownership:** the typed artifact stays branch-owned and write-disjoint.
- **Remediation hint:** the remediation hint names the typed artifact.
- **Stale sweep:** `STALE_SWEEP_STEPS` covers the typed artifact and the rendered report together.
- **Pre-finish fence:** the fence (`computeAndWriteVerdict` via `nonGreenFinishValidators`)
  recomputes through the single reader.
- **Rewind:** operator rewind (adr-2026-08-19-operator-step-rewind-through-the-mutation-port D4)
  clears both files.
- **Open telemetry item:** keeping satisfied siblings on a no-verdict group halt remains owned by
  #1425 (adr-2026-09-10-shared-step-lifecycle-telemetry).

### A-9 — Rebase and mergeability inputs (adr-2026-07-20-post-rebase-delta-aware-invalidation; adr-2026-09-11-finish-mergeability-respects-active-review-inputs item 3; adr-2026-09-11-selective-post-rebase-verification) — fits, no amendment

- The as-built gate's declared surface stays feature runtime source.
- Today the reviewer already reads ADRs outside that surface, so the projection does not widen
  what can change a verdict.
- The mergeability input list does not gain ADR decisions or ledger findings. This preserves
  current behavior (outcome 4). Widening it is a separate decision.
- Code-stamp-first preservation applies to the typed artifact unchanged.

### A-10 — Skill text and audits (adr-2026-08-19-engine-stamped-rubric-judged-result-envelope D10.1 as precedent; adr-2026-08-09-recorded-red-exception-for-remediation; adr-2026-08-14-retire-build-review-wiring-rubric; adr-2026-07-12-wiring-check-gate D6) — fits

**Removed from §12:**
- the context-budget read recipe;
- the report template;
- the table, column, cell, and clause grammar;
- the mandatory-overwrite block;
- the review-required marker instruction; and
- the format checklist items.

**Kept:** the judgement guidance. This covers the reachability semantics (including the
same-file root-to-caller-to-export exception, current-source authority, and UNEXERCISED
signatures), plan-gap semantics, sealed-story outcome authority, the verdict meanings, and the
REMEDIABLE/DESIGN meanings.

**Also kept:** the delegated-evidence and validator-discipline guidance. It is judgement
procedure, not input-reading format, and still governs on-demand reads.

**Audit:** `test/test_provider_skill_contracts.sh` gains a check scoped to §12. The file also
serves the pre-stories and drift-check modes, and its §8 output template must not trip the
audit. The existing pins on judgement prose stay.

**Tests to rewrite:** `src/conductor/test/skill-contracts.test.ts:11-16` pins the verdict-line
and `Outcome delivered:` prose, and is replaced by the new audit.

**Why "fix the skill" does not apply:** the convention in
adr-2026-07-03-halt-pr-rehabilitation-at-finish and adr-2026-07-11-finish-step-engine-completion-machinery
covers PR title and body presentation. Here the engine persists the reviewer's own
schema-validated judgement and renders a mechanical view of it, so no engine-authored judgement
text exists.

### A-11 — Event spine (`.agents/skills/event-spine/SKILL.md`; adr-2026-07-26-event-sink-registry-exhaustiveness; adr-2026-08-11-halt-events-ride-the-persisted-spine) — fits

- **Freshness:** the `verdict_freshness` event keeps `floorSource: 'run-identity'` on the typed
  artifact.
- **Halts:** faults halt through `writeHaltMarker` and `loop_halt` with existing classes (no new
  class; adr-2026-07-28 D1).
- **Kickbacks:** kickback events are reused verbatim (adr-2026-07-04 D4).
- **New telemetry:** any new telemetry (for example projection byte size, which #2377 will
  consume) extends an existing member or adds a `ConductorEvent` member with its `EVENT_SINKS`
  row.
- **No sidecar:** fault diagnostics never go in a sidecar file.

### Diagram accuracy

The approved diagram matches this review, with three additions for the plan to carry: the
pre-finish fence and rewind are further consumers of the single reader, and the diagram set is
passed as paths.

## Domain Integrity

| Principle | Check |
|---|---|
| No primitive obsession | References are tagged objects (`adr-decision` / `plan-task`), not free text. The verdict and class are closed enums. The run identity is the engine's `attempt.id`, never a provider echo (adr-2026-08-19 D4). |
| Parse, don't validate | The result is validated once, at the dispatch boundary. Consumers receive the typed verdict and never re-validate or re-parse. |
| Invalid states unrepresentable | `outcomeDelivered` is present exactly when the verdict is `PLAN_GAP`. Findings are present exactly when the verdict is `BLOCKED`. A REMEDIABLE finding requires a reference. The plan should encode these as a discriminated union on the verdict rather than as optional fields. |
| Semantic types | `AsBuiltVerdict`, `AsBuiltFinding`, and `AsBuiltGoverningReference`, not generic JSON. |
| Exhaustive matching | Outcome mapping stays an exhaustive switch over the verdict union, with no default arm. The fault causes form a closed union. |

## Wiring Surface

| New surface | Production caller (design-time commitment) |
|---|---|
| As-built input projection builder (new engine module) | Invoked by the step runner's as-built dispatch branch before the one-shot skill invocation, on both the serial path (`conductor.ts` step walk) and the validation-group branch (`group-core.ts`). |
| As-built verdict contract (JSON Schema + validator + prompt-shape renderer; new engine module) | The schema is passed as `InvokeOptions.nativeSchema` by the as-built dispatch branch. The validator is called on `finalStructuredResult` in the same branch before persistence. |
| Typed verdict persistence + Markdown renderer | Called by the as-built dispatch branch on a validated result, at the settle boundary where run identity is stamped. |
| Single typed-verdict reader | Replaces `parseAsBuiltVerdict`, `classifyAsBuiltReviewOutcome`, and `parseAsBuiltBlockedFindings`. It is read by: the completion predicate; the validation-group join; the serial halt/kickback path; `planRemediation`; the recorded-findings projection; `shipment-association` / finish publication; the stale sweep; retry classification; rebase preservation; rekick; rewind; and the pre-finish fence. |
| Remediation-seam pending-findings accessor | Called by the projection builder only. |
| One-shot step union admits `architecture_review_as_built` | Reached from `DefaultStepRunner.run` for this step. |
| §12 skill-contract audit rule | Wired into `test/test_harness_integrity.sh` through `test_provider_skill_contracts.sh` (existing wiring). |

The early overlap scan over the step runner, conductor, artifacts, as-built policy, verdict
line, shipment association, gate code validity, kickback ledger, group core, the skill, and the
provider contract audit reported "No overlap detected; no open blockers" (advisory).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A consumer is left on the Markdown path, so it silently keeps old behavior or fails to read the typed verdict. | Integration | Medium | High | Delete the parsers (not deprecate them) so any missed reader fails to compile. Add a repository check that no engine source reads the report `.md`. Prove the consumer rewire through production dispatch paths with fake providers (outcome 7). |
| An always-fresh engine write launders a stale verdict. | Data | Medium | High | Run-identity D3.1 and D7.1: the handshake observes a validated result from this dispatch, and an as-built artifact has no mtime fallback. Test a prior-attempt artifact with a fresh mtime scoring `absent`. |
| Projection limits too tight, so a large real feature halts deterministically. | Technical | Low | High | 09-07 D7.1: limits no smaller than the corpus maximum at BUILD, enforced by a corpus test. Diff overflow degrades to omissions, not a fault. |
| The reviewer's quality drops because it no longer reads the whole plan, or the ADRs it used to search. | Knowledge | Medium | Medium | On-demand reads of code and APPROVED ADRs stay permitted and are described in the skill. The OD-5 scope includes every ADR the plan cites. #2377 re-measures afterwards. |
| An in-flight feature reruns an already-approved as-built review once after upgrade. | Technical | High | Low | Accepted (OD-6): one extra review lap, never a wrong verdict. |
| Forcing `interactive: false` removes operator conversation with the as-built reviewer in interactive conduct runs. | Technical | Low | Low | Same trade-off #2384 accepted. The skill stays usable interactively outside the engine (outcome 5). |
| An unresolvable reference now reruns before it halts, so the operator is involved later than today. | Technical | Medium | Low | Bounded by the existing step retry budget (OD-1). The halt names the field. |
| This change collides with #2521 (PRD audit), #2440 (finding history), or #2184 (reviewer responsibilities) building on the same seams. | Integration | Medium | Medium | #2521 and #191 follow this issue. #2440 and #2184 consume its contracts. Contract versions are explicit so each successor bumps its own. |

## ADRs Created

None (OD-3). Four existing ADRs are amended, each with operator direction from this session:

- `adr-2026-08-25-as-built-remediable-findings-bounded-build-route`: D1.1, D2.1, D6.1, D7.1.
- `adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity`: D2.1, D3.1, D7.1 (as-built only).
- `adr-2026-09-07-durable-prd-widening-decision-reconciliation`: D6.2 (third native-schema
  consumer plus the input projection) and D7.1 (as-built bounds).
- `adr-2026-09-02-adr-decision-citability-contract`: D6.1 (operator-approved scoping of
  persisted as-built references).

Cited without amendment: adr-2026-07-13-session-fresh-verdict-artifacts,
adr-2026-07-22-gate-evidence-code-validity-on-redispatch, adr-2026-07-10-validation-group-join,
adr-2026-08-22-as-built-review-runs-always-with-plan-gap, and
adr-2026-09-11-finish-mergeability-respects-active-review-inputs. Each is resolved by the
amendments above or unchanged in effect (A-1, A-5, A-8, A-9).

## Conditions

1. The plan carries one Architecture Obligation Coverage row for every citable decision id of
   the four amended ADRs: 9 + 9 + 10 + 7 = 35 rows.
2. The as-built Markdown parsers are deleted under the `code-removal` skill. No reader of the
   report `.md` remains in engine source, and a repository check enforces this.
3. Every consumer in the Wiring Surface reads through the single typed reader, proven through
   production dispatch and consumer paths with fake provider boundaries. That proof covers
   invalid output, missing output, unsupported capability, and over-limit input.
4. The verdict is a discriminated union: `outcomeDelivered` only on `PLAN_GAP`, and findings only
   on `BLOCKED`.
5. Projection limits are set no smaller than the corpus maximum when BUILD starts, and a corpus
   test proves this.
6. The §12 audit is scoped to §12. The other modes of the skill and its existing
   judgement-prose pins are unchanged.
7. Consumers still route the bounded remediation route, caps, the single appender, validation-group
   primacy, and `existing-task` restage exactly as before, as asserted by the existing
   remediation acceptance tests.
8. An intake issue for the dead review-required marker question (OD-4) is filed in this DECIDE
   session.
9. The shipped record's bold-`Outcome delivered` inconsistency
   (`shipment-association.ts:201` versus `artifacts.ts:1611`) disappears with the parsers. The
   plan asserts that a delivered PLAN_GAP reaches the shipped record.
