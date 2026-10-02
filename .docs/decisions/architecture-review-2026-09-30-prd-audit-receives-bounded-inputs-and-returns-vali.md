# Architecture Review: PRD-audit bounded inputs and typed verdicts

**Date:** 2026-09-30
**Source:** jstoup111/ai-conductor#2521; incorporates closed #2875
**Track / tier:** technical / L, operator-approved
**Inputs reviewed:** approved track and diagrams; existing ADRs, source and tests.
**Verdict:** APPROVED WITH CONDITIONS
**Approval:** Operator approved the complete proposal and all three additive ADR amendments in chat on 2026-09-30.

## Scope and feasibility

The operator selected full migration of PRD audit, using the shipped as-built pattern, rather
than repairing reviewer-written Markdown. The diagram boundary was approved on 2026-09-30.
This review covers architecture before stories; no implementation plan or stories exist yet.

Verified from current source:

- `DefaultStepRunner.run` and `executeProviderAwareSkillOneShot` already carry engine-rendered
  as-built inputs and `nativeSchema` through the existing provider runtime.
- The Claude and Codex adapters expose `finalStructuredResult`, structured-result failures,
  and native-schema capability. No new library, provider CLI flag, or transport is required.
- `parsePrdAuditReport`, `overScopeRelations`, `classifyPrdAuditGaps`, completion predicates,
  conductor remediation/widening paths, and shipment readers still depend on Markdown.
- `preparePrdWideningEntry` captures operator decisions before review.
  `coordinatePrdWidening` already owns semantic reconciliation and freshness checks.
- `as-built-verdict-store.ts` separates typed authority from its human report. PRD audit can
  adopt this ownership without sharing its judgment vocabulary or inventing a generic registry.

No external research or new runtime dependency is required. No live provider behavior has been
tested in this DECIDE session; BUILD must prove the adapters with faithful injected boundaries.
All new state remains feature-worktree-local. There is no new server, port, watcher or daemon.

## Complexity

Large. The hard part is preserving meaning across all consumers, not defining a JSON object.
The migration crosses dispatch, storage, completion, serial/group routing, bounded repair,
scope decisions, resume/rebase/rewind and publication. A writer-only delivery would leave
competing authorities, so these changes belong in one feature. No production directory deletion
is planned; removing obsolete symbols follows the code-removal survivor method.

## Approved decisions

### 1. One bounded input projection, with existing authorities

Add a feature-scoped PRD-audit projection builder, beside the as-built projection.
Resolve the active plan using the existing feature resolver and its Stories reference.
Carry the full authoritative criterion set with stable identifiers and happy/negative kind,
plan task IDs, their ownership and Done-when blocks, and the plan outcome.
Resolve applicable PRD intent (including goals/non-goals and scope when present) and requirement
references through existing feature-resolution and FR parsing. Include committed coherence
mapping when present, scoped changes and relevant Scope/reseal evidence, and existing
feature-local prior findings and original operator decision history.

No-PRD is an explicit normal case for technical work. Optional absent history is empty history;
present corrupt/foreign/unsupported history is a named fault, never empty authority.
Do not depend on the unshipped history expansion #2440 or implement it here.
Read available state through existing owners, after the existing pre-review decision capture.

The engine owns a versioned contract and named finite limits per structured dimension and total
projection size. Adopt the as-built diff caps (256 KiB per file, 512 KiB total) and its explicit
omitted-path/digest representation, permitting read-only source inspection on demand.
Required structured inputs are never silently truncated. Missing/unreadable/over-limit input
names the dimension, source path and, for overflow, actual size and limit before provider dispatch.

Use the as-built 256 KiB floor for plan tasks and criteria. Choose PRD-intent, coherence and
available-history constants from the corresponding repository corpus at BUILD, rounded upward
and recorded alongside the constants; each must fit the largest corresponding normal input
observed then. The total cap must admit the documented component limits plus envelope overhead.
These are deterministic engineering limits, not new operator configuration. A history store's
existing tighter reconciliation limits remain unchanged.

### 2. The provider returns judgment, never identity or authority

