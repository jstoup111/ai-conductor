# Architecture Review: Operator action inbox and additional issue closures

**Date:** 2026-09-30
**Input reviewed:** Approved PRD FR-1 through FR-16; approved product track and full scope; six approved diagrams
**Tier:** Large — full DECIDE review
**Stories reviewed:** 18 accepted stories; conflict-resolution amendment recheck completed 2026-09-30
**Verdict:** APPROVED WITH CONDITIONS — operator approved the ADR and four scoped amendments on 2026-09-30

The design is feasible on the existing stack. The conditions below bind the implementation plan and validation; they are not
unresolved architectural choices. No implementation has been written or tested.

## Feasibility

| Concern | Assessment and evidence | Basis |
|---|---|---|
| Case persistence | `RemediationCaseStore.mutate` already provides feature identity, leased admission, validation and atomic replacement. Add the post-ship domain and explicit scope; production stays filesystem-backed. | Verified source |
| Authority isolation | Existing PRD-widening domain selectors already separate unrelated case authority. Post-ship state must never enter accepted-risk or BUILD reducers. | Verified source and governing ADR |
| Non-blocking review | Deferral currently waits on intake in the effect executor, effective reducer, recurrence predicate and clean-PASS path. All must recognize applied local handoff together. | Verified source |
| Lifetime beyond cleanup | The existing store is worktree-local. Root action storage plus committed source snapshots supply the approved retention requirement. This is new work, not assumed existing behavior. | Verified gap; proposed architecture |
| Executor isolation | `FeatureTerminalEffects`, `collectOne`, and the production terminal-effects callback already carry shared-root writes across the dispatcher boundary. | Verified source |
| Historical data | Structured shipped findings and explicit recorded audit sections exist; repaired as-built rows coexist with open concerns. A pure parser/importer can consume them without running a reviewer. | Verified source and retained records |
| Optional intake | Existing `applyBuildReviewDeferralEffect` reserves/reuses exact effect markers through the tracker seam. Reuse that recovery pattern, separating publication from gate settlement. | Verified source |
| Additional issue targets | Existing marker writer retains one source; existing daemon linker consumes one source and returns ambiguous failure/no-op results. Multi-target parsing and typed shared publication are new. | Verified source |
| Declaration authority | The seal records baseline commits but does not include intake markers. Add a selective closure descriptor, preserving it across automatic rebaseline. Protecting the whole marker would conflict with owner stamping. | Verified source; proposed scoped extension |
| Hosting behavior | GitHub supports fully qualified closing references for multiple issues on PRs targeting the default branch. Do not claim closure coverage on other bases. | Verified official documentation cited in the ADR |

No new database, service, port, account, provider capability, or authentication system is needed.
The current TypeScript/Node filesystem and process seams suffice. External issue publication keeps
the existing configured adapter and ownership guards; extra merge-closure references are explicitly
GitHub targets, not a promised cross-tracker transition mechanism.

## Complexity

Large is retained because the design intersects independent review, source retention, action
resolution, optional publication, and FINISH provenance state machines. Most risk is at their
boundaries, not in the command renderer. The two deliverables are separated by plan ownership:
action-domain work and additional-closure work share provenance/publication constraints but neither
may turn into an unrelated case-store or CLI rewrite.

No directory deletion is proposed. No new skill or provider-specific invocation seam is needed.
The bounded implementation should add domain adapters around existing machinery, not move every
gate to a new generic review framework.

## Alignment

The approved logical diagrams remain accurate: source capture belongs to the review result path,
durable actions belong to the operator workflow, and optional publication is outside shipping
eligibility. The structural ADR supplies the missing split between feature-local source capture and
dispatcher-owned repository retention. It does not change the approved user-visible flows.

### Governing authority

- Reuse the PRD widening ADR's shared persistence and separate authority pattern; the proposed v3
  extension preserves v1/v2 data and keeps new domains out of existing reducers.
- Reuse dispatcher/executor D1 without broadening executor permissions or adding a live-boundary
  exclusion. Return source payloads; perform shared mutations after collection.