The engine owns a versioned JSON Schema, renders its prompt shape from that schema, and
passes it through the existing native-schema one-shot path. Managed interactive conduct also
uses this non-REPL invocation; standalone interactive skill use remains conversational.
Retain provider selection, fallback, authentication, rate-limit handling, accounting and
per-retry fresh sessions. A provider without the required capability gets a named recovery
diagnostic; do not silently fall back to a prose report.

The output contains criterion judgments and no-owner scope observations, with evidence and
rationale. Criterion references are structured story ID plus criterion ordinal, resolved against
the supplied authoritative set. Preserve alphanumeric/nested story IDs and case-insensitive
matching. Task references are arrays of IDs checked through the shared plan-task resolver;
non-numeric remediation IDs and multiple evidence citations remain supported. FIXABLE has
exactly one owning task. Requirement associations identify the resolved PRD and requirement.

Grades remain PASS, FIXABLE, PLAN_GAP and OVER_SCOPE. OVER_SCOPE alone carries the closed
intent relation within, outside-harmless or outside-visible. No-owner observations admit only
OVER_SCOPE; their NC ordinals are assigned deterministically by the engine for presentation
and are never semantic identity. The reviewer cannot submit an accepted/refused decision,
an attempt identity, a code stamp, a recorded disposition or an overall authoritative PASS.
The engine derives completion from validated findings and existing policy.

### 3. Preserve independent finding validation

Retain the existing distinction between an unusable result envelope and independently invalid
finding entries. Missing/malformed terminal output or an unsupported root version yields no
new authoritative judgment. Where a recognized envelope exposes independently readable entries,
validate each entry and retain valid siblings alongside engine-authored rejection diagnostics.
The native schema remains restrictive; native enforcement failure does not authorize scraping
intermediate output or chat to recover rows.

An invalid grade/shape/reference, missing required owner, invented criterion, or duplicate
normalized criterion rejects the affected entry (every carrier of a duplicate is rejected).
Diagnostics name the entry/index and defective field/reference. Require complete criterion
coverage; omitted criteria produce named incompleteness diagnostics. An incomplete result may
retain valid evidence but cannot pass, become accepted by an OVER_SCOPE/negative-gap override,
or turn a rejected entry into repair work. Existing valid-sibling consumption is retained;
this feature does not broaden partial-result routing.

Preserve the PRD/story traceability check: a resolved requirement without story coverage must
remain an explicit blocking gap unless valid existing criterion PLAN_GAP evidence accounts for
it under the current contract. Do not invent a story criterion, turn it into a no-owner
OVER_SCOPE row, or invent a new requirement-only repair authority to satisfy the schema.

### 4. Engine-owned persisted verdict and derived report

Use `.pipeline/prd-audit.json` as the new versioned run-evidence authority and
`.pipeline/prd-audit.md` as its derived human view. A single reader returns a discriminated
present/absent/invalid result; present data explicitly carries validation completeness and
diagnostics as well as its validated findings.

The engine records the provider-lifecycle attempt ID and reviewed code stamp through the
existing gate identity/code-validity contract. Persist using atomic replacement and await the
report renderer before returning successful dispatch. No new clock-based proof or provider-
echoed identity is introduced. A failed authority write or report render is a named mechanical
failure; it cannot be laundered into success by an old file. Later engine-owned finding
projections update the typed record and regenerate the report through the same writer.

Keep original judgment and derived recorded dispositions distinct inside the envelope.
Operator authority stays in the existing decision store, never in a provider field or report.
Render evidence and disposition details for people; every machine consumer reads typed state.
Human edits, wording, table layout, and report mtime cannot change a gate outcome.

### 5. One reader across all consumers

Rewire completion, code-validity preservation, freshness handshake, stale sweep, retry
classification, serial and validation-group routes, remediation admission, widening
reconciliation/projection, replay/resume/rekick, rebase preservation, operator rewind,
pre-finish fence, shipped findings and finish publication to the typed authority.

Do not leave a typed-to-Markdown-to-parser compatibility bridge. Existing pure domain
functions may receive validated typed data from the reader; they must not independently
re-parse or reconstruct the verdict. Remove obsolete PRD Markdown parsing and its fallback
after survivor coverage is established. No production directory is deleted in this feature.