- Reuse engine-owned FINISH: close-reference completeness is observed publication evidence, not a
  provider promise or a new progress ledger. The same production coordinator covers both modes.
- Reuse the tracker and GitHub operation guards. Refusal cannot be reported as success, and
  publication cannot fall back to a raw transport.
- Extend `ConductorEvent` and its registered sinks. Durable action status is exception-C state;
  standalone process ledger placement uses exceptions A/B with the same schema and reader path.

### Approved reconciliation of predecessor decisions

The old automatic `beyond` filing prescription and the present remote-deferral-before-PASS
requirements conflict with the now-approved optional-intake product. The approved ADR replaces only
those obligations and their settled-effect consequences. It preserves judgement, source coverage,
mixed-lap infrastructure blocking, security authority, and the existing action-work-order budget.

The four amendments enumerated in ADR D12 were approved and applied beside the old assertions
in DECIDE on 2026-09-30. They are not BUILD tasks.

### Focused pattern basis

- **Shared case mutation:** `RemediationCaseStore.mutate` and
  `selectPrdWideningRemediationCases` demonstrate separate domains, preserved sibling state, one
  lease, and atomic replacement. Keep those traits; scope selection and v3 fields may change.
- **Cross-boundary collection:** `FeatureTerminalEffects.engineerSignal` carries evidence captured
  before teardown and is applied by `daemon-cli.onFeatureTerminalEffects`. Keep serializable
  payloads, dispatcher ownership, and idempotent replay; action records have their own domain.
- **Recoverable publication:** `remediationEffectMarker` and
  `applyBuildReviewDeferralEffect` prove exact marker lookup before create. Keep identity and guarded
  transport; depart from holding the feature mutation lease over network I/O by using an
  action-publication lease and short state mutations. Gate settlement no longer depends on it.
- **Retained evidence:** `recordedShipmentFindings` and
  `appendRecordedShipmentFindings` are the source-snapshot precedent. Add action provenance to the
  existing shipped record, not mutable operator resolution state or occurrence timestamps.

These are semantic pattern requirements and rediscovery hints, not exact source-copy contracts or
line-coordinate constraints. The current code is not authority where the listed new ADR amends it.

## Domain Integrity

- Introduce parsed semantic action IDs, source keys, publication IDs, closure-target sets, and
  canonical feature identity. Raw command strings do not reach storage or remote operations.
- Resolution and publication are separate tagged unions; `published` is not `acted-on`, and risk
  acceptance is not action resolution. No collection of booleans should permit contradictory states.
- An applied local handoff is a distinct effect type. It cannot masquerade as an applied remote
  issue effect or an attempted BUILD repair.
- A root action scope may own operator decisions, but a feature scope may only capture source
  observations. Validators enforce scope as well as envelope shape and feature ownership.
- Existing case links carry established semantic judgement. Exact replay is bookkeeping;
  similarity, report ordinal reuse, or absent findings cannot manufacture a new operator decision.
- Old and new readers explicitly distinguish absent data, unsupported version, corrupt data, and
  partial recovery. Unknown variants fail clearly; production defaults remain persistent.
- Closure declarations are read from their approved committed provenance, with a selective seal
  commitment that automatic rebase cannot rewrite. Tracker text is never authoring authority.

## Wiring Surface

Paths identify candidate modules, not a requirement that helpers remain in those files forever.
Each row names a production entry path and the boundary behavior its plan task must prove.