### 6. Missing output is a mechanical failure, not a finding

After an attempted review, only that dispatch's validated persisted result can satisfy its
handshake. An old artifact does not count even when it has a current mtime or a separately
refreshed identity stamp. Name the step, expected attempt and artifact, and state that the
current dispatch produced no verdict. Include a found prior identity only as supporting detail.

Use the existing absent-result retry lane with the resolved step allowance for missing or
invalid reviewer output, then needs-human on exhaustion. Deterministic input and unsupported-
capability faults halt without repeating the same provider call. Preserve higher-priority
provider authentication/rate-limit/model-unavailable handling. Partial-entry diagnostics stay
mechanical evidence defects; they are not fabricated substantive findings.

In a validation group, an exhausted no-verdict branch cannot become a synthetic remediation
gap; preserve the existing join policy and verified completed siblings. Do not redesign
budgets, consolidated remediation or group scheduling.

Carry #2875's diagnostic into the already-typed as-built path where its missing-result case
currently falls through to a missing/stale artifact message. Keep its engine-owned persistence
and judgment semantics unchanged. Both skills must describe their managed output responsibility
consistently. This is the only as-built functional adjustment in this feature.

### 7. Preserve widening authority and replay

Keep decision capture, immutable original offers, explicit reversals, uncertain relationships,
refusals and their provenance under the existing #2429 owners. Criterion decisions remain
criterion-scoped; NC decisions remain tied to original behavior through validated case relations.
Source IDs and current-source projection preserve their existing semantic ingredients.

Replace current-report parsing/digests with canonical source-bearing typed content. Exclude
derived report formatting and recorded-disposition projections from reconciliation identity,
so rendering cannot invalidate its own replay. Existing stored original Markdown snapshots
remain immutable historical evidence, not a current verdict. They need no destructive rewrite.
Existing reportSnapshot provenance fields may receive a deterministic rendering of the validated
source; they are bounded historical context and are never parsed to decide authority.

Reuse remains conditioned on source/code/feature/decision revision/contract version. Update
the current projection contract version where the representation changes so a prior cached
relation cannot be trusted under a different digest convention. Preserve decisions and original
cases; a changed projection may require reconciliation once, never operator re-approval merely
because presentation changed.

### 8. Compatibility and preservation

A worktree with only the old PRD report must rerun PRD audit through the lifecycle once. Never
manufacture a typed verdict by parsing historical Markdown. Retain legacy operator-decision
import, HALT.cleared capture and current decision stores unchanged.

For a valid typed result, preserve the existing code-stamp-first rule before a new dispatch:
the gate surface includes story/PRD inputs; unreachable/unexplained stamps, relevant changes,
uncomputable validity and incomplete evidence fail closed. Preserve the engine-owned rebase
translation and selective-replay proofs. Recheck current blocking findings and current
operator-decision state before honoring a preserved PASS.

The gate-code-validity opt-out may disable cross-run preservation but cannot re-enable
Markdown/mtime authority for the migrated step. Manual-test remains unchanged.
Rewind and sweep handle the typed artifact and report as one evidence family and never delete
durable widening authority. No config schema, CLI command, hook or installed skill target changes.

### 9. Skill and execution boundaries

PRD-audit skill guidance retains judgment, evidence quality, scope semantics, delegation
ownership and waiting for all delegated work. Remove its engine-managed input-reading recipe,
machine table/key grammar and mandatory report-write instructions. The schema/projection are
engine-owned; the same schema produces the dispatched shape description.

Both validators retain the prohibition on executing tests/builds/lint/project modules and on
unrelated writes. Managed PRD audit no longer has permission to write either its verdict or
accepted-widenings.json; those are engine responsibilities. Standalone skill use produces a
human judgment without claiming a managed persisted gate verdict.

Preserve existing provider permissions and containment; do not add an unrequested universal
sandbox or claim that read-only filesystem settings prohibit arbitrary project-code execution.
Proof here covers emitted invocation contracts and engine-owned effects with fake providers,
not a guarantee about a real model's arbitrary behavior. Existing provider read-only review
profiles are currently wired to build_review, not this SHIP migration.