| Surface | Candidate paths / production entry | Observable commitment |
|---|---|---|
| v3 case domain, scope factories, selectors | `engine/remediation-case-store.ts`; constructed by review capture, terminal collection and action commands | Preserve old domains; refuse foreign scope; persist operator state across process restart |
| Source normalization | New `engine/post-ship-actions.ts`, called after shared classified review routes in `engine/conductor.ts` and build-review coordinator | Only consumed non-blocking evidence becomes an action source in serial and group execution |
| Local handoff effect | `engine/remediation-case-effects.ts`, `remediation-case-validator.ts`, `build-review-adjudication.ts`, `build-review-adjudication-coordinator.ts`, `remediation-case-reconciler.ts`, relevant context/store parsers | Deferral settles locally in every effective/recurrence path without granting PASS to blockers |
| Retained shipment source export | `engine/shipment-association.ts`, `shipped-record-cli.ts`, `finish-publication-production.ts`; existing shipped-record path | Source IDs and evidence survive normal cleanup; root operator decisions are never overwritten by a snapshot |
| Terminal import | `engine/feature-executor.ts`, `daemon-runner.ts`, `daemon.ts`, `daemon-cli.ts`, attended outer return in `index.ts` | Executors perform zero shared-root action writes; collection and attended return use the same importer |
| Action commands | New `actions-cli.ts`, registered in `cli.ts` and pre-build dispatch in `index.ts` | list/resolve/file/recover work without entering BUILD; local operations require no network |
| Historical parser/import | New `engine/post-ship-recovery.ts`, called by `actions recover` and terminal import for supplied source snapshots | Source-specific partial results; no reviewer invocation or duplicate/reopened action |
| Optional publication | `remediation-case-effects.ts` recovery primitives and canonical intake/tracker composition, called only by action-file command | Exact marker recovery, ownership checks, concurrency protection, no review wait |
| Source marker set | `engine/engineer/intake-marker.ts`, shared issue-ref parsing, `land-spec.ts`, marker owner/outcome rewrite callers | Preserve/validate all explicit targets outside inbound armor, including non-intake specs |
| Committed closure authority | `engine/protected-artifact-seal.ts`, `reseal-cli.ts`, provenance reads at common publication; transport may include `work-order.ts` | Automatic rebase cannot adopt BUILD-added targets; explicit reseal owns intentional revision |
| Multi-target publication | `engine/engineer/issue-ref.ts`, `engine/finish-publication.ts`, `finish-publication-production.ts`, `ship-draft-pr.ts`, daemon compatibility caller | Complete closing references on the actual implementation PR; safe retries preserve unrelated content |
| Spec references | `engine/engineer/handoff.ts` | Spec publication links with Refs and never closes the declared issues |
| Action and closure events | `types/events.ts`, `engine/event-sinks.ts`, owning emitters and `EventPersister` | One schema; explicit delivery choices; no event success before state/effect confirmation |
| External-process event consumption | `engine/daemon-ledger-readers.ts`, `daemon-observe-cli.ts`, existing render handlers | Repository timeline parses and renders action event variants and merges the single-writer ledgers |
| Operator documentation | `README.md`, affected `docs/reference/cli.md` and daemon/operator guide sections | Explain durable local actions, recovery, optional filing, and declarative merge closure |

### Early overlap scan

Ran `ai-conductor overlap-scan --files ... --source-ref jstoup111/ai-conductor#1810` on the existing
candidate surfaces before planning. It reported:

- `origin/spec/daemon-self-host-guardrails`: `engine/conductor.ts`.
- `origin/spec/self-host-phase6-wiring`: `engine/conductor.ts`, `daemon-cli.ts`.

The scan's remote dependency request failed to connect. A subsequent direct native dependency read
succeeded with an empty list. Read-only open-PR queries for both named sibling heads also returned
empty lists. Thus these are advisory local-ref overlaps, not verified open PR blockers. No fetch,
rebase, branch deletion, or assumption that the local refs are current was needed. Recheck changed
contracts at BUILD entry rather than freezing source coordinates in the plan.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| v3 writer drops old case, effect, or operator evidence | Data | Medium | High | Explicit migration preservation and cross-domain mutation tests; reject unknown formats |
| One effective-verdict path still requires remote intake | Integration | Medium | High | Enumerate reducer/recurrence/clean-PASS consumers; production entry coverage in both execution modes |
| Cleanup races source retention or dispatcher crashes | Data | Medium | High | Committed source snapshot plus terminal payload; repeatable explicit recovery; existing reap authority retained |
| Similar legacy prose incorrectly inherits a resolution | Data | Medium | High | Exact retained source replay only; existing judged relations only; named ambiguity rather than guessed equivalence |
| Concurrent operators create duplicate issues or overwrite decisions | Integration | Medium | High | Separate publication lease, marker reuse, short state leases and revision checks |
| BUILD inserts extra issue closures or rebase silently adopts them | Security | Medium | High | Committed declaration descriptor survives rebaseline; no parsing inbound issue text as declaration |
| Body update overwrites unrelated PR content or misreports coverage | Integration | Medium | High | Typed read/write/read outcome; no empty-body fallback; preserve regions; common FINISH owner |
| Standalone event file is persisted but invisible to readers | Integration | Medium | Medium | Same-schema timeline parser and renderer wiring are explicit production obligations |
| Large histories exceed memory/output bounds | Performance | Low | Medium | Paginated display, bounded feature reads, explicit partial diagnostics; no history pruning |