Extend the existing provider contract audit at its established semantic boundary to catch
reintroduction of machine contract recipes. Do not add brittle tests matching ordinary prose
phrasing or tests whose only assertion is that a removed symbol is absent.

### 10. Delivery and test ownership

This feature updates README and affected review/configuration/recovery documentation as part of
the behavior tasks. Explain derived reports, typed authority, the one-time legacy re-review and
missing-current-dispatch recovery. A notable implementation PR will declare release metadata;
the spec PR uses no-note and never edits VERSION or CHANGELOG.

Use real internal projection/dispatch/persistence/consumer paths with fake provider and external
process boundaries. Cover both adapters, input faults before invocation, entry validation,
chat-only output, prior/fresh-timestamp evidence, rendering/persistence failure, row-sibling
retention, all grade routes, decision replay/refusal, and restart/publication behavior.

Most checks belong to unit or focused integration tests; a small bounded serial/group fixture
owns their orchestration differences. Existing tests of widening capture/coordinator/classifier,
PLAN_GAP routing, code validity and shipment semantics are survivor evidence. Characterize any
uncovered survivor before parser deletion. Direct parser-format tests retire with the parser;
incidental behavior tests migrate to typed fixtures. Aggregate proof remains owned by test_suite.

## Governing ADR alignment and approved amendments

No new architectural family is introduced. Three existing ADRs cover the integration, state and
authority boundaries and were amended additively in this DECIDE pass after operator approval:

1. `adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity`: beside D2/D3/D7, extend the
   as-built engine-writer and validated-result handshake to PRD audit; its legacy/opt-out path
   never falls back to Markdown or mtime. Preserve D1/D4-D6/D8-D9 and the code-validity amendment.
2. `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback`: beside decision 3, change
   the transport from criterion tables to validated typed findings while retaining grades,
   single FIXABLE owner, no-owner scope semantics and independent-row rejection; beside
   decision 8, move recorded findings to engine-owned typed state and derived report.
   No change to decisions 1/2/4-7, including #2753's BUILD-dispatch budget charging.
3. `adr-2026-09-07-durable-prd-widening-decision-reconciliation`: beside D5/D6/D7/D8, describe
   typed current-source input, the fourth native-schema consumer, full-audit projection bounds,
   and typed source-bearing freshness. Keep historical snapshots and D1-D4 authority,
   reconciliation ownership, D9 observability and D10 delivery boundaries intact.

`adr-2026-08-30-shared-plan-task-reference-resolver` needs no semantic amendment: structured
arrays feed the existing resolver and preserve its normalization, membership and multi-citation
behavior; no independent grammar is added.

The validation-group and code-validity ADRs remain binding. The changed artifact location is
an input migration, not a new satisfaction authority or an exception to their join/preservation
rules. No other feature's protected artifacts become BUILD tasks.

## Domain integrity

- The engine derives outcome; no provider boolean can assert satisfaction.
- Criterion and task references resolve against independent authoritative sets.
- Persisted state distinguishes complete judgment, incomplete judgment with diagnostics, and
  no usable judgment; a rejected entry is never converted into a synthetic finding.
- Scope observations and operator decisions remain different types and different owners.
- A shared typed reader is the anti-corruption boundary between stored evidence and routing.
- Semantic same-case decisions remain with the existing LLM reconciliation, constrained by its
  schema; this migration does not replace judgment with summary matching.

## Wiring surface