## ADRs Created

- [Durable post-ship action cases and explicit merge-closure provenance](adr-2026-09-30-durable-post-ship-action-cases.md): APPROVED by the operator on 2026-09-30. One feature ADR covers the connected source/state/publication authority decisions; existing architecture is reused everywhere else.

## Conditions

The implementation plan must bind each new boundary to one owning task and its
production-entry proof. In particular: migration preservation; zero executor root writes; review
PASS independent of remote intake but not genuine blockers; recovery after cleanup; publication
retry after uncertain create; and closure provenance across rebase/body edits. These are scoped
behavioral obligations, not a terminal catch-all testing task.

Automated validation uses faithful local tracker/Git boundaries and must not create live issues or
PRs. Full-suite execution remains owned by the configured test gate. This DECIDE review executed no
tests, typechecks, builds, or production mutations; diagram rendering was already checked separately.

## Conflict-resolution amendment recheck

The operator approved merge-time closure precedence and the additional predecessor corrections
on 2026-09-30. New ADR D11-D12, the observed-close/FINISH predecessors, and affected stories now
agree: implementation origin/extras close at merge, extras-only publication is admitted, and
required local handoff is distinct from optional remote filing. No watcher or additional implementation seam beyond the approved architecture
is required. The original scoped implementation conditions remain in force.

## Blocking Issues

None. The operator approved the structural ADR, its four original predecessor amendments,
and the three additional closure/FINISH predecessor corrections resolved during conflict-check.
All seven predecessor ADR amendments are applied; BUILD proof obligations remain required.

## Verify-Claims Ledger

All existing-behavior claims above are verified by the named source symbols or approved decisions at
`cb4b8b86a`; the external closure semantics are verified against the official documentation linked
in the ADR. New field names, commands, paths, bounds, and lifecycle choices are explicit approved
decisions, not claims about existing behavior. The operator approved the full product scope,
approach A, product track, PRD, logical diagrams, and structural architecture. No additional business requirement is assumed.

Verdict: VERIFIED against inspected source, governing decisions, and explicit operator approval.
There is no unverified technical capability being treated as established. The accepted stories and pending implementation plan follow the approved architecture and
applied predecessor amendments.

## Plan ownership recheck

The operator-approved 40-task plan names production owners and checks for every architecture condition:
v3 preservation and isolation (1–3), authoritative capture and local settlement (4–10), outer
collection and cleanup recovery (11–12, 17–19), offline decisions (13–16), publication recovery and
concurrency (20–23), existing event readers (24–26, 40), and sealed closure authority plus common
FINISH (27–39). Its 53-row architecture-obligation table accounts for every citable decision in the
eight changed ADRs. Engine bookkeeping validation passes. Coherence-check subsequently judged all 53 decision
obligations and recorded CLEAR; the operator approved its report on 2026-09-30.

The criterion-only independent plan review returned 97/97 `asserts`; this is evidence that the
checks require the accepted outcomes, not evidence of implemented or tested behavior. The six
existing diagrams show these planned ownership boundaries and their plan updates are operator-approved.

Coherence refinement made existing architecture obligations explicit in five task check blocks.
The 11 affected criterion bindings passed fresh independent judgement; task count and scope are unchanged.