| Production surface | Existing caller / consumer | Candidate paths |
| --- | --- | --- |
| PRD projection builder and renderer | DefaultStepRunner PRD branch, before provider dispatch | new prd-audit-projection.ts; step-runners.ts; existing feature/plan/story resolvers |
| PRD output schema and entry/reference validator | Native-schema invocation and terminal-result validation | new prd-audit-contract.ts; step-runners.ts; plan-task-parse.ts reused |
| Typed store, reader and Markdown renderer | Step runner persists; conductor projects records; all readers consume | new prd-audit-verdict-store.ts; artifacts.ts; conductor.ts |
| Freshness/fault contract | Serial handshake and validation-group join through existing completion | conductor.ts; artifacts.ts; group-core.ts if needed; runner result types |
| Widening typed input and replay projection | Existing capture/coordinator and effective classification | accepted-widenings.ts; prd-widening-context.ts; prd-widening-coordinator.ts; conductor.ts |
| Preservation and evidence lifecycle | Completion, sweep, rebase, restart and rewind | gate-code-validity.ts; artifacts.ts; rewind.ts; daemon-rekick.ts if needed |
| Shipment findings | Production publication coordinator and shared shipment association | finish-publication-production.ts; shipment-association.ts |
| Managed output responsibility and contract audit | Provider-rendered skill invocation and existing integrity audit | skills/prd-audit/SKILL.md; architecture-review as-built guidance only; test/test_provider_skill_contracts.sh |
| Missing-current-output as-built diagnostic | Existing as-built typed-result handshake | conductor.ts; step-runners.ts |

Paths are rediscovery hints, not permission to change every named file. Resolve actual production
callers at BUILD. The plan must assign exactly one integration-proof owner per changed boundary.

## Overlap scan

The required advisory scan reported overlap on conductor.ts with:

- origin/spec/daemon-self-host-guardrails
- origin/spec/self-host-phase6-wiring

No open blocker was reported for #2521. The scanner warns that renames/name-only diffs may not
be detected. This is an advisory coordination risk, not authority to modify those branches.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| A hidden Markdown reader survives and disagrees with typed authority | Medium | High | Exhaustive caller inventory, remove parser seam, targeted consumer integration proof |
| Refusal or acceptance is lost during replay | Medium | High | Preserve stores/case IDs; compare typed source snapshots and decision revision; existing decision-replay survivor tests |
| Invalid sibling evidence is laundered into a pass or silently discarded | Medium | High | Persist complete/incomplete discriminator and entry diagnostics; test mixed valid/invalid entries and every override path |
| An engine write blesses old judgment | Medium | High | Current attempt result required after dispatch; no mtime fallback; test old verdict with fresh timestamps |
| Input bounds erase obligations or cause unexplained failures | Medium | Medium | Corpus-based named constants; no structured truncation; explicit diff omissions and field-specific faults |
| Compatibility triggers an extra review/reconciliation | High | Low | Accepted one-time transition; preserve original authority and show the recovery reason |
| Concurrent engine work changes an integration seam | Medium | Medium | Re-resolve symbols at BUILD and scope integration tasks; overlap scan is advisory |

## Implementation conditions

1. Operator approval is recorded above; the three additive amendments are in this spec diff before BUILD.
2. Stories cover every #2521 outcome plus the #2875 diagnostic/restriction carryover, with explicit
   survivor evidence and no hidden new cross-gate authority.
3. The plan covers every verdict consumer and the single integration owner for each boundary.
4. BUILD removes the obsolete parser only after survivor coverage and keeps tests fake at all
   provider/process/network boundaries.
5. Full aggregate verification is deferred to the owning test_suite gate.

## Verify-claims ledger

Verified basis: the cited source symbols, existing ADRs and tests were read in this worktree;
the overlap tool was run; #2188/#2429 are closed and #2440 remains open. No observed live-provider
result is claimed. Corpus-specific new limits will be measured at BUILD, not guessed as facts.

Decisions 1-10 and the three ADR amendments were explicitly approved by the operator on
2026-09-30. They are approved choices, not claims about pre-change behavior. No unconfirmed
load-bearing assumption remains.

Verify-claims verdict: CLEAR.

## ADRs created

None. The existing governing architectural shapes are extended by the three approved additive
amendments above; no parallel framework or duplicate authority is introduced.

> **Amended 2026-09-30 by #2521:** BUILD requires #2753 (kickback-cap remediation-to-BUILD settlement) to land first. Its approved ADR is present at this spec base, but its `pendingRepair` implementation is not: `readRemediationGateAppendBudget` still charges through the older append path. Preserve the approved future accounting contract after that prerequisite lands; do not implement #2753 inside this migration. Before spec publication, register #2753 as a native blocking dependency of #2521 so daemon scheduling enforces the order. Recheck the accounting seam against the delivered prerequisite before BUILD. This corrects the earlier description of BUILD-dispatch accounting as already implemented.
